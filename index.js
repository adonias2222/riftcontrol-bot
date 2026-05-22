require('dotenv').config();

const os = require('os');
const express = require('express');
const QRCode = require('qrcode');
const pino = require('pino');
const baileys = require('@whiskeysockets/baileys');
const handleCommand = require('./src/commands/handler');
const { renderDashboard } = require('./src/web/dashboard');

const makeWASocket = baileys.default || baileys.makeWASocket;
const { useMultiFileAuthState, fetchLatestBaileysVersion, DisconnectReason, Browsers } = baileys;

const app = express();
const PORT = Number(process.env.PORT || 3000);
const BOT_NAME = process.env.BOT_NAME || 'RiftControl';
const QR_PASSWORD = process.env.QR_PASSWORD || '';
const AUTH_FOLDER = process.env.AUTH_FOLDER || './auth_info';

let sock = null;
let currentQr = null;
let status = 'iniciando';
let lastError = null;
let startedAt = new Date().toISOString();
let reconnecting = false;
let lastQrAt = null;
let lastOpenAt = null;
let lastCloseAt = null;
let lastConnectionUpdateAt = null;
let lastDisconnectCode = null;
let lastMessageAt = null;
let lastCommandAt = null;
let lastMessageInfo = null;
let totalMessages = 0;
let totalCommands = 0;
let reconnectCount = 0;
let qrCount = 0;
let baileysVersion = null;
let lastPairingCode = null;
let lastPairingPhone = null;
let lastPairingAt = null;
let pairingCount = 0;

function senhaOk(req) {
  if (!QR_PASSWORD) return true;
  return req.query.key === QR_PASSWORD || req.headers['x-panel-key'] === QR_PASSWORD;
}

function onlyDigits(value) {
  return String(value || '').replace(/\D/g, '');
}

function escapeHtml(value) {
  return String(value || '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function extrairTexto(msg) {
  const message = msg?.message || {};
  return (
    message.conversation ||
    message.extendedTextMessage?.text ||
    message.imageMessage?.caption ||
    message.videoMessage?.caption ||
    ''
  ).trim();
}

function formatDuration(ms) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const dias = Math.floor(total / 86400);
  const horas = Math.floor((total % 86400) / 3600);
  const minutos = Math.floor((total % 3600) / 60);
  const segundos = total % 60;
  if (dias > 0) return `${dias}d ${horas}h ${minutos}m`;
  if (horas > 0) return `${horas}h ${minutos}m ${segundos}s`;
  if (minutos > 0) return `${minutos}m ${segundos}s`;
  return `${segundos}s`;
}

function montarStatus() {
  const uptimeMs = Date.now() - new Date(startedAt).getTime();
  return {
    ok: true,
    bot: BOT_NAME,
    status,
    conectado: status === 'conectado',
    qrDisponivel: Boolean(currentQr),
    socketDisponivel: Boolean(sock),
    pairingDisponivel: Boolean(lastPairingCode),
    lastPairingAt,
    lastPairingPhone,
    pairingCount,
    reconnecting,
    startedAt,
    uptimeMs,
    uptime: formatDuration(uptimeMs),
    now: new Date().toISOString(),
    auth: 'local-useMultiFileAuthState + pairing-code',
    authFolder: AUTH_FOLDER,
    lastQrAt,
    lastOpenAt,
    lastCloseAt,
    lastConnectionUpdateAt,
    lastDisconnectCode,
    lastMessageAt,
    lastCommandAt,
    lastMessageInfo,
    totalMessages,
    totalCommands,
    reconnectCount,
    qrCount,
    baileysVersion,
    process: {
      pid: process.pid,
      node: process.version,
      platform: process.platform,
      arch: process.arch,
      memoryMB: Math.round(process.memoryUsage().rss / 1024 / 1024),
      host: os.hostname()
    },
    env: {
      QR_PASSWORD: Boolean(process.env.QR_PASSWORD),
      SUPABASE_URL: Boolean(process.env.SUPABASE_URL),
      SUPABASE_SERVICE_ROLE_KEY: Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY),
      ALLOWED_GROUP_ID: Boolean(process.env.ALLOWED_GROUP_ID),
      OWNER_NUMBER: Boolean(process.env.OWNER_NUMBER),
      OWNER_ID: Boolean(process.env.OWNER_ID || process.env.OWNER_LID),
      ONLY_GROUPS: process.env.ONLY_GROUPS || null,
      LOG_LEVEL: process.env.LOG_LEVEL || 'silent'
    },
    lastError
  };
}

async function gerarPairingCode(phone) {
  const numero = onlyDigits(phone);

  if (!numero || numero.length < 10) {
    const erro = new Error('Informe o número com DDI e DDD. Exemplo: 5598999999999.');
    erro.statusCode = 400;
    throw erro;
  }

  if (status === 'conectado') {
    const erro = new Error('O bot já está conectado ao WhatsApp. Para parear outro número, limpe a pasta auth_info ou recrie o deploy sem sessão antiga.');
    erro.statusCode = 409;
    throw erro;
  }

  if (!sock) {
    iniciarBot();
    const erro = new Error('Socket ainda está iniciando. Aguarde alguns segundos e tente gerar o código novamente.');
    erro.statusCode = 503;
    throw erro;
  }

  if (typeof sock.requestPairingCode !== 'function') {
    const erro = new Error('Esta versão do Baileys não possui requestPairingCode. Use o QR Code.');
    erro.statusCode = 500;
    throw erro;
  }

  status = 'gerando código de pareamento';
  lastError = null;

  const code = await sock.requestPairingCode(numero);

  lastPairingCode = code;
  lastPairingPhone = numero;
  lastPairingAt = new Date().toISOString();
  pairingCount += 1;
  status = 'aguardando código no WhatsApp';

  return { phone: numero, code, generatedAt: lastPairingAt };
}

app.use((req, res, next) => {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.set('Pragma', 'no-cache');
  res.set('Expires', '0');
  next();
});

app.get('/health', (req, res) => {
  res.status(200).send('ok');
});

app.get('/status', (req, res) => {
  res.json(montarStatus());
});

app.get('/api/status', (req, res) => {
  res.json(montarStatus());
});

app.get('/api/qr', async (req, res) => {
  if (!senhaOk(req)) {
    return res.status(401).json({ ok: false, error: 'Senha incorreta.' });
  }

  if (!currentQr) {
    return res.json({ ok: true, qrDisponivel: false, status, lastQrAt });
  }

  const qrImage = await QRCode.toDataURL(currentQr);
  return res.json({ ok: true, qrDisponivel: true, status, lastQrAt, qrImage });
});

app.get('/api/pairing', async (req, res) => {
  if (!senhaOk(req)) {
    return res.status(401).json({ ok: false, error: 'Senha incorreta.' });
  }

  try {
    const resultado = await gerarPairingCode(req.query.phone);
    return res.json({ ok: true, ...resultado, status });
  } catch (error) {
    lastError = error?.stack || String(error);
    return res.status(error.statusCode || 500).json({ ok: false, error: error.message || String(error), status });
  }
});

app.get('/', (req, res) => {
  res.send(renderDashboard(escapeHtml(BOT_NAME)));
});

app.get('/pairing', async (req, res) => {
  if (!senhaOk(req)) {
    return res.status(401).send('Senha incorreta.');
  }

  const phone = onlyDigits(req.query.phone);

  if (!phone) {
    return res.send(`
      <html>
        <head>
          <meta name="viewport" content="width=device-width, initial-scale=1" />
          <title>${escapeHtml(BOT_NAME)} | Pareamento por número</title>
        </head>
        <body style="font-family:Arial;background:#0b1020;color:white;padding:24px">
          <div style="max-width:620px;margin:auto;background:#151b2f;padding:24px;border-radius:18px">
            <h1>🔐 Pareamento por número</h1>
            <p>Digite o número com DDI e DDD. Exemplo: <strong>5598999999999</strong>.</p>
            <form action="/pairing" method="GET">
              <input name="key" type="password" placeholder="Senha QR_PASSWORD" value="${escapeHtml(req.query.key || '')}" style="width:100%;padding:14px;border-radius:12px;margin:8px 0" />
              <input name="phone" type="tel" placeholder="Número com DDI e DDD" style="width:100%;padding:14px;border-radius:12px;margin:8px 0" />
              <button style="width:100%;padding:14px;border-radius:12px;background:#38bdf8;color:#020617;font-weight:bold;border:0">Gerar código</button>
            </form>
            <p><a href="/" style="color:#7dd3fc">Voltar ao painel</a></p>
          </div>
        </body>
      </html>
    `);
  }

  try {
    const resultado = await gerarPairingCode(phone);
    return res.send(`
      <html>
        <head><meta name="viewport" content="width=device-width, initial-scale=1" /></head>
        <body style="font-family:Arial;background:#0b1020;color:white;text-align:center;padding:24px">
          <div style="max-width:620px;margin:auto;background:#151b2f;padding:24px;border-radius:18px">
            <h1>🔐 Código de pareamento</h1>
            <p>Número: <strong>${escapeHtml(resultado.phone)}</strong></p>
            <p>Digite este código imediatamente no WhatsApp:</p>
            <div style="font-size:38px;letter-spacing:8px;background:#050816;padding:22px;border-radius:16px;color:#bbf7d0;font-weight:bold">${escapeHtml(resultado.code)}</div>
            <p>O código expira rápido. Se der expirado, gere outro.</p>
            <p><a href="/" style="color:#7dd3fc">Voltar ao painel</a></p>
          </div>
        </body>
      </html>
    `);
  } catch (error) {
    lastError = error?.stack || String(error);
    return res.status(error.statusCode || 500).send(`
      <html>
        <head><meta name="viewport" content="width=device-width, initial-scale=1" /></head>
        <body style="font-family:Arial;background:#0b1020;color:white;padding:24px">
          <div style="max-width:760px;margin:auto;background:#151b2f;padding:24px;border-radius:18px">
            <h1>❌ Erro ao gerar código</h1>
            <pre style="white-space:pre-wrap;background:#050816;padding:14px;border-radius:12px;color:#fecaca">${escapeHtml(error.message || String(error))}</pre>
            <p><a href="/pairing?key=${encodeURIComponent(req.query.key || '')}" style="color:#7dd3fc">Tentar novamente</a></p>
          </div>
        </body>
      </html>
    `);
  }
});

app.get('/qr', async (req, res) => {
  if (!senhaOk(req)) {
    return res.status(401).send('Senha incorreta.');
  }

  if (!currentQr) {
    return res.send(`
      <html>
        <head>
          <meta name="viewport" content="width=device-width, initial-scale=1" />
          <meta http-equiv="refresh" content="5" />
        </head>
        <body style="font-family:Arial;background:#0b1020;color:white;text-align:center;padding:24px">
          <h1>${escapeHtml(BOT_NAME)}</h1>
          <p>Status: <strong>${escapeHtml(status)}</strong></p>
          <p>Nenhum QR Code disponível agora.</p>
          <p>Se estiver conectado, não precisa QR. Se não estiver, aguarde a página atualizar.</p>
          ${lastError ? `<pre style="white-space:pre-wrap;background:#111827;padding:12px;border-radius:12px">${escapeHtml(lastError)}</pre>` : ''}
        </body>
      </html>
    `);
  }

  const qrImage = await QRCode.toDataURL(currentQr);

  res.send(`
    <html>
      <head><meta name="viewport" content="width=device-width, initial-scale=1" /></head>
      <body style="font-family:Arial;background:#0b1020;color:white;text-align:center;padding:24px">
        <h1>${escapeHtml(BOT_NAME)}</h1>
        <p>Abra o WhatsApp do número do bot → Dispositivos conectados → Conectar dispositivo.</p>
        <img src="${qrImage}" style="width:320px;max-width:90%;background:white;padding:12px;border-radius:12px" />
        <p>Depois teste no WhatsApp com <strong>!Naldo</strong></p>
      </body>
    </html>
  `);
});

async function iniciarBot() {
  if (reconnecting || sock) return;
  reconnecting = true;

  try {
    status = 'iniciando autenticação local';
    lastError = null;

    const { state, saveCreds } = await useMultiFileAuthState(AUTH_FOLDER);
    const latest = await fetchLatestBaileysVersion();
    const { version } = latest;
    baileysVersion = version;

    status = 'conectando ao WhatsApp';

    sock = makeWASocket({
      version,
      auth: state,
      printQRInTerminal: false,
      logger: pino({ level: process.env.LOG_LEVEL || 'silent' }),
      browser: Browsers?.ubuntu ? Browsers.ubuntu(BOT_NAME) : [BOT_NAME, 'Chrome', '1.0.0'],
      markOnlineOnConnect: false,
      syncFullHistory: false,
      connectTimeoutMs: 60_000,
      keepAliveIntervalMs: 25_000
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('messages.upsert', async ({ messages, type }) => {
      if (!['notify', 'append'].includes(type)) return;

      totalMessages += messages.length;
      lastMessageAt = new Date().toISOString();

      console.log('messages.upsert recebido:', {
        type,
        total: messages.length,
        fromMe: messages.map((m) => Boolean(m.key?.fromMe)),
        remoteJids: messages.map((m) => m.key?.remoteJid)
      });

      for (const msg of messages) {
        try {
          if (!msg.message) continue;
          if (msg.key?.remoteJid === 'status@broadcast') continue;

          const texto = extrairTexto(msg);
          lastMessageInfo = {
            type,
            remoteJid: msg.key?.remoteJid,
            participant: msg.key?.participant || null,
            fromMe: Boolean(msg.key?.fromMe),
            textPreview: texto ? texto.slice(0, 80) : null,
            at: new Date().toISOString()
          };

          if (texto.startsWith('!')) {
            totalCommands += 1;
            lastCommandAt = new Date().toISOString();
          }

          await handleCommand(sock, msg);
        } catch (error) {
          lastError = error?.stack || String(error);
          console.error('Erro ao processar mensagem:', error);
        }
      }
    });

    sock.ev.on('connection.update', async (update) => {
      const { connection, lastDisconnect, qr } = update;
      lastConnectionUpdateAt = new Date().toISOString();

      if (qr) {
        currentQr = qr;
        status = 'aguardando QR Code';
        lastQrAt = new Date().toISOString();
        qrCount += 1;
        console.log('QR Code gerado.');
      }

      if (connection === 'open') {
        currentQr = null;
        lastPairingCode = null;
        status = 'conectado';
        lastError = null;
        reconnecting = false;
        lastOpenAt = new Date().toISOString();
        console.log(`${BOT_NAME} conectado ao WhatsApp.`);
      }

      if (connection === 'close') {
        const statusCode = lastDisconnect?.error?.output?.statusCode;
        const erro = lastDisconnect?.error?.stack || lastDisconnect?.error?.message || String(lastDisconnect?.error || '');

        lastDisconnectCode = statusCode || null;
        lastCloseAt = new Date().toISOString();
        lastError = erro || `Conexão fechada. Status: ${statusCode}`;

        console.log('Conexão fechada.', { statusCode, erro: lastError });

        sock = null;
        reconnecting = false;

        if (statusCode === DisconnectReason.loggedOut) {
          status = 'deslogado, precisa novo QR';
          return;
        }

        status = 'reconectando';
        reconnectCount += 1;
        setTimeout(iniciarBot, 10_000);
      }
    });
  } catch (error) {
    sock = null;
    reconnecting = false;
    status = 'erro ao conectar';
    lastError = error?.stack || String(error);
    reconnectCount += 1;
    console.error('Erro ao iniciar bot:', error);
    setTimeout(iniciarBot, 15_000);
  }
}

app.listen(PORT, '0.0.0.0', () => {
  console.log(`${BOT_NAME} servidor HTTP rodando em 0.0.0.0:${PORT}`);
  iniciarBot();
});

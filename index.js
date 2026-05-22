require('dotenv').config();

const express = require('express');
const QRCode = require('qrcode');

const app = express();
const PORT = Number(process.env.PORT || 3000);
const BOT_NAME = process.env.BOT_NAME || 'RiftControl';

let currentQr = null;
let currentSock = null;
let currentSocketId = 0;
let connectionStatus = 'iniciando';
let reconnecting = false;
let botModules = null;
let lastError = null;
let lastPairingCode = null;
let lastPairingGeneratedAt = null;
let autoResetInProgress = false;
let startedAt = new Date().toISOString();

app.use((req, res, next) => {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.set('Pragma', 'no-cache');
  res.set('Expires', '0');
  next();
});

process.on('uncaughtException', (error) => {
  lastError = error?.stack || String(error);
  connectionStatus = 'erro interno';
  console.error('uncaughtException:', error);
});

process.on('unhandledRejection', (reason) => {
  lastError = reason?.stack || String(reason);
  connectionStatus = 'erro interno';
  console.error('unhandledRejection:', reason);
});

function escapeHtml(value) {
  return String(value || '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function onlyDigits(value) {
  return String(value || '').replace(/\D/g, '');
}

function keyOk(req) {
  const senha = process.env.QR_PASSWORD;
  return !senha || req.query.key === senha || req.body?.key === senha;
}

function isSessionFailure(errorText, statusCode) {
  const texto = String(errorText || '').toLowerCase();

  return (
    statusCode === 440 ||
    statusCode === 401 ||
    texto.includes('connection failure') ||
    texto.includes('bad session') ||
    texto.includes('logged out') ||
    texto.includes('bad mac') ||
    texto.includes('messagecountererror') ||
    texto.includes('key used already') ||
    texto.includes('failed to decrypt') ||
    texto.includes('no session') ||
    texto.includes('decrypt')
  );
}

function loadBotModules() {
  if (botModules) return botModules;

  const WebSocket = require('ws');
  global.WebSocket = WebSocket;
  globalThis.WebSocket = WebSocket;

  const pino = require('pino');
  const baileys = require('@whiskeysockets/baileys');
  const makeWASocket = baileys.default || baileys.makeWASocket;
  const { DisconnectReason, fetchLatestBaileysVersion } = baileys;

  const useSupabaseAuthState = require('./src/auth/supabaseAuthState');
  const handleCommand = require('./src/commands/handler');

  botModules = {
    pino,
    makeWASocket,
    DisconnectReason,
    fetchLatestBaileysVersion,
    useSupabaseAuthState,
    handleCommand
  };

  return botModules;
}

function baseStyles() {
  return `
    body { font-family: Arial, sans-serif; background: #0b1020; color: white; padding: 30px; }
    .card { max-width: 820px; margin: auto; background: #151b2f; padding: 24px; border-radius: 18px; box-shadow: 0 18px 55px rgba(0,0,0,.35); }
    h1 { margin-top: 0; }
    input { width: 100%; box-sizing: border-box; padding: 14px; border-radius: 12px; border: 1px solid #334155; background: #050816; color: white; font-size: 16px; margin: 10px 0; }
    button { width: 100%; padding: 14px; border: 0; border-radius: 12px; background: #38bdf8; color: #020617; font-weight: 700; font-size: 16px; cursor: pointer; margin-top: 6px; }
    button.secondary { background: #a78bfa; }
    button.danger { background: #fb7185; }
    a { color: #7dd3fc; }
    code, pre { background: #050816; padding: 4px 8px; border-radius: 8px; }
    pre { white-space: pre-wrap; overflow-wrap: break-word; padding: 12px; color: #fecaca; }
    .muted { color: #cbd5e1; font-size: 14px; }
    .status { display: inline-block; padding: 6px 10px; background: #0f172a; border-radius: 999px; }
    .grid { display: grid; grid-template-columns: 1fr; gap: 18px; }
    .box { background: #0f172a; padding: 16px; border-radius: 16px; border: 1px solid #23314f; }
    .code { font-size: 34px; letter-spacing: 6px; text-align: center; padding: 18px; color: #bbf7d0; }
    .ok { color: #bbf7d0; }
    .warn { color: #fde68a; }
    @media (min-width: 760px) { .grid { grid-template-columns: 1fr 1fr; } }
  `;
}

function page(title, body, extraStyle = '') {
  return `
    <html>
      <head>
        <title>${escapeHtml(title)} - ${escapeHtml(BOT_NAME)}</title>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <style>${baseStyles()} ${extraStyle}</style>
      </head>
      <body>
        <div class="card">${body}</div>
      </body>
    </html>
  `;
}

function accessDenied(res) {
  return res.status(401).send(page('Acesso negado', `
    <h1>🔒 Acesso negado</h1>
    <p>A senha informada está errada ou não foi enviada.</p>
    <a href="/">Voltar para a página inicial</a>
  `));
}

async function clearWhatsappSession(reason = 'manual') {
  if (autoResetInProgress) return;
  autoResetInProgress = true;

  try {
    connectionStatus = `limpando sessão (${reason})`;

    try {
      if (currentSock?.end) currentSock.end(new Error(`Sessão resetada: ${reason}`));
    } catch (error) {
      console.log('End ignorado:', error?.message || error);
    }

    currentSock = null;
    currentQr = null;
    lastPairingCode = null;
    lastPairingGeneratedAt = null;
    currentSocketId += 1;

    const supabase = require('./src/database/supabase');
    const { error } = await supabase
      .from('bot_auth')
      .delete()
      .not('id', 'is', null);

    if (error) throw error;

    connectionStatus = 'sessão limpa, aguardando novo QR';
  } catch (error) {
    lastError = error?.stack || String(error);
    connectionStatus = 'erro ao limpar sessão';
  } finally {
    autoResetInProgress = false;
  }
}

app.get('/', (req, res) => {
  res.send(page(BOT_NAME, `
    <h1>⚔️ ${escapeHtml(BOT_NAME)}</h1>
    <p>Status: <strong class="status">${escapeHtml(connectionStatus)}</strong></p>

    <div class="box" style="margin-bottom:18px">
      <p class="warn"><strong>Recomendado:</strong> conecte pelo QR Code. O código de pareamento pode expirar rápido em hospedagem por container.</p>
    </div>

    <div class="grid">
      <div class="box">
        <h2>Conectar por QR Code</h2>
        <p class="muted">Método mais estável.</p>
        <form action="/qr" method="GET">
          <input name="key" type="password" placeholder="Senha do QR_PASSWORD" autocomplete="current-password" required />
          <button type="submit">Abrir QR Code</button>
        </form>
      </div>

      <div class="box">
        <h2>Conectar por código</h2>
        <p class="muted">Use só se for digitar imediatamente. Exemplo de número: <strong>5598999999999</strong>.</p>
        <form action="/pairing" method="GET">
          <input name="key" type="password" placeholder="Senha do QR_PASSWORD" autocomplete="current-password" required />
          <input name="phone" type="tel" inputmode="numeric" placeholder="Número com DDI e DDD" required />
          <button class="secondary" type="submit">Gerar código novo</button>
        </form>
      </div>
    </div>

    <div class="box" style="margin-top:18px">
      <h2>Resetar sessão</h2>
      <p class="muted">Use se aparecer “Connection Failure”, “Bad MAC”, “MessageCounterError”, “código expirado” ou se o QR não conectar.</p>
      <form action="/reset-session" method="GET">
        <input name="key" type="password" placeholder="Senha do QR_PASSWORD" autocomplete="current-password" required />
        <button class="danger" type="submit">Limpar sessão do WhatsApp</button>
      </form>
    </div>

    <p class="muted">Diagnóstico: <a href="/status">/status</a></p>
    ${lastError ? `<h3>Último erro</h3><pre>${escapeHtml(lastError)}</pre>` : ''}
  `));
});

app.get('/health', (req, res) => res.status(200).send('ok'));
app.get('/favicon.ico', (req, res) => res.status(204).end());

app.get('/status', (req, res) => {
  res.json({
    ok: true,
    bot: BOT_NAME,
    status: connectionStatus,
    qrDisponivel: Boolean(currentQr),
    socketDisponivel: Boolean(currentSock),
    socketId: currentSocketId,
    pairingCodeDisponivel: Boolean(lastPairingCode),
    lastPairingGeneratedAt,
    porta: PORT,
    startedAt,
    env: {
      SUPABASE_URL: Boolean(process.env.SUPABASE_URL),
      SUPABASE_SERVICE_ROLE_KEY: Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY),
      QR_PASSWORD: Boolean(process.env.QR_PASSWORD)
    },
    lastError
  });
});

app.get('/qr', async (req, res) => {
  if (!keyOk(req)) return accessDenied(res);

  if (!currentQr) {
    return res.send(page('QR Code', `
      <h1>⚔️ ${escapeHtml(BOT_NAME)}</h1>
      <p>Status: <strong>${escapeHtml(connectionStatus)}</strong></p>
      <p>Nenhum QR Code disponível agora. A página atualiza automaticamente a cada 5 segundos.</p>
      <p class="muted">Se ficar assim por muito tempo, volte e use “Limpar sessão do WhatsApp”.</p>
      ${lastError ? `<h3>Último erro</h3><pre>${escapeHtml(lastError)}</pre>` : ''}
    `, 'body { text-align: center; }').replace('</head>', '<meta http-equiv="refresh" content="5" /></head>'));
  }

  const qrImage = await QRCode.toDataURL(currentQr);

  return res.send(page('QR Code', `
    <h1>⚔️ ${escapeHtml(BOT_NAME)}</h1>
    <p>Abra o WhatsApp → Dispositivos conectados → Conectar dispositivo.</p>
    <img src="${qrImage}" alt="QR Code do WhatsApp" />
    <p>Depois de conectar, teste no grupo: <strong>!menu</strong></p>
  `, 'body { text-align: center; } img { width: 300px; max-width: 90%; background: white; padding: 12px; border-radius: 12px; }'));
});

app.get('/pairing', async (req, res) => {
  if (!keyOk(req)) return accessDenied(res);
  const phone = onlyDigits(req.query.phone);

  if (!phone || phone.length < 10) {
    return res.status(400).send(page('Número inválido', `
      <h1>📱 Número inválido</h1>
      <p>Informe o número com DDI e DDD. Exemplo: <strong>5598999999999</strong>.</p>
      <a href="/">Voltar</a>
    `));
  }

  if (connectionStatus === 'conectado') {
    return res.send(page('Já conectado', `
      <h1>✅ Bot já conectado</h1>
      <p>O WhatsApp já está pareado. Teste no grupo com <strong>!menu</strong>.</p>
      <a href="/status">Ver status</a>
    `));
  }

  if (!currentSock) {
    connectToWhatsApp();
    return res.status(503).send(page('Bot iniciando', `
      <h1>⏳ Bot iniciando</h1>
      <p>Status: <strong>${escapeHtml(connectionStatus)}</strong></p>
      <p>Aguarde uns 5 segundos e gere o código novamente.</p>
      ${lastError ? `<pre>${escapeHtml(lastError)}</pre>` : ''}
    `));
  }

  try {
    if (typeof currentSock.requestPairingCode !== 'function') {
      throw new Error('Esta versão do Baileys não possui requestPairingCode. Use o QR Code.');
    }

    connectionStatus = 'gerando código de pareamento';
    lastError = null;

    const code = await currentSock.requestPairingCode(phone);
    lastPairingCode = code;
    lastPairingGeneratedAt = new Date().toISOString();
    connectionStatus = 'aguardando código no WhatsApp';

    return res.send(page('Código de pareamento', `
      <h1>🔐 Código de pareamento</h1>
      <p>Digite este código imediatamente no WhatsApp do número <strong>${escapeHtml(phone)}</strong>:</p>
      <pre class="code">${escapeHtml(code)}</pre>
      <p class="warn"><strong>Importante:</strong> esse código expira rápido. Se aparecer “expirado”, gere outro ou use QR Code.</p>
      <p class="muted">Se continuar expirando, clique em <strong>Limpar sessão do WhatsApp</strong> e use o QR Code.</p>
      <a href="/status">Ver status</a>
    `));
  } catch (error) {
    lastError = error?.stack || String(error);
    connectionStatus = 'erro ao gerar código';
    return res.status(500).send(page('Erro ao gerar código', `
      <h1>❌ Erro ao gerar código</h1>
      <pre>${escapeHtml(lastError)}</pre>
      <a href="/">Voltar</a>
    `));
  }
});

app.get('/reset-session', async (req, res) => {
  if (!keyOk(req)) return accessDenied(res);
  await clearWhatsappSession('manual');
  setTimeout(() => {
    reconnecting = false;
    connectToWhatsApp();
  }, 2000);
  return res.send(page('Sessão limpa', `
    <h1>✅ Sessão limpa</h1>
    <p>A sessão antiga do WhatsApp foi removida do Supabase.</p>
    <p>Aguarde alguns segundos e use o <strong>QR Code</strong>.</p>
    <a href="/">Voltar</a>
  `));
});

app.get('/pair', (req, res) => {
  const params = new URLSearchParams(req.query).toString();
  res.redirect(`/pairing${params ? `?${params}` : ''}`);
});

app.get('/:key', (req, res) => {
  const key = req.params.key;
  if (!key || key.includes('.')) return res.status(404).send('Página não encontrada. Use / ou /qr?key=SUA_SENHA');
  return res.redirect(`/qr?key=${encodeURIComponent(key)}`);
});

async function connectToWhatsApp() {
  if (reconnecting || currentSock) return;
  reconnecting = true;

  try {
    if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
      connectionStatus = 'aguardando variáveis do Supabase';
      lastError = 'Configure SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY nas variáveis de ambiente do Back4App.';
      reconnecting = false;
      return;
    }

    connectionStatus = 'carregando módulos';
    const { pino, makeWASocket, DisconnectReason, fetchLatestBaileysVersion, useSupabaseAuthState, handleCommand } = loadBotModules();

    connectionStatus = 'conectando';
    lastError = null;

    const { state, saveCreds } = await useSupabaseAuthState();
    const { version } = await fetchLatestBaileysVersion();
    const socketId = currentSocketId + 1;
    currentSocketId = socketId;

    const sock = makeWASocket({
      version,
      auth: state,
      printQRInTerminal: false,
      logger: pino({ level: process.env.LOG_LEVEL || 'silent' }),
      browser: [BOT_NAME, 'Chrome', '1.0.0'],
      connectTimeoutMs: 60_000,
      keepAliveIntervalMs: 25_000,
      retryRequestDelayMs: 2_000,
      markOnlineOnConnect: false,
      syncFullHistory: false
    });

    currentSock = sock;
    reconnecting = false;

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('messages.upsert', async ({ messages, type }) => {
      if (socketId !== currentSocketId) return;
      if (type !== 'notify') return;

      for (const msg of messages) {
        try {
          if (!msg.message) continue;
          if (msg.key.fromMe) continue;
          await handleCommand(sock, msg);
        } catch (error) {
          lastError = error?.stack || String(error);
          console.error('Erro ao processar mensagem:', error);
        }
      }
    });

    sock.ev.on('connection.update', async (update) => {
      if (socketId !== currentSocketId) return;

      const { connection, lastDisconnect, qr } = update;

      if (qr) {
        currentQr = qr;
        connectionStatus = 'aguardando QR Code';
      }

      if (connection === 'open') {
        currentQr = null;
        lastPairingCode = null;
        lastPairingGeneratedAt = null;
        connectionStatus = 'conectado';
        lastError = null;
        console.log(`${BOT_NAME} conectado ao WhatsApp.`);
      }

      if (connection === 'close') {
        currentSock = null;
        const statusCode = lastDisconnect?.error?.output?.statusCode;
        const errorText = lastDisconnect?.error?.stack || lastDisconnect?.error?.message || String(lastDisconnect?.error || '');
        const deslogado = statusCode === DisconnectReason.loggedOut;
        const falhaSessao = deslogado || isSessionFailure(errorText, statusCode);

        lastError = errorText || `Conexão fechada. Status: ${statusCode}`;
        console.log('Conexão fechada.', { statusCode, deslogado, falhaSessao });

        if (falhaSessao) {
          await clearWhatsappSession(`sessão inválida ${statusCode || ''}`.trim());
        }

        connectionStatus = falhaSessao ? 'sessão limpa, gere novo QR' : 'reconectando';

        setTimeout(() => {
          reconnecting = false;
          connectToWhatsApp();
        }, falhaSessao ? 12000 : 6000);
      }
    });
  } catch (error) {
    currentSock = null;
    reconnecting = false;
    lastError = error?.stack || String(error);
    console.error('Erro ao conectar:', error);
    connectionStatus = 'erro ao conectar';

    if (isSessionFailure(lastError)) {
      await clearWhatsappSession('erro ao conectar');
    }

    setTimeout(connectToWhatsApp, 10000);
  }
}

app.listen(PORT, '0.0.0.0', () => {
  console.log(`${BOT_NAME} servidor HTTP rodando em 0.0.0.0:${PORT}`);
  setTimeout(connectToWhatsApp, 1500);
});

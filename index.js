require('dotenv').config();

const express = require('express');
const QRCode = require('qrcode');
const pino = require('pino');
const baileys = require('@whiskeysockets/baileys');
const handleCommand = require('./src/commands/handler');

const makeWASocket = baileys.default || baileys.makeWASocket;
const { useMultiFileAuthState, fetchLatestBaileysVersion, DisconnectReason, Browsers } = baileys;

const app = express();
const PORT = Number(process.env.PORT || 3000);
const BOT_NAME = process.env.BOT_NAME || 'RiftControl';
const QR_PASSWORD = process.env.QR_PASSWORD || '';

let sock = null;
let currentQr = null;
let status = 'iniciando';
let lastError = null;
let startedAt = new Date().toISOString();
let reconnecting = false;

function senhaOk(req) {
  if (!QR_PASSWORD) return true;
  return req.query.key === QR_PASSWORD;
}

function escapeHtml(value) {
  return String(value || '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

app.get('/health', (req, res) => {
  res.status(200).send('ok');
});

app.get('/status', (req, res) => {
  res.json({
    ok: true,
    bot: BOT_NAME,
    status,
    conectado: status === 'conectado',
    qrDisponivel: Boolean(currentQr),
    socketDisponivel: Boolean(sock),
    startedAt,
    auth: 'local-useMultiFileAuthState',
    env: {
      QR_PASSWORD: Boolean(process.env.QR_PASSWORD),
      SUPABASE_URL: Boolean(process.env.SUPABASE_URL),
      SUPABASE_SERVICE_ROLE_KEY: Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY),
      ALLOWED_GROUP_ID: Boolean(process.env.ALLOWED_GROUP_ID),
      OWNER_NUMBER: Boolean(process.env.OWNER_NUMBER)
    },
    lastError
  });
});

app.get('/', (req, res) => {
  res.send(`
    <html>
      <head>
        <title>${escapeHtml(BOT_NAME)}</title>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <style>
          body { font-family: Arial, sans-serif; background: #0b1020; color: white; padding: 28px; }
          .card { max-width: 760px; margin: auto; background: #151b2f; padding: 24px; border-radius: 18px; }
          input, button { width: 100%; box-sizing: border-box; padding: 14px; margin: 8px 0; border-radius: 12px; border: 0; font-size: 16px; }
          input { background: #050816; color: white; border: 1px solid #334155; }
          button { background: #38bdf8; color: #020617; font-weight: bold; }
          a { color: #7dd3fc; }
          pre { background: #050816; padding: 12px; border-radius: 12px; white-space: pre-wrap; color: #fecaca; }
        </style>
      </head>
      <body>
        <div class="card">
          <h1>⚔️ ${escapeHtml(BOT_NAME)}</h1>
          <p>Status: <strong>${escapeHtml(status)}</strong></p>
          <p>Essa versão usa autenticação local simples. O Supabase continua para os dados da guilda.</p>
          <form action="/qr" method="GET">
            <input name="key" type="password" placeholder="Senha QR_PASSWORD" />
            <button type="submit">Abrir QR Code</button>
          </form>
          <p><a href="/status">Ver status</a></p>
          ${lastError ? `<h3>Último erro</h3><pre>${escapeHtml(lastError)}</pre>` : ''}
        </div>
      </body>
    </html>
  `);
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
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
      </head>
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

    const { state, saveCreds } = await useMultiFileAuthState('./auth_info');
    const { version } = await fetchLatestBaileysVersion();

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

          await handleCommand(sock, msg);
        } catch (error) {
          lastError = error?.stack || String(error);
          console.error('Erro ao processar mensagem:', error);
        }
      }
    });

    sock.ev.on('connection.update', async (update) => {
      const { connection, lastDisconnect, qr } = update;

      if (qr) {
        currentQr = qr;
        status = 'aguardando QR Code';
        console.log('QR Code gerado.');
      }

      if (connection === 'open') {
        currentQr = null;
        status = 'conectado';
        lastError = null;
        reconnecting = false;
        console.log(`${BOT_NAME} conectado ao WhatsApp.`);
      }

      if (connection === 'close') {
        const statusCode = lastDisconnect?.error?.output?.statusCode;
        const erro = lastDisconnect?.error?.stack || lastDisconnect?.error?.message || String(lastDisconnect?.error || '');

        lastError = erro || `Conexão fechada. Status: ${statusCode}`;

        console.log('Conexão fechada.', {
          statusCode,
          erro: lastError
        });

        sock = null;
        reconnecting = false;

        if (statusCode === DisconnectReason.loggedOut) {
          status = 'deslogado, precisa novo QR';
          return;
        }

        status = 'reconectando';
        setTimeout(iniciarBot, 10_000);
      }
    });
  } catch (error) {
    sock = null;
    reconnecting = false;
    status = 'erro ao conectar';
    lastError = error?.stack || String(error);

    console.error('Erro ao iniciar bot:', error);

    setTimeout(iniciarBot, 15_000);
  }
}

app.listen(PORT, '0.0.0.0', () => {
  console.log(`${BOT_NAME} servidor HTTP rodando em 0.0.0.0:${PORT}`);
  iniciarBot();
});

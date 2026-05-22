require('dotenv').config();

const express = require('express');
const QRCode = require('qrcode');

const app = express();
const PORT = Number(process.env.PORT || 3000);
const BOT_NAME = process.env.BOT_NAME || 'RiftControl';

let currentQr = null;
let connectionStatus = 'iniciando';
let reconnecting = false;
let botModules = null;
let lastError = null;
let startedAt = new Date().toISOString();

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
    .card { max-width: 680px; margin: auto; background: #151b2f; padding: 24px; border-radius: 18px; box-shadow: 0 18px 55px rgba(0,0,0,.35); }
    h1 { margin-top: 0; }
    input { width: 100%; box-sizing: border-box; padding: 14px; border-radius: 12px; border: 1px solid #334155; background: #050816; color: white; font-size: 16px; margin: 10px 0; }
    button { width: 100%; padding: 14px; border: 0; border-radius: 12px; background: #38bdf8; color: #020617; font-weight: 700; font-size: 16px; cursor: pointer; }
    a { color: #7dd3fc; }
    code, pre { background: #050816; padding: 4px 8px; border-radius: 8px; }
    pre { white-space: pre-wrap; overflow-wrap: break-word; padding: 12px; color: #fecaca; }
    .muted { color: #cbd5e1; font-size: 14px; }
    .status { display: inline-block; padding: 6px 10px; background: #0f172a; border-radius: 999px; }
  `;
}

app.get('/', (req, res) => {
  res.send(`
    <html>
      <head>
        <title>${escapeHtml(BOT_NAME)}</title>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <style>${baseStyles()}</style>
      </head>
      <body>
        <div class="card">
          <h1>⚔️ ${escapeHtml(BOT_NAME)}</h1>
          <p>Status: <strong class="status">${escapeHtml(connectionStatus)}</strong></p>

          <h2>Entrar no QR Code</h2>
          <p class="muted">Digite a senha configurada em <strong>QR_PASSWORD</strong>. Ao enviar, a página abre o QR automaticamente.</p>

          <form action="/qr" method="GET">
            <input name="key" type="password" placeholder="Digite a senha do QR" autocomplete="current-password" required />
            <button type="submit">Abrir QR Code</button>
          </form>

          <p class="muted">Também funciona usando: <code>/qr?key=SUA_SENHA</code></p>
          <p class="muted">Diagnóstico: <a href="/status">/status</a></p>
          ${lastError ? `<h3>Último erro</h3><pre>${escapeHtml(lastError)}</pre>` : ''}
        </div>
      </body>
    </html>
  `);
});

app.get('/health', (req, res) => {
  res.status(200).send('ok');
});

app.get('/favicon.ico', (req, res) => {
  res.status(204).end();
});

app.get('/status', (req, res) => {
  res.json({
    ok: true,
    bot: BOT_NAME,
    status: connectionStatus,
    qrDisponivel: Boolean(currentQr),
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
  const senha = process.env.QR_PASSWORD;

  if (senha && req.query.key !== senha) {
    return res.status(401).send(`
      <html>
        <head>
          <title>Acesso negado - ${escapeHtml(BOT_NAME)}</title>
          <meta name="viewport" content="width=device-width, initial-scale=1" />
          <style>${baseStyles()}</style>
        </head>
        <body>
          <div class="card">
            <h1>🔒 Acesso negado</h1>
            <p>A senha informada está errada ou não foi enviada.</p>
            <a href="/">Voltar para a página inicial</a>
          </div>
        </body>
      </html>
    `);
  }

  if (!currentQr) {
    return res.send(`
      <html>
        <head>
          <title>QR Code - ${escapeHtml(BOT_NAME)}</title>
          <meta name="viewport" content="width=device-width, initial-scale=1" />
          <meta http-equiv="refresh" content="5" />
          <style>${baseStyles()} body { text-align: center; }</style>
        </head>
        <body>
          <div class="card">
            <h1>⚔️ ${escapeHtml(BOT_NAME)}</h1>
            <p>Status: <strong>${escapeHtml(connectionStatus)}</strong></p>
            <p>Nenhum QR Code disponível agora. A página atualiza automaticamente a cada 5 segundos.</p>
            ${lastError ? `<h3>Último erro</h3><pre>${escapeHtml(lastError)}</pre>` : ''}
          </div>
        </body>
      </html>
    `);
  }

  const qrImage = await QRCode.toDataURL(currentQr);

  return res.send(`
    <html>
      <head>
        <title>QR Code - ${escapeHtml(BOT_NAME)}</title>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <style>${baseStyles()} body { text-align: center; } img { width: 300px; max-width: 90%; background: white; padding: 12px; border-radius: 12px; }</style>
      </head>
      <body>
        <div class="card">
          <h1>⚔️ ${escapeHtml(BOT_NAME)}</h1>
          <p>Abra o WhatsApp → Dispositivos conectados → Conectar dispositivo.</p>
          <img src="${qrImage}" alt="QR Code do WhatsApp" />
          <p>Depois de conectar, teste no grupo: <strong>!menu</strong></p>
        </div>
      </body>
    </html>
  `);
});

// Atalho opcional: se abrir /SUA_SENHA, redireciona para /qr?key=SUA_SENHA.
app.get('/:key', (req, res) => {
  const key = req.params.key;

  if (!key || key.includes('.')) {
    return res.status(404).send('Página não encontrada. Use / ou /qr?key=SUA_SENHA');
  }

  return res.redirect(`/qr?key=${encodeURIComponent(key)}`);
});

async function connectToWhatsApp() {
  if (reconnecting) return;
  reconnecting = true;

  try {
    if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
      connectionStatus = 'aguardando variáveis do Supabase';
      lastError = 'Configure SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY nas variáveis de ambiente do Back4App.';
      console.error(lastError);
      reconnecting = false;
      return;
    }

    connectionStatus = 'carregando módulos';
    const {
      pino,
      makeWASocket,
      DisconnectReason,
      fetchLatestBaileysVersion,
      useSupabaseAuthState,
      handleCommand
    } = loadBotModules();

    connectionStatus = 'conectando';
    lastError = null;

    const { state, saveCreds } = await useSupabaseAuthState();
    const { version } = await fetchLatestBaileysVersion();

    const sock = makeWASocket({
      version,
      auth: state,
      printQRInTerminal: false,
      logger: pino({ level: process.env.LOG_LEVEL || 'silent' }),
      browser: [BOT_NAME, 'Chrome', '1.0.0']
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('messages.upsert', async ({ messages, type }) => {
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
      const { connection, lastDisconnect, qr } = update;

      if (qr) {
        currentQr = qr;
        connectionStatus = 'aguardando QR Code';
        console.log('QR Code gerado. Abra a URL principal e digite a senha.');
      }

      if (connection === 'open') {
        currentQr = null;
        connectionStatus = 'conectado';
        lastError = null;
        console.log(`${BOT_NAME} conectado ao WhatsApp.`);
      }

      if (connection === 'close') {
        const statusCode = lastDisconnect?.error?.output?.statusCode;
        const deslogado = statusCode === DisconnectReason.loggedOut;

        connectionStatus = deslogado ? 'deslogado' : 'reconectando';
        lastError = lastDisconnect?.error?.stack || lastDisconnect?.error?.message || `Conexão fechada. Status: ${statusCode}`;
        console.log('Conexão fechada.', { statusCode, deslogado });

        if (!deslogado) {
          setTimeout(() => {
            reconnecting = false;
            connectToWhatsApp();
          }, 5000);
        }
      }
    });
  } catch (error) {
    lastError = error?.stack || String(error);
    console.error('Erro ao conectar:', error);
    connectionStatus = 'erro ao conectar';

    setTimeout(() => {
      reconnecting = false;
      connectToWhatsApp();
    }, 10000);
  } finally {
    reconnecting = false;
  }
}

app.listen(PORT, '0.0.0.0', () => {
  console.log(`${BOT_NAME} servidor HTTP rodando em 0.0.0.0:${PORT}`);
  setTimeout(connectToWhatsApp, 1500);
});

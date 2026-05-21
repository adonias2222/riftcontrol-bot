require('dotenv').config();

const express = require('express');
const QRCode = require('qrcode');
const pino = require('pino');
const makeWASocket = require('@whiskeysockets/baileys').default;
const {
  DisconnectReason,
  fetchLatestBaileysVersion
} = require('@whiskeysockets/baileys');

const useSupabaseAuthState = require('./src/auth/supabaseAuthState');
const handleCommand = require('./src/commands/handler');

const app = express();
const PORT = process.env.PORT || 3000;
const BOT_NAME = process.env.BOT_NAME || 'RiftControl';

let currentQr = null;
let connectionStatus = 'iniciando';
let reconnecting = false;

app.get('/', (req, res) => {
  res.send(`
    <html>
      <head>
        <title>${BOT_NAME}</title>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <style>
          body { font-family: Arial, sans-serif; background: #0b1020; color: white; padding: 30px; }
          .card { max-width: 620px; margin: auto; background: #151b2f; padding: 24px; border-radius: 18px; }
          a { color: #7dd3fc; }
          code { background: #050816; padding: 4px 8px; border-radius: 8px; }
        </style>
      </head>
      <body>
        <div class="card">
          <h1>⚔️ ${BOT_NAME}</h1>
          <p>Status: <strong>${connectionStatus}</strong></p>
          <p>Para parear o WhatsApp, abra:</p>
          <p><code>/qr?key=SUA_SENHA</code></p>
          <p>Depois teste no grupo: <code>!menu</code></p>
        </div>
      </body>
    </html>
  `);
});

app.get('/status', (req, res) => {
  res.json({
    bot: BOT_NAME,
    status: connectionStatus,
    qrDisponivel: Boolean(currentQr)
  });
});

app.get('/qr', async (req, res) => {
  const senha = process.env.QR_PASSWORD;

  if (senha && req.query.key !== senha) {
    return res.status(401).send('Acesso negado. Informe a senha em /qr?key=SUA_SENHA');
  }

  if (!currentQr) {
    return res.send(`
      <html>
        <head>
          <meta name="viewport" content="width=device-width, initial-scale=1" />
          <style>
            body { font-family: Arial, sans-serif; background: #0b1020; color: white; padding: 30px; text-align: center; }
            .card { max-width: 520px; margin: auto; background: #151b2f; padding: 24px; border-radius: 18px; }
          </style>
        </head>
        <body>
          <div class="card">
            <h1>⚔️ ${BOT_NAME}</h1>
            <p>Status: <strong>${connectionStatus}</strong></p>
            <p>Nenhum QR Code disponível agora.</p>
            <p>Se ainda não conectou, aguarde alguns segundos e atualize a página.</p>
          </div>
        </body>
      </html>
    `);
  }

  const qrImage = await QRCode.toDataURL(currentQr);

  return res.send(`
    <html>
      <head>
        <title>QR Code - ${BOT_NAME}</title>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <style>
          body { font-family: Arial, sans-serif; background: #0b1020; color: white; padding: 30px; text-align: center; }
          .card { max-width: 520px; margin: auto; background: #151b2f; padding: 24px; border-radius: 18px; }
          img { width: 300px; max-width: 90%; background: white; padding: 12px; border-radius: 12px; }
        </style>
      </head>
      <body>
        <div class="card">
          <h1>⚔️ ${BOT_NAME}</h1>
          <p>Abra o WhatsApp → Dispositivos conectados → Conectar dispositivo.</p>
          <img src="${qrImage}" alt="QR Code do WhatsApp" />
          <p>Depois de conectar, teste no grupo: <strong>!menu</strong></p>
        </div>
      </body>
    </html>
  `);
});

async function connectToWhatsApp() {
  if (reconnecting) return;
  reconnecting = true;

  try {
    connectionStatus = 'conectando';

    const { state, saveCreds } = await useSupabaseAuthState();
    const { version } = await fetchLatestBaileysVersion();

    const sock = makeWASocket({
      version,
      auth: state,
      printQRInTerminal: true,
      logger: pino({ level: 'silent' }),
      browser: [BOT_NAME, 'Chrome', '1.0.0']
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('messages.upsert', async ({ messages, type }) => {
      if (type !== 'notify') return;

      for (const msg of messages) {
        if (!msg.message) continue;
        if (msg.key.fromMe) continue;

        await handleCommand(sock, msg);
      }
    });

    sock.ev.on('connection.update', async (update) => {
      const { connection, lastDisconnect, qr } = update;

      if (qr) {
        currentQr = qr;
        connectionStatus = 'aguardando QR Code';
        console.log('QR Code gerado. Abra /qr?key=SUA_SENHA no navegador.');
      }

      if (connection === 'open') {
        currentQr = null;
        connectionStatus = 'conectado';
        console.log(`${BOT_NAME} conectado ao WhatsApp.`);
      }

      if (connection === 'close') {
        const statusCode = lastDisconnect?.error?.output?.statusCode;
        const deslogado = statusCode === DisconnectReason.loggedOut;

        connectionStatus = deslogado ? 'deslogado' : 'reconectando';
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
    console.error('Erro ao conectar:', error);
    connectionStatus = 'erro ao conectar';

    setTimeout(() => {
      reconnecting = false;
      connectToWhatsApp();
    }, 10000);
  }

  reconnecting = false;
}

app.listen(PORT, () => {
  console.log(`${BOT_NAME} rodando na porta ${PORT}`);
  connectToWhatsApp();
});

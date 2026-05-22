require('dotenv').config();

const os = require('os');
const express = require('express');
const QRCode = require('qrcode');

const app = express();

const PORT = Number(process.env.PORT || 3000);
const BOT_NAME = process.env.BOT_NAME || 'RiftControl';
const INSTANCE_ID = `${os.hostname()}-${process.pid}-${Math.random().toString(36).slice(2, 8)}`;

const LOCK_ID = '__runtime_lock';
const LOCK_TTL_MS = 90_000;
const AUTO_RESET_SESSION = true; // auto-recuperação sempre ativa

let currentQr = null;
let currentSock = null;
let currentSocketId = 0;
let connectionStatus = 'iniciando';
let reconnecting = false;
let botModules = null;
let lastError = null;
let lastPairingCode = null;
let lastPairingGeneratedAt = null;
let startedAt = new Date().toISOString();
let runtimeLockTimer = null;
let hasRuntimeLock = false;
let lastLockInfo = null;
let reconnectAttempt = 0;

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

async function gracefulShutdown(signal) {
  console.log(`Recebido ${signal}. Liberando trava da instância.`);

  try {
    if (currentSock?.end) {
      currentSock.end(new Error(`Encerrando por ${signal}`));
    }
  } catch {}

  currentSock = null;
  await releaseRuntimeLock();
  process.exit(0);
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

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
    texto.includes('decrypt') ||
    texto.includes('conflict') ||
    texto.includes('restart required')
  );
}

function getSupabase() {
  return require('./src/database/supabase');
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

async function readRuntimeLock() {
  const supabase = getSupabase();

  const { data, error } = await supabase
    .from('bot_auth')
    .select('value, updated_at')
    .eq('id', LOCK_ID)
    .maybeSingle();

  if (error) throw error;
  if (!data?.value) return null;

  try {
    return JSON.parse(data.value);
  } catch {
    return null;
  }
}

async function writeRuntimeLock() {
  const supabase = getSupabase();

  const value = {
    owner: INSTANCE_ID,
    expiresAt: Date.now() + LOCK_TTL_MS,
    updatedAt: new Date().toISOString()
  };

  const { error } = await supabase
    .from('bot_auth')
    .upsert(
      {
        id: LOCK_ID,
        value: JSON.stringify(value),
        updated_at: new Date().toISOString()
      },
      {
        onConflict: 'id'
      }
    );

  if (error) throw error;

  lastLockInfo = value;
  hasRuntimeLock = true;

  return value;
}

async function acquireRuntimeLock() {
  const lock = await readRuntimeLock();
  const now = Date.now();

  if (lock?.owner && lock.owner !== INSTANCE_ID && Number(lock.expiresAt || 0) > now) {
    lastLockInfo = lock;
    hasRuntimeLock = false;
    connectionStatus = 'standby: outra instância está ativa';
    lastError = `Outra instância está usando a sessão: ${lock.owner}`;
    return false;
  }

  await writeRuntimeLock();
  return true;
}

function startRuntimeHeartbeat() {
  clearInterval(runtimeLockTimer);

  runtimeLockTimer = setInterval(async () => {
    if (!hasRuntimeLock) return;

    try {
      await writeRuntimeLock();
    } catch (error) {
      lastError = error?.stack || String(error);
      console.error('Erro ao renovar runtime lock:', error);
    }
  }, 30_000);
}

async function releaseRuntimeLock() {
  clearInterval(runtimeLockTimer);
  runtimeLockTimer = null;

  try {
    const lock = await readRuntimeLock();

    if (lock?.owner === INSTANCE_ID) {
      const supabase = getSupabase();

      await supabase
        .from('bot_auth')
        .delete()
        .eq('id', LOCK_ID);
    }
  } catch (error) {
    console.log('Erro ao liberar runtime lock:', error?.message || error);
  }

  hasRuntimeLock = false;
}

async function clearWhatsappSession(reason = 'manual') {
  connectionStatus = `limpando sessão (${reason})`;

  try {
    if (currentSock?.end) {
      currentSock.end(new Error(`Sessão resetada: ${reason}`));
    }
  } catch (error) {
    console.log('End ignorado:', error?.message || error);
  }

  currentSock = null;
  currentQr = null;
  lastPairingCode = null;
  lastPairingGeneratedAt = null;
  currentSocketId += 1;

  const supabase = getSupabase();

  const { error } = await supabase
    .from('bot_auth')
    .delete()
    .neq('id', LOCK_ID);

  if (error) throw error;

  connectionStatus = 'sessão limpa, aguardando novo QR';
}

function baseStyles() {
  return `
    body {
      font-family: Arial, sans-serif;
      background: #0b1020;
      color: white;
      padding: 30px;
    }

    .card {
      max-width: 860px;
      margin: auto;
      background: #151b2f;
      padding: 24px;
      border-radius: 18px;
      box-shadow: 0 18px 55px rgba(0,0,0,.35);
    }

    h1 {
      margin-top: 0;
    }

    input {
      width: 100%;
      box-sizing: border-box;
      padding: 14px;
      border-radius: 12px;
      border: 1px solid #334155;
      background: #050816;
      color: white;
      font-size: 16px;
      margin: 10px 0;
    }

    button {
      width: 100%;
      padding: 14px;
      border: 0;
      border-radius: 12px;
      background: #38bdf8;
      color: #020617;
      font-weight: 700;
      font-size: 16px;
      cursor: pointer;
      margin-top: 6px;
    }

    button.secondary {
      background: #a78bfa;
    }

    button.danger {
      background: #fb7185;
    }

    a {
      color: #7dd3fc;
    }

    code,
    pre {
      background: #050816;
      padding: 4px 8px;
      border-radius: 8px;
    }

    pre {
      white-space: pre-wrap;
      overflow-wrap: break-word;
      padding: 12px;
      color: #fecaca;
    }

    .muted {
      color: #cbd5e1;
      font-size: 14px;
    }

    .status {
      display: inline-block;
      padding: 6px 10px;
      background: #0f172a;
      border-radius: 999px;
    }

    .grid {
      display: grid;
      grid-template-columns: 1fr;
      gap: 18px;
    }

    .box {
      background: #0f172a;
      padding: 16px;
      border-radius: 16px;
      border: 1px solid #23314f;
    }

    .code {
      font-size: 34px;
      letter-spacing: 6px;
      text-align: center;
      padding: 18px;
      color: #bbf7d0;
    }

    .warn {
      color: #fde68a;
    }

    .ok {
      color: #bbf7d0;
    }

    @media (min-width: 760px) {
      .grid {
        grid-template-columns: 1fr 1fr;
      }
    }
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
  return res.status(401).send(
    page(
      'Acesso negado',
      `
        <h1>🔒 Acesso negado</h1>
        <p>A senha informada está errada ou não foi enviada.</p>
        <a href="/">Voltar</a>
      `
    )
  );
}

app.get('/', (req, res) => {
  res.send(
    page(
      BOT_NAME,
      `
        <h1>⚔️ ${escapeHtml(BOT_NAME)}</h1>
        <p>Status: <strong class="status">${escapeHtml(connectionStatus)}</strong></p>

        <div class="box" style="margin-bottom:18px">
          <p class="ok"><strong>Modo atual:</strong> preservando sessão do WhatsApp. O bot não apaga o login automaticamente.</p>
          <p class="muted">AUTO_RESET_SESSION=${AUTO_RESET_SESSION ? 'true' : 'false'}. Com <strong>true</strong>, o bot se recupera sozinho de sessão corrompida e reconecta automaticamente.</p>
          <p class="warn"><strong>Importante:</strong> deixe apenas uma instância ativa. Duas instâncias usando a mesma sessão quebram a criptografia do WhatsApp.</p>
        </div>

        <div class="grid">
          <div class="box">
            <h2>Conectar por QR Code</h2>
            <p class="muted">Use apenas se a sessão ainda não estiver conectada.</p>
            <form action="/qr" method="GET">
              <input name="key" type="password" placeholder="Senha do QR_PASSWORD" required />
              <button type="submit">Abrir QR Code</button>
            </form>
          </div>

          <div class="box">
            <h2>Conectar por código</h2>
            <p class="muted">Use só se for digitar imediatamente.</p>
            <form action="/pairing" method="GET">
              <input name="key" type="password" placeholder="Senha do QR_PASSWORD" required />
              <input name="phone" type="tel" inputmode="numeric" placeholder="Número com DDI e DDD" required />
              <button class="secondary" type="submit">Gerar código novo</button>
            </form>
          </div>
        </div>

        <div class="box" style="margin-top:18px">
          <h2>Resetar sessão</h2>
          <p class="muted">Use somente em último caso. Isso apaga o login e obriga conectar de novo.</p>
          <form action="/reset-session" method="GET">
            <input name="key" type="password" placeholder="Senha do QR_PASSWORD" required />
            <button class="danger" type="submit">Limpar sessão do WhatsApp</button>
          </form>
        </div>

        <p class="muted">Diagnóstico: <a href="/status">/status</a></p>
        ${lastError ? `<h3>Último erro</h3><pre>${escapeHtml(lastError)}</pre>` : ''}
      `
    )
  );
});

app.get('/health', (req, res) => {
  res.status(200).send('ok');
});

app.get('/favicon.ico', (req, res) => {
  res.status(204).end();
});

app.get('/status', async (req, res) => {
  let lock = null;

  try {
    lock = await readRuntimeLock();
  } catch {}

  res.json({
    ok: true,
    bot: BOT_NAME,
    instanceId: INSTANCE_ID,
    status: connectionStatus,
    qrDisponivel: Boolean(currentQr),
    socketDisponivel: Boolean(currentSock),
    hasRuntimeLock,
    runtimeLock: lock,
    socketId: currentSocketId,
    pairingCodeDisponivel: Boolean(lastPairingCode),
    lastPairingGeneratedAt,
    reconnectAttempt,
    autoResetSession: AUTO_RESET_SESSION,
    porta: PORT,
    startedAt,
    env: {
      SUPABASE_URL: Boolean(process.env.SUPABASE_URL),
      SUPABASE_SERVICE_ROLE_KEY: Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY),
      QR_PASSWORD: Boolean(process.env.QR_PASSWORD),
      ALLOWED_GROUP_ID: Boolean(process.env.ALLOWED_GROUP_ID),
      OWNER_NUMBER: Boolean(process.env.OWNER_NUMBER)
    },
    lastError
  });
});

app.get('/qr', async (req, res) => {
  if (!keyOk(req)) return accessDenied(res);

  if (!currentQr) {
    return res.send(
      page(
        'QR Code',
        `
          <h1>⚔️ ${escapeHtml(BOT_NAME)}</h1>
          <p>Status: <strong>${escapeHtml(connectionStatus)}</strong></p>
          <p>Nenhum QR Code disponível agora. Se o status estiver conectado, não precisa reconectar.</p>
          ${lastError ? `<h3>Último erro</h3><pre>${escapeHtml(lastError)}</pre>` : ''}
        `,
        'body { text-align: center; }'
      ).replace('</head>', '<meta http-equiv="refresh" content="5" /></head>')
    );
  }

  const qrImage = await QRCode.toDataURL(currentQr);

  return res.send(
    page(
      'QR Code',
      `
        <h1>⚔️ ${escapeHtml(BOT_NAME)}</h1>
        <p>Abra o WhatsApp → Dispositivos conectados → Conectar dispositivo.</p>
        <img src="${qrImage}" alt="QR Code do WhatsApp" />
        <p>Depois teste no grupo: <strong>!menu</strong></p>
      `,
      `
        body {
          text-align: center;
        }

        img {
          width: 300px;
          max-width: 90%;
          background: white;
          padding: 12px;
          border-radius: 12px;
        }
      `
    )
  );
});

app.get('/pairing', async (req, res) => {
  if (!keyOk(req)) return accessDenied(res);

  const phone = onlyDigits(req.query.phone);

  if (!phone || phone.length < 10) {
    return res.status(400).send(
      page(
        'Número inválido',
        `
          <h1>📱 Número inválido</h1>
          <p>Informe o número com DDI e DDD.</p>
          <a href="/">Voltar</a>
        `
      )
    );
  }

  if (connectionStatus === 'conectado') {
    return res.send(
      page(
        'Já conectado',
        `
          <h1>✅ Bot já conectado</h1>
          <p>Teste no grupo com <strong>!menu</strong>.</p>
        `
      )
    );
  }

  if (!currentSock) {
    return res.status(503).send(
      page(
        'Bot iniciando',
        `
          <h1>⏳ Bot iniciando</h1>
          <p>Status: <strong>${escapeHtml(connectionStatus)}</strong></p>
          <p>Aguarde e tente novamente.</p>
        `
      )
    );
  }

  try {
    if (typeof currentSock.requestPairingCode !== 'function') {
      throw new Error('Esta versão do Baileys não possui requestPairingCode. Use o QR Code.');
    }

    connectionStatus = 'gerando código de pareamento';

    const code = await currentSock.requestPairingCode(phone);

    lastPairingCode = code;
    lastPairingGeneratedAt = new Date().toISOString();
    connectionStatus = 'aguardando código no WhatsApp';

    return res.send(
      page(
        'Código de pareamento',
        `
          <h1>🔐 Código de pareamento</h1>
          <p>Digite imediatamente no WhatsApp do número <strong>${escapeHtml(phone)}</strong>:</p>
          <pre class="code">${escapeHtml(code)}</pre>
          <p class="warn">Se expirar, use QR Code.</p>
        `
      )
    );
  } catch (error) {
    lastError = error?.stack || String(error);
    connectionStatus = 'erro ao gerar código';

    return res.status(500).send(
      page(
        'Erro ao gerar código',
        `
          <h1>❌ Erro ao gerar código</h1>
          <pre>${escapeHtml(lastError)}</pre>
          <a href="/">Voltar</a>
        `
      )
    );
  }
});

app.get('/reset-session', async (req, res) => {
  if (!keyOk(req)) return accessDenied(res);

  try {
    await clearWhatsappSession('manual');

    setTimeout(connectToWhatsApp, 3000);

    return res.send(
      page(
        'Sessão limpa',
        `
          <h1>✅ Sessão limpa</h1>
          <p>A sessão antiga foi removida. Agora será necessário conectar novamente.</p>
          <a href="/">Voltar</a>
        `
      )
    );
  } catch (error) {
    lastError = error?.stack || String(error);

    return res.status(500).send(
      page(
        'Erro ao limpar sessão',
        `
          <h1>❌ Erro ao limpar sessão</h1>
          <pre>${escapeHtml(lastError)}</pre>
        `
      )
    );
  }
});

app.get('/clear-bad-session', async (req, res) => {
  if (!keyOk(req)) return accessDenied(res);

  try {
    await clearWhatsappSession('bad-mac-manual');

    setTimeout(connectToWhatsApp, 3000);

    return res.send(
      page(
        'Sessão corrompida limpa',
        `
          <h1>✅ Sessão corrompida limpa!</h1>
          <p>Os dados de criptografia foram removidos do Supabase.</p>
          <p>O bot vai reconectar em instantes — use <strong>/qr</strong> para escanear o QR Code novamente.</p>
          <a href="/">Voltar</a>
        `
      )
    );
  } catch (error) {
    lastError = error?.stack || String(error);

    return res.status(500).send(
      page(
        'Erro',
        `
          <h1>❌ Erro ao limpar sessão</h1>
          <pre>${escapeHtml(lastError)}</pre>
        `
      )
    );
  }
});

app.get('/:key', (req, res) => {
  const key = req.params.key;

  if (!key || key.includes('.')) {
    return res.status(404).send('Página não encontrada. Use / ou /qr?key=SUA_SENHA');
  }

  return res.redirect(`/qr?key=${encodeURIComponent(key)}`);
});

function scheduleReconnect(delayMs) {
  setTimeout(() => {
    reconnecting = false;
    currentSock = null;
    connectToWhatsApp();
  }, delayMs);
}

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

    const gotLock = await acquireRuntimeLock();

    if (!gotLock) {
      reconnecting = false;
      setTimeout(connectToWhatsApp, 30_000);
      return;
    }

    startRuntimeHeartbeat();

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

      /*
        IMPORTANTE:
        - Mensagens enviadas por outras pessoas normalmente chegam como "notify".
        - Mensagens enviadas pelo próprio WhatsApp conectado podem chegar como "append".
        - Como você conectou o bot no seu próprio número, NÃO podemos ignorar fromMe.
      */
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

          // Ignorar mensagens de status do WhatsApp (stories/status@broadcast)
          if (msg.key?.remoteJid === 'status@broadcast') continue;

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
        reconnectAttempt = 0;
        connectionStatus = 'conectado';
        lastError = null;

        console.log(`${BOT_NAME} conectado ao WhatsApp. instance=${INSTANCE_ID}`);
      }

      if (connection === 'close') {
        currentSock = null;

        const statusCode = lastDisconnect?.error?.output?.statusCode;
        const errorText =
          lastDisconnect?.error?.stack ||
          lastDisconnect?.error?.message ||
          String(lastDisconnect?.error || '');

        const deslogado = statusCode === DisconnectReason.loggedOut;
        const falhaSessao = deslogado || isSessionFailure(errorText, statusCode);

        lastError = errorText || `Conexão fechada. Status: ${statusCode}`;

        console.log('Conexão fechada.', {
          statusCode,
          deslogado,
          falhaSessao,
          autoReset: AUTO_RESET_SESSION,
          instance: INSTANCE_ID
        });

        reconnectAttempt += 1;

        const delay = Math.min(60_000, 6_000 + reconnectAttempt * 4_000);

        if (falhaSessao && AUTO_RESET_SESSION) {
          await clearWhatsappSession(`sessão inválida ${statusCode || ''}`.trim());
          connectionStatus = 'sessão limpa, gere novo QR';
        } else if (falhaSessao) {
          connectionStatus = `sessão preservada, tentando reconectar em ${Math.round(delay / 1000)}s`;
        } else {
          connectionStatus = `reconectando em ${Math.round(delay / 1000)}s`;
        }

        scheduleReconnect(delay);
      }
    });
  } catch (error) {
    currentSock = null;
    reconnecting = false;
    lastError = error?.stack || String(error);

    console.error('Erro ao conectar:', error);

    reconnectAttempt += 1;

    const falhaSessao = isSessionFailure(lastError);

    if (falhaSessao && AUTO_RESET_SESSION) {
      await clearWhatsappSession('erro ao conectar');
      connectionStatus = 'sessão limpa, gere novo QR';
    } else if (falhaSessao) {
      connectionStatus = 'sessão preservada, tentando reconectar';
    } else {
      connectionStatus = 'erro ao conectar, tentando novamente';
    }

    setTimeout(connectToWhatsApp, Math.min(60_000, 10_000 + reconnectAttempt * 5_000));
  }
}

app.listen(PORT, '0.0.0.0', () => {
  console.log(`${BOT_NAME} servidor HTTP rodando em 0.0.0.0:${PORT}. instance=${INSTANCE_ID}`);
  setTimeout(connectToWhatsApp, 1500);
});


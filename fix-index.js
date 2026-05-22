const fs = require('fs');

const file = 'index.js';
let s = fs.readFileSync(file, 'utf8');

s = s.replace("if (type !== 'notify') return;", "if (!['notify', 'append'].includes(type)) return;");
s = s.replace("if (!msg.message || msg.key.fromMe) continue;", "if (!msg.message) continue;");

const broken = '        const st';
const idx = s.indexOf(broken);
if (idx !== -1) {
  const tail = `        const statusCode = lastDisconnect?.error?.output?.statusCode;
        const errorText =
          lastDisconnect?.error?.stack ||
          lastDisconnect?.error?.message ||
          String(lastDisconnect?.error || '');

        const deslogado = statusCode === DisconnectReason.loggedOut;
        const falhaSessao = deslogado || isSessionFailure(errorText, statusCode);

        lastError = errorText || \`Conexão fechada. Status: \${statusCode}\`;

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
          await clearWhatsappSession(\`sessão inválida \${statusCode || ''}\`.trim());
          connectionStatus = 'sessão limpa, gere novo QR';
        } else if (falhaSessao) {
          connectionStatus = \`sessão preservada, tentando reconectar em \${Math.round(delay / 1000)}s\`;
        } else {
          connectionStatus = \`reconectando em \${Math.round(delay / 1000)}s\`;
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
  console.log(\`${BOT_NAME} servidor HTTP rodando em 0.0.0.0:${PORT}. instance=${INSTANCE_ID}\`);
  setTimeout(connectToWhatsApp, 1500);
});
`;
  s = s.slice(0, idx) + tail;
}

fs.writeFileSync(file, s);
console.log('fix-index aplicado com sucesso');

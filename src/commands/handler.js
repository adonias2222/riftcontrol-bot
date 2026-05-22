const { getMessageText, getSenderId, formatarNumero } = require('../utils/message');
const { cadastrarOuAtualizarMembro, buscarMembroPorWhatsapp, buscarRanking } = require('../services/membros');
const { registrarPartida, buscarHistorico, buscarStats } = require('../services/partidas');

function getChatId(msg) {
  return msg.key.remoteJid;
}

function onlyDigits(value) {
  return String(value || '').replace(/\D/g, '');
}

function isGrupo(chatId) {
  return String(chatId || '').endsWith('@g.us');
}

function senderPermitido(senderId) {
  const owner = onlyDigits(process.env.OWNER_NUMBER);
  if (!owner) return false;

  const sender = onlyDigits(senderId);
  return sender.includes(owner) || owner.includes(sender);
}

function chatPermitido(chatId, senderId) {
  const grupoPermitido = process.env.ALLOWED_GROUP_ID;

  if (senderPermitido(senderId)) return true;

  if (grupoPermitido) {
    return chatId === grupoPermitido;
  }

  if (process.env.ONLY_GROUPS === 'true') {
    return isGrupo(chatId);
  }

  return true;
}

async function responder(sock, msg, texto) {
  await sock.sendMessage(
    msg.key.remoteJid,
    { text: texto },
    { quoted: msg }
  );
}

function menu() {
  return `⚔️ *RiftControl - Guilda Wild Rift*

👤 *Perfil*
!cadastrar nick elo rota
!perfil
!stats
!historico

🎮 *Partidas*
!partida vitória 12/3/8 ranked jungle
!partida derrota 4/7/10 normal suporte
!partida vitória 15/0/6 ranked adc mvp guilda

🏆 *Ranking*
!ranking

🧪 *Teste*
!Naldo

🔒 *Controle*
!idgrupo
!meuid

ℹ️ *Ajuda*
!menu`;
}

function textoNaldo() {
  return `🤖 *RiftControl - Automação ativa!*

Olá, Naldo! Este é um comando de teste da automação da guilda.

✅ O bot está recebendo mensagens no WhatsApp.
✅ A automação está processando comandos.
✅ O sistema está pronto para controlar membros, XP, ranking, histórico de partidas e KDA.

Use *!menu* para ver todos os comandos disponíveis.`;
}

function ajudaCadastro() {
  return `Use assim:

!cadastrar DarkJungle esmeralda jungle

Exemplo:
!cadastrar Luxzinha ouro suporte`;
}

function ajudaPartida() {
  return `Use assim:

!partida vitória 12/3/8 ranked jungle

Extras opcionais:
mvp | guilda | torneio

Exemplo:
!partida vitória 15/0/6 ranked adc mvp guilda`;
}

async function handleCommand(sock, msg) {
  const text = getMessageText(msg);
  if (!text.startsWith('!')) return;

  const chatId = getChatId(msg);
  const senderId = getSenderId(msg);
  const pushName = msg.pushName || 'Jogador';

  const partes = text.trim().split(/\s+/);
  const comando = partes.shift().replace('!', '').toLowerCase();
  const args = partes;

  try {
    if (comando === 'idgrupo' || comando === 'grupoid') {
      if (!isGrupo(chatId)) {
        return responder(sock, msg, 'Esse comando precisa ser usado dentro do grupo que você quer liberar.');
      }

      return responder(sock, msg, `🔒 *ID deste grupo:*

${chatId}

Coloque no Back4App:
ALLOWED_GROUP_ID=${chatId}`);
    }

    if (comando === 'meuid' || comando === 'meunumero') {
      return responder(sock, msg, `👤 *Seu ID no WhatsApp:*

${senderId}

Seu número detectado:
${onlyDigits(senderId)}

Para liberar seus comandos no privado, coloque no Back4App:
OWNER_NUMBER=${onlyDigits(senderId)}`);
    }

    if (!chatPermitido(chatId, senderId)) {
      return;
    }

    if (comando === 'menu' || comando === 'ajuda') {
      return responder(sock, msg, menu());
    }

    if (comando === 'naldo') {
      return responder(sock, msg, textoNaldo());
    }

    if (comando === 'cadastrar') {
      if (args.length < 3) return responder(sock, msg, ajudaCadastro());

      const [nick, elo, rota] = args;
      const { membro, atualizado } = await cadastrarOuAtualizarMembro({
        whatsappId: senderId,
        nome: pushName,
        nick,
        elo,
        rota
      });

      return responder(sock, msg, `${atualizado ? '♻️ Cadastro atualizado!' : '✅ Cadastro realizado!'}

👤 Nick: ${membro.nick}
🏅 Elo: ${membro.elo}
🛣️ Rota: ${membro.rota}
⭐ XP: ${membro.xp}
🎖️ Cargo: ${membro.cargo}`);
    }

    if (comando === 'perfil') {
      const membro = await buscarMembroPorWhatsapp(senderId);
      if (!membro) return responder(sock, msg, 'Você ainda não está cadastrado. Use: !cadastrar nick elo rota');

      return responder(sock, msg, `👤 *Perfil*

Nick: ${membro.nick}
Nome: ${membro.nome || '-'}
Elo: ${membro.elo || '-'}
Rota: ${membro.rota || '-'}
XP: ${membro.xp}
Cargo: ${membro.cargo}
Presenças: ${membro.presencas}
Faltas: ${membro.faltas}`);
    }

    if (comando === 'partida') {
      if (args.length < 4) return responder(sock, msg, ajudaPartida());

      const [resultado, kdaTexto, modo, rota, ...extras] = args;
      const kdaPartes = kdaTexto.split('/');
      if (kdaPartes.length !== 3) return responder(sock, msg, ajudaPartida());

      const [kills, deaths, assists] = kdaPartes;
      const extrasTexto = extras.join(' ').toLowerCase();

      const resultadoRegistro = await registrarPartida({
        whatsappId: senderId,
        resultado,
        kills,
        deaths,
        assists,
        modo,
        rota,
        mvp: extrasTexto.includes('mvp'),
        comGuilda: extrasTexto.includes('guilda'),
        torneio: extrasTexto.includes('torneio') || extrasTexto.includes('md3')
      });

      if (!resultadoRegistro.ok) return responder(sock, msg, resultadoRegistro.mensagem);

      const { membro, partida, kda, xpGanho } = resultadoRegistro;
      return responder(sock, msg, `⚔️ *Partida registrada!*

Jogador: ${membro.nick}
Resultado: ${partida.resultado}
Modo: ${partida.modo}
Rota: ${partida.rota}
K/D/A: ${partida.kills}/${partida.deaths}/${partida.assists}
KDA: ${kda}

⭐ XP ganho: +${xpGanho}
🏆 XP total: ${membro.xp}
🎖️ Cargo: ${membro.cargo}`);
    }

    if (comando === 'ranking' || comando === 'rank') {
      const ranking = await buscarRanking(10);
      if (!ranking.length) return responder(sock, msg, 'Ainda não há membros no ranking.');

      const linhas = ranking.map((membro, index) => `${index + 1}º ${membro.nick} - ${membro.xp} XP - ${membro.cargo}`);
      return responder(sock, msg, `🏆 *Ranking da Guilda*\n\n${linhas.join('\n')}`);
    }

    if (comando === 'historico') {
      const resultado = await buscarHistorico(senderId, 5);
      if (!resultado.ok) return responder(sock, msg, resultado.mensagem);
      if (!resultado.partidas.length) return responder(sock, msg, 'Você ainda não registrou partidas.');

      const linhas = resultado.partidas.map((p, index) => `${index + 1}. ${p.resultado} | ${p.kills}/${p.deaths}/${p.assists} | KDA ${p.kda} | +${p.xp_ganho} XP`);
      return responder(sock, msg, `📜 *Histórico - ${resultado.membro.nick}*\n\n${linhas.join('\n')}`);
    }

    if (comando === 'stats') {
      const resultado = await buscarStats(senderId);
      if (!resultado.ok) return responder(sock, msg, resultado.mensagem);

      const { membro, stats } = resultado;
      return responder(sock, msg, `📊 *Stats - ${membro.nick}*

Partidas: ${stats.total}
Vitórias: ${stats.vitorias}
Derrotas: ${stats.derrotas}
Winrate: ${formatarNumero(stats.winrate)}%

Abates: ${stats.kills}
Mortes: ${stats.deaths}
Assistências: ${stats.assists}

KDA geral: ${formatarNumero(stats.kdaGeral)}
Melhor KDA: ${formatarNumero(stats.melhorKda)}
XP por partidas: ${stats.xpPartidas}
XP total: ${membro.xp}
Cargo: ${membro.cargo}`);
    }

    return responder(sock, msg, 'Comando não encontrado. Use !menu');
  } catch (error) {
    console.error('Erro no comando:', error);
    return responder(sock, msg, `❌ Erro ao executar comando: ${error.message}`);
  }
}

module.exports = handleCommand;

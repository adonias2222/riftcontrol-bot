function getMessageText(msg) {
  const message = msg.message || {};

  return (
    message.conversation ||
    message.extendedTextMessage?.text ||
    message.imageMessage?.caption ||
    message.videoMessage?.caption ||
    ''
  ).trim();
}

function getSenderId(msg) {
  return msg.key.participant || msg.key.remoteJid;
}

function isGroupMessage(msg) {
  return String(msg.key.remoteJid || '').endsWith('@g.us');
}

function formatarNumero(valor, casas = 2) {
  const numero = Number(valor || 0);
  return numero.toFixed(casas);
}

module.exports = {
  getMessageText,
  getSenderId,
  isGroupMessage,
  formatarNumero
};

function normalizarResultado(resultado) {
  const texto = String(resultado || '').toLowerCase();

  if (['vitoria', 'vitória', 'win', 'w'].includes(texto)) {
    return 'vitória';
  }

  if (['derrota', 'loss', 'lose', 'l'].includes(texto)) {
    return 'derrota';
  }

  return null;
}

function calcularKDA(kills, deaths, assists) {
  const mortes = Number(deaths) === 0 ? 1 : Number(deaths);
  return Number(((Number(kills) + Number(assists)) / mortes).toFixed(2));
}

function calcularXP({ resultado, kills, deaths, assists, modo, mvp = false, comGuilda = false, torneio = false }) {
  const resultadoNormalizado = normalizarResultado(resultado);
  let xp = resultadoNormalizado === 'vitória' ? 25 : 8;

  const kda = calcularKDA(kills, deaths, assists);

  if (kda >= 10) xp += 30;
  else if (kda >= 6) xp += 20;
  else if (kda >= 4) xp += 15;
  else if (kda >= 2) xp += 10;
  else if (kda >= 1) xp += 5;

  if (String(modo || '').toLowerCase() === 'ranked') xp += 5;
  if (Number(deaths) === 0) xp += 10;
  if (mvp) xp += 15;
  if (comGuilda) xp += 10;
  if (torneio) xp += 25;

  return xp;
}

function definirCargo(xp) {
  const total = Number(xp) || 0;

  if (total >= 1000) return 'Lenda da Guilda';
  if (total >= 600) return 'Veterano';
  if (total >= 300) return 'Elite';
  if (total >= 100) return 'Membro';

  return 'Recruta';
}

module.exports = {
  normalizarResultado,
  calcularKDA,
  calcularXP,
  definirCargo
};

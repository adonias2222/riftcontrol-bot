const supabase = require('../database/supabase');
const { buscarMembroPorWhatsapp, atualizarXP } = require('./membros');
const { normalizarResultado, calcularKDA, calcularXP } = require('../utils/xp');

async function registrarPartida({ whatsappId, resultado, kills, deaths, assists, modo, rota, mvp, comGuilda, torneio }) {
  const membro = await buscarMembroPorWhatsapp(whatsappId);

  if (!membro) {
    return {
      ok: false,
      mensagem: 'Você ainda não está cadastrado. Use: !cadastrar nick elo rota'
    };
  }

  const resultadoNormalizado = normalizarResultado(resultado);

  if (!resultadoNormalizado) {
    return {
      ok: false,
      mensagem: 'Resultado inválido. Use vitória ou derrota.'
    };
  }

  const k = Number(kills);
  const d = Number(deaths);
  const a = Number(assists);

  if ([k, d, a].some((n) => Number.isNaN(n) || n < 0)) {
    return {
      ok: false,
      mensagem: 'K/D/A inválido. Exemplo correto: !partida vitória 12/3/8 ranked jungle'
    };
  }

  const kda = calcularKDA(k, d, a);
  const xpGanho = calcularXP({
    resultado: resultadoNormalizado,
    kills: k,
    deaths: d,
    assists: a,
    modo,
    mvp,
    comGuilda,
    torneio
  });

  const { data: partida, error } = await supabase
    .from('partidas')
    .insert({
      membro_id: membro.id,
      resultado: resultadoNormalizado,
      kills: k,
      deaths: d,
      assists: a,
      kda,
      modo,
      rota,
      mvp,
      com_guilda: comGuilda,
      torneio,
      xp_ganho: xpGanho,
      status: 'aprovada'
    })
    .select('*')
    .single();

  if (error) throw error;

  const membroAtualizado = await atualizarXP(
    membro,
    xpGanho,
    `Partida ${resultadoNormalizado} - ${k}/${d}/${a} - KDA ${kda}`
  );

  return {
    ok: true,
    membro: membroAtualizado,
    partida,
    kda,
    xpGanho
  };
}

async function buscarHistorico(whatsappId, limite = 5) {
  const membro = await buscarMembroPorWhatsapp(whatsappId);

  if (!membro) {
    return {
      ok: false,
      mensagem: 'Você ainda não está cadastrado. Use: !cadastrar nick elo rota'
    };
  }

  const { data, error } = await supabase
    .from('partidas')
    .select('*')
    .eq('membro_id', membro.id)
    .order('criado_em', { ascending: false })
    .limit(limite);

  if (error) throw error;

  return {
    ok: true,
    membro,
    partidas: data || []
  };
}

async function buscarStats(whatsappId) {
  const membro = await buscarMembroPorWhatsapp(whatsappId);

  if (!membro) {
    return {
      ok: false,
      mensagem: 'Você ainda não está cadastrado. Use: !cadastrar nick elo rota'
    };
  }

  const { data, error } = await supabase
    .from('partidas')
    .select('*')
    .eq('membro_id', membro.id)
    .eq('status', 'aprovada');

  if (error) throw error;

  const partidas = data || [];
  const total = partidas.length;
  const vitorias = partidas.filter((p) => p.resultado === 'vitória').length;
  const derrotas = partidas.filter((p) => p.resultado === 'derrota').length;

  const kills = partidas.reduce((soma, p) => soma + Number(p.kills || 0), 0);
  const deaths = partidas.reduce((soma, p) => soma + Number(p.deaths || 0), 0);
  const assists = partidas.reduce((soma, p) => soma + Number(p.assists || 0), 0);
  const xpPartidas = partidas.reduce((soma, p) => soma + Number(p.xp_ganho || 0), 0);
  const melhorKda = partidas.reduce((maior, p) => Math.max(maior, Number(p.kda || 0)), 0);

  const kdaGeral = deaths === 0 ? kills + assists : (kills + assists) / deaths;
  const winrate = total === 0 ? 0 : (vitorias / total) * 100;

  return {
    ok: true,
    membro,
    stats: {
      total,
      vitorias,
      derrotas,
      kills,
      deaths,
      assists,
      xpPartidas,
      melhorKda,
      kdaGeral,
      winrate
    }
  };
}

module.exports = {
  registrarPartida,
  buscarHistorico,
  buscarStats
};

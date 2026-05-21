const supabase = require('../database/supabase');
const { definirCargo } = require('../utils/xp');

async function buscarMembroPorWhatsapp(whatsappId) {
  const { data, error } = await supabase
    .from('membros')
    .select('*')
    .eq('whatsapp_id', whatsappId)
    .maybeSingle();

  if (error) throw error;
  return data;
}

async function cadastrarOuAtualizarMembro({ whatsappId, nome, nick, elo, rota }) {
  const existente = await buscarMembroPorWhatsapp(whatsappId);

  if (existente) {
    const { data, error } = await supabase
      .from('membros')
      .update({
        nome,
        nick,
        elo,
        rota
      })
      .eq('id', existente.id)
      .select('*')
      .single();

    if (error) throw error;

    return {
      membro: data,
      atualizado: true
    };
  }

  const { data, error } = await supabase
    .from('membros')
    .insert({
      whatsapp_id: whatsappId,
      nome,
      nick,
      elo,
      rota
    })
    .select('*')
    .single();

  if (error) throw error;

  return {
    membro: data,
    atualizado: false
  };
}

async function atualizarXP(membro, xpGanho, motivo) {
  const novoXP = Number(membro.xp || 0) + Number(xpGanho || 0);
  const novoCargo = definirCargo(novoXP);

  const { data, error } = await supabase
    .from('membros')
    .update({
      xp: novoXP,
      cargo: novoCargo
    })
    .eq('id', membro.id)
    .select('*')
    .single();

  if (error) throw error;

  await supabase
    .from('historico_xp')
    .insert({
      membro_id: membro.id,
      xp: xpGanho,
      motivo
    });

  return data;
}

async function buscarRanking(limite = 10) {
  const { data, error } = await supabase
    .from('membros')
    .select('nick, elo, rota, xp, cargo')
    .order('xp', { ascending: false })
    .limit(limite);

  if (error) throw error;
  return data || [];
}

module.exports = {
  buscarMembroPorWhatsapp,
  cadastrarOuAtualizarMembro,
  atualizarXP,
  buscarRanking
};

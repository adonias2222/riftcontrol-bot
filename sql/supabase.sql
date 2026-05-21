-- RiftControl - Banco Supabase
-- Rode este SQL em: Supabase > SQL Editor > New Query

CREATE TABLE IF NOT EXISTS membros (
  id BIGSERIAL PRIMARY KEY,
  whatsapp_id TEXT UNIQUE NOT NULL,
  nome TEXT,
  nick TEXT NOT NULL,
  elo TEXT,
  rota TEXT,
  xp INTEGER DEFAULT 0,
  cargo TEXT DEFAULT 'Recruta',
  presencas INTEGER DEFAULT 0,
  faltas INTEGER DEFAULT 0,
  criado_em TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS partidas (
  id BIGSERIAL PRIMARY KEY,
  membro_id BIGINT REFERENCES membros(id) ON DELETE CASCADE,
  resultado TEXT NOT NULL,
  kills INTEGER NOT NULL,
  deaths INTEGER NOT NULL,
  assists INTEGER NOT NULL,
  kda NUMERIC(10,2) NOT NULL,
  modo TEXT,
  rota TEXT,
  mvp BOOLEAN DEFAULT FALSE,
  com_guilda BOOLEAN DEFAULT FALSE,
  torneio BOOLEAN DEFAULT FALSE,
  xp_ganho INTEGER DEFAULT 0,
  status TEXT DEFAULT 'aprovada',
  criado_em TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS historico_xp (
  id BIGSERIAL PRIMARY KEY,
  membro_id BIGINT REFERENCES membros(id) ON DELETE CASCADE,
  xp INTEGER NOT NULL,
  motivo TEXT,
  criado_em TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS eventos (
  id BIGSERIAL PRIMARY KEY,
  titulo TEXT NOT NULL,
  horario TEXT,
  status TEXT DEFAULT 'aberto',
  criado_em TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS presencas (
  id BIGSERIAL PRIMARY KEY,
  evento_id BIGINT REFERENCES eventos(id) ON DELETE CASCADE,
  membro_id BIGINT REFERENCES membros(id) ON DELETE CASCADE,
  confirmou BOOLEAN DEFAULT TRUE,
  criado_em TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(evento_id, membro_id)
);

-- Sessão do WhatsApp/Baileys salva no Supabase.
-- Isso evita perder login em redeploy do container.
CREATE TABLE IF NOT EXISTS bot_auth (
  id TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_membros_xp ON membros (xp DESC);
CREATE INDEX IF NOT EXISTS idx_partidas_membro ON partidas (membro_id);
CREATE INDEX IF NOT EXISTS idx_historico_membro ON historico_xp (membro_id);

const fs = require('fs/promises');
const path = require('path');
const supabase = require('../database/supabase');

const PREFIX = 'auth_file:';

async function exists(target) {
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
}

async function listFilesRecursive(dir) {
  if (!(await exists(dir))) return [];

  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      const children = await listFilesRecursive(fullPath);
      files.push(...children);
    } else if (entry.isFile()) {
      files.push(fullPath);
    }
  }

  return files;
}

function normalizeRelative(filePath) {
  return filePath.replace(/\\/g, '/').replace(/^\/+/, '');
}

async function restoreAuthFolder(authFolder) {
  const { data, error } = await supabase
    .from('bot_auth')
    .select('id,value')
    .like('id', `${PREFIX}%`);

  if (error) {
    console.error('Erro ao restaurar auth do Supabase:', error.message);
    return 0;
  }

  if (!data || data.length === 0) return 0;

  await fs.mkdir(authFolder, { recursive: true });

  let restored = 0;

  for (const row of data) {
    const relativeName = normalizeRelative(String(row.id).slice(PREFIX.length));
    if (!relativeName || relativeName.includes('..')) continue;

    let parsed;
    try {
      parsed = typeof row.value === 'string' ? JSON.parse(row.value) : row.value;
    } catch {
      parsed = { content: row.value };
    }

    const content = typeof parsed?.content === 'string' ? parsed.content : '';
    if (!content) continue;

    const target = path.join(authFolder, relativeName);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, content, 'utf8');
    restored += 1;
  }

  console.log(`Auth restaurado do Supabase: ${restored} arquivo(s).`);
  return restored;
}

async function backupAuthFolder(authFolder) {
  const files = await listFilesRecursive(authFolder);

  if (files.length === 0) return 0;

  const rows = [];
  const now = new Date().toISOString();

  for (const file of files) {
    const relativeName = normalizeRelative(path.relative(authFolder, file));
    const content = await fs.readFile(file, 'utf8');

    rows.push({
      id: `${PREFIX}${relativeName}`,
      value: JSON.stringify({ content }),
      updated_at: now
    });
  }

  const { error: deleteError } = await supabase
    .from('bot_auth')
    .delete()
    .like('id', `${PREFIX}%`);

  if (deleteError) {
    console.error('Erro ao limpar backup antigo de auth:', deleteError.message);
  }

  const { error } = await supabase
    .from('bot_auth')
    .upsert(rows, { onConflict: 'id' });

  if (error) {
    console.error('Erro ao salvar auth no Supabase:', error.message);
    return 0;
  }

  console.log(`Auth salvo no Supabase: ${rows.length} arquivo(s).`);
  return rows.length;
}

async function usePersistentLocalAuthState(authFolder, useMultiFileAuthState) {
  await restoreAuthFolder(authFolder);

  const auth = await useMultiFileAuthState(authFolder);
  const originalSaveCreds = auth.saveCreds;

  let saving = false;
  let pending = false;

  async function saveCreds() {
    await originalSaveCreds();

    if (saving) {
      pending = true;
      return;
    }

    saving = true;

    try {
      do {
        pending = false;
        await backupAuthFolder(authFolder);
      } while (pending);
    } finally {
      saving = false;
    }
  }

  return {
    state: auth.state,
    saveCreds,
    backupNow: () => backupAuthFolder(authFolder)
  };
}

module.exports = {
  usePersistentLocalAuthState,
  restoreAuthFolder,
  backupAuthFolder
};

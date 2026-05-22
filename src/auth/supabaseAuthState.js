const { initAuthCreds, BufferJSON, proto } = require('@whiskeysockets/baileys');
const supabase = require('../database/supabase');

async function readData(id) {
  const { data, error } = await supabase
    .from('bot_auth')
    .select('value')
    .eq('id', id)
    .maybeSingle();

  if (error) {
    console.error(`Erro ao ler auth ${id}:`, error.message);
    return null;
  }

  if (!data?.value) return null;

  try {
    return JSON.parse(data.value, BufferJSON.reviver);
  } catch (error) {
    console.error(`Erro ao converter auth ${id}:`, error.message);
    return null;
  }
}

async function writeData(value, id) {
  const payload = {
    id,
    value: JSON.stringify(value, BufferJSON.replacer),
    updated_at: new Date().toISOString()
  };

  const { error } = await supabase
    .from('bot_auth')
    .upsert(payload, { onConflict: 'id' });

  if (error) {
    console.error(`Erro ao salvar auth ${id}:`, error.message);
  }
}

async function removeData(id) {
  const { error } = await supabase
    .from('bot_auth')
    .delete()
    .eq('id', id);

  if (error) {
    console.error(`Erro ao remover auth ${id}:`, error.message);
  }
}

async function useSupabaseAuthState() {
  const creds = (await readData('creds')) || initAuthCreds();

  return {
    state: {
      creds,
      keys: {
        get: async (type, ids) => {
          const data = {};

          await Promise.all(
            ids.map(async (id) => {
              let value = await readData(`${type}-${id}`);

              if (type === 'app-state-sync-key' && value) {
                value = proto.Message.AppStateSyncKeyData.fromObject(value);
              }

              data[id] = value;
            })
          );

          return data;
        },
        set: async (data) => {
          const tasks = [];

          for (const category of Object.keys(data)) {
            for (const id of Object.keys(data[category])) {
              const value = data[category][id];
              const key = `${category}-${id}`;

              if (value) tasks.push(writeData(value, key));
              else tasks.push(removeData(key));
            }
          }

          await Promise.all(tasks);
        }
      }
    },
    saveCreds: async () => {
      await writeData(creds, 'creds');
    }
  };
}

module.exports = useSupabaseAuthState;

const { initAuthCreds, BufferJSON, proto } = require('@whiskeysockets/baileys');
const supabase = require('../database/supabase');

async function readData(id) {
  try {
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

    return JSON.parse(data.value, BufferJSON.reviver);
  } catch (err) {
    console.error(`Erro ao converter auth ${id}:`, err.message);
    return null;
  }
}

async function writeData(value, id) {
  try {
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
  } catch (err) {
    console.error(`Erro inesperado ao salvar auth ${id}:`, err.message);
  }
}

async function removeData(id) {
  try {
    const { error } = await supabase
      .from('bot_auth')
      .delete()
      .eq('id', id);

    if (error) {
      console.error(`Erro ao remover auth ${id}:`, error.message);
    }
  } catch (err) {
    console.error(`Erro inesperado ao remover auth ${id}:`, err.message);
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
              try {
                let value = await readData(`${type}-${id}`);

                if (type === 'app-state-sync-key' && value) {
                  value = proto.Message.AppStateSyncKeyData.fromObject(value);
                }

                data[id] = value;
              } catch (err) {
                console.error(`Erro ao ler chave ${type}-${id}:`, err.message);
                data[id] = null;
              }
            })
          );

          return data;
        },
        set: async (data) => {
          // Salvar cada chave de forma independente para que uma falha
          // não cancele o salvamento das outras (evita corrupção parcial)
          const tasks = [];

          for (const category of Object.keys(data)) {
            for (const id of Object.keys(data[category])) {
              const value = data[category][id];
              const key = `${category}-${id}`;

              if (value) {
                tasks.push(writeData(value, key));
              } else {
                tasks.push(removeData(key));
              }
            }
          }

          // allSettled garante que todas as operações rodam mesmo se uma falha
          await Promise.allSettled(tasks);
        }
      }
    },
    saveCreds: async () => {
      await writeData(creds, 'creds');
    }
  };
}

module.exports = useSupabaseAuthState;

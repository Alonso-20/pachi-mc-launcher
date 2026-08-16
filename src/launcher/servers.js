const fs = require('fs');
const path = require('path');
const nbt = require('prismarine-nbt');

/**
 * Añade el servidor del manifest a servers.dat (la lista de multijugador)
 * para que aparezca siempre como primera opción en el menú del juego.
 */
async function ensureServerEntry(rootPath, server) {
  if (!server || !server.ip) return;

  const file = path.join(rootPath, 'servers.dat');
  const addr = server.port && Number(server.port) !== 25565 ? `${server.ip}:${server.port}` : server.ip;
  const name = server.name || 'Servidor';

  let list = [];
  if (fs.existsSync(file)) {
    try {
      const { parsed } = await nbt.parse(fs.readFileSync(file));
      list = (parsed.value.servers && parsed.value.servers.value && parsed.value.servers.value.value) || [];
      if (list.some((s) => s.ip && s.ip.value === addr)) return; // ya existe
    } catch {
      return; // no tocar un servers.dat que no se pudo leer
    }
  }

  list.unshift({
    name: { type: 'string', value: name },
    ip: { type: 'string', value: addr },
  });

  const data = nbt.writeUncompressed({
    type: 'compound',
    name: '',
    value: {
      servers: { type: 'list', value: { type: 'compound', value: list } },
    },
  });
  fs.mkdirSync(rootPath, { recursive: true });
  fs.writeFileSync(file, data);
}

module.exports = { ensureServerEntry };

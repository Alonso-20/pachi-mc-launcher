const FTB_API = 'https://api.feed-the-beast.com/v1/modpacks/public/modpack';

/**
 * Descarga la lista de archivos de un modpack de FTB.
 *
 * En el manifest del launcher basta con:
 *   "ftbPack": { "id": 134, "version": 100466 }
 *
 * Devuelve { files, targets } donde `files` ya viene normalizado al mismo
 * formato que usa el sincronizador y sin los archivos exclusivos del servidor.
 */
async function fetchFtbPack(id, version) {
  const res = await fetch(`${FTB_API}/${id}/${version}`);
  if (!res.ok) throw new Error(`FTB API respondió HTTP ${res.status} para el pack ${id}/${version}`);
  const data = await res.json();
  if (data.status && data.status !== 'success') {
    throw new Error(`FTB API: ${data.message || 'no se pudo obtener el modpack'}`);
  }
  if (!Array.isArray(data.files)) throw new Error('La respuesta de FTB no trae lista de archivos.');

  const files = data.files
    .filter((f) => !f.serveronly)
    .map((f) => ({
      // path viene como "./mods" y name como "algo.jar"
      path: `${String(f.path).replace(/^\.\/?/, '').replace(/\/$/, '')}/${f.name}`.replace(/^\//, ''),
      url: f.url,
      mirrors: f.mirrors || [],
      sha1: (f.sha1 || (f.hashes && f.hashes.sha1) || '').toLowerCase(),
      size: f.size || 0,
    }));

  const targets = {};
  for (const t of data.targets || []) targets[t.name] = t.version;

  return { files, targets, versionName: data.name };
}

module.exports = { fetchFtbPack };

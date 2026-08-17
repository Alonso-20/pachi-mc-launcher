const fs = require('fs');
const path = require('path');
const { downloadFile, sha1File, mapLimit, safeJoin } = require('./util');

const STATE_FILE = '.launcher-state.json';
const CONCURRENCY = 12;

function loadState(root) {
  try {
    const s = JSON.parse(fs.readFileSync(path.join(root, STATE_FILE), 'utf8'));
    return s && typeof s.files === 'object' ? s : { files: {} };
  } catch {
    return { files: {} };
  }
}

function saveState(root, state) {
  try {
    fs.writeFileSync(path.join(root, STATE_FILE), JSON.stringify(state));
  } catch {}
}

/**
 * Sincroniza un conjunto de archivos ({ path, url, sha1, size, mirrors }) dentro
 * de `root`.
 *
 * Puntos clave:
 *  - Solo descarga lo que falta o lo que tiene el hash cambiado (comparando
 *    contra un estado local, así no re-hashea 1 GB en cada arranque).
 *  - Al actualizar el modpack elimina ÚNICAMENTE los archivos que este launcher
 *    instaló antes y que ya no están en la lista. Los archivos del jugador
 *    (mundos, capturas, options.txt, resourcepacks propios) nunca se tocan.
 *  - En modo "strict" además borra los .jar sueltos que alguien haya metido a
 *    mano en mods/, para que todos jueguen exactamente con lo mismo.
 */
async function syncFiles(files, root, { syncMode = 'strict', onStatus = () => {} } = {}) {
  fs.mkdirSync(root, { recursive: true });
  const state = loadState(root);

  const desired = new Map();
  for (const f of files) {
    if (!f || !f.path || !f.url) continue;
    desired.set(f.path.replace(/\\/g, '/'), f);
  }

  // --- 1. Decidir qué hay que descargar -------------------------------------
  onStatus('Comprobando archivos instalados...', null);
  const pending = [];
  let checked = 0;

  await mapLimit([...desired.values()], CONCURRENCY, async (file) => {
    const dest = safeJoin(root, file.path);
    const known = state.files[file.path];
    let needs = true;

    if (fs.existsSync(dest)) {
      const stat = fs.statSync(dest);
      if (known && known.sha1 === file.sha1 && stat.size === file.size) {
        needs = false; // ya verificado antes y no ha cambiado
      } else if (file.sha1) {
        needs = (await sha1File(dest)) !== file.sha1;
      } else {
        needs = false;
      }
    }

    if (needs) pending.push(file);
    else state.files[file.path] = { sha1: file.sha1, size: file.size };

    if (++checked % 500 === 0) {
      onStatus(`Comprobando archivos instalados... (${checked}/${desired.size})`, null);
    }
  });

  // --- 2. Descargar lo que falta --------------------------------------------
  const totalBytes = pending.reduce((a, f) => a + (f.size || 0), 0);
  let doneBytes = 0;
  let doneFiles = 0;

  if (pending.length) {
    const mb = (totalBytes / 1024 / 1024).toFixed(0);
    onStatus(`Descargando ${pending.length} archivos (${mb} MB)...`, 0);

    await mapLimit(pending, CONCURRENCY, async (file) => {
      const dest = safeJoin(root, file.path);
      await downloadFile(file.url, dest, (bytes) => {
        doneBytes += bytes;
        if (totalBytes) {
          onStatus(
            `Descargando modpack: ${doneFiles}/${pending.length} archivos (${(doneBytes / 1024 / 1024).toFixed(0)}/${mb} MB)`,
            Math.min(99, Math.round((doneBytes / totalBytes) * 100))
          );
        }
      }, file.mirrors);

      if (file.sha1) {
        const got = await sha1File(dest);
        if (got !== file.sha1) {
          fs.rmSync(dest, { force: true });
          throw new Error(`El archivo ${path.basename(file.path)} se descargó corrupto. Vuelve a intentarlo.`);
        }
      }

      state.files[file.path] = { sha1: file.sha1, size: file.size };
      doneFiles++;
    });
  }

  // --- 3. Borrar lo que el admin quitó del modpack ---------------------------
  let removed = 0;
  for (const known of Object.keys(state.files)) {
    if (desired.has(known)) continue;
    try {
      const target = safeJoin(root, known);
      if (fs.existsSync(target)) {
        fs.rmSync(target, { force: true });
        removed++;
      }
    } catch {}
    delete state.files[known];
  }

  // --- 4. Modo estricto: fuera los mods añadidos a mano ----------------------
  if (syncMode === 'strict') {
    const modsDir = path.join(root, 'mods');
    if (fs.existsSync(modsDir)) {
      const wanted = new Set(
        [...desired.keys()].filter((p) => p.startsWith('mods/')).map((p) => p.slice(5).toLowerCase())
      );
      for (const f of fs.readdirSync(modsDir)) {
        if (f.toLowerCase().endsWith('.jar') && !wanted.has(f.toLowerCase())) {
          fs.rmSync(path.join(modsDir, f), { force: true });
          removed++;
        }
      }
    }
  }

  if (removed) onStatus(`Se eliminaron ${removed} archivos obsoletos.`, null);
  saveState(root, state);
  return { downloaded: pending.length, removed };
}

/** Convierte la lista simple `mods` del manifest al formato del sincronizador. */
function modsToFiles(mods = []) {
  return mods
    .filter((m) => m && m.filename && m.url)
    .map((m) => ({
      path: `mods/${m.filename}`,
      url: m.url,
      mirrors: m.mirrors || [],
      sha1: (m.sha1 || '').toLowerCase(),
      size: m.size || 0,
    }));
}

module.exports = { syncFiles, modsToFiles };

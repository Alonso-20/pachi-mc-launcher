const fs = require('fs');
const path = require('path');
const { downloadFile, sha1File } = require('./util');

/**
 * Sincroniza la carpeta de mods con la lista del manifest:
 *  - Descarga los mods que faltan o cuyo SHA-1 no coincide.
 *  - En modo "strict" (por defecto) elimina los .jar que ya no están en la
 *    lista, así el admin puede QUITAR mods remotamente.
 *  - En modo "additive" no borra nada (los jugadores pueden añadir mods propios).
 *
 * Cada mod del manifest: { filename, url, sha1? }
 */
async function syncMods(manifest, rootPath, onStatus) {
  const modsDir = path.join(rootPath, 'mods');
  fs.mkdirSync(modsDir, { recursive: true });

  const wanted = manifest.mods || [];
  const syncMode = manifest.syncMode || 'strict';

  if (syncMode === 'strict') {
    const wantedNames = new Set(wanted.map((m) => m.filename.toLowerCase()));
    for (const f of fs.readdirSync(modsDir)) {
      if (f.toLowerCase().endsWith('.jar') && !wantedNames.has(f.toLowerCase())) {
        onStatus(`Eliminando mod obsoleto: ${f}`, null);
        fs.rmSync(path.join(modsDir, f), { force: true });
      }
    }
  }

  for (let i = 0; i < wanted.length; i++) {
    const mod = wanted[i];
    if (!mod.filename || !mod.url) continue;
    const dest = path.join(modsDir, mod.filename);
    const label = `mod ${i + 1}/${wanted.length}: ${mod.filename}`;

    if (fs.existsSync(dest)) {
      if (!mod.sha1) continue; // sin hash no hay forma de validar; se asume correcto
      const hash = await sha1File(dest);
      if (hash === mod.sha1.toLowerCase()) continue;
      onStatus(`Actualizando ${label}`, null);
    } else {
      onStatus(`Descargando ${label}`, null);
    }

    await downloadFile(mod.url, dest, (pct) => {
      onStatus(`Descargando ${label}${pct != null ? ` (${pct}%)` : ''}`, pct);
    });

    if (mod.sha1) {
      const hash = await sha1File(dest);
      if (hash !== mod.sha1.toLowerCase()) {
        fs.rmSync(dest, { force: true });
        throw new Error(`El mod ${mod.filename} se descargó corrupto (SHA-1 no coincide). Intenta de nuevo.`);
      }
    }
  }
}

module.exports = { syncMods };

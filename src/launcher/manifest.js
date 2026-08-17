const { compareVersions } = require('./util');

/**
 * Descarga y valida el manifest remoto (el archivo que el admin edita en GitHub).
 */
async function fetchManifest(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    // Cache-buster para que GitHub raw no sirva una versión vieja
    const bust = url + (url.includes('?') ? '&' : '?') + 't=' + Date.now();
    const res = await fetch(bust, { signal: controller.signal, cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const manifest = await res.json();
    const hasPack = manifest.ftbPack && manifest.ftbPack.id;
    if (!hasPack && !(manifest.game && manifest.game.mcVersion)) {
      throw new Error('El manifest necesita "ftbPack" o "game.mcVersion"');
    }
    return manifest;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Reglas de acceso controladas por el admin desde el manifest:
 *  - launcher.enabled: false        -> apaga el launcher para TODOS
 *  - launcher.minVersion            -> versiones viejas del launcher quedan obsoletas
 *  - launcher.blockedUsers          -> lista negra por nombre de usuario
 *  - launcher.allowedUsers          -> si existe y no es null, SOLO esos usuarios pueden jugar
 *
 * `username` puede ser null (chequeo previo al login); en ese caso solo se
 * validan las reglas globales.
 */
function checkAccess(manifest, launcherVersion, username) {
  const l = manifest.launcher || {};

  if (l.enabled === false) {
    return { ok: false, reason: l.disabledMessage || 'El launcher está deshabilitado temporalmente por el administrador.' };
  }

  if (l.minVersion && compareVersions(launcherVersion, l.minVersion) < 0) {
    // No se muestra ninguna URL: el launcher se actualiza solo al reiniciarse.
    return {
      ok: false,
      reason:
        `Tu launcher (v${launcherVersion}) quedó obsoleto y necesita la versión ${l.minVersion} o superior.\n` +
        'Cierra el launcher y vuelve a abrirlo para que se actualice. Si sigue igual, pide el instalador al administrador.',
      updateUrl: l.updateUrl || null,
    };
  }

  if (username) {
    const name = String(username).toLowerCase();
    const blocked = (l.blockedUsers || []).map((u) => String(u).toLowerCase());
    if (blocked.includes(name)) {
      return { ok: false, reason: l.blockedMessage || 'Tu acceso al launcher fue revocado por el administrador.' };
    }
    if (Array.isArray(l.allowedUsers)) {
      const allowed = l.allowedUsers.map((u) => String(u).toLowerCase());
      if (!allowed.includes(name)) {
        return { ok: false, reason: l.notAllowedMessage || 'No estás en la lista de jugadores autorizados. Contacta al administrador.' };
      }
    }
  }

  return { ok: true };
}

module.exports = { fetchManifest, checkAccess };

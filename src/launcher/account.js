const fs = require('fs');
const path = require('path');
const { app, safeStorage } = require('electron');
const { Auth, mcTokenToolbox } = require('msmc');

const sessionFile = () => path.join(app.getPath('userData'), 'session.dat');

// ------------------------------------------------------------
// Guardado del token
// El token de refresco es una credencial: se cifra con safeStorage (DPAPI en
// Windows), que lo ata a la cuenta de Windows del jugador. Si el sistema no
// ofrece cifrado, se prefiere NO guardar nada antes que dejarlo en claro.
// ------------------------------------------------------------
function saveSession(token) {
  try {
    if (!safeStorage.isEncryptionAvailable()) return;
    fs.writeFileSync(sessionFile(), safeStorage.encryptString(JSON.stringify(token)));
  } catch {}
}

function loadSession() {
  try {
    if (!fs.existsSync(sessionFile()) || !safeStorage.isEncryptionAvailable()) return null;
    return JSON.parse(safeStorage.decryptString(fs.readFileSync(sessionFile())));
  } catch {
    return null;
  }
}

function clearSession() {
  try {
    fs.rmSync(sessionFile(), { force: true });
  } catch {}
}

// ------------------------------------------------------------
// Perfil para la interfaz
// ------------------------------------------------------------
/** Descarga la skin y la devuelve como data URI (el CSP bloquea imágenes externas). */
async function skinDataUri(profile) {
  try {
    const skin = profile && profile.skins && profile.skins.find((s) => s.state === 'ACTIVE');
    if (!skin || !skin.url) return null;
    const res = await fetch(skin.url);
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    return `data:image/png;base64,${buf.toString('base64')}`;
  } catch {
    return null;
  }
}

async function toAccount(mc) {
  const user = mc.mclc();
  return {
    name: (mc.profile && mc.profile.name) || user.name,
    uuid: user.uuid,
    skin: await skinDataUri(mc.profile),
    auth: user,
  };
}

// ------------------------------------------------------------
// Login / restauración
// ------------------------------------------------------------
/** Abre la ventana de Microsoft. Devuelve la cuenta y deja la sesión guardada. */
async function login() {
  const auth = new Auth('select_account');
  const xbox = await auth.launch('electron');
  const mc = await xbox.getMinecraft();
  saveSession(mc.getToken(true));
  return await toAccount(mc);
}

/**
 * Recupera la sesión guardada sin molestar al jugador. Si el token caducó lo
 * refresca solo; si ya no sirve, borra la sesión y devuelve null.
 */
async function restore() {
  const token = loadSession();
  if (!token) return null;

  try {
    const auth = new Auth();
    let mc = mcTokenToolbox.validate(token) ? mcTokenToolbox.fromToken(auth, token) : null;
    if (!mc) {
      mc = await mcTokenToolbox.fromToken(auth, token, true);
      if (mc) saveSession(mc.getToken(true));
    }
    if (!mc) {
      clearSession();
      return null;
    }
    return await toAccount(mc);
  } catch {
    clearSession();
    return null;
  }
}

module.exports = { login, restore, clearSession };

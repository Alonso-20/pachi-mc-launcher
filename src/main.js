const { app, BrowserWindow, ipcMain, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const { Client, Authenticator } = require('minecraft-launcher-core');
const { Auth } = require('msmc');

const { MANIFEST_URL } = require('./config');
const { fetchManifest, checkAccess } = require('./launcher/manifest');
const { fetchFtbPack } = require('./launcher/ftb');
const { syncFiles, modsToFiles } = require('./launcher/sync');
const { ensureJava } = require('./launcher/java');
const { ensureServerEntry } = require('./launcher/servers');
const { setupLoader } = require('./launcher/loaderconfig');

let win = null;
let isPlaying = false;

// ------------------------------------------------------------
// Rutas locales
// ------------------------------------------------------------
const dataDir = () => path.join(app.getPath('userData'), 'minecraft'); // carpeta .minecraft propia
const javaDir = () => path.join(app.getPath('userData'), 'java');
const settingsFile = () => path.join(app.getPath('userData'), 'launcher-settings.json');

function loadSettings() {
  try {
    return JSON.parse(fs.readFileSync(settingsFile(), 'utf8'));
  } catch {
    return { username: '', ramGB: 6, mode: 'offline' };
  }
}

function saveSettings(s) {
  try {
    fs.writeFileSync(settingsFile(), JSON.stringify(s, null, 2));
  } catch {}
}

// ------------------------------------------------------------
// Ventana
// ------------------------------------------------------------
function createWindow() {
  win = new BrowserWindow({
    width: 900,
    height: 640,
    minWidth: 760,
    minHeight: 560,
    backgroundColor: '#0d1117',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
}

app.whenReady().then(createWindow);
app.on('window-all-closed', () => app.quit());

// ------------------------------------------------------------
// IPC
// ------------------------------------------------------------
function sendStatus(text, percent = null, state = 'working') {
  if (win && !win.isDestroyed()) {
    win.webContents.send('launcher:status', { text, percent, state });
  }
}

ipcMain.handle('launcher:init', async () => {
  const settings = loadSettings();
  try {
    const manifest = await fetchManifest(MANIFEST_URL);
    const access = checkAccess(manifest, app.getVersion(), settings.username || null);
    return { ok: true, manifest, access, settings, launcherVersion: app.getVersion() };
  } catch (err) {
    return {
      ok: false,
      error: `No se pudo obtener la configuración del servidor: ${err.message}`,
      settings,
      launcherVersion: app.getVersion(),
    };
  }
});

ipcMain.handle('launcher:openExternal', (_e, url) => {
  if (typeof url === 'string' && /^https?:\/\//.test(url)) shell.openExternal(url);
});

ipcMain.handle('launcher:play', async (_e, opts) => {
  if (isPlaying) return { ok: false, error: 'Ya hay un lanzamiento en curso.' };
  isPlaying = true;
  try {
    return await playFlow(opts);
  } catch (err) {
    console.error(err);
    sendStatus(err.message, null, 'error');
    return { ok: false, error: err.message };
  } finally {
    isPlaying = false;
  }
});

// ------------------------------------------------------------
// Flujo completo de lanzamiento
// ------------------------------------------------------------
async function playFlow({ mode, username, ramGB }) {
  const root = dataDir();
  fs.mkdirSync(root, { recursive: true });

  // 1. Manifest fresco (el admin puede haber cambiado algo hace un minuto)
  sendStatus('Obteniendo configuración del servidor...', 2);
  const manifest = await fetchManifest(MANIFEST_URL);

  let access = checkAccess(manifest, app.getVersion(), null);
  if (!access.ok) throw new Error(access.reason);

  // 2. Autenticación
  let auth;
  let playerName;
  if (mode === 'microsoft') {
    sendStatus('Iniciando sesión con Microsoft...', 4);
    const authManager = new Auth('select_account');
    const xbox = await authManager.launch('electron');
    const mc = await xbox.getMinecraft();
    auth = mc.mclc();
    playerName = (mc.profile && mc.profile.name) || auth.name;
  } else {
    if (manifest.launcher && manifest.launcher.allowOffline === false) {
      throw new Error('Este servidor solo acepta cuentas premium. Usa el botón de inicio de sesión con Microsoft.');
    }
    playerName = String(username || '').trim();
    if (!/^[A-Za-z0-9_]{3,16}$/.test(playerName)) {
      throw new Error('Nombre de usuario inválido (3-16 caracteres: letras, números y _).');
    }
    auth = Authenticator.getAuth(playerName);
  }

  access = checkAccess(manifest, app.getVersion(), playerName);
  if (!access.ok) throw new Error(access.reason);

  const settings = loadSettings();
  saveSettings({ ...settings, username: mode === 'offline' ? playerName : settings.username, ramGB, mode });

  // 3. Resolver el contenido: modpack de FTB y/o lista de mods del manifest
  const game = { ...(manifest.game || {}) };
  let files = [];

  if (manifest.ftbPack && manifest.ftbPack.id) {
    sendStatus('Consultando el modpack...', 6);
    const pack = await fetchFtbPack(manifest.ftbPack.id, manifest.ftbPack.version);
    files = pack.files;
    // La versión de MC y del loader las manda el modpack salvo que el manifest las fije
    if (!game.mcVersion) game.mcVersion = pack.targets.minecraft;
    if (!game.loader) {
      game.loader = ['neoforge', 'forge', 'fabric', 'quilt'].find((l) => pack.targets[l]) || 'vanilla';
    }
    if (!game.loaderVersion) game.loaderVersion = pack.targets[game.loader];
  }
  files = files.concat(modsToFiles(manifest.mods));

  if (!game.mcVersion) throw new Error('El manifest no indica la versión de Minecraft.');

  // 4. Java adecuado (también lo necesita el instalador del loader)
  sendStatus('Verificando Java...', 8);
  const javaPath = await ensureJava(javaDir(), game.mcVersion, (text, pct) =>
    sendStatus(text, pct != null ? 8 + Math.round(pct * 0.07) : null)
  );

  // 5. Mod loader, en la versión exacta que pide el modpack
  sendStatus(`Preparando ${game.loader || 'vanilla'} ${game.mcVersion}...`, 16);
  const loaderConfig = await setupLoader(game, root, javaPath, (text) => sendStatus(text, null));

  // 6. Sincronizar mods y configs (descarga lo nuevo, borra lo que quitaste)
  sendStatus('Sincronizando archivos del modpack...', 24);
  await syncFiles(files, root, {
    syncMode: manifest.syncMode || 'strict',
    onStatus: (text, pct) => sendStatus(text, pct != null ? 24 + Math.round(pct * 0.34) : null),
  });

  // 7. Registrar el servidor en la lista de multijugador
  await ensureServerEntry(root, manifest.server);

  // 8. Lanzar el juego
  sendStatus('Descargando archivos de Minecraft (la primera vez tarda)...', 60);

  const ram = Math.max(2, Math.min(32, Number(ramGB) || 6));
  const quickPlay = buildQuickPlay(manifest, game);

  const launcher = new Client();
  launcher.on('progress', (e) => {
    if (e && e.total) {
      const pct = 60 + Math.round((e.task / e.total) * 36);
      sendStatus(`Descargando ${e.type}... (${e.task}/${e.total})`, Math.min(96, pct));
    }
  });
  launcher.on('debug', (m) => console.log('[MCLC]', m));
  launcher.on('data', (m) => console.log('[MC]', String(m).trim()));

  const child = await launcher.launch({
    ...loaderConfig,
    authorization: auth,
    javaPath,
    memory: { max: `${ram}G`, min: '2G' },
    ...(quickPlay ? { quickPlay } : {}),
    overrides: { detached: false },
  });

  if (!child) throw new Error('No se pudo iniciar Minecraft. Revisa la consola del launcher.');

  sendStatus('¡Minecraft iniciado! Que disfrutes.', 100, 'playing');
  if (win && !win.isDestroyed()) win.minimize();

  child.on('close', (code) => {
    if (win && !win.isDestroyed()) {
      win.restore();
      sendStatus(code === 0 ? 'Juego cerrado.' : `El juego se cerró con código ${code}.`, null, code === 0 ? 'ready' : 'error');
    }
  });

  return { ok: true };
}

/**
 * Auto-conexión al server: MC 1.20+ soporta --quickPlayMultiplayer;
 * versiones anteriores usan los flags clásicos --server/--port (tipo "legacy").
 */
function buildQuickPlay(manifest, game) {
  const server = manifest.server;
  if (!server || !server.ip || server.autoJoin === false) return null;

  const identifier = `${server.ip}:${server.port || 25565}`;
  const m = String(game.mcVersion).match(/^1\.(\d+)/);
  const minor = m ? parseInt(m[1], 10) : 99;
  return { type: minor >= 20 ? 'multiplayer' : 'legacy', identifier };
}

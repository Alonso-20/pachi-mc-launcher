const { app, BrowserWindow, ipcMain, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const { Client, Authenticator } = require('minecraft-launcher-core');
const { Auth } = require('msmc');

const { MANIFEST_URL } = require('./config');
const { fetchManifest, checkAccess } = require('./launcher/manifest');
const { syncMods } = require('./launcher/mods');
const { ensureJava } = require('./launcher/java');
const { ensureServerEntry } = require('./launcher/servers');
const { getLoaderConfig } = require('./launcher/loaderconfig');

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
    return { username: '', ramGB: 4, mode: 'offline' };
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
    height: 620,
    minWidth: 760,
    minHeight: 540,
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

  // 1. Manifest fresco (el admin puede haber cambiado algo hace 1 minuto)
  sendStatus('Obteniendo configuración del servidor...', 2);
  const manifest = await fetchManifest(MANIFEST_URL);

  // Chequeo global (launcher deshabilitado / versión obsoleta)
  let access = checkAccess(manifest, app.getVersion(), null);
  if (!access.ok) throw new Error(access.reason);

  // 2. Autenticación
  let auth;
  let playerName;
  if (mode === 'microsoft') {
    sendStatus('Iniciando sesión con Microsoft...', 5);
    const authManager = new Auth('select_account');
    const xbox = await authManager.launch('electron');
    const mc = await xbox.getMinecraft();
    auth = mc.mclc();
    playerName = (mc.profile && mc.profile.name) || auth.name;
  } else {
    playerName = String(username || '').trim();
    if (!/^[A-Za-z0-9_]{3,16}$/.test(playerName)) {
      throw new Error('Nombre de usuario inválido (3-16 caracteres: letras, números y _).');
    }
    auth = Authenticator.getAuth(playerName);
  }

  // Chequeo por usuario (lista negra / lista blanca)
  access = checkAccess(manifest, app.getVersion(), playerName);
  if (!access.ok) throw new Error(access.reason);

  // Guardar preferencias
  const settings = loadSettings();
  saveSettings({ ...settings, username: mode === 'offline' ? playerName : settings.username, ramGB, mode });

  // 3. Java adecuado para la versión de MC
  sendStatus('Verificando Java...', 8);
  const javaPath = await ensureJava(javaDir(), manifest.game.mcVersion, (text, pct) =>
    sendStatus(text, pct != null ? 8 + Math.round(pct * 0.12) : null)
  );

  // 4. Mod loader (Forge / Fabric / NeoForge / Quilt)
  sendStatus(`Preparando ${manifest.game.loader || 'vanilla'} ${manifest.game.mcVersion}...`, 22);
  const loaderConfig = await getLoaderConfig(manifest.game, root);

  // 5. Sincronizar mods (instala nuevos, actualiza y borra los quitados)
  sendStatus('Sincronizando mods...', 30);
  let modIdx = 0;
  const totalMods = (manifest.mods || []).length || 1;
  await syncMods(manifest, root, (text, pct) => {
    const base = 30 + Math.round((modIdx / totalMods) * 25);
    sendStatus(text, pct != null ? Math.min(55, base + Math.round((pct / 100) * (25 / totalMods))) : base);
    if (pct === 100) modIdx++;
  });

  // 6. Registrar el servidor en la lista de multijugador
  await ensureServerEntry(root, manifest.server);

  // 7. Lanzar el juego
  sendStatus('Descargando archivos del juego (primera vez puede tardar)...', 58);

  const ram = Math.max(2, Math.min(32, Number(ramGB) || 4));
  const quickPlay = buildQuickPlay(manifest);

  const launcher = new Client();
  launcher.on('progress', (e) => {
    if (e && e.total) {
      const pct = 58 + Math.round((e.task / e.total) * 38);
      sendStatus(`Descargando ${e.type}... (${e.task}/${e.total})`, Math.min(96, pct));
    }
  });
  launcher.on('debug', (m) => console.log('[MCLC]', m));
  launcher.on('data', (m) => console.log('[MC]', String(m).trim()));

  const child = await launcher.launch({
    ...loaderConfig,
    authorization: auth,
    javaPath,
    memory: { max: `${ram}G`, min: '1G' },
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
function buildQuickPlay(manifest) {
  const server = manifest.server;
  if (!server || !server.ip || server.autoJoin === false) return null;

  const identifier = `${server.ip}:${server.port || 25565}`;
  const m = String(manifest.game.mcVersion).match(/^1\.(\d+)/);
  const minor = m ? parseInt(m[1], 10) : 99;
  return { type: minor >= 20 ? 'multiplayer' : 'legacy', identifier };
}

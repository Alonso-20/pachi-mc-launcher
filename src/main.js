const { app, BrowserWindow, ipcMain, Menu } = require('electron');
const path = require('path');
const fs = require('fs');
const { Client, Authenticator } = require('minecraft-launcher-core');

const { MANIFEST_URL } = require('./config');
const account = require('./launcher/account');
const { initUpdater, installNow } = require('./launcher/updater');
const { fetchManifest, checkAccess, getPacks } = require('./launcher/manifest');
const { fetchFtbPack } = require('./launcher/ftb');
const { syncFiles, modsToFiles, installPackZip } = require('./launcher/sync');
const { ensureJava } = require('./launcher/java');
const { ensureServerEntry } = require('./launcher/servers');
const { setupLoader } = require('./launcher/loaderconfig');

let win = null;
let isPlaying = false;

// ------------------------------------------------------------
// Rutas locales
// ------------------------------------------------------------
// Cada pack vive en su propia carpeta. "dir" permite fijarla (el pack original
// usa "." para no obligar a nadie a volver a descargar 1 GB).
const dataDir = (pack) => path.join(app.getPath('userData'), 'minecraft', pack.dir || pack.id);
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
  // Fuera el menú por defecto: al pulsar Alt aparecía con "Toggle Developer
  // Tools" a la vista.
  if (app.isPackaged) Menu.setApplicationMenu(null);

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
      // En la versión repartida no se pueden abrir las herramientas de
      // desarrollo, para que nadie curiosee la configuración desde la interfaz.
      devTools: !app.isPackaged,
    },
  });
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  // La búsqueda de actualizaciones empieza cuando la interfaz ya puede recibir
  // eventos, para que el jugador vea el progreso desde el primer momento.
  win.webContents.once('did-finish-load', () => {
    initUpdater((data) => {
      if (win && !win.isDestroyed()) win.webContents.send('launcher:update', data);
    });
  });
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

/**
 * Versión recortada del manifest para la interfaz.
 *
 * A la ventana solo se le manda lo que necesita pintar. Así no viajan al
 * proceso de render (ni quedan a la vista de nadie que abra las herramientas de
 * desarrollo) la URL del repositorio, el enlace de descarga ni las listas de
 * jugadores bloqueados o autorizados.
 */
function publicManifest(m) {
  const l = m.launcher || {};
  return {
    launcher: { message: l.message || '', allowOffline: l.allowOffline !== false },
    packs: getPacks(m).map((p) => ({
      id: p.id,
      name: p.name,
      mcVersion: (p.game && p.game.mcVersion) || '',
      loader: (p.game && p.game.loader) || (p.ftbPack ? 'FTB' : ''),
      serverName: (p.server && p.server.name) || '',
      serverIp: (p.server && p.server.ip) || '',
      mods: (p.mods || []).length,
      message: p.message || '',
    })),
  };
}

/** La sesión de Microsoft en curso (null si se juega en modo offline). */
let session = null;

function publicAccount() {
  return session ? { name: session.name, uuid: session.uuid, skin: session.skin } : null;
}

ipcMain.handle('launcher:init', async () => {
  const settings = loadSettings();

  // Se recupera la sesión guardada antes de pintar la interfaz, para que el
  // jugador vea que sigue conectado sin tener que volver a iniciar sesión.
  session = await account.restore();

  try {
    const manifest = await fetchManifest(MANIFEST_URL);
    const nameForCheck = session ? session.name : settings.username || null;
    const access = checkAccess(manifest, app.getVersion(), nameForCheck);
    return {
      ok: true,
      manifest: publicManifest(manifest),
      access: { ok: access.ok, reason: access.reason }, // sin updateUrl
      settings,
      account: publicAccount(),
      launcherVersion: app.getVersion(),
    };
  } catch (err) {
    return {
      ok: false,
      error: `No se pudo obtener la configuración del servidor: ${err.message}`,
      settings,
      account: publicAccount(),
      launcherVersion: app.getVersion(),
    };
  }
});

ipcMain.handle('launcher:login', async () => {
  try {
    session = await account.login();
    saveSettings({ ...loadSettings(), mode: 'microsoft' });
    return { ok: true, account: publicAccount() };
  } catch (err) {
    const msg = String((err && err.message) || err);
    return {
      ok: false,
      error: /cancel|closed|abort/i.test(msg)
        ? 'Cancelaste el inicio de sesión.'
        : `No se pudo iniciar sesión: ${msg}`,
    };
  }
});

ipcMain.handle('launcher:logout', async () => {
  account.clearSession();
  session = null;
  saveSettings({ ...loadSettings(), mode: 'offline' });
  return { ok: true };
});

ipcMain.handle('launcher:installUpdate', () => {
  installNow();
  return { ok: true };
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
async function playFlow({ mode, username, ramGB, packId }) {
  // 1. Manifest fresco (el admin puede haber cambiado algo hace un minuto)
  sendStatus('Obteniendo configuración del servidor...', 2);
  const manifest = await fetchManifest(MANIFEST_URL);

  const packs = getPacks(manifest);
  const pack = packs.find((p) => p.id === packId) || packs[0];
  const root = dataDir(pack);
  fs.mkdirSync(root, { recursive: true });

  let access = checkAccess(manifest, app.getVersion(), null);
  if (!access.ok) throw new Error(access.reason);

  // 2. Autenticación
  let auth;
  let playerName;
  if (mode === 'microsoft') {
    // La sesión ya se validó al abrir el launcher; aquí solo se refresca si el
    // token caducó mientras la ventana estaba abierta.
    if (!session) {
      sendStatus('Reanudando sesión de Microsoft...', 4);
      session = await account.restore();
    }
    if (!session) throw new Error('Tu sesión de Microsoft expiró. Vuelve a iniciar sesión.');
    auth = session.auth;
    playerName = session.name;
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
  saveSettings({ ...settings, username: mode === 'offline' ? playerName : settings.username, ramGB, mode, packId: pack.id });

  // 3. Resolver el contenido del pack elegido
  const game = { ...(pack.game || {}) };
  let files = [];

  if (pack.ftbPack && pack.ftbPack.id) {
    sendStatus('Consultando el modpack...', 6);
    const ftb = await fetchFtbPack(pack.ftbPack.id, pack.ftbPack.version);
    files = ftb.files;
    // La versión de MC y del loader las manda el modpack salvo que el manifest las fije
    if (!game.mcVersion) game.mcVersion = ftb.targets.minecraft;
    if (!game.loader) {
      game.loader = ['neoforge', 'forge', 'fabric', 'quilt'].find((l) => ftb.targets[l]) || 'vanilla';
    }
    if (!game.loaderVersion) game.loaderVersion = ftb.targets[game.loader];
  }
  files = files.concat(modsToFiles(pack.mods));

  if (!game.mcVersion) throw new Error('El manifest no indica la versión de Minecraft.');

  // 4. Java adecuado (también lo necesita el instalador del loader)
  sendStatus('Verificando Java...', 8);
  const javaPath = await ensureJava(javaDir(), game.mcVersion, (text, pct) =>
    sendStatus(text, pct != null ? 8 + Math.round(pct * 0.07) : null)
  );

  // 5. Mod loader, en la versión exacta que pide el modpack
  sendStatus(`Preparando ${game.loader || 'vanilla'} ${game.mcVersion}...`, 16);
  const loaderConfig = await setupLoader(game, root, javaPath, (text) => sendStatus(text, null));

  // 6. Zip oficial del pack (CurseForge): configs, kubejs y recursos propios
  await installPackZip(pack.packZip, root, (text, pct) =>
    sendStatus(text, pct != null ? 20 + Math.round(pct * 0.04) : null)
  );

  // 7. Sincronizar mods y configs (descarga lo nuevo, borra lo que quitaste)
  sendStatus('Sincronizando archivos del modpack...', 24);
  await syncFiles(files, root, {
    syncMode: pack.syncMode || 'strict',
    onStatus: (text, pct) => sendStatus(text, pct != null ? 24 + Math.round(pct * 0.34) : null),
  });

  // 8. Registrar el servidor en la lista de multijugador
  await ensureServerEntry(root, pack.server);

  // 9. Lanzar el juego
  sendStatus('Descargando archivos de Minecraft (la primera vez tarda)...', 60);

  const ram = Math.max(2, Math.min(32, Number(ramGB) || 6));
  const quickPlay = buildQuickPlay(pack, game);

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
    // detached: true es imprescindible. En Windows, un proceso hijo NO detached
    // muere junto a su padre: si el jugador cerraba el launcher con la partida
    // abierta, Minecraft se cerraba de golpe y parecía un crasheo.
    overrides: { detached: true },
  });

  if (!child) throw new Error('No se pudo iniciar Minecraft. Revisa la consola del launcher.');

  // El launcher deja de "sujetar" al juego: puede cerrarse sin arrastrarlo.
  child.unref();

  sendStatus('Minecraft está abierto. Ya puedes cerrar este launcher: el juego sigue funcionando.', 100, 'playing');
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
function buildQuickPlay(pack, game) {
  const server = pack.server;
  if (!server || !server.ip || server.autoJoin === false) return null;

  // Sin puerto explícito se pasa solo el host, para que Minecraft resuelva el
  // registro SRV del dominio (es como funcionan los túneles tipo playit.gg).
  // Si se fija el puerto a mano, el SRV se ignora y la conexión falla.
  const identifier = server.port ? `${server.ip}:${server.port}` : server.ip;
  const m = String(game.mcVersion).match(/^1\.(\d+)/);
  const minor = m ? parseInt(m[1], 10) : 99;
  return { type: minor >= 20 ? 'multiplayer' : 'legacy', identifier };
}

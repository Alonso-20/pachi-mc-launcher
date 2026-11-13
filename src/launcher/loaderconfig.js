const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const tomate = require('tomate-loaders');
const { downloadFile } = require('./util');

/**
 * Prepara el mod loader y devuelve la configuración de lanzamiento para MCLC.
 *
 * Si el manifest (o el modpack de FTB) fija una versión concreta del loader,
 * se instala EXACTAMENTE esa versión, que es lo que necesita un modpack:
 *  - forge / neoforge -> se ejecuta el instalador oficial en modo cliente.
 *  - fabric / quilt   -> se escribe el perfil que publica su API.
 * Si no hay versión fijada, se usa la última estable (vía tomate-loaders).
 */
async function setupLoader(game, rootPath, javaPath, onStatus) {
  const id = String(game.loader || 'vanilla').toLowerCase();
  const mc = game.mcVersion;

  if (id === 'vanilla' || id === 'none') {
    return { root: rootPath, version: { number: mc, type: 'release' } };
  }

  if (!game.loaderVersion) {
    const loaders = { fabric: tomate.fabric, forge: tomate.forge, neoforge: tomate.neoforge, quilt: tomate.quilt };
    if (!loaders[id]) throw new Error(`Loader desconocido en el manifest: "${game.loader}"`);
    onStatus(`Instalando ${id} (última versión) para ${mc}...`, null);
    return await loaders[id].getMCLCLaunchConfig({ gameVersion: mc, rootPath });
  }

  const custom =
    id === 'fabric' || id === 'quilt'
      ? await setupFabricLike(id, mc, game.loaderVersion, rootPath, onStatus)
      : await setupForgeLike(id, mc, game.loaderVersion, rootPath, javaPath, onStatus);

  const config = { root: rootPath, version: { number: mc, type: 'release', custom } };
  const jvmArgs = loaderJvmArgs(rootPath, custom);
  if (jvmArgs.length) config.customArgs = jvmArgs;
  return config;
}

/**
 * Los loaders modernos (NeoForge, Forge 1.17+) necesitan argumentos de JVM
 * propios: el module-path de BootstrapLauncher, --add-opens, etc. MCLC no lee
 * `arguments.jvm` del JSON del loader ni resuelve sus variables, así que los
 * extraemos aquí ya sustituidos y se los pasamos como customArgs.
 * Sin esto el juego arranca y se cierra al instante.
 */
function loaderJvmArgs(rootPath, versionId) {
  const jsonPath = path.join(rootPath, 'versions', versionId, `${versionId}.json`);
  if (!fs.existsSync(jsonPath)) return [];

  let json;
  try {
    json = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
  } catch {
    return [];
  }

  const raw = (json.arguments && json.arguments.jvm) || [];
  const libDir = path.resolve(path.join(rootPath, 'libraries'));
  const sep = process.platform === 'win32' ? ';' : ':';

  return raw
    .filter((a) => typeof a === 'string')
    .map((a) =>
      a
        .replace(/\$\{library_directory\}/g, libDir)
        .replace(/\$\{classpath_separator\}/g, sep)
        // MCLC guarda el jar del cliente como <versionId>.jar, no como <mc>.jar
        .replace(/\$\{version_name\}/g, versionId)
    );
}

/** Fabric y Quilt publican el JSON del perfil ya listo: basta con guardarlo. */
async function setupFabricLike(id, mc, loaderVersion, rootPath, onStatus) {
  const base = id === 'quilt' ? 'https://meta.quiltmc.org/v3/versions' : 'https://meta.fabricmc.net/v2/versions';
  const versionId = `${id}-loader-${loaderVersion}-${mc}`;
  const dir = path.join(rootPath, 'versions', versionId);
  const jsonPath = path.join(dir, `${versionId}.json`);

  if (!fs.existsSync(jsonPath)) {
    onStatus(`Instalando ${id} ${loaderVersion}...`, null);
    const res = await fetch(`${base}/loader/${mc}/${loaderVersion}/profile/json`);
    if (!res.ok) throw new Error(`No se pudo obtener el perfil de ${id} ${loaderVersion} (HTTP ${res.status})`);
    const profile = await res.json();
    profile.id = versionId;
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(jsonPath, JSON.stringify(profile, null, 2));
  }
  return versionId;
}

/**
 * Forge y NeoForge: se descarga el instalador oficial y se ejecuta con
 * su flag de instalacion de cliente, que genera la carpeta
 * versions/<loader>/ con su JSON y parchea el cliente.
 */
async function setupForgeLike(id, mc, loaderVersion, rootPath, javaPath, onStatus) {
  const existing = findLoaderVersionDir(rootPath, loaderVersion);
  if (existing) return existing;

  const isNeo = id === 'neoforge';
  const artifact = isNeo
    ? `${loaderVersion}/neoforge-${loaderVersion}`
    : `${loaderVersion.includes('-') ? loaderVersion : `${mc}-${loaderVersion}`}/forge-${loaderVersion.includes('-') ? loaderVersion : `${mc}-${loaderVersion}`}`;
  const url = isNeo
    ? `https://maven.neoforged.net/releases/net/neoforged/neoforge/${artifact}-installer.jar`
    : `https://maven.minecraftforge.net/net/minecraftforge/forge/${artifact}-installer.jar`;

  const installer = path.join(rootPath, 'installers', `${id}-${loaderVersion}-installer.jar`);
  if (!fs.existsSync(installer)) {
    onStatus(`Descargando instalador de ${id} ${loaderVersion}...`, null);
    await downloadFile(url, installer);
  }

  // El instalador oficial exige que exista launcher_profiles.json
  const profilesFile = path.join(rootPath, 'launcher_profiles.json');
  if (!fs.existsSync(profilesFile)) {
    fs.mkdirSync(rootPath, { recursive: true });
    fs.writeFileSync(profilesFile, JSON.stringify({ profiles: {}, selectedProfile: '', clientToken: '' }, null, 2));
  }

  onStatus(`Instalando ${id} ${loaderVersion} (esto tarda un poco la primera vez)...`, null);
  const javaExe = javaPath.replace(/javaw\.exe$/i, 'java.exe');
  // Ojo: NeoForge usa --install-client y Forge --installClient. No son
  // intercambiables: con el flag equivocado el instalador no instala nada.
  await runInstaller(javaExe, installer, rootPath, isNeo ? '--install-client' : '--installClient');

  const created = findLoaderVersionDir(rootPath, loaderVersion);
  if (!created) throw new Error(`El instalador de ${id} ${loaderVersion} terminó pero no generó la versión.`);
  return created;
}

function runInstaller(javaExe, installerJar, rootPath, flag) {
  return new Promise((resolve, reject) => {
    const child = spawn(javaExe, ['-jar', installerJar, flag, rootPath], {
      cwd: rootPath,
      windowsHide: true,
    });
    let out = '';
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { out += d; });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) return resolve();
      reject(new Error(`El instalador del loader falló (código ${code}).\n${out.slice(-600)}`));
    });
  });
}

/** Busca en versions/ la carpeta que generó el instalador para esa versión. */
function findLoaderVersionDir(rootPath, loaderVersion) {
  const versionsDir = path.join(rootPath, 'versions');
  if (!fs.existsSync(versionsDir)) return null;
  for (const name of fs.readdirSync(versionsDir)) {
    if (!name.includes(loaderVersion)) continue;
    if (fs.existsSync(path.join(versionsDir, name, `${name}.json`))) return name;
  }
  return null;
}

module.exports = { setupLoader };

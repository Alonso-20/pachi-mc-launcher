const fs = require('fs');
const path = require('path');
const os = require('os');
const extract = require('extract-zip');
const { downloadFile } = require('./util');

/**
 * Determina la versión mayor de Java que requiere una versión de Minecraft,
 * consultando el manifest oficial de Mojang. Si falla, usa una heurística.
 */
async function getRequiredJavaMajor(mcVersion) {
  try {
    const list = await (await fetch('https://launchermeta.mojang.com/mc/game/version_manifest_v2.json')).json();
    const entry = list.versions.find((v) => v.id === mcVersion);
    if (entry) {
      const vj = await (await fetch(entry.url)).json();
      if (vj.javaVersion && vj.javaVersion.majorVersion) return vj.javaVersion.majorVersion;
    }
  } catch {}

  // Heurística de respaldo
  const m = String(mcVersion).match(/^1\.(\d+)(?:\.(\d+))?/);
  if (!m) return 21;
  const minor = parseInt(m[1], 10);
  const patch = parseInt(m[2] || '0', 10);
  if (minor >= 21 || (minor === 20 && patch >= 5)) return 21;
  if (minor >= 17) return 17;
  return 8;
}

function findJavaw(dir) {
  if (!fs.existsSync(dir)) return null;
  const direct = path.join(dir, 'bin', 'javaw.exe');
  if (fs.existsSync(direct)) return direct;
  for (const sub of fs.readdirSync(dir)) {
    const candidate = path.join(dir, sub, 'bin', 'javaw.exe');
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

/**
 * Garantiza que exista un runtime de Java adecuado para la versión de MC.
 * Si no está instalado localmente, descarga un JRE de Adoptium (Temurin)
 * en <javaRoot>/<major>/ y devuelve la ruta a javaw.exe.
 */
async function ensureJava(javaRoot, mcVersion, onStatus) {
  const major = await getRequiredJavaMajor(mcVersion);
  const dir = path.join(javaRoot, String(major));

  let javaw = findJavaw(dir);
  if (javaw) return javaw;

  onStatus(`Buscando Java ${major}...`, null);
  const arch = os.arch() === 'arm64' ? 'aarch64' : 'x64';
  const apiUrl = `https://api.adoptium.net/v3/assets/latest/${major}/hotspot?os=windows&architecture=${arch}&image_type=jre&vendor=eclipse`;
  const assets = await (await fetch(apiUrl)).json();
  if (!Array.isArray(assets) || !assets.length || !assets[0].binary) {
    throw new Error(`No se encontró un JRE de Java ${major} para descargar.`);
  }
  const pkg = assets[0].binary.package;

  const zipPath = path.join(javaRoot, `temurin-${major}.zip`);
  const totalBytes = pkg.size || 0;
  let received = 0;
  await downloadFile(pkg.link, zipPath, (bytes) => {
    received += bytes;
    const pct = totalBytes ? Math.min(100, Math.round((received / totalBytes) * 100)) : null;
    onStatus(`Descargando Java ${major}${pct != null ? ` (${pct}%)` : ''}`, pct);
  });

  onStatus(`Instalando Java ${major}...`, null);
  fs.mkdirSync(dir, { recursive: true });
  await extract(zipPath, { dir });
  fs.rmSync(zipPath, { force: true });

  javaw = findJavaw(dir);
  if (!javaw) throw new Error(`Java ${major} se descargó pero no se encontró javaw.exe.`);
  return javaw;
}

module.exports = { ensureJava };

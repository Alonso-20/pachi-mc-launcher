const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { pipeline } = require('stream/promises');
const { Readable } = require('stream');

/**
 * Descarga un archivo por HTTP(S) siguiendo redirecciones.
 * onProgress recibe un número 0-100 (o null si no se conoce el tamaño).
 */
async function downloadFile(url, dest, onProgress) {
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) throw new Error(`Error HTTP ${res.status} al descargar ${url}`);

  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const tmp = dest + '.part';
  const total = Number(res.headers.get('content-length')) || 0;
  let received = 0;

  const counter = new (require('stream').Transform)({
    transform(chunk, _enc, cb) {
      received += chunk.length;
      if (onProgress) onProgress(total ? Math.round((received / total) * 100) : null);
      cb(null, chunk);
    },
  });

  try {
    await pipeline(Readable.fromWeb(res.body), counter, fs.createWriteStream(tmp));
    fs.renameSync(tmp, dest);
  } catch (err) {
    try { fs.rmSync(tmp, { force: true }); } catch {}
    throw err;
  }
}

/** SHA-1 de un archivo, en hex minúsculas. */
function sha1File(file) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha1');
    fs.createReadStream(file)
      .on('data', (d) => hash.update(d))
      .on('end', () => resolve(hash.digest('hex')))
      .on('error', reject);
  });
}

/** Compara versiones tipo "1.2.3". Devuelve -1, 0 o 1. */
function compareVersions(a, b) {
  const pa = String(a).split('.').map((n) => parseInt(n, 10) || 0);
  const pb = String(b).split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] || 0;
    const y = pb[i] || 0;
    if (x !== y) return x < y ? -1 : 1;
  }
  return 0;
}

module.exports = { downloadFile, sha1File, compareVersions };

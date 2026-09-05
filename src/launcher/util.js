const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { pipeline } = require('stream/promises');
const { Readable, Transform } = require('stream');

/**
 * Descarga un archivo por HTTP(S) siguiendo redirecciones.
 * Acepta URLs alternativas (mirrors) y reintentos.
 * onProgress recibe bytes descargados en este chunk.
 */
async function downloadFile(url, dest, onChunk, mirrors = [], retries = 3) {
  const urls = [url, ...(mirrors || [])].filter(Boolean);
  let lastErr;

  for (let attempt = 0; attempt < retries; attempt++) {
    const target = urls[Math.min(attempt, urls.length - 1)];
    try {
      const res = await fetch(target, { redirect: 'follow' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      fs.mkdirSync(path.dirname(dest), { recursive: true });
      const tmp = dest + '.part';
      const counter = new Transform({
        transform(chunk, _enc, cb) {
          if (onChunk) onChunk(chunk.length);
          cb(null, chunk);
        },
      });

      try {
        await pipeline(Readable.fromWeb(res.body), counter, fs.createWriteStream(tmp));
        fs.renameSync(tmp, dest);
        return;
      } catch (err) {
        try { fs.rmSync(tmp, { force: true }); } catch {}
        throw err;
      }
    } catch (err) {
      lastErr = err;
      if (attempt < retries - 1) await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
    }
  }
  throw new Error(`No se pudo descargar ${path.basename(dest)}: ${lastErr.message}`);
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

/** Ejecuta `worker` sobre `items` con como máximo `limit` tareas en paralelo. */
async function mapLimit(items, limit, worker) {
  const queue = [...items.entries()];
  const runners = Array.from({ length: Math.min(limit, queue.length) }, async () => {
    while (queue.length) {
      const [index, item] = queue.shift();
      await worker(item, index);
    }
  });
  await Promise.all(runners);
}

/**
 * Une root + una ruta relativa del manifest, garantizando que el resultado
 * quede DENTRO de root (evita rutas maliciosas tipo "../../Windows").
 */
function safeJoin(root, relative) {
  const clean = String(relative).replace(/^\.\/+/, '').replace(/\\/g, '/');
  const full = path.resolve(root, clean);
  const rootResolved = path.resolve(root);
  if (full !== rootResolved && !full.startsWith(rootResolved + path.sep)) {
    throw new Error(`Ruta no permitida en el manifest: ${relative}`);
  }
  return full;
}

module.exports = { downloadFile, sha1File, compareVersions, mapLimit, safeJoin };

#!/usr/bin/env node
/**
 * Genera la entrada de "packs" para un modpack de CurseForge, leyendo una
 * instancia ya instalada con la app de CurseForge.
 *
 *   node tools/cf-pack.js "E:\CurseForge\Instances\Mi Pack" [id-del-pack]
 *
 * Imprime el JSON listo para pegar en remote/manifest.json. Todo sale de URLs
 * publicas del CDN de CurseForge: no hace falta clave de API ni hospedar nada.
 */
const fs = require('fs');
const path = require('path');

const dir = process.argv[2];
if (!dir) {
  console.log('Uso: node tools/cf-pack.js "<carpeta de la instancia>" [id]');
  process.exit(1);
}

const inst = JSON.parse(fs.readFileSync(path.join(dir, 'minecraftinstance.json'), 'utf8'));
const id = process.argv[3] || String(inst.name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

// forge-43.5.0 -> { loader: 'forge', loaderVersion: '43.5.0' }
const ml = inst.baseModLoader || {};
const [loader, loaderVersion] = String(ml.name || '').split(/-(.+)/);

/** Carpeta real del archivo dentro de la instancia (mods/, resourcepacks/...). */
const carpetas = ['mods', 'resourcepacks', 'shaderpacks'];
function destino(nombre) {
  const encontrada = carpetas.find((c) => fs.existsSync(path.join(dir, c, nombre)));
  return `${encontrada || (nombre.endsWith('.jar') ? 'mods' : 'resourcepacks')}/${nombre}`;
}

const mods = (inst.installedAddons || [])
  .map((a) => a.installedFile)
  .filter((f) => f && f.downloadUrl)
  .map((f) => {
    const nombre = f.fileNameOnDisk || f.fileName;
    const sha1 = (f.hashes || []).find((h) => h.type === 1);
    const entrada = { filename: nombre, url: f.downloadUrl, sha1: sha1 ? sha1.value : null, size: f.fileLength || 0 };
    const ruta = destino(nombre);
    if (ruta !== `mods/${nombre}`) entrada.path = ruta;
    return entrada;
  })
  .sort((a, b) => a.filename.localeCompare(b.filename));

const zip = inst.installedModpack && inst.installedModpack.installedFile;

const pack = {
  id,
  name: `${inst.name}${inst.installedModpack ? ' ' + String(inst.installedModpack.installedFile.fileName).replace(/^.*-|\.zip$/g, '') : ''}`.trim(),
  game: { mcVersion: (ml.minecraftVersion || inst.gameVersion), loader, loaderVersion },
  ...(zip ? { packZip: { url: zip.downloadUrl, size: zip.fileLength || 0 } } : {}),
  server: { name: inst.name, ip: 'CAMBIA-ESTO', autoJoin: true },
  syncMode: 'strict',
  mods,
};

const salida = path.join(process.cwd(), `pack-${id}.json`);
fs.writeFileSync(salida, JSON.stringify(pack, null, 2));
console.log(`${pack.name}: ${mods.length} archivos, ${loader} ${loaderVersion}, MC ${pack.game.mcVersion}`);
console.log(`zip del pack: ${zip ? (zip.fileLength / 1024 / 1024).toFixed(0) + ' MB' : 'no tiene'}`);
console.log(`escrito en ${salida} -> pegalo dentro de "packs" en remote/manifest.json`);

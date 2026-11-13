#!/usr/bin/env node
/**
 * Genera la entrada de "packs" para un servidor Fabric, a partir de su carpeta.
 *
 *   node tools/server-pack.js "E:\Juegos\minecraft\mi-server" [id]
 *
 * Busca cada mod del servidor en Modrinth por su hash, descarta los que no
 * funcionan en el cliente y escribe pack-<id>.json con URLs publicas de
 * Modrinth: no hay que hospedar ningun archivo.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const dir = process.argv[2];
if (!dir) {
  console.log('Uso: node tools/server-pack.js "<carpeta del servidor>" [id]');
  process.exit(1);
}
const id = process.argv[3] || path.basename(dir).toLowerCase().replace(/[^a-z0-9]+/g, '-');

// Version de MC y de Fabric: las deja el propio servidor en disco
const mcVersion = fs.readdirSync(path.join(dir, 'versions'))[0];
const loaderDir = path.join(dir, 'libraries', 'net', 'fabricmc', 'fabric-loader');
if (!fs.existsSync(loaderDir)) {
  console.log('No es un servidor Fabric (no hay libraries/net/fabricmc/fabric-loader).');
  process.exit(1);
}
const loaderVersion = fs.readdirSync(loaderDir)[0];

const MODRINTH = 'https://api.modrinth.com/v2';

(async () => {
  const modsDir = path.join(dir, 'mods');
  const local = {};
  for (const f of fs.readdirSync(modsDir).filter((x) => x.endsWith('.jar'))) {
    const buf = fs.readFileSync(path.join(modsDir, f));
    local[crypto.createHash('sha1').update(buf).digest('hex')] = { f, size: buf.length };
  }

  const versions = await (await fetch(`${MODRINTH}/version_files`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ hashes: Object.keys(local), algorithm: 'sha1' }),
  })).json();

  const ids = [...new Set(Object.values(versions).map((v) => v.project_id))];
  const projects = await (await fetch(`${MODRINTH}/projects?ids=${encodeURIComponent(JSON.stringify(ids))}`)).json();
  const side = Object.fromEntries(projects.map((p) => [p.id, p.client_side]));

  const mods = [];
  const fuera = [];
  const sinModrinth = [];
  for (const [sha1, { f, size }] of Object.entries(local)) {
    const v = versions[sha1];
    if (!v) { sinModrinth.push(f); continue; }
    if (side[v.project_id] === 'unsupported') { fuera.push(f); continue; }
    const file = v.files.find((x) => x.hashes.sha1 === sha1);
    mods.push({ filename: f, url: file.url, sha1, size });
  }
  mods.sort((a, b) => a.filename.localeCompare(b.filename));

  const pack = {
    id,
    name: id,
    game: { mcVersion, loader: 'fabric', loaderVersion },
    server: { name: id, ip: 'CAMBIA-ESTO', autoJoin: true },
    syncMode: 'strict',
    mods,
  };
  const salida = path.join(process.cwd(), `pack-${id}.json`);
  fs.writeFileSync(salida, JSON.stringify(pack, null, 2));

  console.log(`MC ${mcVersion} + Fabric ${loaderVersion}: ${mods.length} mods para el cliente`);
  if (fuera.length) console.log(`solo servidor (no van al cliente): ${fuera.join(', ')}`);
  if (sinModrinth.length) console.log(`NO ESTAN EN MODRINTH, añadelos a mano: ${sinModrinth.join(', ')}`);
  console.log(`escrito en ${salida}`);
})().catch((e) => { console.error('Error:', e.message); process.exit(1); });

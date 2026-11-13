#!/usr/bin/env node
/**
 * Genera la entrada de "packs" para un modpack de Modrinth (.mrpack).
 *
 *   node tools/mr-pack.js <slug-o-id-del-proyecto> [id-de-version] [mods extra: ids de version de Modrinth...]
 *   node tools/mr-pack.js prominence-2-fabric rt1vDkAc 1K7XoPeL
 *
 * Sin id de version usa la ultima. Escribe pack-<slug>.json listo para pegar en
 * remote/manifest.json. El .mrpack va como packZip (su carpeta overrides/ es
 * igual que la de CurseForge) y sus mods como lista "mods".
 */
const fs = require('fs');
const path = require('path');
const extract = require('extract-zip');
const os = require('os');

const API = 'https://api.modrinth.com/v2';
const [slug, versionArg, ...extraIds] = process.argv.slice(2);
if (!slug) {
  console.log('Uso: node tools/mr-pack.js <slug> [versionId] [extraVersionId...]');
  process.exit(1);
}

const get = async (url) => {
  const r = await fetch(url, { headers: { 'User-Agent': 'pachi-mc-launcher-tools' } });
  if (!r.ok) throw new Error(`HTTP ${r.status} ${url}`);
  return r;
};

(async () => {
  const project = await (await get(`${API}/project/${slug}`)).json();
  const version = await (await get(`${API}/version/${versionArg || project.versions[project.versions.length - 1]}`)).json();
  const file = version.files.find((f) => f.primary) || version.files[0];

  // Solo se necesita modrinth.index.json, pero viene dentro del .mrpack
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mrpack-'));
  const zip = path.join(tmp, 'pack.mrpack');
  fs.writeFileSync(zip, Buffer.from(await (await get(file.url)).arrayBuffer()));
  await extract(zip, { dir: tmp });
  const index = JSON.parse(fs.readFileSync(path.join(tmp, 'modrinth.index.json'), 'utf8'));
  const hasOverrideMods = fs.existsSync(path.join(tmp, 'overrides', 'mods'));
  fs.rmSync(tmp, { recursive: true, force: true });

  const mods = index.files
    .filter((f) => !f.env || f.env.client !== 'unsupported')
    .map((f) => {
      const filename = path.posix.basename(f.path);
      const e = { filename, url: f.downloads[0], sha1: f.hashes.sha1, size: f.fileSize || 0 };
      if (f.path !== `mods/${filename}`) e.path = f.path;
      return e;
    });

  for (const id of extraIds) {
    const v = await (await get(`${API}/version/${id}`)).json();
    const f = v.files.find((x) => x.primary) || v.files[0];
    mods.push({ filename: f.filename, url: f.url, sha1: f.hashes.sha1, size: f.size });
  }
  mods.sort((a, b) => a.filename.localeCompare(b.filename));

  const deps = index.dependencies;
  const loader = ['fabric-loader', 'quilt-loader', 'neoforge', 'forge'].find((l) => deps[l]);
  const pack = {
    id: project.slug,
    name: `${project.title} ${version.version_number}`,
    game: { mcVersion: deps.minecraft, loader: loader.replace('-loader', ''), loaderVersion: deps[loader] },
    packZip: { url: file.url, sha1: file.hashes.sha1, size: file.size },
    server: { name: project.title, ip: 'CAMBIA-ESTO', autoJoin: true },
    // overrides/mods trae jars sin URL: en "strict" el sincronizador los borraria
    syncMode: hasOverrideMods ? 'additive' : 'strict',
    mods,
  };

  const out = path.join(process.cwd(), `pack-${project.slug}.json`);
  fs.writeFileSync(out, JSON.stringify(pack, null, 2));
  console.log(`${pack.name}: ${mods.length} archivos, ${pack.game.loader} ${pack.game.loaderVersion}, MC ${pack.game.mcVersion}, syncMode ${pack.syncMode}`);
  console.log(`escrito en ${out} -> pegalo dentro de "packs" en remote/manifest.json`);
})().catch((e) => {
  console.error(e.message);
  process.exit(1);
});

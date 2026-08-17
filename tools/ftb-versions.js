#!/usr/bin/env node
/**
 * Ayuda para el administrador: lista las versiones de un modpack de FTB y te da
 * el número que hay que poner en "ftbPack.version" del manifest.
 *
 *   node tools/ftb-versions.js            -> versiones de FTB Skies 2: Aero (134)
 *   node tools/ftb-versions.js 91         -> versiones del pack con id 91
 *   node tools/ftb-versions.js buscar oceanblock  -> busca packs por nombre
 */
const API = 'https://api.feed-the-beast.com/v1/modpacks/public/modpack';

async function main() {
  const [arg1, ...rest] = process.argv.slice(2);

  if (arg1 === 'buscar' || arg1 === 'search') {
    const term = rest.join(' ');
    if (!term) return console.log('Uso: node tools/ftb-versions.js buscar <nombre>');
    const res = await (await fetch(`${API}/search/12?term=${encodeURIComponent(term)}`)).json();
    if (!res.packs || !res.packs.length) return console.log('Sin resultados.');
    for (const id of res.packs) {
      const pack = await (await fetch(`${API}/${id}`)).json();
      console.log(`  id ${String(pack.id).padEnd(6)} ${pack.name}`);
    }
    return;
  }

  const packId = Number(arg1) || 134;
  const pack = await (await fetch(`${API}/${packId}`)).json();
  if (pack.status && pack.status !== 'success') {
    return console.log(`No se encontró el pack ${packId}: ${pack.message || ''}`);
  }

  console.log(`\n${pack.name}  (id ${pack.id})\n`);
  const versions = (pack.versions || []).slice().sort((a, b) => b.updated - a.updated).slice(0, 15);
  console.log('  versionId   nombre           tipo      actualizado');
  console.log('  ' + '-'.repeat(58));
  for (const v of versions) {
    const fecha = new Date((v.updated || 0) * 1000).toISOString().slice(0, 10);
    console.log(`  ${String(v.id).padEnd(11)} ${String(v.name).padEnd(16)} ${String(v.type).padEnd(9)} ${fecha}`);
  }
  console.log(`
  Para actualizar el modpack de todos tus jugadores, pon el versionId que
  quieras en remote/manifest.json:

    "ftbPack": { "id": ${pack.id}, "version": <versionId> }

  Súbelo a GitHub y listo. Recuerda actualizar también el servidor a esa
  misma versión, o los jugadores no podrán entrar.
`);
}

main().catch((e) => console.error('Error:', e.message));

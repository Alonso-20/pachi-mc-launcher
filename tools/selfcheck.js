#!/usr/bin/env node
/** Chequeo de la logica multi-pack. `node tools/selfcheck.js` */
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { execFileSync } = require('child_process');
const { getPacks } = require('../src/launcher/manifest');
const { modsToFiles, installPackZip } = require('../src/launcher/sync');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'selfcheck-'));

// 1. getPacks: varios packs, ids y nombres por defecto, descarta los invalidos
const packs = getPacks({
  packs: [
    { id: 'a', name: 'Pack A', ftbPack: { id: 1, version: 2 } },
    { game: { mcVersion: '1.19.2' }, server: { name: 'Choco' } },
    { game: {} }, // sin version -> fuera
  ],
});
assert.deepStrictEqual(packs.map((p) => p.id), ['a', 'pack1']);
assert.strictEqual(packs[1].name, 'Choco');

// 2. Formato antiguo (sin "packs"): la raiz es el pack unico
assert.strictEqual(getPacks({ ftbPack: { id: 134, version: 100466 } }).length, 1);
assert.strictEqual(getPacks({ launcher: {} }).length, 0);

// 3. Carpeta por pack; "dir" fija la ruta y "." conserva la antigua
const dataDir = (p) => path.join('C:/u', 'minecraft', p.dir || p.id);
assert.strictEqual(dataDir({ id: 'aero', dir: '.' }), path.join('C:/u', 'minecraft'));
assert.strictEqual(dataDir({ id: 'chocolate' }), path.join('C:/u', 'minecraft', 'chocolate'));

// 4. modsToFiles: destino por defecto y destino propio
const files = modsToFiles([
  { filename: 'a.jar', url: 'http://x/a.jar' },
  { filename: 'b.zip', url: 'http://x/b.zip', path: 'resourcepacks/b.zip' },
]);
assert.deepStrictEqual(files.map((f) => f.path), ['mods/a.jar', 'resourcepacks/b.zip']);

// 5. installPackZip: extrae overrides/ y no repite la segunda vez
(async () => {
  const zipDir = path.join(tmp, 'zipsrc', 'overrides', 'config');
  fs.mkdirSync(zipDir, { recursive: true });
  fs.writeFileSync(path.join(zipDir, 'pack.toml'), 'ajuste=1');
  const zip = path.join(tmp, 'pack.zip');
  execFileSync('powershell', ['-NoProfile', '-Command',
    `Compress-Archive -Path '${path.join(tmp, 'zipsrc', 'overrides')}' -DestinationPath '${zip}' -Force`]);

  const srv = http.createServer((_q, res) => fs.createReadStream(zip).pipe(res)).listen(0);
  const url = `http://localhost:${srv.address().port}/pack.zip`;
  const root = path.join(tmp, 'game');

  const primera = await installPackZip({ url }, root, () => {});
  assert.strictEqual(primera, true, 'deberia instalar la primera vez');
  assert.ok(fs.existsSync(path.join(root, 'config', 'pack.toml')), 'overrides no llego a la raiz');
  assert.ok(!fs.existsSync(path.join(root, '.packzip-tmp')), 'temporal sin limpiar');

  const segunda = await installPackZip({ url }, root, () => {});
  assert.strictEqual(segunda, false, 'no deberia reinstalar');

  srv.close();
  fs.rmSync(tmp, { recursive: true, force: true });
  console.log('selfcheck OK');
})().catch((e) => { console.error('FALLO:', e.message); process.exit(1); });

const tomate = require('tomate-loaders');

/**
 * Devuelve la configuración de lanzamiento para MCLC según el loader
 * definido en el manifest (vanilla, fabric, forge, neoforge o quilt).
 * tomate-loaders se encarga de descargar e instalar el loader si falta.
 */
async function getLoaderConfig(game, rootPath) {
  const id = String(game.loader || 'vanilla').toLowerCase();

  if (id === 'vanilla' || id === 'none') {
    return { root: rootPath, version: { number: game.mcVersion, type: 'release' } };
  }

  const loaders = {
    fabric: tomate.fabric,
    forge: tomate.forge,
    neoforge: tomate.neoforge,
    quilt: tomate.quilt,
  };
  const loader = loaders[id];
  if (!loader) throw new Error(`Loader desconocido en el manifest: "${game.loader}"`);

  return await loader.getMCLCLaunchConfig({ gameVersion: game.mcVersion, rootPath });
}

module.exports = { getLoaderConfig };

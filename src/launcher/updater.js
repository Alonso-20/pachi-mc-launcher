const { app } = require('electron');
const { autoUpdater } = require('electron-updater');

/**
 * Actualización automática del propio launcher.
 *
 * Busca releases nuevos en GitHub (el repo es público, no hace falta token),
 * descarga el instalador en segundo plano y lo aplica al cerrar, o cuando el
 * jugador pulsa "Reiniciar e instalar".
 *
 * `send` recibe eventos {state, ...} para pintarlos en la interfaz:
 *   checking | available | progress | downloaded | none | error
 */
function initUpdater(send) {
  // En desarrollo (npm start) no hay nada que actualizar: electron-updater
  // fallaría porque la app no está empaquetada.
  if (!app.isPackaged) {
    send({ state: 'none', reason: 'desarrollo' });
    return;
  }

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  // Sin logger en la versión repartida: electron-updater escribe la URL del
  // repositorio en cada comprobación.
  autoUpdater.logger = null;

  autoUpdater.on('checking-for-update', () => send({ state: 'checking' }));
  autoUpdater.on('update-available', (info) => send({ state: 'available', version: info.version }));
  autoUpdater.on('update-not-available', () => send({ state: 'none' }));
  autoUpdater.on('download-progress', (p) =>
    send({ state: 'progress', percent: Math.round(p.percent || 0) })
  );
  autoUpdater.on('update-downloaded', (info) => send({ state: 'downloaded', version: info.version }));
  // Los mensajes de error de electron-updater incluyen la URL del release, así
  // que nunca se propagan tal cual: el jugador solo ve que no hubo cambios.
  autoUpdater.on('error', () => send({ state: 'error' }));
  autoUpdater.checkForUpdates().catch(() => send({ state: 'error' }));
}

/** Cierra el launcher, instala en silencio y lo vuelve a abrir. */
function installNow() {
  setImmediate(() => autoUpdater.quitAndInstall(true, true));
}

module.exports = { initUpdater, installNow };

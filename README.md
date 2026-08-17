# Pachi MC Launcher

Launcher de Minecraft para Windows que instala el modpack completo del servidor
automáticamente y se controla en remoto desde GitHub.

Configurado para **FTB Skies 2: Aero 1.6.1** (Minecraft 1.21.1 · NeoForge 21.1.248).

## Qué hace

- **Instala el modpack entero solo**: el jugador escribe su nombre y pulsa Jugar.
  El launcher descarga Java, NeoForge en la versión exacta del pack, los 473 mods,
  las configs, KubeJS y los datapacks (11.288 archivos, ~1 GB) desde los servidores
  de FTB.
- **Actualización remota**: cambias un número en `remote/manifest.json` y todos
  los jugadores pasan a la versión nueva del modpack en su siguiente arranque.
  Los mods eliminados se les borran; los nuevos se descargan.
- **Control de acceso**: bloquear jugadores concretos, lista blanca, apagar el
  launcher por mantenimiento, o dejar obsoletas las versiones viejas del launcher.
- **Conexión automática** al servidor al abrir el juego.
- **Login premium (Microsoft) o no premium (offline)**, configurable.
- **No toca el `.minecraft` del jugador**: todo vive en `%APPDATA%\Pachi MC Launcher\minecraft`.

## Estructura

```
src/config.js           URL del manifest en GitHub (ya configurada)
src/main.js             flujo de lanzamiento
src/launcher/ftb.js     lista de archivos del modpack (API de FTB)
src/launcher/sync.js    descarga/actualiza/borra archivos con verificación SHA-1
src/launcher/java.js    descarga el Java correcto (Adoptium)
src/launcher/loaderconfig.js  instala NeoForge/Forge/Fabric en la versión exacta
src/launcher/manifest.js      manifest remoto y reglas de acceso
src/launcher/servers.js       añade el server a la lista de multijugador
src/renderer/           interfaz
remote/manifest.json    ← el panel de control que editas en GitHub
remote/README-ADMIN.md  ← guía del administrador (léela)
tools/ftb-versions.js   lista las versiones del modpack
```

## Uso

```bash
npm install
npm start          # desarrollo
npm run dist       # genera dist/Pachi MC Launcher Setup 1.0.0.exe
```

Reparte el `.exe` de `dist/` a tus jugadores. A partir de ahí, todo lo demás se
controla desde [remote/manifest.json](remote/manifest.json) — ver
[guía del administrador](remote/README-ADMIN.md).

## Cómo funciona cada arranque

1. Descarga `manifest.json` desde GitHub (sin caché).
2. Comprueba que el launcher no esté deshabilitado ni obsoleto y que el jugador
   no esté bloqueado.
3. Autentica (Microsoft u offline).
4. Pide a la API de FTB la lista de archivos del pack `id`/`version`.
5. Instala el Java que pide esa versión de Minecraft.
6. Instala NeoForge en la versión exacta del pack (instalador oficial).
7. Sincroniza los archivos: descarga lo que falta, revalida por SHA-1 y borra lo
   que el pack ya no incluye. Solo borra lo que él mismo instaló.
8. Añade el server a la lista de multijugador y lanza el juego conectándose directo.

La segunda vez que un jugador abre el launcher, los pasos 4-7 tardan ~3 segundos
si no hubo cambios.

# Mi Launcher — Launcher de Minecraft con mods automáticos

Launcher de escritorio (Windows) para tu servidor de Minecraft:

- **Instala los mods automáticamente**: los jugadores solo pulsan "Jugar". El launcher descarga Minecraft, Java, el mod loader (Forge/Fabric/NeoForge/Quilt) y todos los mods.
- **Actualización remota**: tú editas un `manifest.json` en GitHub y todos los jugadores reciben los cambios (mods nuevos, mods eliminados, cambio de versión, IP del server) sin reinstalar nada.
- **Control de acceso**: puedes bloquear usuarios concretos, usar lista blanca, apagar el launcher para mantenimiento o dejar obsoletas las versiones viejas del launcher forzando actualización.
- **Conexión automática** al server al iniciar el juego.
- **Login con Microsoft (premium) o modo offline (no premium)**.

## Estructura

```
src/config.js        ← ÚNICO archivo que debes editar: URL de tu manifest en GitHub
src/main.js          ← proceso principal (flujo de lanzamiento)
src/launcher/        ← módulos: manifest, mods, java, loader, servers.dat
src/renderer/        ← interfaz
remote/manifest.json ← EJEMPLO del manifest que subes a GitHub
remote/README-ADMIN.md ← guía completa del administrador
```

## Puesta en marcha

1. **Configura el manifest remoto** — sigue [remote/README-ADMIN.md](remote/README-ADMIN.md):
   crea un repo público en GitHub, sube `remote/manifest.json` ajustado a tu server
   y copia su URL raw en [src/config.js](src/config.js).

2. **Prueba en desarrollo:**
   ```bash
   npm install
   npm start
   ```

3. **Genera el instalador para repartir:**
   ```bash
   npm run dist
   ```
   El instalador queda en `dist/Mi Launcher Setup 1.0.0.exe`. Repártelo a tus
   jugadores (Discord, Drive, o como *release* en GitHub).

## Cómo funciona la actualización remota

Cada vez que un jugador pulsa "Jugar", el launcher:

1. Descarga tu `manifest.json` fresco desde GitHub.
2. Verifica que el launcher no esté deshabilitado ni obsoleto (`minVersion`) y que el usuario no esté bloqueado.
3. Instala el Java correcto para la versión de MC (lo descarga de Adoptium si falta).
4. Instala/actualiza el mod loader indicado.
5. Sincroniza la carpeta `mods/`: descarga los nuevos, verifica SHA-1 y borra los que quitaste del manifest.
6. Añade tu server a la lista de multijugador y lanza el juego conectándose directo.

Los archivos del juego viven en `%APPDATA%/Mi Launcher/minecraft`, separados del
`.minecraft` normal del jugador.

## Publicar una nueva versión del launcher

1. Sube `version` en `package.json` (ej. `1.1.0`) y ejecuta `npm run dist`.
2. Publica el nuevo instalador (ej. release de GitHub) y pon ese link en `updateUrl` del manifest.
3. Sube `minVersion` a `1.1.0` en el manifest → todas las copias viejas quedan bloqueadas y muestran el botón de descarga.

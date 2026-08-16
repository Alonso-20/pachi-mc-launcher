# Guía del administrador

Este `manifest.json` es el **panel de control remoto** de tu launcher. Lo subes a un
repositorio público de GitHub y cada vez que un jugador abre el launcher o pulsa
"Jugar", el launcher lo descarga fresco. Editas el JSON → todos los jugadores
reciben el cambio al instante. **No hace falta recompilar ni redistribuir nada.**

## Configuración inicial (una sola vez)

1. Crea un repositorio público en GitHub (ej. `mi-server-config`).
2. Sube este `manifest.json` a la raíz del repo.
3. Copia la URL **raw** del archivo:
   `https://raw.githubusercontent.com/TU_USUARIO/mi-server-config/main/manifest.json`
4. Pégala en `src/config.js` del launcher (campo `MANIFEST_URL`).
5. Compila el launcher (`npm run dist`) y reparte el instalador `dist/Mi Launcher Setup X.X.X.exe`.

Para editar el manifest después: entra al archivo en GitHub → botón del lápiz →
edita → "Commit changes". Listo, ya está actualizado para todos.

## Qué controla cada campo

### `launcher` — control de acceso

| Campo | Efecto |
|---|---|
| `enabled: false` | Apaga el launcher para **todos** (mantenimiento). |
| `minVersion` | Cualquier launcher con versión menor queda **obsoleto**: no puede jugar y ve un botón para descargar la nueva versión (`updateUrl`). |
| `updateUrl` | Link de descarga que se muestra a quien tiene el launcher obsoleto. |
| `blockedUsers` | Lista negra: `["nombre1", "nombre2"]`. Esos usuarios no pueden jugar (no distingue mayúsculas). |
| `allowedUsers` | Lista blanca. Si es `null`, juega cualquiera. Si es una lista `["amigo1", "amigo2"]`, **solo** ellos pueden jugar. |
| `message` | Mensaje/noticias que se muestra en la pantalla principal del launcher. |

**Dejar obsoleto el instalador para ciertas personas:** ponlas en `blockedUsers`.
**Dejar obsoletas TODAS las copias viejas del launcher:** sube `minVersion` (y sube
el nuevo instalador a `updateUrl`, por ejemplo un release de GitHub).

### `game` — versión y loader

```json
"game": { "mcVersion": "1.20.1", "loader": "fabric" }
```

`loader` puede ser: `vanilla`, `fabric`, `forge`, `neoforge` o `quilt`.
El launcher descarga e instala el loader automáticamente. Puedes cambiar de
versión o de loader cuando quieras; los jugadores lo reciben en el siguiente lanzamiento.

### `server` — conexión automática

```json
"server": { "name": "Mi Server", "ip": "play.miserver.com", "port": 25565, "autoJoin": true }
```

Con `autoJoin: true` el juego se conecta solo al server al abrirse. El server
también se añade a la lista de multijugador del jugador.

### `mods` — la lista de mods

```json
{ "filename": "sodium.jar", "url": "https://...", "sha1": "abc123..." }
```

- **Añadir un mod**: agrega una entrada. Se descargará a todos.
- **Quitar un mod**: borra la entrada. Con `syncMode: "strict"` (por defecto) el
  launcher también lo **borra** de las PCs de los jugadores.
- **Actualizar un mod**: cambia `filename` y `url` por los de la versión nueva.
- `sha1` es opcional pero recomendado: verifica que la descarga no esté corrupta y
  detecta mods modificados. Para calcularlo en PowerShell:
  `Get-FileHash mod.jar -Algorithm SHA1`
- `syncMode: "additive"` permite que los jugadores añadan sus propios mods
  (el launcher no borra jars desconocidos).

### ¿De dónde saco las URLs de los mods?

- **Modrinth** (recomendado): en la página del mod → Versions → botón derecho en
  "Download" → copiar enlace. Son enlaces directos del CDN, estables y rápidos.
- **CurseForge**: usa el enlace directo del archivo (termina en `.jar`).
- **Mods propios / configs**: súbelos como *release* en tu mismo repo de GitHub y
  usa la URL del asset.

## Recetas rápidas

**Banear a un jugador:**
```json
"blockedUsers": ["jugadorMalo"]
```

**Solo mis 5 amigos pueden entrar:**
```json
"allowedUsers": ["amigo1", "amigo2", "amigo3", "amigo4", "amigo5"]
```

**Forzar a todos a actualizar el launcher:**
```json
"minVersion": "1.1.0",
"updateUrl": "https://github.com/TU_USUARIO/TU_REPO/releases/latest"
```
(y en el launcher nuevo, sube `version` en `package.json` a `1.1.0` antes de compilar)

**Mantenimiento del server:**
```json
"enabled": false,
"disabledMessage": "Mantenimiento hasta las 6pm. ¡Volvemos pronto!"
```

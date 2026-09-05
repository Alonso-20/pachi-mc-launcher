# Guía del administrador

`manifest.json` es el **panel de control remoto** del launcher. Vive en este repo
de GitHub y el launcher lo descarga fresco cada vez que un jugador pulsa "Jugar".
Editas el JSON → todos reciben el cambio al instante. **Nunca hay que recompilar
ni volver a repartir el instalador.**

URL que usa el launcher (ya configurada en `src/config.js`):

```
https://raw.githubusercontent.com/Alonso-20/pachi-mc-launcher/main/remote/manifest.json
```

Para editarlo: abre el archivo en GitHub → icono del lápiz → edita → "Commit changes".

---

## El modpack (FTB Skies 2: Aero)

```json
"ftbPack": { "id": 134, "version": 100466, "name": "FTB Skies 2: Aero 1.6.1" }
```

Con esas dos cifras el launcher descarga de FTB la lista completa del pack
(11.288 archivos: los 473 mods, configs, KubeJS, datapacks y shaderpacks) y la
instala en la PC del jugador, exactamente igual que hace la app oficial de FTB.
También toma de ahí la versión de Minecraft (1.21.1) y la de NeoForge (21.1.248),
así que no tienes que escribirlas a mano.

`name` es solo el texto que se muestra en el launcher.

### Actualizar el modpack

1. Actualiza **primero el servidor** a la versión nueva (con el instalador de FTB).
2. Averigua el `versionId` nuevo:
   ```bash
   node tools/ftb-versions.js
   ```
   Te lista las últimas versiones con su número (ej. `100466 = 1.6.1`).
3. Cambia `version` en el manifest y súbelo a GitHub.

En el siguiente arranque, cada jugador recibe los mods nuevos, se le actualizan
los cambiados y **se le borran los que el pack quitó**. No tienen que hacer nada.

> Importante: el servidor y el manifest deben apuntar a la **misma versión**. Si
> el server va en 1.6.1 y el manifest en 1.6.0, los jugadores serán rechazados
> por diferencia de mods.

### Añadir mods extra al pack

Cualquier mod que no venga en el pack de FTB (por ejemplo Simple Voice Chat) se
agrega en `mods`, y se instala **encima** del modpack:

```json
"mods": [
  {
    "filename": "voicechat-neoforge-1.21.1-2.5.26.jar",
    "url": "https://cdn.modrinth.com/data/9eGKb6K1/versions/xxxx/voicechat-neoforge-1.21.1-2.5.26.jar",
    "sha1": "opcional pero recomendado"
  }
]
```

Las URLs se sacan de Modrinth (página del mod → Versions → clic derecho en
Download → copiar enlace). Acuérdate de instalar también ese mod en el servidor
si es de los que lo requieren.

---

## Control de acceso (`launcher`)

| Campo | Efecto |
|---|---|
| `enabled: false` | Apaga el launcher para **todos** (mantenimiento). |
| `minVersion` | Los launchers con versión menor quedan **obsoletos**: no pueden jugar y ven un botón de descarga (`updateUrl`). |
| `updateUrl` | Link al instalador nuevo. |
| `blockedUsers` | Lista negra: `["fulano"]`. No distingue mayúsculas. |
| `allowedUsers` | Lista blanca. `null` = juega cualquiera; una lista = **solo** esos. |
| `allowOffline` | `false` oculta el modo no premium (útil si el server tiene `online-mode=true`). |
| `message` | Aviso que se muestra en la pantalla principal. |

**Dejar obsoleto el instalador para ciertas personas** → `blockedUsers`.
**Dejar obsoletas todas las copias viejas** → sube `minVersion`.

> Ojo: esto es control del *launcher*, no del servidor. A alguien decidido no le
> impide conectarse con otro cliente. La barrera de verdad es la whitelist del
> servidor (`whitelist.json` / `/whitelist add <jugador>`), sobre todo si usas
> `online-mode=false`. Usa las dos cosas juntas.

---

## Servidor (`server`)

```json
"server": { "name": "Aero", "ip": "xxxxx.gl.at.ply.gg", "port": 25565, "autoJoin": true }
```

Con `autoJoin: true` el juego se conecta solo al entrar. El server además se
añade a la lista de multijugador del jugador.

Como usas **playit.gg**, pon aquí la dirección que te da tu panel de playit
(algo como `xxxxx.gl.at.ply.gg`, y el puerto que te asigne). Si el túnel cambia
de dirección, actualiza este campo en GitHub y todos se reconectan al nuevo sin
tocar nada.

---

## Sincronización (`syncMode`)

- `"strict"` (actual): todos juegan con exactamente los mismos mods. Si alguien
  mete un `.jar` a mano en la carpeta del launcher, se le borra en el siguiente
  arranque.
- `"additive"`: permite mods personales (minimapa, shaders...). Sigue instalando
  y actualizando el pack, pero no borra jars desconocidos.

En ambos casos el launcher **solo** toca lo que él mismo instaló: los mundos,
capturas y opciones del jugador nunca se borran, y su `.minecraft` normal ni se
abre.

---

## Recetas rápidas

**Banear a alguien:**
```json
"blockedUsers": ["jugadorMalo"]
```

**Solo mis amigos:**
```json
"allowedUsers": ["amigo1", "amigo2", "amigo3"]
```

**Mantenimiento:**
```json
"enabled": false,
"disabledMessage": "Actualizando el modpack. Volvemos en 1 hora."
```

**Forzar actualización del launcher:**
```json
"minVersion": "1.1.0",
"updateUrl": "https://github.com/Alonso-20/pachi-mc-launcher/releases/latest"
```
(sube antes `version` en `package.json` a 1.1.0, compila con `npm run dist` y
publica el .exe en Releases)

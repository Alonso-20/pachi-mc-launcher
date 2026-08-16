const $ = (id) => document.getElementById(id);

const usernameInput = $('username');
const ramSelect = $('ram');
const btnOffline = $('play-offline');
const btnMs = $('play-ms');
const progressArea = $('progress-area');
const progressBar = $('progress-bar');
const statusText = $('status-text');

let blocked = false;

function setButtons(enabled) {
  btnOffline.disabled = !enabled || blocked;
  btnMs.disabled = !enabled || blocked;
}

function showBanner(text, updateUrl) {
  $('banner-text').textContent = text;
  $('banner').classList.remove('hidden');
  if (updateUrl) {
    const link = $('banner-link');
    link.classList.remove('hidden');
    link.onclick = () => window.launcher.openExternal(updateUrl);
  }
}

function setStatus(text, percent, state) {
  progressArea.classList.remove('hidden');
  statusText.textContent = text;
  statusText.className = state === 'error' ? 'error' : state === 'playing' ? 'playing' : '';
  if (percent != null) progressBar.style.width = `${percent}%`;
  if (state === 'error' || state === 'ready') {
    setButtons(true);
    if (state === 'ready') progressBar.style.width = '0%';
  }
}

async function init() {
  const res = await window.launcher.init();
  $('launcher-version').textContent = `v${res.launcherVersion}`;

  if (res.settings) {
    usernameInput.value = res.settings.username || '';
    if (res.settings.ramGB) ramSelect.value = String(res.settings.ramGB);
  }

  if (!res.ok) {
    $('server-name').textContent = 'Sin conexión';
    $('motd').textContent = res.error + '\nRevisa tu conexión a internet y vuelve a abrir el launcher.';
    return;
  }

  const m = res.manifest;
  $('server-name').textContent = (m.server && m.server.name) || 'Servidor de Minecraft';
  $('motd').textContent = (m.launcher && m.launcher.message) || '';

  const chip = (id, text) => {
    $(id).textContent = text;
    $(id).classList.remove('hidden');
  };
  chip('chip-version', `Minecraft ${m.game.mcVersion}`);
  chip('chip-loader', m.game.loader ? m.game.loader.charAt(0).toUpperCase() + m.game.loader.slice(1) : 'Vanilla');
  chip('chip-mods', `${(m.mods || []).length} mods`);
  if (m.server && m.server.ip) chip('chip-ip', m.server.ip);

  if (res.access && !res.access.ok) {
    blocked = true;
    showBanner(res.access.reason, res.access.updateUrl);
    return;
  }

  setButtons(true);
}

async function play(mode) {
  setButtons(false);
  progressBar.style.width = '0%';
  const res = await window.launcher.play({
    mode,
    username: usernameInput.value,
    ramGB: Number(ramSelect.value),
  });
  if (!res.ok && res.error) setStatus(res.error, null, 'error');
}

btnOffline.addEventListener('click', () => play('offline'));
btnMs.addEventListener('click', () => play('microsoft'));
usernameInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !btnOffline.disabled) play('offline');
});

window.launcher.onStatus(({ text, percent, state }) => setStatus(text, percent, state));

init();

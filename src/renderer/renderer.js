const $ = (id) => document.getElementById(id);

const usernameInput = $('username');
const usernameRow = $('username-row');
const ramSelect = $('ram');
const btnPlay = $('play-offline');
const btnLogin = $('login-ms');
const btnLogout = $('logout');
const accountBox = $('account-box');
const progressArea = $('progress-area');
const progressBar = $('progress-bar');
const statusText = $('status-text');

let blocked = false;
let account = null;      // sesión de Microsoft activa
let allowOffline = true;

function setButtons(enabled) {
  const on = enabled && !blocked;
  btnPlay.disabled = !on;
  btnLogin.disabled = !on;
  btnLogout.disabled = !on;
}

/** Pinta la interfaz según haya sesión de Microsoft o no. */
function renderAccount() {
  if (account) {
    accountBox.classList.remove('hidden');
    $('account-name').textContent = account.name;
    if (account.skin) {
      // La skin es 64x64; la cabeza está en (8,8)-(16,16). Se amplía x6.
      const av = $('account-avatar');
      av.style.backgroundImage = `url("${account.skin}")`;
      av.style.backgroundSize = '384px 384px';
      av.style.backgroundPosition = '-48px -48px';
    }

    // El nombre lo manda Mojang: se rellena solo y no se puede editar.
    usernameInput.value = account.name;
    usernameInput.disabled = true;
    usernameInput.title = 'Tu nombre viene de tu cuenta de Microsoft';
    usernameRow.classList.add('hidden');

    btnLogin.classList.add('hidden');
    btnPlay.textContent = `▶ Jugar como ${account.name}`;
  } else {
    accountBox.classList.add('hidden');
    usernameInput.disabled = false;
    usernameInput.title = '';
    usernameRow.classList.toggle('hidden', !allowOffline);
    btnLogin.classList.remove('hidden');
    btnPlay.textContent = '▶ Jugar';
    btnPlay.classList.toggle('hidden', !allowOffline);
  }
}

function showBanner(text) {
  $('banner-text').textContent = text;
  $('banner').classList.remove('hidden');
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
    if (res.settings.username) usernameInput.value = res.settings.username;
    if (res.settings.ramGB) ramSelect.value = String(res.settings.ramGB);
  }

  account = res.account || null;

  if (!res.ok) {
    $('server-name').textContent = 'Sin conexión';
    $('motd').textContent = res.error + '\nRevisa tu conexión a internet y vuelve a abrir el launcher.';
    renderAccount();
    return;
  }

  const m = res.manifest;
  const game = m.game || {};
  $('server-name').textContent = (m.server && m.server.name) || 'Servidor de Minecraft';
  $('motd').textContent = (m.launcher && m.launcher.message) || '';

  const chip = (id, text) => {
    $(id).textContent = text;
    $(id).classList.remove('hidden');
  };
  if (m.ftbPack && m.ftbPack.name) chip('chip-pack', m.ftbPack.name);
  if (game.mcVersion) chip('chip-version', `Minecraft ${game.mcVersion}`);
  if (game.loader) chip('chip-loader', game.loader.charAt(0).toUpperCase() + game.loader.slice(1));
  else if (m.ftbPack) chip('chip-loader', 'Modpack FTB');
  if ((m.mods || []).length) chip('chip-mods', `+${m.mods.length} mods extra`);
  if (m.server && m.server.ip) chip('chip-ip', m.server.ip);

  // Servidor solo premium: sin modo offline
  allowOffline = !(m.launcher && m.launcher.allowOffline === false);
  if (!allowOffline) {
    $('footer-note').textContent = 'Este servidor requiere cuenta premium de Minecraft.';
  }

  renderAccount();

  if (res.access && !res.access.ok) {
    blocked = true;
    showBanner(res.access.reason);
    return;
  }

  setButtons(true);
}

async function play() {
  setButtons(false);
  progressBar.style.width = '0%';
  const res = await window.launcher.play({
    mode: account ? 'microsoft' : 'offline',
    username: usernameInput.value,
    ramGB: Number(ramSelect.value),
  });
  if (!res.ok && res.error) setStatus(res.error, null, 'error');
}

btnPlay.addEventListener('click', play);

btnLogin.addEventListener('click', async () => {
  setButtons(false);
  setStatus('Abriendo el inicio de sesión de Microsoft...', null, 'working');
  const res = await window.launcher.login();
  if (res.ok) {
    account = res.account;
    renderAccount();
    setStatus(`Sesión iniciada como ${account.name}. Ya puedes jugar.`, null, 'ready');
  } else {
    setStatus(res.error, null, 'error');
  }
  setButtons(true);
});

btnLogout.addEventListener('click', async () => {
  await window.launcher.logout();
  account = null;
  usernameInput.value = '';
  renderAccount();
  setStatus('Sesión cerrada.', null, 'ready');
});

usernameInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !btnPlay.disabled) play();
});

window.launcher.onStatus(({ text, percent, state }) => setStatus(text, percent, state));

// ------------------------------------------------------------
// Actualización automática del launcher
// ------------------------------------------------------------
const updateBar = $('update-bar');
const updateText = $('update-text');
const updateInstall = $('update-install');

function showUpdate(text, withButton) {
  updateBar.classList.remove('hidden');
  updateText.textContent = text;
  updateInstall.classList.toggle('hidden', !withButton);
}

window.launcher.onUpdate((u) => {
  switch (u.state) {
    case 'available':
      showUpdate(`Descargando actualización del launcher (v${u.version})...`, false);
      break;
    case 'progress':
      showUpdate(`Descargando actualización del launcher... ${u.percent}%`, false);
      break;
    case 'downloaded':
      showUpdate(`Actualización v${u.version} lista. Se instalará al cerrar el launcher.`, true);
      break;
    default:
      // 'checking', 'none' y 'error' no se le enseñan al jugador: si no hay
      // internet o aún no hay releases, el launcher funciona igual.
      updateBar.classList.add('hidden');
  }
});

updateInstall.addEventListener('click', async () => {
  updateInstall.disabled = true;
  showUpdate('Instalando actualización, el launcher se reiniciará...', false);
  await window.launcher.installUpdate();
});

init();

import { db, doc, onSnapshot } from './firebase.js';
import { parseStreamingSource, streamingPlatformLabel } from './streaming.js';

const streamId = new URLSearchParams(location.search).get('stream') ||
  localStorage.getItem('zytrixSelectedStream') ||
  '';
const root = document.querySelector('#live-root');
const MATURE_SESSION_KEY = 'zytrixMatureViewerConfirmed';
const TWITCH_SDK_ID = 'zytrix-twitch-embed-sdk';

let stream = null;
let stopStream = null;
let observer = null;
let twitchSdkPromise = null;
let mountVersion = 0;

function matureConfirmed() {
  return sessionStorage.getItem(MATURE_SESSION_KEY) === '1';
}

function externalLink(source) {
  return source?.canonicalUrl || '#';
}

function loadTwitchSdk() {
  if (window.Twitch?.Embed) return Promise.resolve(window.Twitch);
  if (twitchSdkPromise) return twitchSdkPromise;
  twitchSdkPromise = new Promise((resolve, reject) => {
    const existing = document.getElementById(TWITCH_SDK_ID);
    if (existing) {
      existing.addEventListener('load', () => resolve(window.Twitch), { once: true });
      existing.addEventListener('error', reject, { once: true });
      return;
    }
    const script = document.createElement('script');
    script.id = TWITCH_SDK_ID;
    script.src = 'https://embed.twitch.tv/embed/v1.js';
    script.async = true;
    script.onload = () => resolve(window.Twitch);
    script.onerror = () => reject(new Error('twitch-sdk'));
    document.head.appendChild(script);
  });
  return twitchSdkPromise;
}

function removeAccessHelp() {
  root?.querySelector('#platform-access-help')?.remove();
}

function renderAccessHelp(player, source) {
  removeAccessHelp();
  if (!player || !source) return;

  const help = document.createElement('div');
  help.id = 'platform-access-help';
  help.className = 'platform-access-help';

  const label = streamingPlatformLabel(source.platform);
  const text = document.createElement('span');

  if (source.platform === 'twitch') {
    text.textContent = 'Se a Twitch solicitar login para conteúdo restrito, use o login do player. Se o navegador bloquear o popup ou cookies, abra diretamente na Twitch.';
  } else if (source.platform === 'kick') {
    text.textContent = 'Lives 18+ continuam sujeitas às preferências e controles da própria Kick. Se o embed restringir o acesso, abra diretamente na Kick.';
  } else {
    text.textContent = 'O YouTube pode bloquear a incorporação de algumas lives, exigir login ou aplicar restrições de idade. Se isso acontecer, abra a transmissão diretamente no YouTube.';
  }

  const link = document.createElement('a');
  link.href = externalLink(source);
  link.target = '_blank';
  link.rel = 'noopener noreferrer external';
  link.referrerPolicy = 'no-referrer';
  link.textContent = `Abrir no ${label}`;

  help.append(text, link);
  player.insertAdjacentElement('afterend', help);
}

function renderMatureGate(player, source) {
  player.innerHTML = '';
  const gate = document.createElement('div');
  gate.className = 'mature-stream-gate';

  const badge = document.createElement('span');
  badge.className = 'mature-stream-badge';
  badge.textContent = '18+';

  const title = document.createElement('strong');
  title.textContent = 'Conteúdo marcado como 18+';

  const text = document.createElement('p');
  text.textContent = `Este aviso da Zytrix não verifica idade nem substitui os controles do ${streamingPlatformLabel(source.platform)}. Ao continuar, o player original será carregado e a plataforma poderá exigir login, confirmação de idade ou outras permissões.`;

  const actions = document.createElement('div');
  actions.className = 'mature-stream-actions';

  const confirm = document.createElement('button');
  confirm.type = 'button';
  confirm.className = 'btn btn-primary';
  confirm.textContent = 'Continuar para o player';
  confirm.onclick = () => {
    sessionStorage.setItem(MATURE_SESSION_KEY, '1');
    player.dataset.zytrixPlayerSignature = '';
    setupPlayer(true);
  };

  const link = document.createElement('a');
  link.className = 'btn';
  link.href = externalLink(source);
  link.target = '_blank';
  link.rel = 'noopener noreferrer external';
  link.referrerPolicy = 'no-referrer';
  link.textContent = `Abrir no ${streamingPlatformLabel(source.platform)}`;

  actions.append(confirm, link);
  gate.append(badge, title, text, actions);
  player.appendChild(gate);
  renderAccessHelp(player, source);
}

function renderKick(player, source) {
  player.innerHTML = '';
  const params = new URLSearchParams({
    autoplay: 'true',
    muted: 'true',
    allowfullscreen: 'true'
  });

  const iframe = document.createElement('iframe');
  iframe.src = `https://player.kick.com/${encodeURIComponent(source.username)}?${params.toString()}`;
  iframe.title = `Player Kick de ${source.username}`;
  iframe.allow = 'autoplay; fullscreen; picture-in-picture';
  iframe.allowFullscreen = true;
  iframe.referrerPolicy = 'strict-origin-when-cross-origin';

  player.appendChild(iframe);
  renderAccessHelp(player, source);
}

function renderYouTube(player, source) {
  player.innerHTML = '';

  const params = new URLSearchParams({
    autoplay: '1',
    mute: '1',
    playsinline: '1',
    rel: '0'
  });

  const iframe = document.createElement('iframe');
  iframe.src = `https://www.youtube.com/embed/${encodeURIComponent(source.videoId)}?${params.toString()}`;
  iframe.title = 'Player de live do YouTube';
  iframe.allow = 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share; fullscreen';
  iframe.allowFullscreen = true;
  iframe.referrerPolicy = 'strict-origin-when-cross-origin';

  player.appendChild(iframe);
  renderAccessHelp(player, source);
}

async function renderTwitch(player, source, version) {
  player.innerHTML = '';
  const host = document.createElement('div');
  host.className = 'twitch-embed-host';
  host.id = `twitch-embed-${streamId}-${version}`;

  const loading = document.createElement('div');
  loading.className = 'player-access-loading';
  loading.textContent = 'Carregando player da Twitch…';

  player.append(host, loading);
  renderAccessHelp(player, source);

  try {
    const Twitch = await loadTwitchSdk();
    if (version !== mountVersion || !player.isConnected || !Twitch?.Embed) return;

    const embed = new Twitch.Embed(host.id, {
      width: '100%',
      height: '100%',
      channel: source.username,
      layout: 'video',
      autoplay: true,
      muted: true,
      theme: 'dark',
      allowfullscreen: true
    });

    embed.addEventListener(Twitch.Embed.VIDEO_READY, () => loading.remove());

    setTimeout(() => {
      if (loading.isConnected) {
        loading.textContent = 'A Twitch pode estar aguardando login ou interação. Use o player ou o botão “Abrir na Twitch” abaixo.';
      }
    }, 6000);
  } catch (error) {
    console.warn('Não foi possível iniciar o embed completo da Twitch.', error);
    if (version !== mountVersion || !player.isConnected) return;

    player.innerHTML = '';
    const fallback = document.createElement('div');
    fallback.className = 'state player-access-fallback';

    const message = document.createElement('p');
    message.textContent = 'O player incorporado da Twitch não carregou neste navegador.';

    const link = document.createElement('a');
    link.className = 'btn btn-primary';
    link.href = externalLink(source);
    link.target = '_blank';
    link.rel = 'noopener noreferrer external';
    link.referrerPolicy = 'no-referrer';
    link.textContent = 'Abrir na Twitch';

    fallback.append(message, link);
    player.appendChild(fallback);
  }
}

function setupPlayer(force = false) {
  if (!root || !stream) return;

  const player = root.querySelector('.player');
  if (!player) return;

  const source = parseStreamingSource(stream.playbackURL || '');
  if (!source) return;

  const sourceKey = source.videoId || source.username || '';
  const signature = [
    source.platform,
    sourceKey,
    stream.matureContent === true ? '18' : 'all',
    matureConfirmed() ? 'confirmed' : 'locked'
  ].join(':');

  if (!force && player.dataset.zytrixPlayerSignature === signature) return;

  player.dataset.zytrixPlayerSignature = signature;
  mountVersion += 1;
  const version = mountVersion;

  if (stream.matureContent === true && !matureConfirmed()) {
    renderMatureGate(player, source);
    return;
  }

  if (source.platform === 'twitch') {
    renderTwitch(player, source, version);
    return;
  }

  if (source.platform === 'youtube') {
    renderYouTube(player, source);
    return;
  }

  renderKick(player, source);
}

if (root && streamId) {
  stopStream = onSnapshot(doc(db, 'streams', streamId), snap => {
    if (!snap.exists()) return;
    stream = { id: snap.id, ...snap.data() };
    setupPlayer(true);
  }, error => console.warn('Não foi possível acompanhar o player.', error));

  observer = new MutationObserver(() => setupPlayer());
  observer.observe(root, { childList: true, subtree: true });
}

window.addEventListener('pagehide', () => {
  stopStream?.();
  observer?.disconnect();
});

import {
  auth,
  db,
  onAuthStateChanged,
  doc,
  getDoc,
  onSnapshot
} from './firebase.js';
import { escapeHtml } from './ui.js';
import {
  selectedStreamId,
  isFollowing,
  setFollowState,
  watchFollowerCount,
  watchActiveViewers,
  startViewerPresence
} from './social.js';

const streamId = selectedStreamId();
let stream = null;
let streamerProfile = null;
let currentUser = null;
let following = false;
let followerCount = 0;
let activeViewers = null;
let stopFollowers = null;
let stopViewers = null;
let stopPresence = null;
let stopStream = null;
let observer = null;

function waitForLiveContent() {
  const root = document.querySelector('#live-root');
  if (!root) return;

  const tryMount = () => {
    if (!stream || root.querySelector('#live-social-panel')) return;
    const loadingOnly = root.children.length === 1 && root.querySelector('.state');
    if (loadingOnly) return;
    renderPanel();
  };

  tryMount();
  observer = new MutationObserver(tryMount);
  observer.observe(root, { childList: true, subtree: false });
}

function viewerLabel() {
  if (!currentUser) return 'Login necessário';
  return currentUser?.uid === stream?.streamerUid ? Number(activeViewers || 0).toLocaleString('pt-BR') : 'Privado';
}

function renderPanel() {
  const root = document.querySelector('#live-root');
  if (!root || !stream) return;

  let panel = root.querySelector('#live-social-panel');
  if (!panel) {
    panel = document.createElement('section');
    panel.id = 'live-social-panel';
    panel.className = 'card panel social-panel';
    root.appendChild(panel);
  }

  const ownChannel = currentUser?.uid === stream.streamerUid;
  const buttonText = !currentUser
    ? 'Entrar para seguir'
    : ownChannel
      ? 'Seu canal'
      : following
        ? 'Seguindo ✓'
        : 'Seguir';

  panel.innerHTML = `
    <div class="social-panel-head">
      <div>
        <div class="eyebrow">Comunidade</div>
        <h2 style="margin:4px 0 0">${escapeHtml(streamerProfile?.username || 'Streamer')}</h2>
      </div>
      <button
        id="follow-streamer"
        class="btn ${following ? 'is-following follow-button' : 'btn-primary follow-button'}"
        ${ownChannel ? 'disabled' : ''}
      >${escapeHtml(buttonText)}</button>
    </div>

    <div class="social-stats">
      <div class="stat-box">
        <span class="stat-label">Seguidores</span>
        <strong id="live-follower-count">${currentUser?.uid === stream.streamerUid ? followerCount.toLocaleString('pt-BR') : 'Privado'}</strong>
      </div>
      <div class="stat-box">
        <span class="stat-label">Na Zytrix agora</span>
        <strong id="zytrix-active-viewers">${viewerLabel()}</strong>
      </div>
      <div class="stat-box">
        <span class="stat-label">Contador da transmissão</span>
        <strong>${Number(stream.viewerCount || 0).toLocaleString('pt-BR')}</strong>
      </div>
    </div>

    <p class="dashboard-note">
      O contador “Na Zytrix agora” considera usuários autenticados ativos nesta página nos últimos 90 segundos.
      O contador da transmissão continua sendo o valor registrado na live.
    </p>
    <div id="follow-message"></div>
  `;

  const button = panel.querySelector('#follow-streamer');
  if (!button || ownChannel) return;

  button.onclick = async () => {
    if (!currentUser) {
      location.href = `login.html?redirect=${encodeURIComponent(location.pathname + location.search)}`;
      return;
    }

    button.disabled = true;
    const message = panel.querySelector('#follow-message');
    try {
      await setFollowState(currentUser.uid, stream.streamerUid, !following);
      following = !following;
      if (message) {
        message.innerHTML = `<div class="message ok">${following ? 'Você está seguindo este streamer.' : 'Você deixou de seguir este streamer.'}</div>`;
      }
      renderPanel();
    } catch (error) {
      console.error('Erro ao alterar acompanhamento:', error);
      button.disabled = false;
      if (message) {
        message.innerHTML = '<div class="message err">Não foi possível alterar agora.</div>';
      }
    }
  };
}

async function refreshFollowState() {
  if (!currentUser || !stream || currentUser.uid === stream.streamerUid) {
    following = false;
    renderPanel();
    return;
  }
  try {
    following = await isFollowing(currentUser.uid, stream.streamerUid);
  } catch (error) {
    console.warn('Não foi possível verificar se o canal é seguido.', error);
  }
  renderPanel();
}

async function startPresenceForUser() {
  stopPresence?.();
  stopViewers?.();
  stopPresence = null;
  stopViewers = null;
  activeViewers = null;

  if (!currentUser || !streamId) {
    renderPanel();
    return;
  }

  try {
    stopPresence = await startViewerPresence(currentUser.uid, streamId);
    if (currentUser.uid !== stream?.streamerUid) { activeViewers = null; renderPanel(); return; }
    stopViewers = watchActiveViewers(
      streamId,
      count => {
        activeViewers = count;
        const element = document.querySelector('#zytrix-active-viewers');
        if (element) element.textContent = count.toLocaleString('pt-BR');
      },
      error => console.warn('Não foi possível acompanhar espectadores ativos.', error)
    );
  } catch (error) {
    console.warn('Presença do espectador indisponível.', error);
  }
}

async function initialize() {
  if (!streamId) return;

  const snap = await getDoc(doc(db, 'streams', streamId));
  if (!snap.exists()) return;
  stream = { id: snap.id, ...snap.data() };

  const profileSnap = await getDoc(doc(db, 'profiles', stream.streamerUid));
  streamerProfile = profileSnap.exists() ? profileSnap.data() : null;

  if (currentUser?.uid === stream.streamerUid) stopFollowers = watchFollowerCount(
    stream.streamerUid,
    count => {
      followerCount = count;
      const element = document.querySelector('#live-follower-count');
      if (element) element.textContent = count.toLocaleString('pt-BR');
    },
    error => console.warn('Não foi possível carregar seguidores.', error)
  );

  stopStream = onSnapshot(doc(db, 'streams', streamId), streamSnap => {
    if (!streamSnap.exists()) return;
    stream = { id: streamSnap.id, ...streamSnap.data() };
    renderPanel();
  });

  waitForLiveContent();
  await refreshFollowState();
  await startPresenceForUser();
}

onAuthStateChanged(auth, async user => {
  currentUser = user;
  if (!stream) return;
  await refreshFollowState();
  await startPresenceForUser();
});

initialize().catch(error => console.warn('Recursos sociais da live indisponíveis.', error));

window.addEventListener('pagehide', () => {
  stopFollowers?.();
  stopViewers?.();
  stopPresence?.();
  stopStream?.();
  observer?.disconnect();
});

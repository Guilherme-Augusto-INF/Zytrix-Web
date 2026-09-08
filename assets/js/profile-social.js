import {
  auth,
  db,
  onAuthStateChanged,
  collection,
  doc,
  getDoc,
  onSnapshot
} from './firebase.js';
import { escapeHtml } from './ui.js';

const root = document.querySelector('#profile-root');
let followingIds = new Set();
let channels = [];
let followerCount = 0;
let stopFollowing = null;
let stopFollowers = null;
let stopChannels = null;
let observer = null;

function mountOrRender() {
  if (!root || root.querySelector('#profile-social-panel')) return render();
  const firstPanel = root.querySelector('.card.panel');
  if (!firstPanel) return;

  const panel = document.createElement('section');
  panel.id = 'profile-social-panel';
  panel.className = 'card panel social-panel';
  firstPanel.insertAdjacentElement('afterend', panel);
  render();
}

function render() {
  const panel = root?.querySelector('#profile-social-panel');
  if (!panel) return;

  const followedChannels = channels
    .filter(channel => followingIds.has(channel.id))
    .sort((a, b) => Number(b.isLive === true) - Number(a.isLive === true));

  panel.innerHTML = `
    <div class="social-panel-head">
      <div>
        <div class="eyebrow">Comunidade</div>
        <h2 style="margin:4px 0 0">Sua rede na Zytrix</h2>
      </div>
      <a class="btn" href="notificacoes.html">Lives que sigo</a>
    </div>

    <div class="social-stats">
      <div class="stat-box">
        <span class="stat-label">Seguidores</span>
        <strong>${followerCount.toLocaleString('pt-BR')}</strong>
      </div>
      <div class="stat-box">
        <span class="stat-label">Seguindo</span>
        <strong>${followingIds.size.toLocaleString('pt-BR')}</strong>
      </div>
      <div class="stat-box">
        <span class="stat-label">Seguidos ao vivo</span>
        <strong>${followedChannels.filter(channel => channel.isLive === true).length.toLocaleString('pt-BR')}</strong>
      </div>
    </div>

    <div class="followed-list">
      ${followedChannels.length
        ? followedChannels.slice(0, 8).map(channel => `
          <div class="followed-item">
            <div class="followed-main">
              <strong>${escapeHtml(channel.channelName || 'Streamer')}</strong>
              <span class="${channel.isLive ? 'live-indicator' : 'offline-indicator'}">
                ${channel.isLive ? '● AO VIVO' : 'OFFLINE'}
              </span>
            </div>
            ${channel.isLive && channel.currentStreamId
              ? `<a class="btn btn-primary" href="live.html?stream=${encodeURIComponent(channel.currentStreamId)}">Assistir</a>`
              : ''}
          </div>
        `).join('')
        : '<div class="admin-empty">Você ainda não segue nenhum streamer.</div>'}
    </div>
  `;
}

async function initialize(user) {
  stopFollowing?.();
  stopFollowers?.();
  stopChannels?.();

  const channelSnap = await getDoc(doc(db, 'channels', user.uid));

  stopFollowing = onSnapshot(
    collection(db, 'users', user.uid, 'following'),
    snap => {
      followingIds = new Set(snap.docs.map(item => item.id));
      mountOrRender();
    },
    error => console.warn('Não foi possível carregar canais seguidos.', error)
  );

  stopChannels = onSnapshot(
    collection(db, 'channels'),
    snap => {
      channels = snap.docs.map(item => ({ id: item.id, ...item.data() }));
      mountOrRender();
    },
    error => console.warn('Não foi possível acompanhar canais.', error)
  );

  if (channelSnap.exists()) {
    stopFollowers = onSnapshot(
      collection(db, 'channels', user.uid, 'followers'),
      snap => {
        followerCount = snap.size;
        mountOrRender();
      },
      error => console.warn('Não foi possível carregar seguidores.', error)
    );
  } else {
    followerCount = 0;
  }

  observer?.disconnect();
  observer = new MutationObserver(mountOrRender);
  observer.observe(root, { childList: true });
  mountOrRender();
}

onAuthStateChanged(auth, user => {
  if (user) initialize(user).catch(error => console.warn('Resumo social indisponível.', error));
});

window.addEventListener('pagehide', () => {
  stopFollowing?.();
  stopFollowers?.();
  stopChannels?.();
  observer?.disconnect();
});

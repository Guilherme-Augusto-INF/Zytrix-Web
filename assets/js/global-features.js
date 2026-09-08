import {
  auth,
  db,
  onAuthStateChanged,
  collection,
  doc,
  getDoc,
  onSnapshot
} from './firebase.js';
import { escapeAttr, escapeHtml } from './ui.js';

let stopFollowing = null;
let stopChannels = null;
let followingIds = new Set();
let channels = [];

function waitForNav(timeout = 5000) {
  return new Promise(resolve => {
    const existing = document.querySelector('.nav-actions');
    if (existing) {
      resolve(existing);
      return;
    }

    const observer = new MutationObserver(() => {
      const element = document.querySelector('.nav-actions');
      if (element) {
        observer.disconnect();
        resolve(element);
      }
    });

    observer.observe(document.documentElement, { childList: true, subtree: true });
    setTimeout(() => {
      observer.disconnect();
      resolve(document.querySelector('.nav-actions'));
    }, timeout);
  });
}

function removeSignedInFeatures() {
  document.querySelector('#notifications-nav')?.remove();
  document.querySelector('#admin-nav')?.remove();
  document.querySelector('#zytrix-live-toast')?.remove();
}

function ensureNotificationButton(nav) {
  let link = document.querySelector('#notifications-nav');
  if (link) return link;

  link = document.createElement('a');
  link.id = 'notifications-nav';
  link.className = 'icon-link notification-link';
  link.href = 'notificacoes.html';
  link.title = 'Lives de canais seguidos';
  link.setAttribute('aria-label', 'Abrir notificações de lives');
  link.innerHTML = '<span aria-hidden="true">🔔</span><span id="notifications-count" class="notification-count hidden">0</span>';

  const profile = nav.querySelector('#profile-nav');
  nav.insertBefore(link, profile || null);
  return link;
}

function showLiveToast(channel) {
  const streamId = channel.currentStreamId || '';
  const key = `zytrix-live-seen:${channel.id}:${streamId}`;

  if (sessionStorage.getItem(key)) return;
  sessionStorage.setItem(key, '1');

  document.querySelector('#zytrix-live-toast')?.remove();
  const toast = document.createElement('a');
  toast.id = 'zytrix-live-toast';
  toast.className = 'live-toast';
  toast.href = streamId ? `live.html?stream=${encodeURIComponent(streamId)}` : 'ao-vivo.html';
  toast.innerHTML = `
    <strong>● ${escapeHtml(channel.channelName || 'Um canal que você segue')} está ao vivo</strong>
    <span>Toque para assistir na Zytrix.</span>
  `;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 6500);
}

function refreshNotifications() {
  const followedLive = channels.filter(channel =>
    followingIds.has(channel.id) && channel.isLive === true
  );

  const count = document.querySelector('#notifications-count');
  if (count) {
    count.textContent = String(followedLive.length);
    count.classList.toggle('hidden', followedLive.length === 0);
  }

  if (followedLive.length) {
    showLiveToast(followedLive[0]);
  }
}

async function addAdminLink(nav, uid) {
  try {
    const adminSnap = await getDoc(doc(db, 'admins', uid));
    if (!adminSnap.exists() || adminSnap.data().active !== true) return;

    if (document.querySelector('#admin-nav')) return;
    const link = document.createElement('a');
    link.id = 'admin-nav';
    link.className = 'btn btn-ghost admin-nav-link';
    link.href = 'admin.html';
    link.textContent = 'Admin';
    link.setAttribute('aria-label', 'Abrir painel administrativo');
    nav.appendChild(link);
  } catch (error) {
    console.warn('Não foi possível verificar acesso administrativo.', error);
  }
}

function cleanupSubscriptions() {
  stopFollowing?.();
  stopChannels?.();
  stopFollowing = null;
  stopChannels = null;
  followingIds = new Set();
  channels = [];
}

onAuthStateChanged(auth, async user => {
  cleanupSubscriptions();
  const nav = await waitForNav();
  if (!nav) return;

  if (!user) {
    removeSignedInFeatures();
    return;
  }

  ensureNotificationButton(nav);
  addAdminLink(nav, user.uid);

  stopFollowing = onSnapshot(
    collection(db, 'users', user.uid, 'following'),
    snap => {
      followingIds = new Set(snap.docs.map(item => item.id));
      refreshNotifications();
    },
    error => console.warn('Não foi possível acompanhar os canais seguidos.', error)
  );

  stopChannels = onSnapshot(
    collection(db, 'channels'),
    snap => {
      channels = snap.docs.map(item => ({ id: item.id, ...item.data() }));
      refreshNotifications();
    },
    error => console.warn('Não foi possível acompanhar o status dos canais.', error)
  );
});

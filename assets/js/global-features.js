import './platform-global.js';
import {
  auth,
  db,
  onAuthStateChanged,
  collection,
  doc,
  getDoc,
  onSnapshot,
  query,
  where
} from './firebase.js';
import { escapeHtml } from './ui.js';

let stopFollowing = null;
let stopChannels = null;
let stopSupportTransactions = null;
let stopNotificationState = null;
let followingIds = new Set();
let channels = [];
let supportTransactions = [];
let supportLastSeenAt = 0;
let supportSnapshotReady = false;
let supportStateReady = false;
let activeUid = '';

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

function timestampMillis(value) {
  const date = value?.toDate?.();
  return date ? date.getTime() : 0;
}

function removeSignedInFeatures() {
  document.querySelector('#notifications-nav')?.remove();
  document.querySelector('#admin-nav')?.remove();
  document.querySelector('#zytrix-live-toast')?.remove();
  document.querySelector('#zytrix-support-toast')?.remove();
}

function ensureNotificationButton(nav) {
  let link = document.querySelector('#notifications-nav');
  if (link) return link;

  link = document.createElement('a');
  link.id = 'notifications-nav';
  link.className = 'icon-link notification-link';
  link.href = 'notificacoes.html';
  link.title = 'Notificações';
  link.setAttribute('aria-label', 'Abrir notificações');
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

  if (document.querySelector('#zytrix-support-toast')) return;

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

function showSupportToast(transaction) {
  if (!transaction?.id) return;
  const key = `zytrix-support-toast:${transaction.id}`;
  if (sessionStorage.getItem(key)) return;
  sessionStorage.setItem(key, '1');

  const amount = Number(transaction.amount || 0);
  document.querySelector('#zytrix-live-toast')?.remove();
  document.querySelector('#zytrix-support-toast')?.remove();
  const toast = document.createElement('a');
  toast.id = 'zytrix-support-toast';
  toast.className = 'live-toast';
  toast.href = 'notificacoes.html';
  toast.setAttribute('role', 'status');
  toast.setAttribute('aria-live', 'polite');
  toast.innerHTML = `
    <strong>◈ Você recebeu ${amount.toLocaleString('pt-BR')} Zy Coins!</strong>
    <span>Um espectador apoiou sua transmissão. Toque para ver.</span>
  `;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 7000);
}

function refreshNotifications() {
  const followedLive = channels.filter(channel =>
    followingIds.has(channel.id) && channel.isLive === true
  );

  const unreadSupports = supportStateReady
    ? supportTransactions.filter(transaction =>
        timestampMillis(transaction.createdAt) > supportLastSeenAt
      )
    : [];

  const total = followedLive.length + unreadSupports.length;
  const count = document.querySelector('#notifications-count');
  if (count) {
    count.textContent = total > 99 ? '99+' : String(total);
    count.classList.toggle('hidden', total === 0);
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
  stopSupportTransactions?.();
  stopNotificationState?.();
  stopFollowing = null;
  stopChannels = null;
  stopSupportTransactions = null;
  stopNotificationState = null;
  followingIds = new Set();
  channels = [];
  supportTransactions = [];
  supportLastSeenAt = 0;
  supportSnapshotReady = false;
  supportStateReady = false;
  activeUid = '';
}

onAuthStateChanged(auth, async user => {
  cleanupSubscriptions();
  const nav = await waitForNav();
  if (!nav) return;

  if (!user) {
    removeSignedInFeatures();
    return;
  }

  activeUid = user.uid;
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

  stopNotificationState = onSnapshot(
    doc(db, 'users', user.uid, 'notificationState', 'zycoins'),
    snap => {
      if (activeUid !== user.uid) return;
      supportLastSeenAt = snap.exists()
        ? timestampMillis(snap.data().lastSupportSeenAt)
        : 0;
      supportStateReady = true;
      refreshNotifications();
    },
    error => {
      console.warn('Não foi possível acompanhar o estado das notificações.', error);
      supportLastSeenAt = 0;
      supportStateReady = true;
      refreshNotifications();
    }
  );

  const supportsQuery = query(
    collection(db, 'zyCoinTransactions'),
    where('toUid', '==', user.uid)
  );

  stopSupportTransactions = onSnapshot(
    supportsQuery,
    snap => {
      const wasReady = supportSnapshotReady;
      supportTransactions = snap.docs
        .map(item => ({ id: item.id, ...item.data() }))
        .filter(item => item.type === 'stream_support' && item.status === 'completed');

      if (wasReady) {
        snap.docChanges()
          .filter(change => change.type === 'added')
          .map(change => ({ id: change.doc.id, ...change.doc.data() }))
          .filter(item => item.type === 'stream_support' && item.status === 'completed')
          .forEach(showSupportToast);
      }

      supportSnapshotReady = true;
      refreshNotifications();
    },
    error => console.warn('Não foi possível acompanhar apoios em Zy Coins.', error)
  );
});
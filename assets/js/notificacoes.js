import {
  auth,
  db,
  onAuthStateChanged,
  collection,
  doc,
  getDoc,
  onSnapshot,
  query,
  setDoc,
  serverTimestamp,
  where
} from './firebase.js';
import { header, footer, escapeHtml } from './ui.js';
import { parseStreamingSource, streamingPlatformLabel } from './streaming.js';

header();
footer();

const root = document.querySelector('#notifications-root');
let activeUser = null;
let followingIds = new Set();
let channels = [];
let streams = [];
let supportTransactions = [];
let supportProfiles = new Map();
let supportLoadError = '';
let supportRenderVersion = 0;
let stopFollowing = null;
let stopChannels = null;
let stopStreams = null;
let stopSupportTransactions = null;

function transactionTime(transaction) {
  const date = transaction?.createdAt?.toDate?.();
  return date ? date.getTime() : 0;
}

function formatSupportTime(timestamp) {
  const date = timestamp?.toDate?.();
  if (!date) return 'Agora';
  return date.toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
}

async function markSupportNotificationsSeen(uid) {
  if (!uid || !supportTransactions.length) return;

  try {
    await setDoc(
      doc(db, 'users', uid, 'notificationState', 'zycoins'),
      {
        uid,
        lastSupportSeenAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      },
      { merge: true }
    );
  } catch (error) {
    console.warn('Não foi possível sincronizar o estado das notificações.', error);
  }
}

async function hydrateSupportProfiles(transactions) {
  const uids = [...new Set(
    transactions
      .map(transaction => String(transaction.fromUid || ''))
      .filter(Boolean)
  )];

  await Promise.all(uids.map(async uid => {
    if (supportProfiles.has(uid)) return;
    try {
      const snap = await getDoc(doc(db, 'profiles', uid));
      supportProfiles.set(uid, snap.exists()
        ? {
            username: String(snap.data().username || 'Usuário'),
            photoURL: String(snap.data().photoURL || '')
          }
        : { username: 'Usuário', photoURL: '' });
    } catch {
      supportProfiles.set(uid, { username: 'Usuário', photoURL: '' });
    }
  }));
}

function renderSupportNotifications() {
  if (supportLoadError) {
    return `
      <section class="card panel" style="margin-bottom:18px">
        <div class="eyebrow">Zy Coins</div>
        <h2 style="margin:6px 0 10px">Apoios recebidos</h2>
        <div class="message err">${escapeHtml(supportLoadError)}</div>
      </section>
    `;
  }

  if (!supportTransactions.length) {
    return `
      <section class="card panel" style="margin-bottom:18px">
        <div class="eyebrow">Zy Coins</div>
        <h2 style="margin:6px 0 10px">Apoios recebidos</h2>
        <p class="muted" style="margin:0">Quando alguém apoiar sua live com Zy Coins, a notificação aparecerá aqui.</p>
      </section>
    `;
  }

  const items = supportTransactions.map(transaction => {
    const profile = supportProfiles.get(transaction.fromUid) || { username: 'Usuário' };
    const amount = Number(transaction.amount || 0);
    const streamId = String(transaction.streamId || '');

    return `
      <article class="notification-item">
        <div class="notification-main">
          <strong>◈ ${amount.toLocaleString('pt-BR')} Zy Coins recebidos</strong>
          <span class="muted">${escapeHtml(profile.username)} apoiou sua transmissão</span>
          <span class="muted" style="display:block;margin-top:4px">${escapeHtml(formatSupportTime(transaction.createdAt))}</span>
        </div>
        ${streamId
          ? `<a class="btn btn-ghost" href="live.html?stream=${encodeURIComponent(streamId)}">Ver transmissão</a>`
          : '<span class="muted">Apoio recebido</span>'}
      </article>
    `;
  }).join('');

  return `
    <section style="margin-bottom:22px">
      <div class="eyebrow">Zy Coins</div>
      <h2 style="margin:6px 0 12px">Apoios recebidos</h2>
      <div class="notifications-list">${items}</div>
    </section>
  `;
}

function renderFollowedChannels() {
  const followed = channels
    .filter(channel => followingIds.has(channel.id))
    .map(channel => {
      const stream = streams.find(item =>
        item.id === channel.currentStreamId || item.streamerUid === channel.id
      );
      return { ...channel, stream };
    })
    .sort((a, b) => {
      const liveA = a.isLive === true && a.stream?.status === 'live';
      const liveB = b.isLive === true && b.stream?.status === 'live';
      return Number(liveB) - Number(liveA);
    });

  if (!followingIds.size) {
    return `
      <section>
        <div class="eyebrow">Canais seguidos</div>
        <h2 style="margin:6px 0 12px">Lives da sua comunidade</h2>
        <div class="card panel admin-empty">
          Você ainda não segue nenhum streamer. Abra uma live e use o botão <strong>Seguir</strong>.
        </div>
      </section>
    `;
  }

  const items = followed.map(channel => {
    const stream = channel.stream;
    const live = channel.isLive === true && stream?.status === 'live';
    const source = parseStreamingSource(stream?.playbackURL || '');
    const platform = source ? streamingPlatformLabel(source.platform) : 'Zytrix';

    return `
      <article class="notification-item">
        <div class="notification-main">
          <strong>${escapeHtml(channel.channelName || 'Streamer')}</strong>
          <span class="${live ? 'live-indicator' : 'offline-indicator'}">
            ${live ? '● AO VIVO' : 'OFFLINE'} · ${escapeHtml(platform)}
          </span>
          ${stream?.title ? `<span style="display:block;margin-top:4px">${escapeHtml(stream.title)}</span>` : ''}
        </div>
        ${live && stream?.id
          ? `<a class="btn btn-primary" href="live.html?stream=${encodeURIComponent(stream.id)}">Assistir agora</a>`
          : '<span class="muted">Sem transmissão ativa</span>'}
      </article>
    `;
  }).join('') || '<div class="card panel admin-empty">Nenhum canal seguido foi encontrado.</div>';

  return `
    <section>
      <div class="eyebrow">Canais seguidos</div>
      <h2 style="margin:6px 0 12px">Lives da sua comunidade</h2>
      <div class="notifications-list">${items}</div>
    </section>
  `;
}

function render() {
  if (!root || !activeUser) return;
  root.innerHTML = `${renderSupportNotifications()}${renderFollowedChannels()}`;
}

function cleanup() {
  stopFollowing?.();
  stopChannels?.();
  stopStreams?.();
  stopSupportTransactions?.();
  stopFollowing = null;
  stopChannels = null;
  stopStreams = null;
  stopSupportTransactions = null;
  supportRenderVersion++;
}

onAuthStateChanged(auth, user => {
  cleanup();
  activeUser = user;
  followingIds = new Set();
  channels = [];
  streams = [];
  supportTransactions = [];
  supportProfiles = new Map();
  supportLoadError = '';

  if (!user) {
    root.innerHTML = `
      <div class="card panel">
        <h2>Entre para ver suas notificações</h2>
        <p class="muted">Aqui aparecem lives de canais seguidos e apoios recebidos em Zy Coins.</p>
        <a class="btn btn-primary" href="login.html">Entrar</a>
      </div>
    `;
    return;
  }

  render();

  stopFollowing = onSnapshot(
    collection(db, 'users', user.uid, 'following'),
    snap => {
      followingIds = new Set(snap.docs.map(item => item.id));
      render();
    },
    error => {
      console.error(error);
      followingIds = new Set();
      render();
    }
  );

  stopChannels = onSnapshot(
    collection(db, 'channels'),
    snap => {
      channels = snap.docs.map(item => ({ id: item.id, ...item.data() }));
      render();
    },
    error => console.warn('Não foi possível acompanhar canais.', error)
  );

  stopStreams = onSnapshot(
    collection(db, 'streams'),
    snap => {
      streams = snap.docs.map(item => ({ id: item.id, ...item.data() }));
      render();
    },
    error => console.warn('Não foi possível acompanhar lives.', error)
  );

  const supportsQuery = query(
    collection(db, 'zyCoinTransactions'),
    where('toUid', '==', user.uid)
  );

  stopSupportTransactions = onSnapshot(
    supportsQuery,
    async snap => {
      const version = ++supportRenderVersion;
      supportLoadError = '';
      supportTransactions = snap.docs
        .map(item => ({ id: item.id, ...item.data() }))
        .filter(item => item.type === 'stream_support' && item.status === 'completed')
        .sort((a, b) => transactionTime(b) - transactionTime(a));

      await hydrateSupportProfiles(supportTransactions);
      if (version !== supportRenderVersion || activeUser?.uid !== user.uid) return;

      render();
      await markSupportNotificationsSeen(user.uid);
    },
    error => {
      console.error('Não foi possível carregar os apoios em Zy Coins.', error);
      supportLoadError = 'Não foi possível carregar os apoios recebidos.';
      render();
    }
  );
});

window.addEventListener('pagehide', cleanup);
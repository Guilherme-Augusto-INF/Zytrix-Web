import {
  auth,
  db,
  onAuthStateChanged,
  collection,
  onSnapshot
} from './firebase.js';
import { header, footer, escapeHtml } from './ui.js';
import { parseStreamingSource, streamingPlatformLabel } from './streaming.js';

header();
footer();

const root = document.querySelector('#notifications-root');
let followingIds = new Set();
let channels = [];
let streams = [];
let stopFollowing = null;
let stopChannels = null;
let stopStreams = null;

function render() {
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
    root.innerHTML = `
      <div class="card panel admin-empty">
        Você ainda não segue nenhum streamer. Abra uma live e use o botão <strong>Seguir</strong>.
      </div>
    `;
    return;
  }

  root.innerHTML = followed.map(channel => {
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
}

function cleanup() {
  stopFollowing?.();
  stopChannels?.();
  stopStreams?.();
  stopFollowing = null;
  stopChannels = null;
  stopStreams = null;
}

onAuthStateChanged(auth, user => {
  cleanup();

  if (!user) {
    root.innerHTML = `
      <div class="card panel">
        <h2>Entre para ver suas notificações</h2>
        <p class="muted">As notificações são baseadas nos canais que sua conta segue.</p>
        <a class="btn btn-primary" href="login.html">Entrar</a>
      </div>
    `;
    return;
  }

  stopFollowing = onSnapshot(
    collection(db, 'users', user.uid, 'following'),
    snap => {
      followingIds = new Set(snap.docs.map(item => item.id));
      render();
    },
    error => {
      console.error(error);
      root.innerHTML = '<div class="message err">Não foi possível carregar os canais seguidos.</div>';
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
});

window.addEventListener('pagehide', cleanup);

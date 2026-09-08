import {
  auth,
  db,
  onAuthStateChanged,
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  where,
  limit,
  onSnapshot
} from './firebase.js';
import { escapeHtml, escapeAttr } from './ui.js';
import { parseStreamingSource, streamingPlatformLabel } from './streaming.js';
import { watchFollowerCount, watchActiveViewers } from './social.js';

const root = document.querySelector('#config-root');
let user = null;
let channel = null;
let stream = null;
let followerCount = 0;
let activeViewers = 0;
let stopChannel = null;
let stopStream = null;
let stopFollowers = null;
let stopViewers = null;
let observer = null;

async function findStream(uid, currentStreamId) {
  if (currentStreamId) {
    const direct = await getDoc(doc(db, 'streams', currentStreamId));
    if (direct.exists()) return { id: direct.id, ...direct.data() };
  }

  const result = await getDocs(query(
    collection(db, 'streams'),
    where('streamerUid', '==', uid),
    limit(1)
  ));

  if (result.empty) return null;
  return { id: result.docs[0].id, ...result.docs[0].data() };
}

function mountOrRender() {
  if (!root || !stream) return;

  let panel = root.querySelector('#streamer-dashboard');
  if (!panel) {
    const loadingOnly = root.children.length === 1 && root.querySelector('.state');
    if (loadingOnly) return;
    panel = document.createElement('section');
    panel.id = 'streamer-dashboard';
    panel.className = 'card panel dashboard-card';
    root.prepend(panel);
  }

  const source = parseStreamingSource(stream.playbackURL || '');
  const platform = source ? streamingPlatformLabel(source.platform) : 'Não vinculada';
  const isLive = stream.status === 'live';

  panel.innerHTML = `
    <div class="dashboard-head">
      <div>
        <div class="eyebrow">Painel do streamer</div>
        <h2 style="margin:4px 0 0">Resumo da transmissão</h2>
      </div>
      <span class="${isLive ? 'status-live' : 'status-offline'}">${isLive ? '● AO VIVO' : 'OFFLINE'}</span>
    </div>

    <div class="dashboard-platform" style="margin-top:12px">
      <span class="platform-badge platform-${source?.platform || 'unknown'}">${escapeHtml(platform)}</span>
      ${source
        ? `<a href="${escapeAttr(source.canonicalUrl)}" target="_blank" rel="noopener noreferrer" class="muted">${escapeHtml(source.username)}</a>`
        : '<span class="muted">Nenhum canal externo válido.</span>'}
    </div>

    <div class="dashboard-stats">
      <div class="stat-box">
        <span class="stat-label">Seguidores</span>
        <strong id="dashboard-followers">${followerCount.toLocaleString('pt-BR')}</strong>
      </div>
      <div class="stat-box">
        <span class="stat-label">Zytrix agora</span>
        <strong id="dashboard-viewers">${activeViewers.toLocaleString('pt-BR')}</strong>
      </div>
      <div class="stat-box">
        <span class="stat-label">Contador da live</span>
        <strong>${Number(stream.viewerCount || 0).toLocaleString('pt-BR')}</strong>
      </div>
      <div class="stat-box">
        <span class="stat-label">Controle de status</span>
        <strong style="font-size:15px">Manual</strong>
      </div>
    </div>

    <p class="dashboard-note">
      O status da Zytrix continua controlado pelos botões <strong>Iniciar live</strong> e <strong>Encerrar live</strong>.
      A integração Twitch/Kick é usada para reprodução, enquanto “Zytrix agora” mede usuários autenticados ativos na página da live.
    </p>
  `;
}

async function initialize(currentUser) {
  user = currentUser;
  const channelRef = doc(db, 'channels', user.uid);
  const channelSnap = await getDoc(channelRef);
  if (!channelSnap.exists()) return;
  channel = channelSnap.data();

  stream = await findStream(user.uid, channel.currentStreamId);
  if (!stream) return;

  stopFollowers = watchFollowerCount(
    user.uid,
    count => {
      followerCount = count;
      const element = document.querySelector('#dashboard-followers');
      if (element) element.textContent = count.toLocaleString('pt-BR');
    },
    error => console.warn('Não foi possível carregar seguidores no dashboard.', error)
  );

  stopViewers = watchActiveViewers(
    stream.id,
    count => {
      activeViewers = count;
      const element = document.querySelector('#dashboard-viewers');
      if (element) element.textContent = count.toLocaleString('pt-BR');
    },
    error => console.warn('Não foi possível carregar presença no dashboard.', error)
  );

  stopChannel = onSnapshot(channelRef, snap => {
    if (!snap.exists()) return;
    channel = snap.data();
    mountOrRender();
  });

  stopStream = onSnapshot(doc(db, 'streams', stream.id), snap => {
    if (!snap.exists()) return;
    stream = { id: snap.id, ...snap.data() };
    mountOrRender();
  });

  observer?.disconnect();
  observer = new MutationObserver(mountOrRender);
  observer.observe(root, { childList: true });
  mountOrRender();
}

onAuthStateChanged(auth, currentUser => {
  if (currentUser) initialize(currentUser).catch(error => console.warn('Dashboard do streamer indisponível.', error));
});

window.addEventListener('pagehide', () => {
  stopChannel?.();
  stopStream?.();
  stopFollowers?.();
  stopViewers?.();
  observer?.disconnect();
});

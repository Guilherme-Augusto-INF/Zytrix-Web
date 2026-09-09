import {
  auth,
  db,
  onAuthStateChanged,
  collection,
  doc,
  getDoc,
  query,
  orderBy,
  limit,
  onSnapshot
} from './firebase.js';
import { header, footer, escapeHtml, escapeAttr } from './ui.js';
import { getPlatformPreferences, filterMature } from './platform-core.js';

header();
footer();

const root = document.querySelector('#clips-root');
let user = null;
let preferences = { hideMatureContent: false, safeMode: false };
let clips = [];
let stop = null;
const profileCache = new Map();

async function profileFor(uid) {
  if (!uid) return { username: 'Streamer' };
  if (profileCache.has(uid)) return profileCache.get(uid);
  const snap = await getDoc(doc(db, 'profiles', uid)).catch(() => null);
  const profile = snap?.exists?.() ? snap.data() : { username: 'Streamer' };
  profileCache.set(uid, profile);
  return profile;
}

function timeLabel(seconds) {
  const safe = Math.max(0, Math.floor(Number(seconds || 0)));
  return `${Math.floor(safe / 60)}:${String(safe % 60).padStart(2, '0')}`;
}

async function render() {
  const visible = filterMature(clips, preferences);
  if (!visible.length) {
    root.innerHTML = '<div class="state">Nenhum clipe disponível com os seus filtros.</div>';
    return;
  }
  const hydrated = await Promise.all(visible.map(async item => ({ ...item, streamer: await profileFor(item.streamerUid), creator: await profileFor(item.creatorUid) })));
  root.innerHTML = hydrated.map(item => `
    <article class="vertical-clip" id="clip-${escapeAttr(item.id)}">
      <div class="vertical-clip-media">
        ${item.thumbnailURL ? `<img src="${escapeAttr(item.thumbnailURL)}" alt="Thumbnail do clipe" style="width:100%;height:100%;object-fit:cover;max-height:520px">` : '<div><div style="font-size:52px">✂</div><strong>Momento Zytrix</strong></div>'}
      </div>
      <div class="vertical-clip-copy">
        <div class="eyebrow">${item.matureContent ? '18+ · ' : ''}${timeLabel(item.momentSeconds)}</div>
        <h2 style="margin:5px 0">${escapeHtml(item.title || 'Clipe')}</h2>
        <p class="muted">${escapeHtml(item.streamer?.username || 'Streamer')} · marcado por ${escapeHtml(item.creator?.username || 'usuário')}</p>
        <div class="live-interaction-row">
          <a class="btn btn-primary" href="live.html?stream=${encodeURIComponent(item.streamId)}">Abrir transmissão</a>
          ${item.sourceUrl ? `<a class="btn" href="${escapeAttr(item.sourceUrl)}" target="_blank" rel="noopener noreferrer">Abrir origem/VOD</a>` : ''}
          <button class="btn" data-share-clip="${escapeAttr(item.id)}">Compartilhar</button>
        </div>
      </div>
    </article>
  `).join('');
  root.querySelectorAll('[data-share-clip]').forEach(button => button.addEventListener('click', () => shareClip(button.dataset.shareClip)));
  const requested = new URLSearchParams(location.search).get('clip');
  if (requested) setTimeout(() => document.querySelector(`#clip-${CSS.escape(requested)}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 50);
}

async function shareClip(id) {
  const item = clips.find(clip => clip.id === id);
  if (!item) return;
  const url = new URL('clips.html', location.href);
  url.searchParams.set('clip', id);
  const data = { title: item.title || 'Clipe Zytrix', text: `Veja este momento de uma live na Zytrix (${timeLabel(item.momentSeconds)}).`, url: url.toString() };
  try {
    if (navigator.share) await navigator.share(data);
    else {
      await navigator.clipboard.writeText(url.toString());
      alert('Link do clipe copiado.');
    }
  } catch {}
}

onAuthStateChanged(auth, async current => {
  user = current;
  preferences = user ? await getPlatformPreferences(user.uid).catch(() => preferences) : preferences;
  stop?.();
  stop = onSnapshot(query(collection(db, 'clips'), orderBy('createdAt', 'desc'), limit(80)), snap => {
    clips = snap.docs.map(item => ({ id: item.id, ...item.data() }));
    render();
  }, () => { root.innerHTML = '<div class="state">Não foi possível carregar os clipes.</div>'; });
});

window.addEventListener('pagehide', () => stop?.());

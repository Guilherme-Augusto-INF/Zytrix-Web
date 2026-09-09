import {
  auth,
  db,
  onAuthStateChanged,
  collection,
  getDocs,
  getDoc,
  doc,
  query,
  where,
  orderBy,
  limit,
  onSnapshot,
  selectStream
} from './firebase.js';
import { header, footer, liveCard, categories, icons, escapeHtml, escapeAttr } from './ui.js';
import {
  getPlatformPreferences,
  watchFollowedCategories,
  setCategoryFollow,
  recommendationScore,
  filterMature
} from './platform-core.js';

header();
footer();

const root = document.querySelector('#explore-root');
let user = null;
let preferences = { hideMatureContent: false, safeMode: false };
let followedCategories = new Set();
let followingStreamers = new Set();
let recentStreamers = new Set();
let lives = [];
let clips = [];
let schedules = [];
let stopLive = null;
let stopCategories = null;

async function profileFor(uid) {
  try {
    const snap = await getDoc(doc(db, 'profiles', uid));
    return snap.exists() ? snap.data() : { username: 'Streamer', photoURL: '' };
  } catch {
    return { username: 'Streamer', photoURL: '' };
  }
}

async function loadUserContext() {
  followingStreamers = new Set();
  recentStreamers = new Set();
  stopCategories?.();
  stopCategories = null;
  if (!user) {
    followedCategories = new Set();
    preferences = { hideMatureContent: false, safeMode: false };
    return;
  }
  preferences = await getPlatformPreferences(user.uid).catch(() => preferences);
  const [followingSnap, historySnap] = await Promise.all([
    getDocs(collection(db, 'users', user.uid, 'following')).catch(() => null),
    getDocs(collection(db, 'users', user.uid, 'watchHistory')).catch(() => null)
  ]);
  followingStreamers = new Set(followingSnap?.docs?.map(item => item.id) || []);
  recentStreamers = new Set((historySnap?.docs || []).sort((a,b) => (b.data().watchedAt?.seconds || 0) - (a.data().watchedAt?.seconds || 0)).slice(0,10).map(item => item.data().streamerUid || '').filter(Boolean));
  stopCategories = watchFollowedCategories(user.uid, set => {
    followedCategories = set;
    render();
  }, () => {});
}

async function hydrateLives(base) {
  return Promise.all(base.map(async live => {
    const p = await profileFor(live.streamerUid);
    return { ...live, username: p.username || 'Streamer', photoURL: p.photoURL || '' };
  }));
}

async function loadClipsAndSchedule() {
  const [clipSnap, channelSnap] = await Promise.all([
    getDocs(query(collection(db, 'clips'), orderBy('createdAt', 'desc'), limit(12))).catch(() => null),
    getDocs(collection(db, 'channels')).catch(() => null)
  ]);
  const rawClips = clipSnap?.docs?.map(item => ({ id: item.id, ...item.data() })) || [];
  clips = filterMature(rawClips, preferences);

  const channelIds = channelSnap?.docs?.map(item => item.id) || [];
  const agenda = [];
  for (const channelId of channelIds.slice(0, 30)) {
    const snap = await getDocs(query(collection(db, 'channels', channelId, 'schedule'), orderBy('startsAt', 'asc'), limit(3))).catch(() => null);
    if (!snap) continue;
    for (const item of snap.docs) {
      const data = item.data();
      const d = data.startsAt?.toDate?.();
      if (d && d.getTime() > Date.now()) agenda.push({ id: item.id, channelId, ...data });
    }
  }
  schedules = agenda.sort((a,b) => a.startsAt.toDate() - b.startsAt.toDate()).slice(0,8);
}

function categoryId(live) {
  return String(live.categoryId || '').split(' - ')[0].trim();
}

function rankedLives() {
  return filterMature(lives, preferences).sort((a,b) => recommendationScore(b, {
    following: followingStreamers,
    followedCategories,
    recentStreamers,
    hideMatureContent: preferences.hideMatureContent || preferences.safeMode
  }) - recommendationScore(a, {
    following: followingStreamers,
    followedCategories,
    recentStreamers,
    hideMatureContent: preferences.hideMatureContent || preferences.safeMode
  }));
}

function clipCard(item) {
  const time = Math.max(0, Math.floor(Number(item.momentSeconds || 0)));
  const min = Math.floor(time / 60);
  const sec = String(time % 60).padStart(2, '0');
  return `<article class="clip-card" data-clip-id="${escapeAttr(item.id)}">
    <div class="clip-thumb">${item.thumbnailURL ? `<img src="${escapeAttr(item.thumbnailURL)}" alt="">` : '<strong>ZYTRIX CLIP</strong>'}<span class="clip-time">${min}:${sec}</span></div>
    <div class="clip-copy"><h3>${escapeHtml(item.title || 'Clipe')}</h3><span class="muted">Momento salvo de uma transmissão</span></div>
  </article>`;
}

function render() {
  if (!root) return;
  const ranked = rankedLives();
  const following = ranked.filter(item => followingStreamers.has(item.streamerUid));
  const rising = [...ranked].sort((a,b) => Number(b.viewerCount || 0) - Number(a.viewerCount || 0)).slice(0,8);
  const starting = [...ranked].sort((a,b) => {
    const aTime = a.startedAt?.toDate?.()?.getTime?.() || 0;
    const bTime = b.startedAt?.toDate?.()?.getTime?.() || 0;
    return bTime - aTime;
  }).slice(0,8);

  root.innerHTML = `
    <section class="card panel">
      <div class="eyebrow">DESCOBERTA</div>
      <h1>Explorar Zytrix</h1>
      <p class="muted">Recomendações combinam canais seguidos, categorias favoritas, histórico recente e atividade da transmissão. O algoritmo é simples e explicável.</p>
      <div class="explore-controls">
        <input id="explore-search" class="input" placeholder="Buscar streamer, título ou categoria">
        <select id="explore-category" class="input"><option value="">Todas as categorias</option>${Object.keys(categories).map(c => `<option>${escapeHtml(c)}</option>`).join('')}</select>
        ${preferences.hideMatureContent || preferences.safeMode ? '<span class="mature-badge">Conteúdo 18+ oculto</span>' : ''}
      </div>
    </section>

    <section class="section"><div class="section-head"><div><div class="eyebrow">PARA VOCÊ</div><h2>Recomendadas</h2></div></div><div class="grid grid-4" id="recommended-lives">${ranked.slice(0,8).length ? ranked.slice(0,8).map(liveCard).join('') : '<div class="state">Nenhuma live disponível.</div>'}</div></section>

    ${following.length ? `<section class="section"><div class="section-head"><div><div class="eyebrow">SEGUINDO</div><h2>Canais que você acompanha</h2></div></div><div class="grid grid-4">${following.slice(0,8).map(liveCard).join('')}</div></section>` : ''}

    <section class="section"><div class="section-head"><div><div class="eyebrow">EM ALTA</div><h2>Mais movimentadas</h2></div></div><div class="grid grid-4">${rising.length ? rising.map(liveCard).join('') : '<div class="state">Nenhuma live agora.</div>'}</div></section>

    <section class="section"><div class="section-head"><div><div class="eyebrow">COMEÇANDO AGORA</div><h2>Transmissões recentes</h2></div></div><div class="grid grid-4">${starting.length ? starting.map(liveCard).join('') : '<div class="state">Nenhuma live agora.</div>'}</div></section>

    <section class="section"><div class="section-head"><div><div class="eyebrow">CATEGORIAS</div><h2>Siga temas que você gosta</h2></div></div><div class="grid grid-4">${Object.keys(categories).map(c => `<article class="card panel"><div style="font-size:26px">${icons[c]}</div><strong>${escapeHtml(c)}</strong><p class="muted">${followedCategories.has(c) ? 'Você recebe mais recomendações desta categoria.' : 'Use esta categoria para personalizar a descoberta.'}</p><div class="live-interaction-row"><a class="btn" href="categoria.html?categoria=${encodeURIComponent(c)}">Abrir</a>${user ? `<button class="btn follow-category-button ${followedCategories.has(c) ? 'is-following' : ''}" data-follow-category="${escapeAttr(c)}">${followedCategories.has(c) ? 'Seguindo ✓' : 'Seguir'}</button>` : ''}</div></article>`).join('')}</div></section>

    <section class="section"><div class="section-head"><div><div class="eyebrow">CLIPES</div><h2>Momentos da comunidade</h2></div><a class="muted" href="clips.html">Ver feed vertical →</a></div><div class="clip-grid">${clips.slice(0,6).length ? clips.slice(0,6).map(clipCard).join('') : '<div class="state">Nenhum clipe criado ainda.</div>'}</div></section>

    <section class="section"><div class="section-head"><div><div class="eyebrow">AGENDA</div><h2>Próximas transmissões</h2></div></div><div class="schedule-list">${schedules.length ? schedules.map(item => `<article class="schedule-card"><time>${item.startsAt.toDate().toLocaleString('pt-BR', { dateStyle: 'medium', timeStyle: 'short' })}</time><strong>${escapeHtml(item.title || 'Live')}</strong><span class="muted">Canal ${escapeHtml(item.channelId)}</span></article>`).join('') : '<div class="state">Nenhuma transmissão agendada.</div>'}</div></section>
  `;
  bindCards();
  bindControls();
}

function bindCards() {
  document.querySelectorAll('.live-card').forEach(card => card.addEventListener('click', () => {
    const live = lives.find(item => item.id === card.dataset.liveId);
    if (!live) return;
    selectStream(live);
    location.href = `live.html?stream=${encodeURIComponent(live.id)}`;
  }));
  document.querySelectorAll('[data-clip-id]').forEach(card => card.addEventListener('click', () => {
    const item = clips.find(clip => clip.id === card.dataset.clipId);
    if (!item) return;
    location.href = `clips.html?clip=${encodeURIComponent(item.id)}`;
  }));
  document.querySelectorAll('[data-follow-category]').forEach(button => button.addEventListener('click', async () => {
    const category = button.dataset.followCategory;
    await setCategoryFollow(user.uid, category, !followedCategories.has(category));
  }));
}

function bindControls() {
  const search = document.querySelector('#explore-search');
  const category = document.querySelector('#explore-category');
  const apply = () => {
    const text = String(search.value || '').trim().toLowerCase();
    const cat = category.value;
    document.querySelectorAll('#recommended-lives .live-card').forEach(card => {
      const live = lives.find(item => item.id === card.dataset.liveId);
      const haystack = `${live?.username || ''} ${live?.title || ''} ${live?.categoryId || ''}`.toLowerCase();
      card.style.display = (!text || haystack.includes(text)) && (!cat || categoryId(live) === cat) ? '' : 'none';
    });
  };
  search?.addEventListener('input', apply);
  category?.addEventListener('change', apply);
}

async function initializeLives() {
  stopLive?.();
  stopLive = onSnapshot(query(collection(db, 'streams'), where('status', '==', 'live')), async snap => {
    const base = snap.docs.map(item => ({ id: item.id, ...item.data(), viewerCount: Math.max(0, Number(item.data().viewerCount || 0)) }));
    lives = await hydrateLives(base);
    render();
  }, () => { root.innerHTML = '<div class="state">Não foi possível carregar a descoberta.</div>'; });
}

onAuthStateChanged(auth, async current => {
  user = current;
  await loadUserContext();
  await loadClipsAndSchedule();
  await initializeLives();
  render();
});

window.addEventListener('pagehide', () => { stopLive?.(); stopCategories?.(); });

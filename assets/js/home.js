import {
  auth,
  db,
  onAuthStateChanged,
  collection,
  query,
  where,
  onSnapshot,
  getDocs,
  getProfile,
  selectStream
} from './firebase.js';
import { header, footer, liveCard, categories, icons, escapeHtml } from './ui.js';
import {
  getPlatformPreferences,
  watchFollowedCategories,
  recommendationScore,
  filterMature
} from './platform-core.js';

header('inicio');
footer();

const featured = document.querySelector('#featured');
const liveNow = document.querySelector('#live-now');
const cats = document.querySelector('#home-categories');
let user = null;
let preferences = { hideMatureContent:false, safeMode:false };
let following = new Set();
let followedCategories = new Set();
let recentStreamers = new Set();
let lives = [];
let stopLive = null;
let stopCategories = null;

cats.innerHTML = Object.keys(categories).map(c => `<a class="card category-card" href="categoria.html?categoria=${encodeURIComponent(c)}"><span class="category-icon">${icons[c]}</span><div><strong>${c}</strong><div class="muted" style="font-size:11px;margin-top:4px">Explorar conteúdo</div></div><span class="arrow">→</span></a>`).join('');

function ensurePersonalizedSection() {
  let section = document.querySelector('#personalized-home');
  if (section) return section;
  const hero = document.querySelector('.hero');
  section = document.createElement('section');
  section.id = 'personalized-home';
  section.className = 'section';
  hero?.parentElement?.insertBefore(section, hero.nextElementSibling);
  return section;
}

async function loadContext() {
  following = new Set();
  recentStreamers = new Set();
  stopCategories?.();
  stopCategories = null;
  if (!user) {
    preferences = { hideMatureContent:false, safeMode:false };
    followedCategories = new Set();
    return;
  }
  preferences = await getPlatformPreferences(user.uid).catch(() => preferences);
  const [followingSnap, historySnap] = await Promise.all([
    getDocs(collection(db, 'users', user.uid, 'following')).catch(() => null),
    getDocs(collection(db, 'users', user.uid, 'watchHistory')).catch(() => null)
  ]);
  following = new Set(followingSnap?.docs?.map(item => item.id) || []);
  const history = historySnap?.docs?.map(item => item.data()) || [];
  history.sort((a,b) => (b.watchedAt?.seconds || 0) - (a.watchedAt?.seconds || 0));
  recentStreamers = new Set(history.slice(0,12).map(item => item.streamerUid).filter(Boolean));
  stopCategories = watchFollowedCategories(user.uid, value => {
    followedCategories = value;
    renderLives();
  }, () => {});
}

function score(item) {
  return recommendationScore(item, {
    following,
    followedCategories,
    recentStreamers,
    hideMatureContent: preferences.hideMatureContent || preferences.safeMode
  });
}

function renderLives() {
  const visible = filterMature(lives, preferences);
  const recommended = [...visible].sort((a,b) => score(b) - score(a));
  const trending = [...visible].sort((a,b) => Number(b.viewerCount || 0) - Number(a.viewerCount || 0));

  featured.innerHTML = recommended.slice(0,3).length
    ? recommended.slice(0,3).map(liveCard).join('')
    : '<div class="state">Nenhuma live em destaque.</div>';
  liveNow.innerHTML = trending.slice(0,4).length
    ? trending.slice(0,4).map(liveCard).join('')
    : '<div class="state">Nenhuma live agora.</div>';

  const personal = ensurePersonalizedSection();
  if (user) {
    const followedLives = recommended.filter(item => following.has(item.streamerUid)).slice(0,4);
    const recentLives = recommended.filter(item => recentStreamers.has(item.streamerUid) && !following.has(item.streamerUid)).slice(0,4);
    personal.innerHTML = `
      <div class="section-head"><div><div class="eyebrow">PARA VOCÊ</div><h2>Sua Zytrix</h2></div><a class="muted" href="explorar.html">Abrir Explorar →</a></div>
      ${followedLives.length ? `<h3>Canais que você segue</h3><div class="grid grid-4">${followedLives.map(liveCard).join('')}</div>` : ''}
      ${recentLives.length ? `<h3 style="margin-top:18px">Continuar explorando</h3><div class="grid grid-4">${recentLives.map(liveCard).join('')}</div>` : ''}
      ${!followedLives.length && !recentLives.length ? '<div class="card panel"><strong>Personalize sua Home</strong><p class="muted">Siga streamers e categorias para a Zytrix ordenar melhor suas recomendações.</p><a class="btn" href="explorar.html">Explorar agora</a></div>' : ''}
    `;
  } else {
    personal.innerHTML = `<div class="card panel"><div class="eyebrow">PERSONALIZAÇÃO</div><h2>Uma Home que aprende com suas escolhas</h2><p class="muted">Entre na sua conta para priorizar canais seguidos, categorias favoritas e conteúdos recentes.</p><a class="btn btn-primary" href="login.html">Entrar</a></div>`;
  }
  bindCards();
}

function bindCards() {
  document.querySelectorAll('.live-card').forEach(card => card.addEventListener('click', () => {
    const live = lives.find(item => item.id === card.dataset.liveId);
    if (!live) return;
    selectStream(live);
    location.href = `live.html?stream=${encodeURIComponent(live.id)}`;
  }));
}

function startLives() {
  stopLive?.();
  stopLive = onSnapshot(query(collection(db, 'streams'), where('status', '==', 'live')), async snap => {
    const base = snap.docs.map(d => ({ id: d.id, ...d.data(), viewerCount: Math.max(0, Number(d.data().viewerCount || 0)) }));
    lives = await Promise.all(base.map(async item => {
      const p = await getProfile(item.streamerUid).catch(() => null);
      return { ...item, username: p?.username || 'Streamer', photoURL: p?.photoURL || '' };
    }));
    renderLives();
  }, () => { featured.innerHTML = '<div class="state">Não foi possível carregar as lives.</div>'; });
}

onAuthStateChanged(auth, async current => {
  user = current;
  await loadContext();
  startLives();
  renderLives();
});

window.addEventListener('pagehide', () => { stopLive?.(); stopCategories?.(); });

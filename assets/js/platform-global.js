import { auth, db, onAuthStateChanged, doc, getDoc } from './firebase.js';
import { watchProgress, levelFromXp } from './platform-core.js';

let stopProgress = null;

function ensureStylesheet() {
  if (document.querySelector('link[data-zytrix-platform-style]')) return;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = 'assets/css/platform.css';
  link.dataset.zytrixPlatformStyle = 'true';
  document.head.appendChild(link);
}

function addPrimaryNavigation() {
  const nav = document.querySelector('.nav-links');
  if (!nav) return false;
  if (!nav.querySelector('[data-platform-nav="explore"]')) {
    const explore = document.createElement('a');
    explore.href = 'explorar.html';
    explore.dataset.platformNav = 'explore';
    explore.textContent = 'Explorar';
    nav.insertBefore(explore, nav.querySelector('a[href="sobre.html"]') || null);
  }
  if (!nav.querySelector('[data-platform-nav="clips"]')) {
    const clips = document.createElement('a');
    clips.href = 'clips.html';
    clips.dataset.platformNav = 'clips';
    clips.textContent = 'Clipes';
    nav.insertBefore(clips, nav.querySelector('a[href="sobre.html"]') || null);
  }
  return true;
}

function addFooterNavigation() {
  const top = document.querySelector('.footer-links');
  if (top) {
    [['Explorar','explorar.html','explore'],['Clipes','clips.html','clips'],['Status','status.html','status'],['Roadmap','roadmap.html','roadmap']].forEach(([label, href, key]) => {
      if (top.querySelector(`[data-platform-footer="${key}"]`)) return;
      const link = document.createElement('a');
      link.href = href;
      link.textContent = label;
      link.dataset.platformFooter = key;
      top.appendChild(link);
    });
  }
  return Boolean(top);
}

async function addCreatorCenter(uid) {
  const actions = document.querySelector('.nav-actions');
  if (!actions || document.querySelector('#creator-center-nav')) return;
  try {
    const channel = await getDoc(doc(db, 'channels', uid));
    if (!channel.exists()) return;
    const link = document.createElement('a');
    link.id = 'creator-center-nav';
    link.className = 'btn btn-ghost creator-center-nav';
    link.href = 'creator-center.html';
    link.textContent = 'Criador';
    const profile = document.querySelector('#profile-nav');
    actions.insertBefore(link, profile || null);
  } catch (error) {
    console.warn('Centro do Criador indisponível.', error);
  }
}

function addLevelChip(uid) {
  stopProgress?.();
  stopProgress = watchProgress(uid, progress => {
    const actions = document.querySelector('.nav-actions');
    if (!actions) return;
    let chip = document.querySelector('#zytrix-level-chip');
    if (!chip) {
      chip = document.createElement('a');
      chip.id = 'zytrix-level-chip';
      chip.className = 'zy-level-chip';
      chip.href = 'perfil.html#progresso';
      chip.title = 'Seu nível na Zytrix';
      actions.insertBefore(chip, document.querySelector('#profile-nav') || null);
    }
    const level = levelFromXp(progress?.xp || 0);
    chip.textContent = `Nv. ${level.level}`;
    chip.setAttribute('aria-label', `Nível ${level.level}: ${level.label}`);
  }, () => {});
}

function applyMiniMode() {
  const params = new URLSearchParams(location.search);
  if (params.get('mini') !== '1') return;
  document.documentElement.classList.add('zytrix-mini-mode');
  document.body.classList.add('zytrix-mini-mode');
  document.title = `Mini player — ${document.title}`;
}

function waitForLayout() {
  const attempt = () => {
    const headerReady = addPrimaryNavigation();
    const footerReady = addFooterNavigation();
    return headerReady && footerReady;
  };
  if (attempt()) return;
  const observer = new MutationObserver(() => {
    if (attempt()) observer.disconnect();
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });
  setTimeout(() => observer.disconnect(), 6000);
}

ensureStylesheet();
applyMiniMode();
waitForLayout();

onAuthStateChanged(auth, user => {
  stopProgress?.();
  stopProgress = null;
  document.querySelector('#creator-center-nav')?.remove();
  document.querySelector('#zytrix-level-chip')?.remove();
  if (!user) return;
  addCreatorCenter(user.uid);
  addLevelChip(user.uid);
});

window.addEventListener('pagehide', () => stopProgress?.());

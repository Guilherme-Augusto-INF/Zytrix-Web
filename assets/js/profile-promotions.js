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
  setDoc,
  runTransaction,
  serverTimestamp,
  ensureWallet
} from './firebase.js';
import { escapeHtml, escapeAttr } from './ui.js';

const root = document.querySelector('#profile-root');
let user = null;
let observer = null;
let promotions = [];
let claimed = new Set();

function tsMs(value) {
  return value?.toDate?.()?.getTime?.() || 0;
}

async function load() {
  if (!user || !root) return;
  const snap = await getDocs(collection(db, 'coinPromotions')).catch(() => null);
  const now = Date.now();
  promotions = (snap?.docs || []).map(item => ({ id: item.id, ...item.data() })).filter(item => item.active === true && (!tsMs(item.startsAt) || tsMs(item.startsAt) <= now) && (!tsMs(item.endsAt) || tsMs(item.endsAt) >= now));
  claimed = new Set();
  await Promise.all(promotions.map(async item => {
    const claim = await getDoc(doc(db, 'coinPromotions', item.id, 'claims', user.uid)).catch(() => null);
    if (claim?.exists?.()) claimed.add(item.id);
  }));
  mount();
}

function mount() {
  const plus = root.querySelector('#profile-plus');
  if (!plus || !user) return;
  plus.querySelector('#profile-promotions')?.remove();
  const section = document.createElement('div');
  section.id = 'profile-promotions';
  section.className = 'card panel';
  section.innerHTML = `
    <div class="eyebrow">EVENTOS E BÔNUS</div>
    <h2>Zy Coins promocionais</h2>
    <p class="muted">Promoções são criadas pela administração e cada conta só pode resgatar uma vez por evento. O limite total também é controlado no mesmo fluxo atômico.</p>
    <div class="reward-grid">
      ${promotions.length ? promotions.map(item => `<article class="reward-card"><strong>${escapeHtml(item.title || 'Evento Zytrix')}</strong><span class="muted">${escapeHtml(item.description || '')}</span><span class="reward-cost">+ ◈ ${Number(item.amount || 0).toLocaleString('pt-BR')}</span><button class="btn ${claimed.has(item.id) ? '' : 'btn-primary'}" data-claim-promo="${escapeAttr(item.id)}" ${claimed.has(item.id) ? 'disabled' : ''}>${claimed.has(item.id) ? 'Resgatado ✓' : 'Resgatar'}</button></article>`).join('') : '<div class="state">Nenhum evento ativo no momento.</div>'}
    </div>
    <div id="promo-feedback"></div>
  `;
  plus.appendChild(section);
  section.querySelectorAll('[data-claim-promo]').forEach(button => button.addEventListener('click', () => claimPromotion(button.dataset.claimPromo)));
}

function feedback(text, error = false) {
  const el = document.querySelector('#promo-feedback');
  if (el) el.innerHTML = `<div class="message ${error ? 'err' : 'ok'}">${escapeHtml(text)}</div>`;
}

async function claimPromotion(promotionId) {
  alert('Resgates promocionais estão temporariamente pausados enquanto a emissão de Zy Coins migra para o backend seguro.');
}

function tryMount() {
  if (root?.querySelector('#profile-plus')) mount();
}

onAuthStateChanged(auth, current => {
  user = current;
  if (user) load();
});

if (root) {
  observer = new MutationObserver(tryMount);
  observer.observe(root, { childList: true, subtree: false });
}

window.addEventListener('pagehide', () => observer?.disconnect());

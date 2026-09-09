import {
  auth,
  db,
  onAuthStateChanged,
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  updateDoc,
  serverTimestamp
} from './firebase.js';
import { escapeHtml, escapeAttr } from './ui.js';

const root = document.querySelector('#admin-root');
let user = null;
let promotions = [];
let observer = null;

async function isAdmin(uid) {
  const snap = await getDoc(doc(db, 'admins', uid)).catch(() => null);
  return snap?.exists?.() && snap.data().active === true;
}

async function loadPromotions() {
  const snap = await getDocs(collection(db, 'coinPromotions'));
  promotions = snap.docs.map(item => ({ id: item.id, ...item.data() }));
  mount();
}

function localDate(value) {
  const d = value?.toDate?.();
  return d ? d.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : '—';
}

function mount() {
  if (!root || !user) return;
  root.querySelector('#admin-promotions')?.remove();
  const section = document.createElement('section');
  section.id = 'admin-promotions';
  section.className = 'card panel';
  section.style.marginTop = '18px';
  section.innerHTML = `
    <div class="eyebrow">EVENTOS DE ZY COINS</div>
    <h2>Promoções controladas</h2>
    <p class="muted">Cada promoção tem limite por conta e limite total. O resgate altera promoção, claim, carteira e transação no mesmo fluxo atômico.</p>
    <div class="creator-grid">
      <label>Título<input id="promo-title" class="input" maxlength="60" placeholder="Evento Zytrix"></label>
      <label>Zy Coins<input id="promo-amount" class="input" type="number" min="1" max="10000" value="100"></label>
      <label>Máximo de resgates<input id="promo-max" class="input" type="number" min="1" max="100000" value="100"></label>
      <label>Descrição<input id="promo-description" class="input" maxlength="160" placeholder="Motivo do bônus"></label>
      <label>Início<input id="promo-start" class="input" type="datetime-local"></label>
      <label>Fim<input id="promo-end" class="input" type="datetime-local"></label>
    </div>
    <button id="create-promotion" class="btn btn-primary" style="margin-top:12px">Criar evento</button>
    <div id="admin-promo-feedback"></div>
    <div class="reward-list" style="margin-top:14px">
      ${promotions.length ? promotions.map(item => `<article class="reward-card"><strong>${escapeHtml(item.title || 'Promoção')}</strong><span class="muted">${escapeHtml(item.description || '')}</span><span>+ ◈ ${Number(item.amount || 0).toLocaleString('pt-BR')} · ${Number(item.claimCount || 0)}/${Number(item.maxClaims || 0)} resgates</span><span class="muted">${localDate(item.startsAt)} → ${localDate(item.endsAt)}</span><button class="btn ${item.active ? 'btn-danger' : ''}" data-toggle-promo="${escapeAttr(item.id)}">${item.active ? 'Desativar' : 'Ativar'}</button></article>`).join('') : '<span class="muted">Nenhuma promoção criada.</span>'}
    </div>
  `;
  root.appendChild(section);
  section.querySelector('#create-promotion')?.addEventListener('click', createPromotion);
  section.querySelectorAll('[data-toggle-promo]').forEach(button => button.addEventListener('click', () => togglePromotion(button.dataset.togglePromo)));
}

function feedback(text, error = false) {
  const el = document.querySelector('#admin-promo-feedback');
  if (el) el.innerHTML = `<div class="message ${error ? 'err' : 'ok'}">${escapeHtml(text)}</div>`;
}

async function createPromotion() {
  const title = document.querySelector('#promo-title').value.trim().slice(0,60);
  const description = document.querySelector('#promo-description').value.trim().slice(0,160);
  const amount = Math.floor(Number(document.querySelector('#promo-amount').value || 0));
  const maxClaims = Math.floor(Number(document.querySelector('#promo-max').value || 0));
  const startRaw = document.querySelector('#promo-start').value;
  const endRaw = document.querySelector('#promo-end').value;
  const startsAt = startRaw ? new Date(startRaw) : new Date();
  const endsAt = endRaw ? new Date(endRaw) : new Date(Date.now() + 7 * 86400000);
  if (!title || amount < 1 || amount > 10000 || maxClaims < 1 || maxClaims > 100000 || !Number.isFinite(startsAt.getTime()) || !Number.isFinite(endsAt.getTime()) || endsAt <= startsAt) {
    feedback('Revise título, valores e período da promoção.', true);
    return;
  }
  try {
    const ref = doc(collection(db, 'coinPromotions'));
    await setDoc(ref, {
      promotionId: ref.id,
      title,
      description,
      amount,
      maxClaims,
      claimCount: 0,
      active: true,
      startsAt,
      endsAt,
      createdBy: user.uid,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    });
    feedback('Evento criado.');
    await loadPromotions();
  } catch (error) {
    console.error(error);
    feedback('Não foi possível criar a promoção.', true);
  }
}

async function togglePromotion(id) {
  const item = promotions.find(p => p.id === id);
  if (!item) return;
  try {
    await updateDoc(doc(db, 'coinPromotions', id), { active: !item.active, updatedAt: serverTimestamp() });
    await loadPromotions();
  } catch (error) {
    feedback('Não foi possível alterar a promoção.', true);
  }
}

function tryMount() {
  if (!root || !user) return;
  if (root.querySelector('#admin-promotions')) return;
  if (root.querySelector('.state')) return;
  mount();
}

onAuthStateChanged(auth, async current => {
  user = current;
  if (!user || !(await isAdmin(user.uid))) return;
  await loadPromotions();
});

if (root) {
  observer = new MutationObserver(tryMount);
  observer.observe(root, { childList: true, subtree: false });
}

window.addEventListener('pagehide', () => observer?.disconnect());

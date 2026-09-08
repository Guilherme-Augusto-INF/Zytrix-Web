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
  const promo = promotions.find(item => item.id === promotionId);
  if (!promo || claimed.has(promotionId)) return;
  try {
    await ensureWallet(user.uid);
    const promoRef = doc(db, 'coinPromotions', promotionId);
    const claimRef = doc(db, 'coinPromotions', promotionId, 'claims', user.uid);
    const walletRef = doc(db, 'wallets', user.uid);
    const txRef = doc(collection(db, 'zyCoinTransactions'));

    await runTransaction(db, async tx => {
      const [promoSnap, claimSnap, walletSnap] = await Promise.all([tx.get(promoRef), tx.get(claimRef), tx.get(walletRef)]);
      if (!promoSnap.exists() || promoSnap.data().active !== true) throw new Error('promo-unavailable');
      if (claimSnap.exists()) throw new Error('already-claimed');
      if (!walletSnap.exists()) throw new Error('wallet-missing');
      const data = promoSnap.data();
      const amount = Number(data.amount || 0);
      const maxClaims = Math.max(1, Number(data.maxClaims || 1));
      const claimCount = Math.max(0, Number(data.claimCount || 0));
      const now = Date.now();
      if (!Number.isInteger(amount) || amount < 1 || amount > 10000 || claimCount >= maxClaims) throw new Error('promo-unavailable');
      if (data.startsAt?.toDate?.() && data.startsAt.toDate().getTime() > now) throw new Error('promo-unavailable');
      if (data.endsAt?.toDate?.() && data.endsAt.toDate().getTime() < now) throw new Error('promo-unavailable');
      const wallet = walletSnap.data();
      tx.update(promoRef, { claimCount: claimCount + 1, updatedAt: serverTimestamp() });
      tx.update(walletRef, { balance: Number(wallet.balance || 0) + amount, lastTransactionId: txRef.id, updatedAt: serverTimestamp() });
      tx.set(claimRef, { uid: user.uid, promotionId, amount, transactionId: txRef.id, createdAt: serverTimestamp() });
      tx.set(txRef, { transactionId: txRef.id, fromUid: 'zytrix', toUid: user.uid, amount, promotionId, type: 'promotion_claim', status: 'completed', createdAt: serverTimestamp() });
    });
    claimed.add(promotionId);
    feedback(`Você recebeu ◈ ${Number(promo.amount || 0).toLocaleString('pt-BR')} Zy Coins.`);
    mount();
  } catch (error) {
    console.error(error);
    feedback(error?.message === 'already-claimed' ? 'Você já resgatou este evento.' : 'Não foi possível resgatar a promoção.', true);
  }
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
  observer.observe(root, { childList: true, subtree: true });
}

window.addEventListener('pagehide', () => observer?.disconnect());

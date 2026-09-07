import { auth, onAuthStateChanged, db, doc, onSnapshot, ensureWallet } from './firebase.js';
import { header, footer } from './ui.js';
header();
footer();
const packages = [{ id: 'zy100', coins: 100, priceCents: 490 }, { id: 'zy500', coins: 500, priceCents: 1490 }, { id: 'zy1200', coins: 1200, priceCents: 2990 }, { id: 'zy2500', coins: 2500, priceCents: 4990 }];
const grid = document.querySelector('#packages');
const balance = document.querySelector('#shop-balance');
let user = null;
grid.innerHTML = packages.map(p => `<div class="card package"><div class="eyebrow">Pacote</div><div class="coins">◈ ${p.coins.toLocaleString('pt-BR')}</div><div class="price">R$ ${(p.priceCents / 100).toFixed(2).replace('.', ',')}</div><button class="btn btn-primary" data-package="${p.id}">Selecionar</button></div>`).join('');
grid.onclick = e => { const b = e.target.closest('[data-package]'); if (!b)
    return; const p = packages.find(x => x.id === b.dataset.package); localStorage.setItem('zytrixSelectedCoinPackage', JSON.stringify(p)); location.href = 'pagamento.html'; };
onAuthStateChanged(auth, async (u) => { user = u; if (!u) {
    balance.textContent = 'Entre para ver seu saldo';
    return;
} try {
    await ensureWallet(u.uid);
    onSnapshot(doc(db, 'wallets', u.uid), s => balance.textContent = s.exists() ? `◈ ${Number(s.data().balance || 0).toLocaleString('pt-BR')}` : '◈ 0');
}
catch {
    balance.textContent = 'Saldo indisponível';
} });

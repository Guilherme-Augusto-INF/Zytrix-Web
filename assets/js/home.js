import { db, collection, query, where, onSnapshot, getProfile, selectStream } from './firebase.js';
import { header, footer, liveCard, categories, icons } from './ui.js';
header('inicio');
footer();
const featured = document.querySelector('#featured');
const liveNow = document.querySelector('#live-now');
const cats = document.querySelector('#home-categories');
cats.innerHTML = Object.keys(categories).map(c => `<a class="card category-card" href="categoria.html?categoria=${encodeURIComponent(c)}"><span class="category-icon">${icons[c]}</span><div><strong>${c}</strong><div class="muted" style="font-size:11px;margin-top:4px">Explorar conteúdo</div></div><span class="arrow">→</span></a>`).join('');
const q = query(collection(db, 'streams'), where('status', '==', 'live'));
onSnapshot(q, async (snap) => {
    const base = snap.docs.map(d => ({ id: d.id, ...d.data(), viewerCount: Math.max(0, Number(d.data().viewerCount || 0)) })).sort((a, b) => b.viewerCount - a.viewerCount);
    const lives = await Promise.all(base.map(async (l) => { const p = await getProfile(l.streamerUid).catch(() => null); return { ...l, username: p?.username || 'Streamer', photoURL: p?.photoURL || '' }; }));
    featured.innerHTML = lives.slice(0, 3).length ? lives.slice(0, 3).map(liveCard).join('') : '<div class="state">Nenhuma live em destaque.</div>';
    liveNow.innerHTML = lives.slice(3, 7).length ? lives.slice(3, 7).map(liveCard).join('') : '<div class="state">Nenhuma outra live agora.</div>';
    document.querySelectorAll('.live-card').forEach(card => card.addEventListener('click', () => { const live = lives.find(x => x.id === card.dataset.liveId); if (live) {
        selectStream(live);
        location.href = 'live.html';
    } }));
}, () => { featured.innerHTML = '<div class="state">Não foi possível carregar as lives.</div>'; });

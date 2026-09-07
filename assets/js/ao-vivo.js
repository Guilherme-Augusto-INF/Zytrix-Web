import { db, collection, query, where, onSnapshot, getProfile, selectStream, normalize, mainCategory } from './firebase.js';
import { header, footer, liveCard, icons } from './ui.js';
header('ao-vivo');
footer();
let lives = [];
let filter = 'todos';
let search = '';
const grid = document.querySelector('#lives-grid');
const filters = document.querySelector('#filters');
const names = ['todos', 'Gaming', 'Música', 'Just Chatting', 'Criatividade', 'Esportes', 'Tecnologia', 'Podcasts', 'IRL'];
filters.innerHTML = names.map(n => `<button class="filter ${n === 'todos' ? 'active' : ''}" data-filter="${n}">${n === 'todos' ? 'Todos' : icons[n] + ' ' + n}</button>`).join('');
filters.addEventListener('click', e => { const b = e.target.closest('[data-filter]'); if (!b)
    return; filter = b.dataset.filter; filters.querySelectorAll('.filter').forEach(x => x.classList.toggle('active', x === b)); render(); });
document.querySelector('#search').addEventListener('input', e => { search = e.target.value; render(); });
function render() { const term = normalize(search); const list = lives.filter(l => { if (filter !== 'todos' && mainCategory(l.categoryId) !== filter)
    return false; if (!term)
    return true; return normalize([l.username, l.title, l.description, l.categoryId].join(' ')).includes(term); }); grid.innerHTML = list.length ? list.map(liveCard).join('') : '<div class="state">Nenhuma transmissão encontrada.</div>'; grid.querySelectorAll('.live-card').forEach(card => card.addEventListener('click', () => { const l = lives.find(x => x.id === card.dataset.liveId); selectStream(l); location.href = 'live.html'; })); }
onSnapshot(query(collection(db, 'streams'), where('status', '==', 'live')), async (snap) => { const base = snap.docs.map(d => ({ id: d.id, ...d.data(), viewerCount: Math.max(0, Number(d.data().viewerCount || 0)) })).sort((a, b) => b.viewerCount - a.viewerCount); lives = await Promise.all(base.map(async (l) => { const p = await getProfile(l.streamerUid).catch(() => null); return { ...l, username: p?.username || 'Streamer', photoURL: p?.photoURL || '' }; })); render(); }, () => grid.innerHTML = '<div class="state">Erro ao carregar transmissões.</div>');

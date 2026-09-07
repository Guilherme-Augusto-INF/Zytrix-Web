import { header, footer, categories, icons } from './ui.js';
header('categorias');
footer();
const grid = document.querySelector('#categories-grid');
grid.innerHTML = Object.entries(categories).map(([c, subs]) => `<a class="card category-card" href="categoria.html?categoria=${encodeURIComponent(c)}"><span class="category-icon">${icons[c]}</span><div><strong>${c}</strong><div class="muted" style="font-size:11px;margin-top:4px">${subs.length} subcategorias</div></div><span class="arrow">→</span></a>`).join('');

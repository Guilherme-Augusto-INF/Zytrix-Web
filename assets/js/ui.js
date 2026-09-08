import { auth, onAuthStateChanged } from './firebase.js';
import { parseStreamingSource, streamingPlatformLabel } from './streaming.js';

export function header(active = '') {
    const element = document.querySelector('[data-header]');
    if (!element) return;

    element.innerHTML = `
    <header class="site-header">
      <div class="container nav">
        <a class="brand" href="index.html" aria-label="Zytrix - Início">
          <span class="brand-mark">Z</span>
          <span>Zytrix</span>
        </a>

        <nav class="nav-links" aria-label="Navegação principal">
          <a class="${active === 'inicio' ? 'active' : ''}" href="index.html">Início</a>
          <a class="${active === 'categorias' ? 'active' : ''}" href="categorias.html">Categorias</a>
          <a class="${active === 'ao-vivo' ? 'active' : ''}" href="ao-vivo.html">Ao Vivo</a>
          <a class="${active === 'sobre' ? 'active' : ''}" href="sobre.html">Sobre</a>
        </nav>

        <div class="nav-actions">
          <a class="icon-link" title="Zy Coins" aria-label="Abrir loja de Zy Coins" href="loja.html">◈</a>

          <div id="guest-nav" class="guest-nav">
            <a class="btn btn-ghost" href="login.html">Entrar</a>
            <a class="btn btn-primary" href="registro.html">Registrar</a>
          </div>

          <a id="profile-nav" class="btn btn-primary hidden" href="perfil.html">Perfil</a>
        </div>
      </div>
    </header>
  `;

    onAuthStateChanged(auth, user => {
        const guest = document.querySelector('#guest-nav');
        const profile = document.querySelector('#profile-nav');
        if (!guest || !profile) return;

        if (user) {
            guest.classList.add('hidden');
            profile.classList.remove('hidden');
        } else {
            guest.classList.remove('hidden');
            profile.classList.add('hidden');
        }
    });
}

export function footer() {
    const element = document.querySelector('[data-footer]');
    if (!element) return;

    element.innerHTML = `
    <footer class="site-footer">
      <div class="container footer-inner">
        <a class="brand" href="index.html">
          <span class="brand-mark">Z</span>
          <span>Zytrix</span>
        </a>

        <span>© 2026 Zytrix. Todos os direitos reservados.</span>

        <div class="footer-links">
          <a href="recursos.html">Recursos</a>
          <a href="faq.html">FAQ</a>
          <a href="sobre.html">Sobre</a>
        </div>
      </div>
    </footer>
  `;
}

export function liveCard(live) {
    const initial = (live.username || 'S').charAt(0).toUpperCase();
    const source = parseStreamingSource(live.playbackURL || '');
    const platform = source ? streamingPlatformLabel(source.platform) : '';

    return `
    <article class="card live-card" data-live-id="${escapeAttr(live.id)}">
      <div class="thumb">
        ${live.thumbnailURL
        ? `<img src="${escapeAttr(live.thumbnailURL)}" alt="Thumbnail de ${escapeAttr(live.username || 'streamer')}">`
        : '<div class="state">ZYTRIX</div>'}

        <span class="badge">● AO VIVO</span>

        ${source
        ? `<span class="platform-badge platform-${source.platform} card-platform">${escapeHtml(platform)}</span>`
        : ''}

        <span class="viewers">👁 ${Number(live.viewerCount || 0).toLocaleString('pt-BR')}</span>
        <span class="play">▶</span>
      </div>

      <div class="live-meta">
        ${live.photoURL
        ? `<img class="avatar" src="${escapeAttr(live.photoURL)}" alt="Foto de ${escapeAttr(live.username || 'streamer')}">`
        : `<span class="avatar">${escapeHtml(initial)}</span>`}

        <div>
          <div class="live-title">${escapeHtml(live.username || 'Streamer')}</div>
          <div class="live-sub">${escapeHtml(live.title || 'Transmissão ao vivo')}</div>
          <div class="live-cat">${escapeHtml(live.categoryId || '')}</div>
        </div>
      </div>
    </article>
  `;
}

export function escapeHtml(value = '') {
    return String(value).replace(/[&<>'"]/g, character => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        "'": '&#039;',
        '"': '&quot;'
    })[character]);
}

export function escapeAttr(value = '') {
    return escapeHtml(value);
}

export const categories = {
    Gaming: ['Ação / Aventura', 'RPG', 'Esportes', 'Simulação'],
    Música: ['Rock', 'Sertanejo', 'Eletrônica', 'Funk'],
    'Just Chatting': ['Bate-Papo', 'Perguntas e Respostas', 'Histórias', 'Desafios'],
    Criatividade: ['Desenho', 'Design', 'Fotografia', 'Edição'],
    Esportes: ['Futebol', 'Basquete', 'Automobilismo', 'Lutas'],
    Tecnologia: ['Programação', 'Hardware', 'Inteligência Artificial', 'Ciência e Tech'],
    Podcasts: ['Conversas', 'Entrevistas', 'Notícias', 'Entretenimento'],
    IRL: ['Viagens', 'Eventos', 'Vida Cotidiana', 'Exploração']
};

export const icons = {
    Gaming: '🎮',
    Música: '🎵',
    'Just Chatting': '🎙️',
    Criatividade: '🎨',
    Esportes: '⚽',
    Tecnologia: '💻',
    Podcasts: '🎧',
    IRL: '📹'
};

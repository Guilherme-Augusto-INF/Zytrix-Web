import {
  auth,
  db,
  onAuthStateChanged,
  collection,
  doc,
  getDoc,
  getDocs
} from './firebase.js';
import { header, footer, escapeHtml } from './ui.js';
import { parseStreamingSource, streamingPlatformLabel } from './streaming.js';

header();
footer();

const root = document.querySelector('#admin-root');

function toMillis(value) {
  return value?.toMillis?.() || 0;
}

function formatDate(value) {
  const millis = toMillis(value);
  if (!millis) return '—';
  return new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'short',
    timeStyle: 'short'
  }).format(new Date(millis));
}

function moneyFromCents(value) {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL'
  }).format(Number(value || 0) / 100);
}

function table(headers, rows) {
  if (!rows.length) return '<div class="admin-empty">Nenhum registro encontrado.</div>';
  return `
    <div class="admin-table-wrap">
      <table class="admin-table">
        <thead><tr>${headers.map(item => `<th>${escapeHtml(item)}</th>`).join('')}</tr></thead>
        <tbody>${rows.join('')}</tbody>
      </table>
    </div>
  `;
}

async function safeCollection(path) {
  try {
    return await getDocs(collection(db, ...path));
  } catch (error) {
    console.warn(`Falha ao ler ${path.join('/')}`, error);
    return null;
  }
}

async function countModeration(streamIds) {
  let messages = 0;
  let bans = 0;

  const results = await Promise.all(streamIds.map(async streamId => {
    const [chat, chatBans] = await Promise.all([
      safeCollection(['streams', streamId, 'chat']),
      safeCollection(['streams', streamId, 'chatBans'])
    ]);
    return {
      messages: chat?.size || 0,
      bans: chatBans?.size || 0
    };
  }));

  for (const result of results) {
    messages += result.messages;
    bans += result.bans;
  }

  return { messages, bans };
}

async function loadDashboard() {
  root.innerHTML = '<div class="state">Carregando dados administrativos...</div>';

  const [usersSnap, profilesSnap, channelsSnap, streamsSnap, walletsSnap, ordersSnap, categoriesSnap] = await Promise.all([
    safeCollection(['users']),
    safeCollection(['profiles']),
    safeCollection(['channels']),
    safeCollection(['streams']),
    safeCollection(['wallets']),
    safeCollection(['zyCoinOrders']),
    safeCollection(['categories'])
  ]);

  const users = usersSnap?.docs.map(item => ({ id: item.id, ...item.data() })) || [];
  const profiles = new Map((profilesSnap?.docs || []).map(item => [item.id, item.data()]));
  const channels = channelsSnap?.docs.map(item => ({ id: item.id, ...item.data() })) || [];
  const streams = streamsSnap?.docs.map(item => ({ id: item.id, ...item.data() })) || [];
  const wallets = walletsSnap?.docs.map(item => ({ id: item.id, ...item.data() })) || [];
  const orders = ordersSnap?.docs.map(item => ({ id: item.id, ...item.data() })) || [];
  const categories = categoriesSnap?.docs.map(item => ({ id: item.id, ...item.data() })) || [];
  const liveStreams = streams.filter(item => item.status === 'live');
  const moderation = await countModeration(streams.map(item => item.id));
  const totalCoins = wallets.reduce((sum, item) => sum + Number(item.balance || 0), 0);

  const recentUsers = [...users]
    .sort((a, b) => toMillis(b.createdAt) - toMillis(a.createdAt))
    .slice(0, 12)
    .map(user => {
      const profile = profiles.get(user.id) || {};
      return `
        <tr>
          <td>${escapeHtml(profile.username || 'Sem nome')}</td>
          <td>${escapeHtml(user.email || '—')}</td>
          <td>${escapeHtml(user.provider || '—')}</td>
          <td class="muted-cell">${formatDate(user.createdAt)}</td>
        </tr>
      `;
    });

  const streamRows = [...streams]
    .sort((a, b) => Number(b.status === 'live') - Number(a.status === 'live'))
    .slice(0, 16)
    .map(stream => {
      const profile = profiles.get(stream.streamerUid) || {};
      const source = parseStreamingSource(stream.playbackURL || '');
      const platform = source ? streamingPlatformLabel(source.platform) : '—';
      return `
        <tr>
          <td>${escapeHtml(profile.username || stream.streamerUid || '—')}</td>
          <td>${escapeHtml(stream.title || 'Sem título')}</td>
          <td><span class="${stream.status === 'live' ? 'live-indicator' : 'offline-indicator'}">${stream.status === 'live' ? '● AO VIVO' : 'OFFLINE'}</span></td>
          <td>${escapeHtml(platform)}</td>
          <td>${Number(stream.viewerCount || 0).toLocaleString('pt-BR')}</td>
          <td><a href="live.html?stream=${encodeURIComponent(stream.id)}">Abrir</a></td>
        </tr>
      `;
    });

  const orderRows = [...orders]
    .sort((a, b) => toMillis(b.createdAt) - toMillis(a.createdAt))
    .slice(0, 12)
    .map(order => `
      <tr>
        <td>${escapeHtml(order.uid || '—')}</td>
        <td>${escapeHtml(order.packageId || '—')}</td>
        <td>${Number(order.coins || 0).toLocaleString('pt-BR')} Zy</td>
        <td>${moneyFromCents(order.priceCents)}</td>
        <td>${escapeHtml(order.status || '—')}</td>
        <td class="muted-cell">${formatDate(order.createdAt)}</td>
      </tr>
    `);

  root.innerHTML = `
    <div class="admin-section-head">
      <div>
        <div class="eyebrow">Administração</div>
        <h1 style="margin:5px 0 0">Painel Zytrix</h1>
      </div>
      <span class="admin-badge">ACESSO ADMIN</span>
    </div>

    <p class="muted">Visão consolidada do projeto. Este painel é somente leitura nesta etapa para reduzir o risco de alterações acidentais durante o TCC.</p>

    <section class="admin-stats">
      <div class="stat-box"><span class="stat-label">Usuários</span><strong>${users.length.toLocaleString('pt-BR')}</strong></div>
      <div class="stat-box"><span class="stat-label">Streamers</span><strong>${channels.length.toLocaleString('pt-BR')}</strong></div>
      <div class="stat-box"><span class="stat-label">Lives ativas</span><strong>${liveStreams.length.toLocaleString('pt-BR')}</strong></div>
      <div class="stat-box"><span class="stat-label">Mensagens de chat</span><strong>${moderation.messages.toLocaleString('pt-BR')}</strong></div>
      <div class="stat-box"><span class="stat-label">Banimentos / mutes</span><strong>${moderation.bans.toLocaleString('pt-BR')}</strong></div>
      <div class="stat-box"><span class="stat-label">Zy Coins em carteiras</span><strong>${totalCoins.toLocaleString('pt-BR')}</strong></div>
      <div class="stat-box"><span class="stat-label">Pedidos</span><strong>${orders.length.toLocaleString('pt-BR')}</strong></div>
      <div class="stat-box"><span class="stat-label">Categorias no Firestore</span><strong>${categories.length.toLocaleString('pt-BR')}</strong></div>
    </section>

    <div class="admin-grid" style="margin-top:20px">
      <section class="card panel">
        <div class="admin-section-head"><h2 style="margin:0">Usuários recentes</h2><span class="muted">até 12 registros</span></div>
        ${table(['Usuário', 'E-mail', 'Provedor', 'Criado em'], recentUsers)}
      </section>

      <section class="card panel">
        <div class="admin-section-head"><h2 style="margin:0">Lives</h2><span class="muted">ativas primeiro</span></div>
        ${table(['Streamer', 'Título', 'Status', 'Plataforma', 'Contador', ''], streamRows)}
      </section>

      <section class="card panel">
        <div class="admin-section-head"><h2 style="margin:0">Pedidos de Zy Coins</h2><span class="muted">até 12 registros</span></div>
        ${table(['UID', 'Pacote', 'Moedas', 'Valor', 'Status', 'Criado em'], orderRows)}
      </section>
    </div>
  `;
}

onAuthStateChanged(auth, async user => {
  if (!user) {
    root.innerHTML = `
      <div class="card panel">
        <h2>Acesso restrito</h2>
        <p class="muted">Entre com uma conta administrativa para continuar.</p>
        <a class="btn btn-primary" href="login.html">Entrar</a>
      </div>
    `;
    return;
  }

  try {
    const adminSnap = await getDoc(doc(db, 'admins', user.uid));
    if (!adminSnap.exists() || adminSnap.data().active !== true) {
      root.innerHTML = '<div class="message err">Sua conta não possui acesso administrativo.</div>';
      return;
    }
    await loadDashboard();
  } catch (error) {
    console.error('Falha no painel administrativo:', error);
    root.innerHTML = '<div class="message err">Não foi possível carregar o painel administrativo.</div>';
  }
});

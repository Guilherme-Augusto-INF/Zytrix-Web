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
import { header, footer, escapeHtml, escapeAttr } from './ui.js';
import { parseStreamingSource, streamingPlatformLabel } from './streaming.js';

header();
footer();

const root = document.querySelector('#admin-root');
let currentAdmin = null;

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

async function moderationSnapshot(streams) {
  let messages = 0;
  const chatPenalties = [];
  const results = await Promise.all(streams.map(async stream => {
    const [chat, chatBans] = await Promise.all([
      safeCollection(['streams', stream.id, 'chat']),
      safeCollection(['streams', stream.id, 'chatBans'])
    ]);
    for (const item of chatBans?.docs || []) {
      chatPenalties.push({
        streamId: stream.id,
        streamTitle: stream.title || stream.id,
        ...item.data()
      });
    }
    return { messages: chat?.size || 0 };
  }));
  for (const result of results) messages += result.messages;
  return { messages, chatPenalties };
}

function durationToDate(value) {
  const minutes = Number(value || 0);
  if (!minutes) return null;
  return new Date(Date.now() + minutes * 60 * 1000);
}

function penaltyStatus(item) {
  if (item.active !== true) return 'Encerrada';
  if (item.expiresAt?.toMillis?.() && item.expiresAt.toMillis() <= Date.now()) return 'Expirada';
  return 'Ativa';
}

async function applyPenalty(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const uid = form.querySelector('[name="uid"]').value.trim();
  const type = form.querySelector('[name="type"]').value;
  const reason = form.querySelector('[name="reason"]').value.trim();
  const duration = form.querySelector('[name="duration"]').value;
  const message = document.querySelector('#moderation-msg');
  if (!uid || !reason) {
    message.innerHTML = '<div class="message err">Informe UID e motivo.</div>';
    return;
  }
  try {
    const ref = doc(db, 'moderationPenalties', uid);
    const current = await getDoc(ref);
    const base = {
      uid,
      type,
      reason: reason.slice(0, 500),
      active: true,
      expiresAt: durationToDate(duration),
      updatedAt: serverTimestamp()
    };
    if (current.exists()) {
      await updateDoc(ref, base);
    } else {
      await setDoc(ref, {
        ...base,
        createdBy: currentAdmin.uid,
        createdAt: serverTimestamp()
      });
    }
    await setDoc(doc(collection(db, 'moderationActions')), {
      targetUid: uid,
      type,
      reason: reason.slice(0, 500),
      action: 'apply',
      moderatorUid: currentAdmin.uid,
      expiresAt: durationToDate(duration),
      createdAt: serverTimestamp()
    });
    message.innerHTML = '<div class="message ok">Penalidade aplicada.</div>';
    await loadDashboard();
  } catch (error) {
    console.error('Falha ao aplicar penalidade:', error);
    message.innerHTML = '<div class="message err">Não foi possível aplicar a penalidade.</div>';
  }
}

async function revokePenalty(uid) {
  const reason = window.prompt('Motivo para encerrar a penalidade:', 'Revisão administrativa');
  if (!reason) return;
  try {
    await updateDoc(doc(db, 'moderationPenalties', uid), {
      active: false,
      updatedAt: serverTimestamp()
    });
    await setDoc(doc(collection(db, 'moderationActions')), {
      targetUid: uid,
      type: 'none',
      reason: reason.slice(0, 500),
      action: 'revoke',
      moderatorUid: currentAdmin.uid,
      expiresAt: null,
      createdAt: serverTimestamp()
    });
    await loadDashboard();
  } catch (error) {
    console.error('Falha ao encerrar penalidade:', error);
    window.alert('Não foi possível encerrar a penalidade.');
  }
}

async function loadDashboard() {
  root.innerHTML = '<div class="state">Carregando dados administrativos...</div>';

  const [usersSnap, profilesSnap, channelsSnap, streamsSnap, walletsSnap, ordersSnap, categoriesSnap, penaltiesSnap, actionsSnap] = await Promise.all([
    safeCollection(['users']),
    safeCollection(['profiles']),
    safeCollection(['channels']),
    safeCollection(['streams']),
    safeCollection(['wallets']),
    safeCollection(['zyCoinOrders']),
    safeCollection(['categories']),
    safeCollection(['moderationPenalties']),
    safeCollection(['moderationActions'])
  ]);

  const users = usersSnap?.docs.map(item => ({ id: item.id, ...item.data() })) || [];
  const profiles = new Map((profilesSnap?.docs || []).map(item => [item.id, item.data()]));
  const channels = channelsSnap?.docs.map(item => ({ id: item.id, ...item.data() })) || [];
  const streams = streamsSnap?.docs.map(item => ({ id: item.id, ...item.data() })) || [];
  const wallets = walletsSnap?.docs.map(item => ({ id: item.id, ...item.data() })) || [];
  const orders = ordersSnap?.docs.map(item => ({ id: item.id, ...item.data() })) || [];
  const categories = categoriesSnap?.docs.map(item => ({ id: item.id, ...item.data() })) || [];
  const penalties = penaltiesSnap?.docs.map(item => ({ id: item.id, ...item.data() })) || [];
  const actions = actionsSnap?.docs.map(item => ({ id: item.id, ...item.data() })) || [];
  const liveStreams = streams.filter(item => item.status === 'live');
  const moderation = await moderationSnapshot(streams);
  const totalCoins = wallets.reduce((sum, item) => sum + Number(item.balance || 0), 0);
  const activePenalties = penalties.filter(item => penaltyStatus(item) === 'Ativa');

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

  const penaltyRows = [...penalties]
    .sort((a, b) => toMillis(b.updatedAt) - toMillis(a.updatedAt))
    .map(item => `
      <tr>
        <td>${escapeHtml(profiles.get(item.uid)?.username || item.uid)}</td>
        <td>${escapeHtml(item.type || '—')}</td>
        <td>${escapeHtml(item.reason || '—')}</td>
        <td>${penaltyStatus(item)}</td>
        <td>${item.expiresAt ? formatDate(item.expiresAt) : 'Permanente'}</td>
        <td>${item.active === true ? `<button class="btn btn-danger revoke-penalty" data-uid="${escapeAttr(item.uid)}">Encerrar</button>` : '—'}</td>
      </tr>
    `);

  const chatPenaltyRows = [...moderation.chatPenalties]
    .sort((a, b) => toMillis(b.createdAt) - toMillis(a.createdAt))
    .slice(0, 30)
    .map(item => `
      <tr>
        <td>${escapeHtml(profiles.get(item.uid)?.username || item.uid || '—')}</td>
        <td>${escapeHtml(item.reason || '—')}</td>
        <td>${escapeHtml(item.streamTitle || item.streamId || '—')}</td>
        <td>${item.expiresAt ? formatDate(item.expiresAt) : 'Permanente'}</td>
      </tr>
    `);

  const actionRows = [...actions]
    .sort((a, b) => toMillis(b.createdAt) - toMillis(a.createdAt))
    .slice(0, 30)
    .map(item => `
      <tr>
        <td>${escapeHtml(profiles.get(item.targetUid)?.username || item.targetUid || '—')}</td>
        <td>${escapeHtml(item.action || '—')}</td>
        <td>${escapeHtml(item.type || '—')}</td>
        <td>${escapeHtml(item.reason || '—')}</td>
        <td>${formatDate(item.createdAt)}</td>
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

    <p class="muted">Visão administrativa da plataforma e central de moderação.</p>

    <section class="admin-stats">
      <div class="stat-box"><span class="stat-label">Usuários</span><strong>${users.length.toLocaleString('pt-BR')}</strong></div>
      <div class="stat-box"><span class="stat-label">Streamers</span><strong>${channels.length.toLocaleString('pt-BR')}</strong></div>
      <div class="stat-box"><span class="stat-label">Lives ativas</span><strong>${liveStreams.length.toLocaleString('pt-BR')}</strong></div>
      <div class="stat-box"><span class="stat-label">Mensagens de chat</span><strong>${moderation.messages.toLocaleString('pt-BR')}</strong></div>
      <div class="stat-box"><span class="stat-label">Mutes / bans de chat</span><strong>${moderation.chatPenalties.length.toLocaleString('pt-BR')}</strong></div>
      <div class="stat-box"><span class="stat-label">Penalidades globais ativas</span><strong>${activePenalties.length.toLocaleString('pt-BR')}</strong></div>
      <div class="stat-box"><span class="stat-label">Zy Coins em carteiras</span><strong>${totalCoins.toLocaleString('pt-BR')}</strong></div>
      <div class="stat-box"><span class="stat-label">Pedidos</span><strong>${orders.length.toLocaleString('pt-BR')}</strong></div>
    </section>

    <section class="card panel" style="margin-top:20px">
      <div class="admin-section-head">
        <div><div class="eyebrow">Moderação</div><h2 style="margin:4px 0 0">Aplicar penalidade</h2></div>
        <a class="btn" href="/moderacao">Fila de denúncias</a>
      </div>
      <form id="moderation-form" class="grid grid-2" style="margin-top:16px">
        <div class="form-group"><label>UID do usuário</label><input class="input" name="uid" required></div>
        <div class="form-group"><label>Tipo</label><select class="input" name="type"><option value="warning">Advertência</option><option value="mute">Mute global</option><option value="ban">Ban global</option></select></div>
        <div class="form-group"><label>Duração</label><select class="input" name="duration"><option value="0">Permanente</option><option value="10">10 minutos</option><option value="60">1 hora</option><option value="1440">1 dia</option><option value="10080">7 dias</option><option value="43200">30 dias</option></select></div>
        <div class="form-group"><label>Motivo</label><input class="input" name="reason" maxlength="500" required></div>
        <div><button class="btn btn-primary" type="submit">Aplicar penalidade</button></div>
      </form>
      <div id="moderation-msg"></div>
    </section>

    <div class="admin-grid" style="margin-top:20px">
      <section class="card panel">
        <div class="admin-section-head"><h2 style="margin:0">Penalidades globais</h2><span class="muted">warning / mute / ban</span></div>
        ${table(['Usuário', 'Tipo', 'Motivo', 'Status', 'Expira', ''], penaltyRows)}
      </section>

      <section class="card panel">
        <div class="admin-section-head"><h2 style="margin:0">Mutes e bans de chat</h2><span class="muted">até 30 registros</span></div>
        ${table(['Usuário', 'Tipo', 'Live', 'Expira'], chatPenaltyRows)}
      </section>

      <section class="card panel">
        <div class="admin-section-head"><h2 style="margin:0">Histórico de ações</h2><span class="muted">até 30 registros</span></div>
        ${table(['Usuário', 'Ação', 'Tipo', 'Motivo', 'Data'], actionRows)}
      </section>

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

  document.querySelector('#moderation-form')?.addEventListener('submit', applyPenalty);
  document.querySelectorAll('.revoke-penalty').forEach(button => {
    button.addEventListener('click', () => revokePenalty(button.dataset.uid));
  });
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
    currentAdmin = user;
    await loadDashboard();
  } catch (error) {
    console.error('Falha no painel administrativo:', error);
    root.innerHTML = '<div class="message err">Não foi possível carregar o painel administrativo.</div>';
  }
});

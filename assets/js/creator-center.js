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
  deleteDoc,
  query,
  where,
  orderBy,
  limit,
  onSnapshot,
  serverTimestamp,
  ensureWallet
} from './firebase.js';
import { header, footer, escapeHtml, escapeAttr } from './ui.js';
import { SUPPORT_ALERT_SOUNDS, normalizeSupportAlertSound, playSupportAlertSound, unlockSupportAlertAudio } from './support-alert-sound.js';

header();
footer();

const root = document.querySelector('#creator-center-root');
let user = null;
let channel = null;
let stream = null;
let profile = null;
let chatSettings = null;
let moderators = [];
let members = [];
let schedule = [];
let rewards = [];
let redemptions = [];
let clips = [];
let supportTransactions = [];
let creatorCode = null;
let activePoll = null;
let followerCount = 0;
let stopStream = null;
let stopPolls = null;

function tsMs(value) {
  const d = value?.toDate?.();
  return d ? d.getTime() : 0;
}

function dateTimeLocalValue(value) {
  const d = value?.toDate?.();
  if (!d) return '';
  const copy = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
  return copy.toISOString().slice(0, 16);
}

function safeUrl(value = '') {
  const text = String(value || '').trim();
  if (!text) return '';
  try {
    const url = new URL(text);
    return ['http:', 'https:'].includes(url.protocol) ? url.toString() : '';
  } catch {
    return '';
  }
}

async function findStream(uid) {
  const snap = await getDocs(query(collection(db, 'streams'), where('streamerUid', '==', uid), limit(1)));
  return snap.empty ? null : { id: snap.docs[0].id, ...snap.docs[0].data() };
}

async function resolveUserId(value) {
  const text = String(value || '').trim();
  if (!text) return null;
  const direct = await getDoc(doc(db, 'profiles', text)).catch(() => null);
  if (direct?.exists?.()) return { uid: text, profile: direct.data() };
  const byId = await getDocs(query(collection(db, 'users'), where('zytrixId', '==', text), limit(1))).catch(() => null);
  if (byId && !byId.empty) {
    const uid = byId.docs[0].id;
    const p = await getDoc(doc(db, 'profiles', uid)).catch(() => null);
    return { uid, profile: p?.exists?.() ? p.data() : { username: text } };
  }
  return null;
}

async function hydrateNamed(items) {
  return Promise.all(items.map(async item => {
    const snap = await getDoc(doc(db, 'profiles', item.uid)).catch(() => null);
    return { ...item, profile: snap?.exists?.() ? snap.data() : { username: item.uid } };
  }));
}

async function loadAll() {
  const [channelSnap, profileSnap] = await Promise.all([
    getDoc(doc(db, 'channels', user.uid)),
    getDoc(doc(db, 'profiles', user.uid))
  ]);
  if (!channelSnap.exists()) {
    root.innerHTML = '<div class="card panel"><h1>Centro do Criador</h1><p class="muted">Crie seu canal primeiro no Perfil para liberar este painel.</p><a class="btn btn-primary" href="perfil.html">Ir para o Perfil</a></div>';
    return;
  }
  channel = { id: channelSnap.id, ...channelSnap.data() };
  profile = profileSnap.exists() ? profileSnap.data() : { username: 'Streamer' };
  stream = await findStream(user.uid);
  if (!stream) {
    root.innerHTML = '<div class="state">Sua transmissão-base não foi encontrada.</div>';
    return;
  }
  await ensureWallet(user.uid);

  const [settingsSnap, modSnap, memberSnap, scheduleSnap, rewardsSnap, redemptionSnap, clipsSnap, supportSnap, followersSnap, codeSnap] = await Promise.all([
    getDoc(doc(db, 'streams', stream.id, 'chatSettings', 'main')),
    getDocs(collection(db, 'streams', stream.id, 'moderators')),
    getDocs(collection(db, 'channels', user.uid, 'members')),
    getDocs(collection(db, 'channels', user.uid, 'schedule')),
    getDocs(collection(db, 'channels', user.uid, 'rewards')),
    getDocs(query(collection(db, 'rewardRedemptions'), where('channelId', '==', user.uid))).catch(() => null),
    getDocs(query(collection(db, 'clips'), where('streamerUid', '==', user.uid))).catch(() => null),
    getDocs(query(collection(db, 'zyCoinTransactions'), where('toUid', '==', user.uid))).catch(() => null),
    getDocs(collection(db, 'channels', user.uid, 'followers')).catch(() => null),
    getDocs(query(collection(db, 'creatorCodes'), where('creatorUid', '==', user.uid), limit(1))).catch(() => null)
  ]);

  chatSettings = settingsSnap.exists() ? settingsSnap.data() : {
    mode: 'everyone',
    slowModeSeconds: 0,
    allowLinks: true,
    blockExcessCaps: false,
    blockedWords: [],
    emergencyMode: false
  };
  moderators = await hydrateNamed(modSnap.docs.map(item => ({ uid: item.id, ...item.data() })));
  members = await hydrateNamed(memberSnap.docs.map(item => ({ uid: item.id, ...item.data() })));
  schedule = scheduleSnap.docs.map(item => ({ id: item.id, ...item.data() })).sort((a, b) => tsMs(a.startsAt) - tsMs(b.startsAt));
  rewards = rewardsSnap.docs.map(item => ({ id: item.id, ...item.data() }));
  redemptions = redemptionSnap?.docs?.map(item => ({ id: item.id, ...item.data() })) || [];
  clips = clipsSnap?.docs?.map(item => ({ id: item.id, ...item.data() })).sort((a, b) => tsMs(b.createdAt) - tsMs(a.createdAt)) || [];
  supportTransactions = supportSnap?.docs?.map(item => ({ id: item.id, ...item.data() })).filter(item => ['stream_support', 'reward_redeem'].includes(item.type) && item.status === 'completed') || [];
  followerCount = followersSnap?.size || 0;
  creatorCode = codeSnap && !codeSnap.empty ? { code: codeSnap.docs[0].id, ...codeSnap.docs[0].data() } : null;

  const pollsSnap = await getDocs(query(collection(db, 'streams', stream.id, 'polls'), orderBy('createdAt', 'desc'), limit(10))).catch(() => null);
  const polls = pollsSnap?.docs?.map(item => ({ id: item.id, ...item.data() })) || [];
  activePoll = polls.find(item => item.status === 'active') || null;
  render();
  startRealtime();
}

function startRealtime() {
  stopStream?.();
  stopPolls?.();
  stopStream = onSnapshot(doc(db, 'streams', stream.id), snap => {
    if (!snap.exists()) return;
    stream = { id: snap.id, ...snap.data() };
    refreshOverviewNumbers();
  });
  stopPolls = onSnapshot(query(collection(db, 'streams', stream.id, 'polls'), orderBy('createdAt', 'desc'), limit(10)), snap => {
    const polls = snap.docs.map(item => ({ id: item.id, ...item.data() }));
    activePoll = polls.find(item => item.status === 'active') || null;
    const host = document.querySelector('#community-poll-state');
    if (host) host.innerHTML = pollStateHtml();
    bindCommunityActions();
  }, () => {});
}

function totalCoinsReceived() {
  return supportTransactions.reduce((sum, item) => sum + Math.max(0, Number(item.amount || 0)), 0);
}

function uniqueSupporters() {
  return new Set(supportTransactions.map(item => item.fromUid).filter(Boolean)).size;
}

function render() {
  root.innerHTML = `
    <section class="platform-hero">
      <div class="card panel">
        <div class="eyebrow">CENTRO DO CRIADOR</div>
        <h1 style="margin:5px 0">${escapeHtml(profile?.username || 'Streamer')}</h1>
        <p class="muted">Live, comunidade, alertas, moderação, agenda, recompensas e analytics em um único painel.</p>
        <div class="live-interaction-row">
          <a class="btn btn-primary" href="config-live.html">Configuração rápida</a>
          <a class="btn" href="live.html?stream=${encodeURIComponent(stream.id)}">Ver minha live</a>
        </div>
      </div>
      <div class="card panel">
        <div class="eyebrow">STATUS</div>
        <h2 id="cc-live-status" class="${stream.status === 'live' ? 'status-live' : 'status-offline'}">${stream.status === 'live' ? '● AO VIVO' : 'OFFLINE'}</h2>
        <p class="muted">Stream ID: <code>${escapeHtml(stream.id)}</code></p>
      </div>
    </section>

    <div class="platform-kpi-grid">
      <div class="platform-kpi"><span>Seguidores</span><strong>${followerCount.toLocaleString('pt-BR')}</strong></div>
      <div class="platform-kpi"><span>Zy Coins recebidos</span><strong>◈ ${totalCoinsReceived().toLocaleString('pt-BR')}</strong></div>
      <div class="platform-kpi"><span>Apoiadores únicos</span><strong>${uniqueSupporters().toLocaleString('pt-BR')}</strong></div>
      <div class="platform-kpi"><span>Clipes</span><strong>${clips.length.toLocaleString('pt-BR')}</strong></div>
    </div>

    <nav class="platform-tabs" aria-label="Seções do Centro do Criador">
      ${[
        ['overview', 'Visão geral'],
        ['live', 'Live e alertas'],
        ['community', 'Comunidade'],
        ['schedule', 'Agenda'],
        ['monetization', 'Monetização'],
        ['analytics', 'Analytics'],
        ['profile', 'Perfil do canal']
      ].map(([id, label], index) => `<button class="platform-tab ${index === 0 ? 'active' : ''}" data-tab="${id}">${label}</button>`).join('')}
    </nav>

    <section class="platform-section" data-section="overview">${overviewHtml()}</section>
    <section class="platform-section" data-section="live" hidden>${liveSettingsHtml()}</section>
    <section class="platform-section" data-section="community" hidden>${communityHtml()}</section>
    <section class="platform-section" data-section="schedule" hidden>${scheduleHtml()}</section>
    <section class="platform-section" data-section="monetization" hidden>${monetizationHtml()}</section>
    <section class="platform-section" data-section="analytics" hidden>${analyticsHtml()}</section>
    <section class="platform-section" data-section="profile" hidden>${profileHtml()}</section>
  `;
  bindTabs();
  bindAllActions();
}

function overviewHtml() {
  const upcoming = schedule.filter(item => tsMs(item.startsAt) > Date.now()).slice(0, 3);
  const pending = redemptions.filter(item => item.status === 'pending_fulfillment').slice(0, 5);
  return `
    <div class="creator-grid">
      <div class="card panel"><div class="eyebrow">PRÓXIMAS LIVES</div><h2>${upcoming.length}</h2><p class="muted">Transmissões agendadas no futuro.</p></div>
      <div class="card panel"><div class="eyebrow">RECOMPENSAS</div><h2>${rewards.filter(item => item.active).length}</h2><p class="muted">Itens ativos na loja do canal.</p></div>
      <div class="card panel"><div class="eyebrow">PENDÊNCIAS</div><h2>${pending.length}</h2><p class="muted">Resgates aguardando entrega.</p></div>
      <div class="card panel"><div class="eyebrow">CHAT</div><h2>${escapeHtml(chatSettings.mode || 'everyone')}</h2><p class="muted">Slow mode: ${Number(chatSettings.slowModeSeconds || 0)}s.</p></div>
    </div>
    <div class="card panel">
      <h2>Ações rápidas</h2>
      <div class="live-interaction-row">
        <button class="btn ${chatSettings.emergencyMode ? 'btn-danger' : ''}" id="overview-emergency">${chatSettings.emergencyMode ? 'Desativar emergência' : 'Ativar modo emergência'}</button>
        <button class="btn" data-open-tab="live">Personalizar alertas</button>
        <button class="btn" data-open-tab="community">Criar enquete</button>
        <button class="btn" data-open-tab="schedule">Agendar live</button>
      </div>
      <div id="overview-feedback"></div>
    </div>
    ${pending.length ? `<div class="card panel"><h2>Resgates pendentes</h2><div class="reward-list">${pending.map(item => `<div class="moderator-item"><span>${escapeHtml(item.rewardId || 'Recompensa')} · ${escapeHtml(item.uid || '')} · ◈ ${Number(item.cost || 0)}</span><button class="btn" data-fulfill="${escapeAttr(item.id)}">Marcar entregue</button></div>`).join('')}</div></div>` : ''}
  `;
}

function liveSettingsHtml() {
  const sound = normalizeSupportAlertSound(stream.supportAlertSound || 'coin');
  return `
    <div class="card panel">
      <div class="eyebrow">META DA LIVE</div>
      <h2>Meta de Zy Coins</h2>
      <div class="creator-form-row">
        <input id="goal-label" class="input" maxlength="60" value="${escapeAttr(stream.supportGoalLabel || '')}" placeholder="Ex.: Meta para live especial">
        <input id="goal-coins" class="input" type="number" min="0" max="10000000" value="${Number(stream.supportGoalCoins || 0)}" placeholder="Quantidade">
        <button id="save-goal" class="btn btn-primary">Salvar meta</button>
      </div>
      <p class="setting-help">Use 0 para ocultar a meta. O progresso é calculado a partir dos apoios públicos da transmissão.</p>
    </div>

    <div class="card panel">
      <div class="eyebrow">ALERTA DE APOIO</div>
      <h2>Visual e som</h2>
      <div class="creator-grid">
        <label>Som<select id="alert-sound" class="input">${Object.entries(SUPPORT_ALERT_SOUNDS).map(([value, label]) => `<option value="${value}" ${sound === value ? 'selected' : ''}>${escapeHtml(label)}</option>`).join('')}</select></label>
        <label>Tema<select id="alert-theme" class="input">${[['classic','Clássico'],['minimal','Minimalista'],['celebrate','Celebração'],['neon','Neon']].map(([value,label]) => `<option value="${value}" ${(stream.supportAlertTheme || 'classic') === value ? 'selected' : ''}>${label}</option>`).join('')}</select></label>
        <label>Mínimo de Zy Coins<input id="alert-min" class="input" type="number" min="1" max="100000" value="${Number(stream.supportAlertMinCoins || 1)}"></label>
        <label>Duração (ms)<input id="alert-duration" class="input" type="number" min="2500" max="10000" step="100" value="${Number(stream.supportAlertDurationMs || 4200)}"></label>
      </div>
      <div class="live-interaction-row" style="margin-top:12px"><button id="preview-alert-sound" class="btn">▶ Testar som</button><button id="save-alert-settings" class="btn btn-primary">Salvar alerta</button></div>
      <div id="alert-feedback"></div>
    </div>

    <div class="card panel">
      <div class="eyebrow">CONTEÚDO E REPLAY</div>
      <label class="toggle-line"><input id="creator-mature" type="checkbox" ${stream.matureContent === true ? 'checked' : ''}><span><strong>Conteúdo 18+</strong><small>Ativa os avisos locais da Zytrix. Twitch/Kick continuam responsáveis pelo login e pelas próprias restrições.</small></span></label>
      <label>URL do VOD<input id="vod-url" class="input" value="${escapeAttr(stream.vodURL || '')}" placeholder="https://... do VOD/replay"></label>
      <div class="creator-form-row" style="margin-top:12px"><label style="flex:1">Raid para Stream ID<input id="raid-target" class="input" value="${escapeAttr(stream.raidTargetStreamId || '')}" placeholder="Stream ID de destino"></label><label style="flex:1">Host enquanto offline<input id="host-target" class="input" value="${escapeAttr(stream.hostTargetStreamId || '')}" placeholder="Stream ID de destino"></label></div>
      <button id="save-live-advanced" class="btn btn-primary" style="margin-top:12px">Salvar opções avançadas</button>
      <div id="live-advanced-feedback"></div>
    </div>
  `;
}

function communityHtml() {
  return `
    <div class="card panel">
      <div class="eyebrow">CHAT</div><h2>Regras do chat</h2>
      <div class="creator-grid">
        <label>Quem pode conversar<select id="chat-mode" class="input"><option value="everyone" ${chatSettings.mode === 'everyone' ? 'selected' : ''}>Todos</option><option value="followers" ${chatSettings.mode === 'followers' ? 'selected' : ''}>Somente seguidores</option><option value="members" ${chatSettings.mode === 'members' ? 'selected' : ''}>Somente membros</option></select></label>
        <label>Slow mode (segundos)<input id="slow-mode" class="input" type="number" min="0" max="120" value="${Number(chatSettings.slowModeSeconds || 0)}"></label>
        <label class="toggle-line"><input id="allow-links" type="checkbox" ${chatSettings.allowLinks !== false ? 'checked' : ''}><span><strong>Permitir links</strong><small>Se desativado, URLs são bloqueadas também pelas regras.</small></span></label>
        <label class="toggle-line"><input id="block-caps" type="checkbox" ${chatSettings.blockExcessCaps === true ? 'checked' : ''}><span><strong>Reduzir CAPS excessivo</strong><small>Filtro de interface do AutoMod.</small></span></label>
      </div>
      <label style="display:block;margin-top:10px">Palavras bloqueadas<textarea id="blocked-words" class="input textarea" maxlength="800" placeholder="Uma por linha ou separadas por vírgula">${escapeHtml((chatSettings.blockedWords || []).join('\n'))}</textarea></label>
      <label class="toggle-line"><input id="emergency-mode" type="checkbox" ${chatSettings.emergencyMode === true ? 'checked' : ''}><span><strong>Modo emergência</strong><small>Bloqueia mensagens de espectadores; streamer, moderadores e admins continuam operando.</small></span></label>
      <button id="save-chat-settings" class="btn btn-primary">Salvar moderação</button><div id="chat-settings-feedback"></div>
      <p class="setting-help">O bloqueio de links, modos de acesso, bans e slow mode são reforçados no Firestore. A lista personalizada de palavras e CAPS também é filtrada no cliente; para moderação sem possibilidade de bypass, o próximo passo é mover AutoMod textual para backend.</p>
    </div>

    <div class="card panel"><div class="eyebrow">EQUIPE</div><h2>Moderadores</h2><div class="creator-form-row"><input id="moderator-user" class="input" placeholder="UID ou Zytrix ID"><button id="add-moderator" class="btn btn-primary">Adicionar</button></div><div class="moderator-list" style="margin-top:10px">${moderators.length ? moderators.map(item => `<div class="moderator-item"><span><strong>${escapeHtml(item.profile?.username || item.uid)}</strong><br><small class="muted">${escapeHtml(item.uid)}</small></span><button class="btn btn-danger" data-remove-moderator="${escapeAttr(item.uid)}">Remover</button></div>`).join('') : '<span class="muted">Nenhum moderador adicionado.</span>'}</div><div id="moderator-feedback"></div></div>

    <div class="card panel"><div class="eyebrow">MEMBROS</div><h2>Membros do canal</h2><p class="muted">Enquanto o Stripe Billing não está concluído, a lista de membros é manual. Ela já alimenta o modo “somente membros” sem fingir que existe assinatura paga ativa.</p><div class="creator-form-row"><input id="member-user" class="input" placeholder="UID ou Zytrix ID"><button id="add-member" class="btn">Adicionar membro</button></div><div class="moderator-list" style="margin-top:10px">${members.length ? members.map(item => `<div class="moderator-item"><span>${escapeHtml(item.profile?.username || item.uid)}</span><button class="btn btn-danger" data-remove-member="${escapeAttr(item.uid)}">Remover</button></div>`).join('') : '<span class="muted">Nenhum membro cadastrado.</span>'}</div></div>

    <div class="card panel"><div class="eyebrow">INTERAÇÃO</div><h2>Enquete ou predição</h2><div class="creator-form-row"><select id="poll-kind" class="input"><option value="poll">Enquete</option><option value="prediction">Predição sem aposta</option></select><input id="poll-question" class="input" maxlength="100" placeholder="Pergunta"></div><div class="creator-grid" style="margin-top:10px"><input id="poll-option-0" class="input" maxlength="50" placeholder="Opção 1"><input id="poll-option-1" class="input" maxlength="50" placeholder="Opção 2"><input id="poll-option-2" class="input" maxlength="50" placeholder="Opção 3 (opcional)"><input id="poll-option-3" class="input" maxlength="50" placeholder="Opção 4 (opcional)"></div><button id="create-poll" class="btn btn-primary" style="margin-top:10px">Publicar</button><div id="community-poll-state">${pollStateHtml()}</div><div id="poll-create-feedback"></div></div>
  `;
}

function pollStateHtml() {
  if (!activePoll) return '<p class="muted">Nenhuma enquete ativa.</p>';
  const options = [0,1,2,3].filter(i => activePoll[`option${i}`]).map(i => `<button class="btn" data-resolve-poll="${i}">${escapeHtml(activePoll[`option${i}`])} (${Number(activePoll[`count${i}`] || 0)})</button>`).join('');
  return `<div class="card panel" style="margin-top:12px"><strong>${escapeHtml(activePoll.question || '')}</strong><p class="muted">${activePoll.kind === 'prediction' ? 'Escolha o resultado quando terminar.' : 'Você pode encerrar a enquete sem vencedor.'}</p><div class="live-interaction-row">${activePoll.kind === 'prediction' ? options : ''}<button class="btn btn-danger" id="close-poll">Encerrar</button></div></div>`;
}

function scheduleHtml() {
  return `
    <div class="card panel"><div class="eyebrow">AGENDA</div><h2>Programar transmissão</h2><div class="creator-form-row"><input id="schedule-title" class="input" maxlength="80" placeholder="Título da live"><input id="schedule-start" class="input" type="datetime-local"><button id="add-schedule" class="btn btn-primary">Adicionar</button></div><div id="schedule-feedback"></div></div>
    <div class="schedule-list">${schedule.length ? schedule.map(item => `<article class="schedule-card"><time>${item.startsAt?.toDate?.().toLocaleString('pt-BR', { dateStyle: 'medium', timeStyle: 'short' }) || 'Data'}</time><strong>${escapeHtml(item.title || 'Live')}</strong><span class="muted">${escapeHtml(item.description || '')}</span><div><button class="btn btn-danger" data-delete-schedule="${escapeAttr(item.id)}">Remover</button></div></article>`).join('') : '<div class="state">Nenhuma live agendada.</div>'}</div>
  `;
}

function monetizationHtml() {
  return `
    <div class="card panel"><div class="eyebrow">LOJA DO CANAL</div><h2>Criar recompensa</h2><div class="creator-form-row"><input id="reward-title" class="input" maxlength="60" placeholder="Nome da recompensa"><input id="reward-cost" class="input" type="number" min="1" max="100000" placeholder="Custo em Zy Coins"><input id="reward-description" class="input" maxlength="160" placeholder="Descrição"><button id="create-reward" class="btn btn-primary">Criar</button></div><div id="reward-create-feedback"></div></div>
    <div class="reward-grid">${rewards.length ? rewards.map(item => `<article class="reward-card"><strong>${escapeHtml(item.title || '')}</strong><span class="muted">${escapeHtml(item.description || '')}</span><span class="reward-cost">◈ ${Number(item.cost || 0).toLocaleString('pt-BR')}</span><div class="reward-action-row"><button class="btn" data-toggle-reward="${escapeAttr(item.id)}">${item.active ? 'Desativar' : 'Ativar'}</button><button class="btn btn-danger" data-delete-reward="${escapeAttr(item.id)}">Excluir</button></div></article>`).join('') : '<div class="state">Nenhuma recompensa criada.</div>'}</div>
    <div class="card panel"><div class="eyebrow">CÓDIGO DE CRIADOR</div><h2>Atribuição de criador</h2><p class="muted">O código já pode ser escolhido pelos usuários. Repasse financeiro automático só será ligado quando o Stripe estiver concluído e as regras comerciais forem definidas.</p><div class="creator-code-row"><input id="creator-code" class="input" maxlength="24" value="${escapeAttr(creatorCode?.code || '')}" placeholder="seucodigo"><button id="save-creator-code" class="btn btn-primary">Salvar código</button></div><div id="creator-code-feedback"></div></div>
  `;
}

function analyticsHtml() {
  const total = totalCoinsReceived();
  const supportOnly = supportTransactions.filter(item => item.type === 'stream_support');
  const avg = supportOnly.length ? Math.round(supportOnly.reduce((sum, item) => sum + Number(item.amount || 0), 0) / supportOnly.length) : 0;
  return `
    <div class="analytics-grid"><div class="analytics-card"><span>Visualizações registradas</span><strong>${Number(stream.viewerCount || 0).toLocaleString('pt-BR')}</strong></div><div class="analytics-card"><span>Apoios</span><strong>${supportOnly.length.toLocaleString('pt-BR')}</strong></div><div class="analytics-card"><span>Média por apoio</span><strong>◈ ${avg.toLocaleString('pt-BR')}</strong></div><div class="analytics-card"><span>Zy Coins totais</span><strong>◈ ${total.toLocaleString('pt-BR')}</strong></div></div>
    <div class="card panel"><h2>Resumo de conteúdo</h2><table class="creator-analytics-table"><tbody><tr><th>Seguidores</th><td>${followerCount}</td></tr><tr><th>Clipes criados</th><td>${clips.length}</td></tr><tr><th>Lives agendadas</th><td>${schedule.length}</td></tr><tr><th>Recompensas ativas</th><td>${rewards.filter(item => item.active).length}</td></tr><tr><th>Resgates pendentes</th><td>${redemptions.filter(item => item.status === 'pending_fulfillment').length}</td></tr></tbody></table><p class="setting-help">Estes números vêm do Firestore da Zytrix. Métricas detalhadas de retenção dentro do player dependem das APIs da Twitch/Kick ou de streaming próprio.</p></div>
    <div class="card panel"><h2>Clipes recentes</h2>${clips.slice(0,8).map(item => `<div class="moderator-item"><span>${escapeHtml(item.title || 'Clipe')} · ${Math.floor(Number(item.momentSeconds || 0) / 60)}:${String(Number(item.momentSeconds || 0) % 60).padStart(2,'0')}</span><button class="btn btn-danger" data-delete-clip="${escapeAttr(item.id)}">Excluir</button></div>`).join('') || '<span class="muted">Nenhum clipe ainda.</span>'}</div>
  `;
}

function profileHtml() {
  return `
    <div class="card panel"><div class="eyebrow">PÁGINA DO CANAL</div><h2>Informações públicas</h2><label>Sobre<textarea id="channel-about" class="input textarea" maxlength="800" placeholder="Conte sobre seu canal..."></textarea></label><label>Conteúdos / jogos<input id="channel-games" class="input" maxlength="160" placeholder="Valorant, IRL, programação..."></label><div class="creator-grid"><label>Site<input id="channel-website" class="input" placeholder="https://"></label><label>YouTube<input id="channel-youtube" class="input" placeholder="https://"></label><label>Instagram<input id="channel-instagram" class="input" placeholder="https://"></label><label>TikTok<input id="channel-tiktok" class="input" placeholder="https://"></label></div><button id="save-channel-profile" class="btn btn-primary" style="margin-top:12px">Salvar perfil do canal</button><div id="channel-profile-feedback"></div></div>
  `;
}

function bindTabs() {
  document.querySelectorAll('[data-tab]').forEach(button => button.addEventListener('click', () => openTab(button.dataset.tab)));
  document.querySelectorAll('[data-open-tab]').forEach(button => button.addEventListener('click', () => openTab(button.dataset.openTab)));
}

function openTab(id) {
  document.querySelectorAll('[data-tab]').forEach(button => button.classList.toggle('active', button.dataset.tab === id));
  document.querySelectorAll('[data-section]').forEach(section => section.hidden = section.dataset.section !== id);
  if (id === 'profile') loadChannelProfileIntoForm();
}

function feedback(id, message, error = false) {
  const el = document.querySelector(id);
  if (el) el.innerHTML = `<div class="message ${error ? 'err' : 'ok'}">${escapeHtml(message)}</div>`;
}

async function saveStreamPatch(patch, feedbackSelector, message = 'Salvo.') {
  try {
    await updateDoc(doc(db, 'streams', stream.id), patch);
    Object.assign(stream, patch);
    feedback(feedbackSelector, message);
  } catch (error) {
    console.error(error);
    feedback(feedbackSelector, 'Não foi possível salvar.', true);
  }
}

async function saveGoal() {
  const label = document.querySelector('#goal-label').value.trim().slice(0,60);
  const coins = Math.max(0, Math.min(10000000, Number(document.querySelector('#goal-coins').value || 0)));
  await saveStreamPatch({ supportGoalLabel: label, supportGoalCoins: Math.floor(coins) }, '#alert-feedback', 'Meta salva.');
}

async function saveAlertSettings() {
  const sound = normalizeSupportAlertSound(document.querySelector('#alert-sound').value);
  const theme = document.querySelector('#alert-theme').value;
  const min = Math.max(1, Math.min(100000, Number(document.querySelector('#alert-min').value || 1)));
  const duration = Math.max(2500, Math.min(10000, Number(document.querySelector('#alert-duration').value || 4200)));
  await saveStreamPatch({ supportAlertSound: sound, supportAlertTheme: theme, supportAlertMinCoins: Math.floor(min), supportAlertDurationMs: Math.floor(duration) }, '#alert-feedback', 'Alertas atualizados.');
}

async function saveAdvancedLive() {
  const vodURL = safeUrl(document.querySelector('#vod-url').value);
  const raidTargetStreamId = document.querySelector('#raid-target').value.trim().slice(0,128);
  const hostTargetStreamId = document.querySelector('#host-target').value.trim().slice(0,128);
  const matureContent = document.querySelector('#creator-mature').checked;
  await saveStreamPatch({ vodURL, raidTargetStreamId, hostTargetStreamId, matureContent }, '#live-advanced-feedback', 'Opções avançadas salvas.');
}

async function saveChatSettings() {
  const blockedWords = document.querySelector('#blocked-words').value.split(/[\n,]+/).map(item => item.trim().toLowerCase()).filter(Boolean).slice(0,40);
  const data = {
    mode: document.querySelector('#chat-mode').value,
    slowModeSeconds: Math.max(0, Math.min(120, Math.floor(Number(document.querySelector('#slow-mode').value || 0)))),
    allowLinks: document.querySelector('#allow-links').checked,
    blockExcessCaps: document.querySelector('#block-caps').checked,
    blockedWords,
    emergencyMode: document.querySelector('#emergency-mode').checked,
    updatedBy: user.uid,
    updatedAt: serverTimestamp()
  };
  try {
    await setDoc(doc(db, 'streams', stream.id, 'chatSettings', 'main'), data);
    chatSettings = data;
    feedback('#chat-settings-feedback', 'Configurações do chat salvas.');
  } catch (error) {
    console.error(error);
    feedback('#chat-settings-feedback', 'Não foi possível salvar a moderação.', true);
  }
}

async function toggleEmergency() {
  const next = !chatSettings.emergencyMode;
  try {
    await setDoc(doc(db, 'streams', stream.id, 'chatSettings', 'main'), { ...chatSettings, emergencyMode: next, updatedBy: user.uid, updatedAt: serverTimestamp() });
    chatSettings.emergencyMode = next;
    feedback('#overview-feedback', next ? 'Modo emergência ativado.' : 'Modo emergência desativado.');
    render();
  } catch (error) {
    feedback('#overview-feedback', 'Não foi possível alterar o modo emergência.', true);
  }
}

async function addRole(kind) {
  const input = document.querySelector(kind === 'moderator' ? '#moderator-user' : '#member-user');
  const resolved = await resolveUserId(input.value);
  if (!resolved || resolved.uid === user.uid) {
    if (kind === 'moderator') feedback('#moderator-feedback', 'Usuário não encontrado ou inválido.', true);
    return;
  }
  const path = kind === 'moderator'
    ? ['streams', stream.id, 'moderators', resolved.uid]
    : ['channels', user.uid, 'members', resolved.uid];
  await setDoc(doc(db, ...path), { uid: resolved.uid, addedBy: user.uid, createdAt: serverTimestamp() });
  await loadAll();
  openTab('community');
}

async function removeRole(kind, uid) {
  const path = kind === 'moderator'
    ? ['streams', stream.id, 'moderators', uid]
    : ['channels', user.uid, 'members', uid];
  await deleteDoc(doc(db, ...path));
  await loadAll();
  openTab('community');
}

async function createPoll() {
  const kind = document.querySelector('#poll-kind').value;
  const question = document.querySelector('#poll-question').value.trim().slice(0,100);
  const options = [0,1,2,3].map(i => document.querySelector(`#poll-option-${i}`).value.trim().slice(0,50)).filter(Boolean);
  if (!question || options.length < 2) {
    feedback('#poll-create-feedback', 'Informe a pergunta e pelo menos duas opções.', true);
    return;
  }
  if (activePoll) {
    feedback('#poll-create-feedback', 'Encerre a interação atual antes de criar outra.', true);
    return;
  }
  const ref = doc(collection(db, 'streams', stream.id, 'polls'));
  const data = { pollId: ref.id, kind, question, status: 'active', resultIndex: null, createdBy: user.uid, createdAt: serverTimestamp(), updatedAt: serverTimestamp(), count0:0, count1:0, count2:0, count3:0 };
  options.forEach((text, index) => { data[`option${index}`] = text; });
  for (let index = options.length; index < 4; index++) data[`option${index}`] = '';
  await setDoc(ref, data);
  feedback('#poll-create-feedback', 'Interação publicada.');
}

async function resolvePoll(resultIndex = null) {
  if (!activePoll) return;
  await updateDoc(doc(db, 'streams', stream.id, 'polls', activePoll.id), { status: resultIndex === null ? 'closed' : 'resolved', resultIndex, updatedAt: serverTimestamp() });
}

async function addSchedule() {
  const title = document.querySelector('#schedule-title').value.trim().slice(0,80);
  const raw = document.querySelector('#schedule-start').value;
  const startsAt = new Date(raw);
  if (!title || !raw || !Number.isFinite(startsAt.getTime()) || startsAt.getTime() <= Date.now()) {
    feedback('#schedule-feedback', 'Escolha título e uma data futura.', true);
    return;
  }
  const ref = doc(collection(db, 'channels', user.uid, 'schedule'));
  await setDoc(ref, { scheduleId: ref.id, channelId: user.uid, title, description: '', startsAt, createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
  await loadAll(); openTab('schedule');
}

async function createReward() {
  const title = document.querySelector('#reward-title').value.trim().slice(0,60);
  const description = document.querySelector('#reward-description').value.trim().slice(0,160);
  const cost = Math.floor(Number(document.querySelector('#reward-cost').value || 0));
  if (!title || cost < 1 || cost > 100000) {
    feedback('#reward-create-feedback', 'Informe nome e custo válido.', true);
    return;
  }
  const ref = doc(collection(db, 'channels', user.uid, 'rewards'));
  await setDoc(ref, { rewardId: ref.id, channelId: user.uid, title, description, cost, active: true, createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
  await loadAll(); openTab('monetization');
}

async function saveCreatorCode() {
  const value = document.querySelector('#creator-code').value.trim().toLowerCase();
  if (!/^[a-z0-9_-]{3,24}$/.test(value)) {
    feedback('#creator-code-feedback', 'Use 3–24 caracteres: letras minúsculas, números, _ ou -.', true);
    return;
  }
  try {
    const ref = doc(db, 'creatorCodes', value);
    const existing = await getDoc(ref);
    if (existing.exists() && existing.data().creatorUid !== user.uid) {
      feedback('#creator-code-feedback', 'Esse código já está em uso.', true);
      return;
    }
    if (creatorCode && creatorCode.code !== value) await deleteDoc(doc(db, 'creatorCodes', creatorCode.code));
    await setDoc(ref, { code: value, creatorUid: user.uid, createdAt: existing.exists() ? existing.data().createdAt : serverTimestamp(), updatedAt: serverTimestamp() });
    creatorCode = { code: value, creatorUid: user.uid };
    feedback('#creator-code-feedback', 'Código de criador salvo.');
  } catch (error) {
    feedback('#creator-code-feedback', 'Não foi possível salvar o código.', true);
  }
}

async function loadChannelProfileIntoForm() {
  const snap = await getDoc(doc(db, 'channelProfiles', user.uid)).catch(() => null);
  const data = snap?.exists?.() ? snap.data() : {};
  [['#channel-about','about'],['#channel-games','games'],['#channel-website','website'],['#channel-youtube','youtube'],['#channel-instagram','instagram'],['#channel-tiktok','tiktok']].forEach(([selector,key]) => { const el = document.querySelector(selector); if (el) el.value = data[key] || ''; });
}

async function saveChannelProfile() {
  const data = {
    uid: user.uid,
    about: document.querySelector('#channel-about').value.trim().slice(0,800),
    games: document.querySelector('#channel-games').value.trim().slice(0,160),
    website: safeUrl(document.querySelector('#channel-website').value),
    youtube: safeUrl(document.querySelector('#channel-youtube').value),
    instagram: safeUrl(document.querySelector('#channel-instagram').value),
    tiktok: safeUrl(document.querySelector('#channel-tiktok').value),
    updatedAt: serverTimestamp()
  };
  await setDoc(doc(db, 'channelProfiles', user.uid), data, { merge: true });
  feedback('#channel-profile-feedback', 'Perfil público do canal salvo.');
}

async function fulfillRedemption(id) {
  await updateDoc(doc(db, 'rewardRedemptions', id), { status: 'fulfilled', fulfilledBy: user.uid, fulfilledAt: serverTimestamp() });
  await loadAll();
}

async function deleteClip(id) {
  await deleteDoc(doc(db, 'clips', id));
  await loadAll(); openTab('analytics');
}

function bindCommunityActions() {
  document.querySelector('#close-poll')?.addEventListener('click', () => resolvePoll(null));
  document.querySelectorAll('[data-resolve-poll]').forEach(button => button.addEventListener('click', () => resolvePoll(Number(button.dataset.resolvePoll))));
}

function bindAllActions() {
  document.querySelector('#save-goal')?.addEventListener('click', saveGoal);
  document.querySelector('#save-alert-settings')?.addEventListener('click', saveAlertSettings);
  document.querySelector('#save-live-advanced')?.addEventListener('click', saveAdvancedLive);
  document.querySelector('#preview-alert-sound')?.addEventListener('click', async () => { await unlockSupportAlertAudio(); playSupportAlertSound(normalizeSupportAlertSound(document.querySelector('#alert-sound').value)); });
  document.querySelector('#save-chat-settings')?.addEventListener('click', saveChatSettings);
  document.querySelector('#overview-emergency')?.addEventListener('click', toggleEmergency);
  document.querySelector('#add-moderator')?.addEventListener('click', () => addRole('moderator'));
  document.querySelectorAll('[data-remove-moderator]').forEach(button => button.addEventListener('click', () => removeRole('moderator', button.dataset.removeModerator)));
  document.querySelector('#add-member')?.addEventListener('click', () => addRole('member'));
  document.querySelectorAll('[data-remove-member]').forEach(button => button.addEventListener('click', () => removeRole('member', button.dataset.removeMember)));
  document.querySelector('#create-poll')?.addEventListener('click', createPoll);
  bindCommunityActions();
  document.querySelector('#add-schedule')?.addEventListener('click', addSchedule);
  document.querySelectorAll('[data-delete-schedule]').forEach(button => button.addEventListener('click', async () => { await deleteDoc(doc(db, 'channels', user.uid, 'schedule', button.dataset.deleteSchedule)); await loadAll(); openTab('schedule'); }));
  document.querySelector('#create-reward')?.addEventListener('click', createReward);
  document.querySelectorAll('[data-toggle-reward]').forEach(button => button.addEventListener('click', async () => { const item = rewards.find(x => x.id === button.dataset.toggleReward); if (!item) return; await updateDoc(doc(db, 'channels', user.uid, 'rewards', item.id), { active: !item.active, updatedAt: serverTimestamp() }); await loadAll(); openTab('monetization'); }));
  document.querySelectorAll('[data-delete-reward]').forEach(button => button.addEventListener('click', async () => { await deleteDoc(doc(db, 'channels', user.uid, 'rewards', button.dataset.deleteReward)); await loadAll(); openTab('monetization'); }));
  document.querySelector('#save-creator-code')?.addEventListener('click', saveCreatorCode);
  document.querySelector('#save-channel-profile')?.addEventListener('click', saveChannelProfile);
  document.querySelectorAll('[data-fulfill]').forEach(button => button.addEventListener('click', () => fulfillRedemption(button.dataset.fulfill)));
  document.querySelectorAll('[data-delete-clip]').forEach(button => button.addEventListener('click', () => deleteClip(button.dataset.deleteClip)));
  document.querySelectorAll('[data-open-tab]').forEach(button => button.addEventListener('click', () => openTab(button.dataset.openTab)));
}

function refreshOverviewNumbers() {
  const status = document.querySelector('#cc-live-status');
  if (status) {
    status.className = stream.status === 'live' ? 'status-live' : 'status-offline';
    status.textContent = stream.status === 'live' ? '● AO VIVO' : 'OFFLINE';
  }
}

onAuthStateChanged(auth, current => {
  if (!current) {
    location.href = `login.html?redirect=${encodeURIComponent('creator-center.html')}`;
    return;
  }
  user = current;
  loadAll().catch(error => {
    console.error(error);
    root.innerHTML = '<div class="state">Não foi possível carregar o Centro do Criador.</div>';
  });
});

window.addEventListener('pagehide', () => {
  stopStream?.();
  stopPolls?.();
});

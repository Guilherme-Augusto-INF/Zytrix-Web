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
  runTransaction,
  increment,
  Timestamp,
  ensureWallet
} from './firebase.js';
import { escapeHtml, escapeAttr } from './ui.js';
import { safeStreamingUrl, safeImageUrl, safeSocialUrl } from './security.js';
import {
  getPlatformPreferences,
  recordWatchProgress,
  openMiniPlayer,
  levelFromXp,
  watchProgress
} from './platform-core.js';

const streamId = new URLSearchParams(location.search).get('stream') || localStorage.getItem('zytrixSelectedStream') || '';
const root = document.querySelector('#live-root');

let stream = null;
let streamerProfile = null;
let currentUser = null;
let balance = 0;
let selectedAmount = 50;
let preferences = null;
let supportAlerts = [];
let profiles = new Map();
let activePoll = null;
let chatSettings = null;
let following = false;
let member = false;
let moderator = false;
let stopStream = null;
let stopWallet = null;
let stopAlerts = null;
let stopPolls = null;
let stopReactions = null;
let stopSchedule = null;
let stopRewards = null;
let stopChatSettings = null;
let stopProgress = null;
let observer = null;
let renderTimer = null;
let matureSessionOverride = false;
let lastReactionIds = new Set();
let enhancedComposerSignature = '';

const REACTIONS = ['❤️', '😂', '🔥', '👏', '😮'];

function timestampMs(value) {
  const d = value?.toDate?.();
  return d ? d.getTime() : 0;
}

function formatClipTime(seconds) {
  const safe = Math.max(0, Math.floor(Number(seconds || 0)));
  const m = Math.floor(safe / 60);
  const s = safe % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

async function profileFor(uid) {
  if (!uid) return { username: 'Usuário', photoURL: '' };
  if (profiles.has(uid)) return profiles.get(uid);
  try {
    const snap = await getDoc(doc(db, 'profiles', uid));
    const value = snap.exists() ? snap.data() : { username: 'Usuário', photoURL: '' };
    profiles.set(uid, value);
    return value;
  } catch {
    return { username: 'Usuário', photoURL: '' };
  }
}

function scheduleRender() {
  clearTimeout(renderTimer);
  renderTimer = setTimeout(() => {
    mountExtras();
    enhanceChatComposer();
  }, 50);
}

function supportTotal() {
  return supportAlerts.reduce((sum, item) => sum + Math.max(0, Number(item.amount || 0)), 0);
}

async function leaderboardRows() {
  const totals = new Map();
  for (const item of supportAlerts) {
    const uid = String(item.fromUid || '');
    if (!uid) continue;
    totals.set(uid, (totals.get(uid) || 0) + Math.max(0, Number(item.amount || 0)));
  }
  const top = [...totals.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
  return Promise.all(top.map(async ([uid, amount], index) => ({ uid, amount, index, profile: await profileFor(uid) })));
}

function maturityBlocked() {
  return stream?.matureContent === true
    && !matureSessionOverride
    && (preferences?.hideMatureContent === true || preferences?.safeMode === true);
}

function renderMaturePreferenceGate(host) {
  if (!maturityBlocked()) return '';
  return `
    <div class="card panel" id="platform-mature-preference-gate" style="border-color:#7f1d1d">
      <div class="eyebrow">PREFERÊNCIA DE CONTEÚDO</div>
      <h2>Esta live está marcada como 18+</h2>
      <p class="muted">Você configurou sua conta para ocultar conteúdo maduro. A Zytrix não verifica idade e não substitui os controles da Twitch/Kick.</p>
      <button id="platform-show-mature-once" class="btn">Mostrar apenas nesta sessão</button>
    </div>
  `;
}

function hideBaseLiveForMature(blocked) {
  if (!root) return;
  [...root.children].forEach(child => {
    if (child.id === 'live-extras-root') return;
    child.style.display = blocked ? 'none' : '';
  });
}

async function renderSupportSection() {
  const rows = await leaderboardRows();
  const total = supportTotal();
  const goal = Math.max(0, Number(stream?.supportGoalCoins || 0));
  const goalLabel = String(stream?.supportGoalLabel || 'Meta de apoio');
  const pct = goal > 0 ? Math.min(100, Math.round((total / goal) * 100)) : 0;
  const username = streamerProfile?.username || 'Streamer';
  const own = currentUser?.uid === stream?.streamerUid;

  return `
    <section class="card panel zy-support-composer" id="zy-support-composer">
      <div class="eyebrow">APOIO INTERATIVO</div>
      <div style="display:flex;justify-content:space-between;gap:12px;align-items:flex-start;flex-wrap:wrap">
        <div>
          <h2 style="margin:4px 0">Apoie ${escapeHtml(username)}</h2>
          <p class="muted" style="margin:0">Seu saldo: ◈ <strong id="zy-extra-balance">${Number(balance || 0).toLocaleString('pt-BR')}</strong></p>
        </div>
        ${stream?.matureContent === true ? '<span class="mature-badge">18+</span>' : ''}
      </div>

      <div class="support-values">
        ${[10, 50, 100, 500].map(value => `<button type="button" class="btn ${value === selectedAmount ? 'active' : ''}" data-extra-support="${value}">◈ ${value}</button>`).join('')}
        <input id="zy-extra-custom-amount" class="input" style="width:150px" type="number" min="1" max="100000" placeholder="Outro valor">
      </div>
      <input id="zy-support-message" class="input zy-support-message" maxlength="120" placeholder="Mensagem opcional para aparecer no alerta (até 120 caracteres)">
      <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap">
        <button id="zy-extra-support-btn" class="btn btn-primary" ${own ? 'disabled' : ''}>Enviar apoio</button>
        <span class="muted" style="font-size:12px">A mensagem é pública para quem estiver assistindo.</span>
      </div>
      <div id="zy-extra-support-feedback"></div>
    </section>

    ${goal > 0 ? `
      <section class="goal-card">
        <div class="eyebrow">META DA LIVE</div>
        <strong>${escapeHtml(goalLabel)}</strong>
        <div class="goal-progress" aria-label="${pct}% da meta"><span style="width:${pct}%"></span></div>
        <div class="goal-copy"><span>◈ ${total.toLocaleString('pt-BR')}</span><span>◈ ${goal.toLocaleString('pt-BR')}</span></div>
      </section>
    ` : ''}

    <section class="leaderboard-card">
      <div class="eyebrow">TOP APOIADORES</div>
      <h3 style="margin:4px 0 10px">Nesta transmissão</h3>
      <div class="support-leaderboard">
        ${rows.length ? rows.map(row => `
          <div class="support-leaderboard-item">
            <span class="support-leaderboard-rank">#${row.index + 1}</span>
            ${row.profile?.photoURL
              ? `<img class="support-leaderboard-avatar" src="${escapeAttr(row.profile.photoURL)}" alt="">`
              : `<span class="support-leaderboard-avatar">${escapeHtml((row.profile?.username || 'A').charAt(0).toUpperCase())}</span>`}
            <strong>${escapeHtml(row.profile?.username || 'Apoiador')}</strong>
            <span>◈ ${row.amount.toLocaleString('pt-BR')}</span>
          </div>
        `).join('') : '<div class="muted">O ranking aparece quando chegar o primeiro apoio.</div>'}
      </div>
    </section>
  `;
}

function pollHtml() {
  if (!activePoll) return '';
  const options = [0, 1, 2, 3]
    .map(index => ({ index, text: String(activePoll[`option${index}`] || ''), count: Number(activePoll[`count${index}`] || 0) }))
    .filter(item => item.text);
  const total = options.reduce((sum, item) => sum + item.count, 0);
  return `
    <section class="poll-card">
      <div class="eyebrow">${activePoll.kind === 'prediction' ? 'PREDIÇÃO' : 'ENQUETE'}</div>
      <h3>${escapeHtml(activePoll.question || 'Pergunta')}</h3>
      <div class="poll-options">
        ${options.map(item => {
          const pct = total ? Math.round(item.count / total * 100) : 0;
          return `<button class="poll-option" data-poll-option="${item.index}" ${activePoll.status !== 'active' ? 'disabled' : ''}>
            <span class="poll-fill" style="width:${pct}%"></span>
            <span>${escapeHtml(item.text)}</span>
            <strong>${pct}%</strong>
          </button>`;
        }).join('')}
      </div>
      <div class="muted" style="font-size:12px;margin-top:8px">${total.toLocaleString('pt-BR')} voto(s)${activePoll.kind === 'prediction' ? ' · sem dinheiro, prêmio ou aposta' : ''}</div>
      ${activePoll.status === 'resolved' && Number.isInteger(activePoll.resultIndex)
        ? `<div class="message ok">Resultado: ${escapeHtml(activePoll[`option${activePoll.resultIndex}`] || '')}</div>` : ''}
      <div id="poll-feedback"></div>
    </section>
  `;
}

function toolbarHtml() {
  return `
    <div class="live-toolbar">
      <button id="zy-theater" class="btn" type="button">▣ Modo cinema</button>
      <button id="zy-mini" class="btn" type="button">↗ Mini player</button>
      <button id="zy-clip" class="btn" type="button">✂ Criar clipe</button>
      <a class="btn" href="denunciar.html?type=stream&target=${encodeURIComponent(streamId)}">⚑ Denunciar</a>
    </div>
  `;
}

function reactionHtml() {
  if (preferences?.allowReactions === false) return '';
  return `
    <section class="card panel">
      <div class="eyebrow">REAÇÕES AO VIVO</div>
      <div class="reaction-dock" aria-label="Enviar reação">
        ${REACTIONS.map(emoji => `<button class="reaction-button" data-reaction="${emoji}" type="button" aria-label="Reagir com ${emoji}">${emoji}</button>`).join('')}
      </div>
      <div class="autmod-note">As reações são visuais e não têm valor financeiro.</div>
    </section>
  `;
}

async function scheduleHtml() {
  if (!stream?.streamerUid) return '';
  try {
    const snap = await getDocs(query(collection(db, 'channels', stream.streamerUid, 'schedule'), orderBy('startsAt', 'asc'), limit(5)));
    const now = Date.now();
    const next = snap.docs.map(item => ({ id: item.id, ...item.data() })).find(item => timestampMs(item.startsAt) > now);
    if (!next) return '';
    const date = next.startsAt.toDate();
    return `<section class="schedule-card"><div class="eyebrow">PRÓXIMA LIVE</div><strong>${escapeHtml(next.title || 'Transmissão agendada')}</strong><time>${date.toLocaleString('pt-BR', { dateStyle: 'medium', timeStyle: 'short' })}</time></section>`;
  } catch {
    return '';
  }
}

async function rewardsHtml() {
  if (!stream?.streamerUid) return '';
  try {
    const snap = await getDocs(collection(db, 'channels', stream.streamerUid, 'rewards'));
    const rewards = snap.docs.map(item => ({ id: item.id, ...item.data() })).filter(item => item.active === true).slice(0, 6);
    if (!rewards.length) return '';
    return `
      <section class="card panel">
        <div class="eyebrow">LOJA DO CANAL</div>
        <h3 style="margin:4px 0 12px">Recompensas com Zy Coins</h3>
        <div class="reward-grid">
          ${rewards.map(item => `<article class="reward-card"><strong>${escapeHtml(item.title || 'Recompensa')}</strong><span class="muted">${escapeHtml(item.description || '')}</span><span class="reward-cost">◈ ${Number(item.cost || 0).toLocaleString('pt-BR')}</span><button class="btn" data-redeem-reward="${escapeAttr(item.id)}">Resgatar</button></article>`).join('')}
        </div>
        <div id="reward-feedback"></div>
      </section>
    `;
  } catch {
    return '';
  }
}

async function aboutHtml() {
  if (!stream?.streamerUid) return '';
  try {
    const snap = await getDoc(doc(db, 'channelProfiles', stream.streamerUid));
    if (!snap.exists()) return '';
    const data = snap.data();
    const links = [
      ['Site', safeSocialUrl('website', data.website)],
      ['YouTube', safeSocialUrl('youtube', data.youtube)],
      ['Instagram', safeSocialUrl('instagram', data.instagram)],
      ['TikTok', safeSocialUrl('tiktok', data.tiktok)]
    ].filter(([, value]) => value);
    return `<section class="card panel"><div class="eyebrow">SOBRE O CRIADOR</div><p>${escapeHtml(data.about || '')}</p>${data.games ? `<p class="muted">Conteúdos: ${escapeHtml(data.games)}</p>` : ''}<div class="live-interaction-row">${links.map(([label, url]) => `<a class="btn" href="${escapeAttr(url)}" target="_blank" rel="noopener noreferrer external" referrerpolicy="no-referrer">${escapeHtml(label)}</a>`).join('')}</div></section>`;
  } catch {
    return '';
  }
}

async function offlineDestinationHtml() {
  if (stream?.status === 'live') return '';
  const targetId = stream?.raidTargetStreamId || stream?.hostTargetStreamId || '';
  if (!targetId) return '';
  try {
    const snap = await getDoc(doc(db, 'streams', targetId));
    if (!snap.exists() || snap.data().status !== 'live') return '';
    const profile = await profileFor(snap.data().streamerUid);
    const kind = stream?.raidTargetStreamId ? 'Raid' : 'Host';
    return `<section class="${kind === 'Raid' ? 'raid-banner' : 'host-banner'}"><div><div class="eyebrow">${kind.toUpperCase()}</div><strong>Continue assistindo ${escapeHtml(profile.username || 'outro canal')}</strong></div><a class="btn btn-primary" href="live.html?stream=${encodeURIComponent(targetId)}">Ir para a live →</a></section>`;
  } catch {
    return '';
  }
}

async function mountExtras() {
  if (!root || !stream) return;
  let host = root.querySelector('#live-extras-root');
  if (!host) {
    host = document.createElement('section');
    host.id = 'live-extras-root';
    host.className = 'live-extras';
    root.appendChild(host);
  }

  if (maturityBlocked()) {
    hideBaseLiveForMature(true);
    host.innerHTML = renderMaturePreferenceGate(host);
    host.querySelector('#platform-show-mature-once')?.addEventListener('click', () => {
      matureSessionOverride = true;
      hideBaseLiveForMature(false);
      scheduleRender();
    });
    return;
  }
  hideBaseLiveForMature(false);

  const [support, schedule, rewards, about, destination] = await Promise.all([
    renderSupportSection(),
    scheduleHtml(),
    rewardsHtml(),
    aboutHtml(),
    offlineDestinationHtml()
  ]);

  host.innerHTML = `${toolbarHtml()}${destination}${support}${pollHtml()}${reactionHtml()}${schedule}${rewards}${about}`;

  // Esconde o compositor antigo para não existir dois fluxos de apoio.
  root.querySelector('.support-box')?.setAttribute('hidden', '');

  host.querySelectorAll('[data-extra-support]').forEach(button => {
    button.addEventListener('click', () => {
      selectedAmount = Number(button.dataset.extraSupport);
      host.querySelectorAll('[data-extra-support]').forEach(item => item.classList.toggle('active', item === button));
      const custom = host.querySelector('#zy-extra-custom-amount');
      if (custom) custom.value = '';
    });
  });
  host.querySelector('#zy-extra-support-btn')?.addEventListener('click', sendSupport);
  host.querySelector('#zy-theater')?.addEventListener('click', () => document.body.classList.toggle('zytrix-theater-mode'));
  host.querySelector('#zy-mini')?.addEventListener('click', () => {
    const popup = openMiniPlayer(streamId);
    if (!popup) alert('O navegador bloqueou a janela do mini player. Libere pop-ups para a Zytrix.');
  });
  host.querySelector('#zy-clip')?.addEventListener('click', createClip);
  host.querySelectorAll('[data-reaction]').forEach(button => button.addEventListener('click', () => sendReaction(button.dataset.reaction)));
  host.querySelectorAll('[data-poll-option]').forEach(button => button.addEventListener('click', () => votePoll(Number(button.dataset.pollOption))));
  host.querySelectorAll('[data-redeem-reward]').forEach(button => button.addEventListener('click', () => redeemReward(button.dataset.redeemReward)));
}

async function sendSupport() {
  const feedback = document.querySelector('#zy-extra-support-feedback');
  if (!currentUser) {
    feedback.innerHTML = '<div class="message err">Entre na sua conta para apoiar.</div>';
    return;
  }
  if (!currentUser.emailVerified) { feedback.innerHTML = '<div class="message err">Verifique seu e-mail para usar Zy Coins.</div>'; return; }
  if (currentUser.uid === stream.streamerUid) {
    feedback.innerHTML = '<div class="message err">Você não pode apoiar a própria live.</div>';
    return;
  }
  if (stream.status !== 'live') {
    feedback.innerHTML = '<div class="message err">A live precisa estar ao vivo.</div>';
    return;
  }
  const custom = Number(document.querySelector('#zy-extra-custom-amount')?.value || 0);
  const amount = custom || selectedAmount;
  const message = String(document.querySelector('#zy-support-message')?.value || '').trim().slice(0, 120);
  if (!Number.isInteger(amount) || amount < 1 || amount > 100000) {
    feedback.innerHTML = '<div class="message err">Valor inválido.</div>';
    return;
  }

  const button = document.querySelector('#zy-extra-support-btn');
  if (button) button.disabled = true;
  try {
    await ensureWallet(currentUser.uid);
    const senderRef = doc(db, 'wallets', currentUser.uid);
    const recipientRef = doc(db, 'wallets', stream.streamerUid);
    const txRef = doc(collection(db, 'zyCoinTransactions'));
    const alertRef = doc(db, 'streams', stream.id, 'supportAlerts', txRef.id);

    const commit = async createRecipient => runTransaction(db, async tx => {
      const sender = await tx.get(senderRef);
      if (!sender.exists() || Number(sender.data().balance || 0) < amount) throw new Error('saldo');
      const senderData = sender.data();
      tx.update(senderRef, {
        balance: Number(senderData.balance) - amount,
        totalSent: Number(senderData.totalSent || 0) + amount,
        lastTransactionId: txRef.id,
        updatedAt: serverTimestamp()
      });
      if (createRecipient) {
        tx.set(recipientRef, {
          uid: stream.streamerUid,
          balance: amount,
          totalSent: 0,
          totalReceived: amount,
          lastTransactionId: txRef.id,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp()
        });
      } else {
        tx.update(recipientRef, {
          balance: increment(amount),
          totalReceived: increment(amount),
          lastTransactionId: txRef.id,
          updatedAt: serverTimestamp()
        });
      }
      tx.set(txRef, {
        transactionId: txRef.id,
        fromUid: currentUser.uid,
        toUid: stream.streamerUid,
        streamId: stream.id,
        amount,
        message,
        type: 'stream_support',
        status: 'completed',
        createdAt: serverTimestamp()
      });
      tx.set(alertRef, {
        transactionId: txRef.id,
        fromUid: currentUser.uid,
        streamId: stream.id,
        amount,
        message,
        createdAt: serverTimestamp(),
        expiresAt: Timestamp.fromMillis(Date.now() + 24 * 60 * 60 * 1000)
      });
    });

    try {
      await commit(false);
    } catch (error) {
      if (String(error?.code || '').includes('not-found')) await commit(true);
      else throw error;
    }
    feedback.innerHTML = `<div class="message ok">Apoio de ◈ ${amount.toLocaleString('pt-BR')} enviado!</div>`;
    const input = document.querySelector('#zy-support-message');
    if (input) input.value = '';
  } catch (error) {
    console.error('Erro no apoio interativo:', error);
    feedback.innerHTML = `<div class="message err">${error?.message === 'saldo' ? 'Saldo insuficiente.' : 'Não foi possível enviar o apoio.'}</div>`;
  } finally {
    if (button) button.disabled = false;
  }
}

async function sendReaction(emoji) {
  if (!REACTIONS.includes(emoji)) return;
  if (!currentUser) {
    location.href = `login.html?redirect=${encodeURIComponent(location.pathname + location.search)}`;
    return;
  }
  if (!currentUser.emailVerified) return;
  const eventRef = doc(collection(db, 'streams', streamId, 'reactions'));
  const rateRef = doc(db, 'streams', streamId, 'reactionRate', currentUser.uid);
  try {
    await runTransaction(db, async tx => {
      const rate = await tx.get(rateRef);
      const last = rate.exists() ? timestampMs(rate.data().lastAt) : 0;
      if (last && Date.now() - last < 900) throw new Error('reaction-rate');
      tx.set(eventRef, { uid: currentUser.uid, emoji, createdAt: serverTimestamp(), expiresAt: Timestamp.fromMillis(Date.now() + 10 * 60 * 1000) });
      tx.set(rateRef, { uid: currentUser.uid, lastAt: serverTimestamp(), expiresAt: Timestamp.fromMillis(Date.now() + 2 * 60 * 60 * 1000) }, { merge: true });
    });
  } catch (error) {
    if (error?.message !== 'reaction-rate') console.warn('Reação não enviada.', error);
  }
}

function showReaction(emoji) {
  let layer = document.querySelector('#zy-reaction-layer');
  if (!layer) {
    layer = document.createElement('div');
    layer.id = 'zy-reaction-layer';
    layer.className = 'reaction-layer';
    document.body.appendChild(layer);
  }
  const node = document.createElement('span');
  node.className = 'reaction-pop';
  node.textContent = emoji;
  node.style.setProperty('--drift', `${Math.round((Math.random() - .5) * 70)}px`);
  node.style.left = `${30 + Math.round(Math.random() * 45)}%`;
  layer.appendChild(node);
  setTimeout(() => node.remove(), 2300);
}

async function votePoll(index) {
  const feedback = document.querySelector('#poll-feedback');
  if (!currentUser) {
    if (feedback) feedback.innerHTML = '<div class="message err">Entre na conta para votar.</div>';
    return;
  }
  if (!currentUser.emailVerified) { if (feedback) feedback.innerHTML = '<div class="message err">Verifique seu e-mail para votar.</div>'; return; }
  if (!activePoll || activePoll.status !== 'active' || ![0, 1, 2, 3].includes(index) || !activePoll[`option${index}`]) return;
  const pollRef = doc(db, 'streams', streamId, 'polls', activePoll.id);
  const voteRef = doc(db, 'streams', streamId, 'polls', activePoll.id, 'votes', currentUser.uid);
  try {
    await runTransaction(db, async tx => {
      const [pollSnap, voteSnap] = await Promise.all([tx.get(pollRef), tx.get(voteRef)]);
      if (!pollSnap.exists() || pollSnap.data().status !== 'active') throw new Error('poll-closed');
      if (voteSnap.exists()) throw new Error('already-voted');
      const poll = pollSnap.data();
      tx.update(pollRef, { [`count${index}`]: Number(poll[`count${index}`] || 0) + 1, updatedAt: serverTimestamp() });
      tx.set(voteRef, { uid: currentUser.uid, optionIndex: index, createdAt: serverTimestamp() });
    });
    if (feedback) feedback.innerHTML = '<div class="message ok">Voto registrado.</div>';
  } catch (error) {
    if (feedback) feedback.innerHTML = `<div class="message err">${error?.message === 'already-voted' ? 'Você já votou.' : 'Não foi possível votar.'}</div>`;
  }
}

async function createClip() {
  if (!currentUser) {
    location.href = `login.html?redirect=${encodeURIComponent(location.pathname + location.search)}`;
    return;
  }
  if (!currentUser.emailVerified) { alert('Verifique seu e-mail para criar clipes.'); return; }
  const title = window.prompt('Título do clipe:', `Momento de ${streamerProfile?.username || 'streamer'}`)?.trim();
  if (!title) return;
  const started = timestampMs(stream.startedAt);
  const momentSeconds = started ? Math.max(0, Math.floor((Date.now() - started) / 1000)) : 0;
  const ref = doc(collection(db, 'clips'));
  try {
    await setDoc(ref, {
      clipId: ref.id,
      streamId,
      streamerUid: stream.streamerUid,
      creatorUid: currentUser.uid,
      title: title.slice(0, 80),
      momentSeconds,
      sourceUrl: safeStreamingUrl(stream.vodURL || stream.playbackURL || ''),
      thumbnailURL: safeImageUrl(stream.thumbnailURL || ''),
      matureContent: stream.matureContent === true,
      createdAt: serverTimestamp()
    });
    alert(`Clipe salvo em ${formatClipTime(momentSeconds)}. Como a transmissão vem da Twitch/Kick, a Zytrix salva o momento e o link; o vídeo continua sujeito ao VOD/clipe da plataforma de origem.`);
  } catch (error) {
    console.error(error);
    alert('Não foi possível criar o clipe agora.');
  }
}

async function redeemReward(rewardId) {
  const feedback = document.querySelector('#reward-feedback');
  if (!currentUser) {
    if (feedback) feedback.innerHTML = '<div class="message err">Entre na conta para resgatar.</div>';
    return;
  }
  if (!currentUser.emailVerified) { if (feedback) feedback.innerHTML = '<div class="message err">Verifique seu e-mail para resgatar.</div>'; return; }
  if (currentUser.uid === stream.streamerUid) {
    if (feedback) feedback.innerHTML = '<div class="message err">O criador não pode resgatar a própria recompensa.</div>';
    return;
  }
  try {
    await ensureWallet(currentUser.uid);
    const rewardRef = doc(db, 'channels', stream.streamerUid, 'rewards', rewardId);
    const senderRef = doc(db, 'wallets', currentUser.uid);
    const recipientRef = doc(db, 'wallets', stream.streamerUid);
    const txRef = doc(collection(db, 'zyCoinTransactions'));
    const redemptionRef = doc(db, 'rewardRedemptions', txRef.id);

    const execute = async createRecipient => runTransaction(db, async tx => {
      const [rewardSnap, senderSnap] = await Promise.all([tx.get(rewardRef), tx.get(senderRef)]);
      if (!rewardSnap.exists() || rewardSnap.data().active !== true) throw new Error('reward-unavailable');
      const cost = Number(rewardSnap.data().cost || 0);
      if (!Number.isInteger(cost) || cost < 1) throw new Error('reward-unavailable');
      if (!senderSnap.exists() || Number(senderSnap.data().balance || 0) < cost) throw new Error('saldo');
      const sender = senderSnap.data();
      tx.update(senderRef, {
        balance: Number(sender.balance) - cost,
        totalSent: Number(sender.totalSent || 0) + cost,
        lastTransactionId: txRef.id,
        updatedAt: serverTimestamp()
      });
      if (createRecipient) {
        tx.set(recipientRef, { uid: stream.streamerUid, balance: cost, totalSent: 0, totalReceived: cost, lastTransactionId: txRef.id, createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
      } else {
        tx.update(recipientRef, { balance: increment(cost), totalReceived: increment(cost), lastTransactionId: txRef.id, updatedAt: serverTimestamp() });
      }
      tx.set(txRef, {
        transactionId: txRef.id,
        fromUid: currentUser.uid,
        toUid: stream.streamerUid,
        streamId,
        amount: cost,
        rewardId,
        type: 'reward_redeem',
        status: 'completed',
        createdAt: serverTimestamp()
      });
      tx.set(redemptionRef, {
        redemptionId: txRef.id,
        rewardId,
        channelId: stream.streamerUid,
        uid: currentUser.uid,
        cost,
        status: 'pending_fulfillment',
        createdAt: serverTimestamp()
      });
    });

    try { await execute(false); }
    catch (error) {
      if (String(error?.code || '').includes('not-found')) await execute(true);
      else throw error;
    }
    if (feedback) feedback.innerHTML = '<div class="message ok">Recompensa resgatada. O criador recebeu a solicitação.</div>';
  } catch (error) {
    console.error(error);
    if (feedback) feedback.innerHTML = `<div class="message err">${error?.message === 'saldo' ? 'Saldo insuficiente.' : 'Não foi possível resgatar.'}</div>`;
  }
}

async function loadRelationshipState() {
  following = false;
  member = false;
  moderator = false;
  if (!currentUser || !stream?.streamerUid) return;
  const [followSnap, memberSnap, modSnap] = await Promise.all([
    getDoc(doc(db, 'channels', stream.streamerUid, 'followers', currentUser.uid)).catch(() => null),
    getDoc(doc(db, 'channels', stream.streamerUid, 'members', currentUser.uid)).catch(() => null),
    getDoc(doc(db, 'streams', streamId, 'moderators', currentUser.uid)).catch(() => null)
  ]);
  following = Boolean(followSnap?.exists?.());
  member = Boolean(memberSnap?.exists?.());
  moderator = Boolean(modSnap?.exists?.());
}

function chatAccessAllowed() {
  if (!currentUser) return false;
  if (!chatSettings) return true;
  if (currentUser.uid === stream?.streamerUid || moderator) return true;
  if (chatSettings.emergencyMode === true) return false;
  if (chatSettings.mode === 'followers') return following;
  if (chatSettings.mode === 'members') return member;
  return true;
}

function textPassesAutoMod(text) {
  if (!chatSettings) return { ok: true };
  if (chatSettings.allowLinks === false && /(https?:\/\/|www\.)/i.test(text)) return { ok: false, reason: 'Links estão bloqueados neste chat.' };
  const blockedWords = Array.isArray(chatSettings.blockedWords) ? chatSettings.blockedWords.map(x => String(x).trim().toLowerCase()).filter(Boolean) : [];
  const lowered = text.toLowerCase();
  const hit = blockedWords.find(word => lowered.includes(word));
  if (hit) return { ok: false, reason: 'A mensagem contém um termo bloqueado pelo streamer.' };
  const letters = text.replace(/[^A-Za-zÀ-ÿ]/g, '');
  if (chatSettings.blockExcessCaps === true && letters.length >= 12) {
    const caps = letters.replace(/[^A-ZÀ-Þ]/g, '').length;
    if (caps / letters.length > .75) return { ok: false, reason: 'Evite excesso de letras maiúsculas.' };
  }
  return { ok: true };
}

function enhanceChatComposer() {
  if (!root || !stream) return;
  const oldInput = root.querySelector('#chat-input');
  const oldButton = root.querySelector('#chat-send');
  if (!oldInput || !oldButton) return;
  const signature = `${streamId}:${oldInput.dataset.zyEnhanced || ''}`;
  if (oldInput.dataset.zyEnhanced === '1') return;

  const input = oldInput.cloneNode(true);
  const button = oldButton.cloneNode(true);
  input.dataset.zyEnhanced = '1';
  button.dataset.zyEnhanced = '1';
  oldInput.replaceWith(input);
  oldButton.replaceWith(button);
  enhancedComposerSignature = signature;

  const send = async () => {
    const feedback = root.querySelector('#chat-feedback');
    if (!currentUser) {
      if (feedback) feedback.textContent = 'Faça login para conversar.';
      return;
    }
    if (!chatAccessAllowed()) {
      if (feedback) feedback.textContent = chatSettings?.emergencyMode ? 'Chat em modo de emergência.' : chatSettings?.mode === 'followers' ? 'Chat exclusivo para seguidores.' : 'Chat exclusivo para membros.';
      return;
    }
    if (!currentUser.emailVerified) { if (feedback) feedback.textContent = 'Verifique seu e-mail para conversar.'; return; }
    const text = input.value.trim();
    if (!text || text.length > 300) return;
    const autoMod = textPassesAutoMod(text);
    if (!autoMod.ok) {
      if (feedback) feedback.textContent = autoMod.reason;
      return;
    }
    const messageRef = doc(collection(db, 'streams', streamId, 'chat'));
    const rateRef = doc(db, 'streams', streamId, 'chatRate', currentUser.uid);
    try {
      await runTransaction(db, async tx => {
        const rate = await tx.get(rateRef);
        const last = rate.exists() ? timestampMs(rate.data().lastAt) : 0;
        const slow = Math.max(1, Math.min(120, Number(chatSettings?.slowModeSeconds || 0) || 1));
        if (last && Date.now() - last < slow * 1000) throw new Error('slow-mode');
        tx.set(messageRef, { uid: currentUser.uid, text, createdAt: serverTimestamp() });
        tx.set(rateRef, { uid: currentUser.uid, lastAt: serverTimestamp(), expiresAt: Timestamp.fromMillis(Date.now() + 2 * 60 * 60 * 1000) }, { merge: true });
      });
      input.value = '';
      const counter = root.querySelector('#chat-counter');
      if (counter) counter.textContent = '0/300';
      if (feedback) feedback.textContent = 'Enviado.';
    } catch (error) {
      console.error('Chat aprimorado:', error);
      if (feedback) feedback.textContent = error?.message === 'slow-mode' ? 'Aguarde o slow mode antes de enviar novamente.' : 'Não foi possível enviar a mensagem.';
    }
  };

  input.addEventListener('input', () => {
    const counter = root.querySelector('#chat-counter');
    if (counter) counter.textContent = `${input.value.length}/300`;
  });
  input.addEventListener('keydown', event => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      send();
    }
  });
  button.addEventListener('click', send);

  const allowed = chatAccessAllowed();
  input.disabled = !currentUser || stream.status !== 'live' || !allowed;
  button.disabled = input.disabled;
  if (!allowed && currentUser) input.placeholder = chatSettings?.emergencyMode ? 'Chat em modo de emergência' : chatSettings?.mode === 'followers' ? 'Somente seguidores' : 'Somente membros';
}

function watchReactions() {
  stopReactions?.();
  if (!streamId) return;
  stopReactions = onSnapshot(query(collection(db, 'streams', streamId, 'reactions'), orderBy('createdAt', 'desc'), limit(30)), snap => {
    if (!lastReactionIds.size) {
      snap.docs.forEach(item => lastReactionIds.add(item.id));
      return;
    }
    snap.docChanges().filter(change => change.type === 'added').forEach(change => {
      if (lastReactionIds.has(change.doc.id)) return;
      lastReactionIds.add(change.doc.id);
      const emoji = String(change.doc.data().emoji || '');
      if (REACTIONS.includes(emoji) && preferences?.allowReactions !== false) showReaction(emoji);
    });
    if (lastReactionIds.size > 200) lastReactionIds = new Set([...lastReactionIds].slice(-100));
  }, () => {});
}

function watchPolls() {
  stopPolls?.();
  stopPolls = onSnapshot(query(collection(db, 'streams', streamId, 'polls'), orderBy('createdAt', 'desc'), limit(5)), snap => {
    const polls = snap.docs.map(item => ({ id: item.id, ...item.data() }));
    activePoll = polls.find(item => item.status === 'active') || polls.find(item => item.status === 'resolved') || null;
    scheduleRender();
  }, () => {});
}

function watchSupportAlerts() {
  stopAlerts?.();
  stopAlerts = onSnapshot(query(collection(db, 'streams', streamId, 'supportAlerts'), orderBy('createdAt', 'desc'), limit(100)), snap => {
    supportAlerts = snap.docs.map(item => ({ id: item.id, ...item.data() }));
    scheduleRender();
  }, () => {});
}

function watchChatSettings() {
  stopChatSettings?.();
  stopChatSettings = onSnapshot(doc(db, 'streams', streamId, 'chatSettings', 'main'), snap => {
    chatSettings = snap.exists() ? snap.data() : { mode: 'everyone', slowModeSeconds: 0, allowLinks: true, blockExcessCaps: false, blockedWords: [], emergencyMode: false };
    scheduleRender();
  }, () => {
    chatSettings = { mode: 'everyone', slowModeSeconds: 0, allowLinks: true, blockExcessCaps: false, blockedWords: [], emergencyMode: false };
  });
}

async function setupForUser(user) {
  currentUser = user;
  stopWallet?.();
  stopWallet = null;
  balance = 0;
  if (user) {
    preferences = await getPlatformPreferences(user.uid).catch(() => null);
    stopWallet = onSnapshot(doc(db, 'wallets', user.uid), snap => {
      balance = snap.exists() ? Number(snap.data().balance || 0) : 0;
      const el = document.querySelector('#zy-extra-balance');
      if (el) el.textContent = balance.toLocaleString('pt-BR');
    }, () => {});
    await loadRelationshipState();
    recordWatchProgress(user.uid, streamId).catch(() => {});
    clearInterval(window.__zytrixWatchProgressTimer);
    window.__zytrixWatchProgressTimer = setInterval(() => recordWatchProgress(user.uid, streamId).catch(() => {}), 10 * 60 * 1000);
  } else {
    preferences = { hideMatureContent: false, safeMode: false, allowReactions: true };
    following = false;
    member = false;
    moderator = false;
  }
  scheduleRender();
}

async function initialize() {
  if (!root || !streamId) return;
  const snap = await getDoc(doc(db, 'streams', streamId));
  if (!snap.exists()) return;
  stream = { id: snap.id, ...snap.data() };
  streamerProfile = await profileFor(stream.streamerUid);

  stopStream = onSnapshot(doc(db, 'streams', streamId), async next => {
    if (!next.exists()) return;
    stream = { id: next.id, ...next.data() };
    streamerProfile = await profileFor(stream.streamerUid);
    await loadRelationshipState();
    scheduleRender();
  });

  watchSupportAlerts();
  watchPolls();
  watchReactions();
  watchChatSettings();

  observer = new MutationObserver(scheduleRender);
  observer.observe(root, { childList: true, subtree: false });
  scheduleRender();
}

onAuthStateChanged(auth, user => setupForUser(user).catch(error => console.warn('Recursos da live parcialmente indisponíveis.', error)));
initialize().catch(error => console.warn('Extras da live indisponíveis.', error));

window.addEventListener('pagehide', () => {
  stopStream?.();
  stopWallet?.();
  stopAlerts?.();
  stopPolls?.();
  stopReactions?.();
  stopSchedule?.();
  stopRewards?.();
  stopChatSettings?.();
  stopProgress?.();
  observer?.disconnect();
  clearInterval(window.__zytrixWatchProgressTimer);
});

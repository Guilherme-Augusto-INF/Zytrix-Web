import {
  auth,
  db,
  onAuthStateChanged,
  collection,
  doc,
  getDoc,
  query,
  orderBy,
  limit,
  onSnapshot,
  setDoc,
  updateDoc,
  deleteDoc,
  serverTimestamp
} from './firebase.js';
import { escapeHtml, escapeAttr } from './ui.js';

const streamId = new URLSearchParams(location.search).get('stream') || localStorage.getItem('zytrixSelectedStream') || '';
const root = document.querySelector('#live-root');
let user = null;
let stream = null;
let canModerate = false;
let isAdmin = false;
let isOwner = false;
let messages = [];
let stopMessages = null;
let stopStream = null;
let observer = null;
const profiles = new Map();

async function profileFor(uid) {
  if (profiles.has(uid)) return profiles.get(uid);
  const snap = await getDoc(doc(db, 'profiles', uid)).catch(() => null);
  const value = snap?.exists?.() ? snap.data() : { username: uid || 'Usuário' };
  profiles.set(uid, value);
  return value;
}

async function adminFor(uid) {
  const snap = await getDoc(doc(db, 'admins', uid)).catch(() => null);
  return snap?.exists?.() && snap.data().active === true;
}

async function evaluateAccess() {
  canModerate = false;
  isAdmin = false;
  isOwner = false;
  if (!user || !stream) return;
  isOwner = user.uid === stream.streamerUid;
  isAdmin = await adminFor(user.uid);
  const mod = await getDoc(doc(db, 'streams', streamId, 'moderators', user.uid)).catch(() => null);
  canModerate = isOwner || isAdmin || Boolean(mod?.exists?.());
  if (canModerate) startMessages();
  else stopMessages?.();
  render();
}

function startMessages() {
  stopMessages?.();
  stopMessages = onSnapshot(query(collection(db, 'streams', streamId, 'chat'), orderBy('createdAt', 'desc'), limit(25)), async snap => {
    messages = await Promise.all(snap.docs.map(async item => ({ id: item.id, ...item.data(), profile: await profileFor(item.data().uid) })));
    render();
  }, () => {});
}

function render() {
  if (!root) return;
  root.querySelector('#zy-moderator-console')?.remove();
  if (!canModerate) return;
  const panel = document.createElement('section');
  panel.id = 'zy-moderator-console';
  panel.className = 'card panel live-extras';
  panel.innerHTML = `
    <div style="display:flex;justify-content:space-between;gap:12px;align-items:center;flex-wrap:wrap">
      <div><div class="eyebrow">MODERAÇÃO</div><h2 style="margin:4px 0">Console ${isOwner ? 'do streamer' : isAdmin ? 'administrativo' : 'do moderador'}</h2></div>
      <button id="mod-emergency-toggle" class="btn">Alternar emergência</button>
    </div>
    <p class="muted">Últimas mensagens. Moderadores não podem punir o streamer nem administradores.</p>
    <div class="moderator-list">
      ${messages.length ? messages.map(item => `<div class="moderator-item"><span><strong>${escapeHtml(item.profile?.username || 'Usuário')}</strong>: ${escapeHtml(String(item.text || '').slice(0,120))}</span><div class="live-interaction-row"><button class="btn" data-mod-delete="${escapeAttr(item.id)}">Excluir</button>${item.uid !== user?.uid ? `<button class="btn" data-mod-mute="${escapeAttr(item.uid)}">Mute 10m</button><button class="btn btn-danger" data-mod-ban="${escapeAttr(item.uid)}">Ban</button>` : ''}</div></div>`).join('') : '<span class="muted">Nenhuma mensagem recente.</span>'}
    </div>
    <div id="mod-feedback"></div>
  `;
  root.appendChild(panel);
  panel.querySelector('#mod-emergency-toggle')?.addEventListener('click', toggleEmergency);
  panel.querySelectorAll('[data-mod-delete]').forEach(button => button.addEventListener('click', () => deleteMessage(button.dataset.modDelete)));
  panel.querySelectorAll('[data-mod-mute]').forEach(button => button.addEventListener('click', () => punish(button.dataset.modMute, 'mute')));
  panel.querySelectorAll('[data-mod-ban]').forEach(button => button.addEventListener('click', () => punish(button.dataset.modBan, 'ban')));
}

function feedback(text, error = false) {
  const el = document.querySelector('#mod-feedback');
  if (el) el.innerHTML = `<div class="message ${error ? 'err' : 'ok'}">${escapeHtml(text)}</div>`;
}

async function targetProtected(uid) {
  if (!uid) return true;
  if (uid === stream.streamerUid && !isAdmin) return true;
  if (!isAdmin && await adminFor(uid)) return true;
  return false;
}

async function deleteMessage(messageId) {
  try {
    const message = messages.find(item => item.id === messageId);
    if (!message || await targetProtected(message.uid)) {
      feedback('Você não pode moderar este usuário.', true);
      return;
    }
    await deleteDoc(doc(db, 'streams', streamId, 'chat', messageId));
  } catch (error) {
    feedback('Não foi possível excluir a mensagem.', true);
  }
}

async function punish(uid, type) {
  if (await targetProtected(uid)) {
    feedback('Você não pode moderar este usuário.', true);
    return;
  }
  try {
    await setDoc(doc(db, 'streams', streamId, 'chatBans', uid), {
      uid,
      bannedBy: user.uid,
      reason: type,
      createdAt: serverTimestamp(),
      expiresAt: type === 'mute' ? new Date(Date.now() + 10 * 60000) : null
    });
    feedback(type === 'mute' ? 'Usuário silenciado por 10 minutos.' : 'Usuário banido do chat.');
  } catch (error) {
    feedback('Não foi possível aplicar a moderação.', true);
  }
}

async function toggleEmergency() {
  try {
    const ref = doc(db, 'streams', streamId, 'chatSettings', 'main');
    const snap = await getDoc(ref);
    const current = snap.exists() ? snap.data() : { mode:'everyone', slowModeSeconds:0, allowLinks:true, blockExcessCaps:false, blockedWords:[], emergencyMode:false };
    await setDoc(ref, { ...current, emergencyMode: current.emergencyMode !== true, updatedBy: user.uid, updatedAt: serverTimestamp() });
    feedback(current.emergencyMode === true ? 'Modo emergência desativado.' : 'Modo emergência ativado.');
  } catch (error) {
    feedback('Não foi possível alterar o modo emergência.', true);
  }
}

onAuthStateChanged(auth, async current => {
  user = current;
  await evaluateAccess();
});

if (streamId) {
  stopStream = onSnapshot(doc(db, 'streams', streamId), async snap => {
    if (!snap.exists()) return;
    stream = { id: snap.id, ...snap.data() };
    await evaluateAccess();
  });
}

if (root) {
  observer = new MutationObserver(() => { if (canModerate && !root.querySelector('#zy-moderator-console')) render(); });
  observer.observe(root, { childList:true, subtree:false });
}

window.addEventListener('pagehide', () => { stopMessages?.(); stopStream?.(); observer?.disconnect(); });

import {
  db,
  collection,
  query,
  orderBy,
  limit,
  onSnapshot,
  doc,
  getDoc
} from './firebase.js';
import {
  installSupportAlertAudioUnlock,
  playSupportAlertSound,
  supportAlertAudioReady,
  unlockSupportAlertAudio,
  normalizeSupportAlertSound
} from './support-alert-sound.js';

const streamId = new URLSearchParams(location.search).get('stream') ||
  localStorage.getItem('zytrixSelectedStream') ||
  '';
const root = document.querySelector('#live-root');

let streamSound = 'coin';
let stopAlerts = null;
let stopStream = null;
let observer = null;
let baselineReady = false;
let showing = false;
let hideTimer = null;
const seen = new Set();
const queue = [];
const profileCache = new Map();

function timestampMs(value) {
  const date = value?.toDate?.();
  return date ? date.getTime() : 0;
}

async function profileFor(uid) {
  if (!uid) return { username: 'Apoiador', photoURL: '' };
  if (profileCache.has(uid)) return profileCache.get(uid);
  try {
    const snap = await getDoc(doc(db, 'profiles', uid));
    const value = snap.exists()
      ? {
          username: String(snap.data().username || 'Apoiador'),
          photoURL: String(snap.data().photoURL || '')
        }
      : { username: 'Apoiador', photoURL: '' };
    profileCache.set(uid, value);
    return value;
  } catch {
    return { username: 'Apoiador', photoURL: '' };
  }
}

function ensureStage() {
  if (!root) return null;
  let stage = root.querySelector('#support-alert-stage');
  if (stage) return stage;
  const player = root.querySelector('.player');
  if (!player) return null;
  stage = document.createElement('section');
  stage.id = 'support-alert-stage';
  stage.className = 'support-alert-stage';
  stage.setAttribute('aria-live', 'polite');
  stage.setAttribute('aria-atomic', 'true');
  player.parentElement?.insertBefore(stage, player);
  renderAudioControl(stage);
  return stage;
}

function renderAudioControl(stage = ensureStage()) {
  if (!stage) return;
  let control = stage.querySelector('#support-alert-audio-control');
  if (!control) {
    control = document.createElement('button');
    control.id = 'support-alert-audio-control';
    control.type = 'button';
    control.className = 'support-alert-audio-control';
    stage.appendChild(control);
  }
  if (streamSound === 'none') {
    control.hidden = true;
    return;
  }
  control.hidden = supportAlertAudioReady();
  control.textContent = '🔊 Ativar sons de apoio';
  control.onclick = async () => {
    if (await unlockSupportAlertAudio()) renderAudioControl(stage);
  };
}

function clearVisibleCard(stage) {
  stage?.querySelector('.support-alert-card')?.remove();
  showing = false;
  showNext();
}

async function showNext() {
  if (showing || !queue.length) return;
  const event = queue.shift();
  const stage = ensureStage();
  if (!stage) {
    queue.unshift(event);
    return;
  }
  showing = true;
  const profile = await profileFor(event.fromUid);
  const card = document.createElement('article');
  card.className = 'support-alert-card';

  const icon = document.createElement(profile.photoURL ? 'img' : 'span');
  icon.className = 'support-alert-avatar';
  if (profile.photoURL) {
    icon.src = profile.photoURL;
    icon.alt = '';
  } else {
    icon.textContent = (profile.username || 'A').charAt(0).toUpperCase();
  }

  const copy = document.createElement('div');
  copy.className = 'support-alert-copy';
  const eyebrow = document.createElement('span');
  eyebrow.className = 'support-alert-eyebrow';
  eyebrow.textContent = 'NOVO APOIO';
  const title = document.createElement('strong');
  title.textContent = `${profile.username || 'Apoiador'} enviou ◈ ${Number(event.amount || 0).toLocaleString('pt-BR')}`;
  const sub = document.createElement('span');
  sub.textContent = 'Obrigado por fortalecer esta live 💙';
  copy.append(eyebrow, title, sub);
  card.append(icon, copy);
  stage.appendChild(card);

  const played = playSupportAlertSound(streamSound);
  if (!played && streamSound !== 'none') renderAudioControl(stage);

  clearTimeout(hideTimer);
  hideTimer = setTimeout(() => {
    card.classList.add('is-leaving');
    setTimeout(() => clearVisibleCard(stage), 260);
  }, 4200);
}

function enqueue(events) {
  const sorted = [...events].sort((a, b) => timestampMs(a.createdAt) - timestampMs(b.createdAt));
  for (const event of sorted) {
    if (!event.transactionId || seen.has(event.transactionId)) continue;
    seen.add(event.transactionId);
    queue.push(event);
  }
  while (queue.length > 20) queue.shift();
  showNext();
}

function watchSupportAlerts() {
  if (!streamId || stopAlerts) return;
  const q = query(
    collection(db, 'streams', streamId, 'supportAlerts'),
    orderBy('createdAt', 'desc'),
    limit(20)
  );
  stopAlerts = onSnapshot(q, snapshot => {
    if (!baselineReady) {
      snapshot.docs.forEach(item => seen.add(item.id));
      baselineReady = true;
      return;
    }
    const added = snapshot.docChanges()
      .filter(change => change.type === 'added')
      .map(change => ({ transactionId: change.doc.id, ...change.doc.data() }));
    enqueue(added);
  }, error => console.warn('Alertas de apoio indisponíveis.', error));
}

function watchStreamSettings() {
  if (!streamId || stopStream) return;
  stopStream = onSnapshot(doc(db, 'streams', streamId), snap => {
    if (!snap.exists()) return;
    streamSound = normalizeSupportAlertSound(snap.data().supportAlertSound || 'coin');
    renderAudioControl();
  }, error => console.warn('Configuração de som indisponível.', error));
}

if (root && streamId) {
  installSupportAlertAudioUnlock(() => renderAudioControl());
  observer = new MutationObserver(() => ensureStage());
  observer.observe(root, { childList: true, subtree: true });
  ensureStage();
  watchStreamSettings();
  watchSupportAlerts();
}

window.addEventListener('pagehide', () => {
  stopAlerts?.();
  stopStream?.();
  observer?.disconnect();
  clearTimeout(hideTimer);
});

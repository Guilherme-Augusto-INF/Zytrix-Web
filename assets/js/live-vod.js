import { db, doc, onSnapshot } from './firebase.js';
import { escapeAttr } from './ui.js';
import { safeStreamingUrl } from './security.js';

const streamId = new URLSearchParams(location.search).get('stream') || localStorage.getItem('zytrixSelectedStream') || '';
const root = document.querySelector('#live-root');
let stream = null;
let stop = null;
let observer = null;

function validUrl(value) { return safeStreamingUrl(value); }

function mount() {
  if (!root || !stream) return;
  root.querySelector('#zy-vod-card')?.remove();
  const vod = validUrl(stream.vodURL);
  if (stream.status === 'live' || !vod) return;
  const card = document.createElement('section');
  card.id = 'zy-vod-card';
  card.className = 'card panel';
  card.innerHTML = `<div class="eyebrow">REPLAY / VOD</div><h2>A transmissão terminou, mas existe replay</h2><p class="muted">O VOD é hospedado pela plataforma de origem e continua sujeito às regras, login e disponibilidade dela.</p><a class="btn btn-primary" href="${escapeAttr(vod)}" target="_blank" rel="noopener noreferrer external" referrerpolicy="no-referrer">Assistir VOD →</a>`;
  root.appendChild(card);
}

if (streamId && root) {
  stop = onSnapshot(doc(db, 'streams', streamId), snap => {
    if (!snap.exists()) return;
    stream = { id: snap.id, ...snap.data() };
    mount();
  });
  observer = new MutationObserver(() => { if (stream && !root.querySelector('#zy-vod-card')) mount(); });
  observer.observe(root, { childList:true, subtree:false });
}

window.addEventListener('pagehide', () => { stop?.(); observer?.disconnect(); });

import {
  auth,
  db,
  onAuthStateChanged,
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  where,
  orderBy,
  limit,
  setDoc,
  serverTimestamp
} from './firebase.js';
import { escapeHtml, escapeAttr } from './ui.js';
import { achievementList, levelFromXp } from './platform-core.js';

const root = document.querySelector('#notifications-root');
let user = null;
let observer = null;
let data = { followers: [], clips: [], schedules: [], achievements: [] };

function tsMs(value) { return value?.toDate?.()?.getTime?.() || 0; }

async function profileFor(uid) {
  const snap = await getDoc(doc(db, 'profiles', uid)).catch(() => null);
  return snap?.exists?.() ? snap.data() : { username: 'Usuário' };
}

async function load() {
  if (!user) return;
  const [channelSnap, followingSnap, progressSnap] = await Promise.all([
    getDoc(doc(db, 'channels', user.uid)).catch(() => null),
    getDocs(collection(db, 'users', user.uid, 'following')).catch(() => null),
    getDoc(doc(db, 'users', user.uid, 'progress', 'main')).catch(() => null)
  ]);

  data.followers = [];
  data.clips = [];
  data.schedules = [];
  data.achievements = achievementList(progressSnap?.exists?.() ? progressSnap.data() : {}).filter(item => item.unlocked);

  if (channelSnap?.exists?.()) {
    const [followers, clips] = await Promise.all([
      getDocs(collection(db, 'channels', user.uid, 'followers')).catch(() => null),
      getDocs(query(collection(db, 'clips'), where('streamerUid', '==', user.uid), orderBy('createdAt', 'desc'), limit(20))).catch(() => null)
    ]);
    data.followers = await Promise.all((followers?.docs || []).map(async item => ({ id: item.id, ...item.data(), profile: await profileFor(item.id) })));
    data.followers.sort((a,b) => tsMs(b.followedAt) - tsMs(a.followedAt));
    data.clips = clips?.docs?.map(item => ({ id: item.id, ...item.data() })) || [];
  }

  const followed = followingSnap?.docs?.map(item => item.id) || [];
  const now = Date.now();
  for (const channelId of followed.slice(0,30)) {
    const snap = await getDocs(query(collection(db, 'channels', channelId, 'schedule'), orderBy('startsAt', 'asc'), limit(5))).catch(() => null);
    for (const item of snap?.docs || []) {
      const schedule = { id: item.id, channelId, ...item.data() };
      if (tsMs(schedule.startsAt) > now) data.schedules.push(schedule);
    }
  }
  data.schedules.sort((a,b) => tsMs(a.startsAt) - tsMs(b.startsAt));

  await setDoc(doc(db, 'users', user.uid, 'notificationState', 'platform'), {
    uid: user.uid,
    lastSeenAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  }, { merge: true }).catch(() => {});
  mount();
}

function mount() {
  if (!root || !user) return;
  root.querySelector('#notifications-plus')?.remove();
  const section = document.createElement('section');
  section.id = 'notifications-plus';
  section.className = 'platform-shell';
  section.style.marginTop = '16px';
  section.innerHTML = `
    ${data.followers.length ? `<div class="card panel"><div class="eyebrow">NOVOS SEGUIDORES</div><h2>Comunidade do seu canal</h2><div class="moderator-list">${data.followers.slice(0,12).map(item => `<div class="moderator-item"><span><strong>${escapeHtml(item.profile?.username || 'Usuário')}</strong> começou a seguir seu canal.</span><span class="muted">${item.followedAt?.toDate?.().toLocaleDateString('pt-BR') || ''}</span></div>`).join('')}</div></div>` : ''}
    ${data.clips.length ? `<div class="card panel"><div class="eyebrow">CLIPES</div><h2>Momentos do seu canal</h2><div class="moderator-list">${data.clips.slice(0,10).map(item => `<div class="moderator-item"><span>✂ <strong>${escapeHtml(item.title || 'Clipe')}</strong> foi marcado na sua transmissão.</span><a class="btn" href="clips.html?clip=${encodeURIComponent(item.id)}">Ver</a></div>`).join('')}</div></div>` : ''}
    ${data.schedules.length ? `<div class="card panel"><div class="eyebrow">AGENDA</div><h2>Lives que você acompanha</h2><div class="schedule-list">${data.schedules.slice(0,10).map(item => `<article class="schedule-card"><time>${item.startsAt.toDate().toLocaleString('pt-BR', { dateStyle:'medium', timeStyle:'short' })}</time><strong>${escapeHtml(item.title || 'Live agendada')}</strong><span class="muted">Canal ${escapeHtml(item.channelId)}</span></article>`).join('')}</div></div>` : ''}
    ${data.achievements.length ? `<div class="card panel"><div class="eyebrow">CONQUISTAS</div><h2>Seu progresso</h2><div class="achievement-grid">${data.achievements.map(item => `<article class="achievement-card unlocked"><strong>✓ ${escapeHtml(item.label)}</strong><span class="muted">${escapeHtml(item.description)}</span></article>`).join('')}</div><a class="btn" href="perfil.html#progresso">Ver nível e streak</a></div>` : ''}
  `;
  root.appendChild(section);
}

function tryMount() {
  if (!root?.querySelector('.state')) mount();
}

onAuthStateChanged(auth, current => {
  user = current;
  if (user) load().catch(() => {});
});

if (root) {
  observer = new MutationObserver(tryMount);
  observer.observe(root, { childList:true, subtree:false });
}

window.addEventListener('pagehide', () => observer?.disconnect());

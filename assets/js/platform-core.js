import {
  db,
  doc,
  getDoc,
  setDoc,
  deleteDoc,
  collection,
  onSnapshot,
  runTransaction,
  serverTimestamp
} from './firebase.js';

export const DEFAULT_PLATFORM_PREFERENCES = Object.freeze({
  hideMatureContent: false,
  safeMode: false,
  allowReactions: true,
  compactAlerts: false
});

export const LEVELS = Object.freeze([
  { level: 1, minXp: 0, label: 'Novato' },
  { level: 2, minXp: 100, label: 'Espectador' },
  { level: 3, minXp: 300, label: 'Regular' },
  { level: 4, minXp: 700, label: 'Veterano' },
  { level: 5, minXp: 1500, label: 'Superfã' },
  { level: 6, minXp: 3000, label: 'Lenda Zytrix' }
]);

function timestampMs(value) {
  const date = value?.toDate?.();
  return date ? date.getTime() : 0;
}

function utcDayKey(date = new Date()) {
  return date.toISOString().slice(0, 10);
}

function previousUtcDayKey(date = new Date()) {
  const copy = new Date(date.getTime() - 86400000);
  return utcDayKey(copy);
}

export function levelFromXp(value = 0) {
  const xp = Math.max(0, Number(value || 0));
  let current = LEVELS[0];
  for (const level of LEVELS) {
    if (xp >= level.minXp) current = level;
  }
  const next = LEVELS.find(level => level.level === current.level + 1) || null;
  return {
    ...current,
    xp,
    next,
    progress: next
      ? Math.max(0, Math.min(1, (xp - current.minXp) / (next.minXp - current.minXp)))
      : 1
  };
}

export function achievementList(progress = {}) {
  const xp = Number(progress.xp || 0);
  const watchMinutes = Number(progress.watchMinutes || 0);
  const streak = Number(progress.streakDays || 0);
  const level = levelFromXp(xp).level;
  return [
    { id: 'first-steps', label: 'Primeiros passos', description: 'Começou a explorar a Zytrix.', unlocked: xp >= 10 },
    { id: 'one-hour', label: 'Uma hora ao vivo', description: 'Assistiu pelo menos 60 minutos de lives.', unlocked: watchMinutes >= 60 },
    { id: 'five-hours', label: 'Maratonista', description: 'Assistiu pelo menos 5 horas de lives.', unlocked: watchMinutes >= 300 },
    { id: 'streak-3', label: 'Presença confirmada', description: 'Entrou na Zytrix por 3 dias seguidos.', unlocked: streak >= 3 },
    { id: 'streak-7', label: 'Semana Zytrix', description: 'Manteve uma sequência de 7 dias.', unlocked: streak >= 7 },
    { id: 'veteran', label: 'Veterano', description: 'Alcançou o nível 4.', unlocked: level >= 4 }
  ];
}

export async function getPlatformPreferences(uid) {
  if (!uid) return { ...DEFAULT_PLATFORM_PREFERENCES };
  const snap = await getDoc(doc(db, 'users', uid, 'preferences', 'platform'));
  return snap.exists()
    ? { ...DEFAULT_PLATFORM_PREFERENCES, ...snap.data() }
    : { ...DEFAULT_PLATFORM_PREFERENCES };
}

export function watchPlatformPreferences(uid, callback, onError) {
  if (!uid) {
    callback({ ...DEFAULT_PLATFORM_PREFERENCES });
    return () => {};
  }
  return onSnapshot(
    doc(db, 'users', uid, 'preferences', 'platform'),
    snap => callback(snap.exists()
      ? { ...DEFAULT_PLATFORM_PREFERENCES, ...snap.data() }
      : { ...DEFAULT_PLATFORM_PREFERENCES }),
    onError
  );
}

export async function savePlatformPreferences(uid, patch = {}) {
  if (!uid) throw new Error('auth-required');
  const allowed = {
    hideMatureContent: Boolean(patch.hideMatureContent),
    safeMode: Boolean(patch.safeMode),
    allowReactions: patch.allowReactions !== false,
    compactAlerts: Boolean(patch.compactAlerts),
    uid,
    updatedAt: serverTimestamp()
  };
  await setDoc(doc(db, 'users', uid, 'preferences', 'platform'), allowed, { merge: true });
}

export async function recordWatchProgress(uid, streamId) {
  if (!uid || !streamId) return null;
  const presence = await getDoc(doc(db, 'streams', streamId, 'viewers', uid)).catch(() => null);
  const seenAt = presence?.exists?.() ? timestampMs(presence.data().lastSeen) : 0;
  if (!seenAt || Date.now() - seenAt > 2 * 60 * 1000) return { skipped: true, reason: 'presence-required' };
  const ref = doc(db, 'users', uid, 'progress', 'main');
  const nowMs = Date.now();
  const today = utcDayKey();
  const yesterday = previousUtcDayKey();

  return runTransaction(db, async tx => {
    const snap = await tx.get(ref);
    const data = snap.exists() ? snap.data() : {};
    const lastRewardMs = timestampMs(data.lastWatchRewardAt);
    if (lastRewardMs && nowMs - lastRewardMs < 9 * 60 * 1000) {
      return { skipped: true, ...data };
    }

    const lastActiveDay = String(data.lastActiveDay || '');
    const streakDays = lastActiveDay === today
      ? Math.max(1, Number(data.streakDays || 1))
      : lastActiveDay === yesterday
        ? Math.max(1, Number(data.streakDays || 0) + 1)
        : 1;

    const next = {
      uid,
      xp: Math.max(0, Number(data.xp || 0)) + 10,
      watchMinutes: Math.max(0, Number(data.watchMinutes || 0)) + 10,
      streakDays,
      lastActiveDay: today,
      lastStreamId: streamId,
      lastWatchRewardAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      createdAt: snap.exists() ? (data.createdAt || serverTimestamp()) : serverTimestamp()
    };
    tx.set(ref, next, { merge: true });
    return next;
  });
}

export function watchProgress(uid, callback, onError) {
  if (!uid) {
    callback(null);
    return () => {};
  }
  return onSnapshot(doc(db, 'users', uid, 'progress', 'main'), snap => {
    callback(snap.exists() ? snap.data() : null);
  }, onError);
}

export async function setCategoryFollow(uid, categoryId, following) {
  if (!uid || !categoryId) throw new Error('invalid-category-follow');
  const ref = doc(db, 'users', uid, 'followedCategories', categoryId);
  if (!following) {
    await deleteDoc(ref);
    return;
  }
  await setDoc(ref, {
    uid,
    categoryId,
    followedAt: serverTimestamp()
  });
}

export function watchFollowedCategories(uid, callback, onError) {
  if (!uid) {
    callback(new Set());
    return () => {};
  }
  return onSnapshot(collection(db, 'users', uid, 'followedCategories'), snap => {
    callback(new Set(snap.docs.map(item => String(item.data().categoryId || item.id))));
  }, onError);
}

export async function saveCreatorAttribution(uid, code, creatorUid) {
  if (!uid) throw new Error('auth-required');
  if (!code || !creatorUid) {
    await deleteDoc(doc(db, 'users', uid, 'creatorAttribution', 'current'));
    return;
  }
  await setDoc(doc(db, 'users', uid, 'creatorAttribution', 'current'), {
    uid,
    code: String(code).toLowerCase(),
    creatorUid,
    updatedAt: serverTimestamp()
  });
}

export function recommendationScore(live, context = {}) {
  const viewers = Math.max(0, Number(live?.viewerCount || 0));
  const category = String(live?.categoryId || '').split(' - ')[0].trim();
  let score = Math.log2(viewers + 2) * 12;
  if (context.following?.has?.(live.streamerUid)) score += 80;
  if (context.followedCategories?.has?.(category)) score += 35;
  if (context.recentStreamers?.has?.(live.streamerUid)) score += 20;
  if (live?.matureContent === true && context.hideMatureContent) score -= 10000;
  return score;
}

export function filterMature(items = [], preferences = {}) {
  if (!preferences.hideMatureContent && !preferences.safeMode) return items;
  return items.filter(item => item?.matureContent !== true);
}

export function openMiniPlayer(streamId) {
  if (!streamId) return null;
  const url = new URL('live.html', location.href);
  url.searchParams.set('stream', streamId);
  url.searchParams.set('mini', '1');
  return window.open(
    url.toString(),
    `zytrix-mini-${streamId}`,
    'popup=yes,width=720,height=460,resizable=yes,scrollbars=no'
  );
}

export function relativeDate(timestamp) {
  const ms = timestampMs(timestamp);
  if (!ms) return 'agora';
  const delta = Date.now() - ms;
  if (delta < 60000) return 'agora';
  if (delta < 3600000) return `há ${Math.floor(delta / 60000)} min`;
  if (delta < 86400000) return `há ${Math.floor(delta / 3600000)} h`;
  return `há ${Math.floor(delta / 86400000)} d`;
}

import {
  db,
  collection,
  doc,
  getDoc,
  setDoc,
  updateDoc,
  deleteDoc,
  onSnapshot,
  serverTimestamp,
  writeBatch,
  query,
  limit,
  Timestamp
} from './firebase.js';

export function selectedStreamId() {
  return new URLSearchParams(location.search).get('stream')
    || localStorage.getItem('zytrixSelectedStream')
    || '';
}

export async function isFollowing(uid, channelId) {
  if (!uid || !channelId) return false;
  const snap = await getDoc(doc(db, 'users', uid, 'following', channelId));
  return snap.exists();
}

export async function setFollowState(uid, channelId, follow) {
  if (!uid || !channelId || uid === channelId) return;

  const followingRef = doc(db, 'users', uid, 'following', channelId);
  const followerRef = doc(db, 'channels', channelId, 'followers', uid);

  if (follow) {
    const [followingSnap, followerSnap] = await Promise.all([
      getDoc(followingRef),
      getDoc(followerRef)
    ]);

    // Repara um estado antigo/incompleto antes de criar o par de documentos.
    if (!followingSnap.exists() && followerSnap.exists()) {
      await deleteDoc(followerRef);
    }

    const batch = writeBatch(db);
    batch.set(followingRef, {
      channelId,
      followedAt: serverTimestamp()
    });
    batch.set(followerRef, {
      uid,
      followedAt: serverTimestamp()
    });
    await batch.commit();
    return;
  }

  const batch = writeBatch(db);
  batch.delete(followingRef);
  batch.delete(followerRef);
  await batch.commit();
}

export function watchFollowing(uid, callback, onError = console.error) {
  return onSnapshot(
    collection(db, 'users', uid, 'following'),
    snap => callback(new Set(snap.docs.map(item => item.id)), snap),
    onError
  );
}

export function watchFollowerCount(channelId, callback, onError = console.error) {
  return onSnapshot(
    query(collection(db, 'channels', channelId, 'followers'), limit(1001)),
    snap => callback(snap.size),
    onError
  );
}

function activePresenceCount(docs) {
  const threshold = Date.now() - 90_000;
  return docs.filter(data => {
    const millis = data.lastSeen?.toMillis?.() || 0;
    return millis >= threshold;
  }).length;
}

export function watchActiveViewers(streamId, callback, onError = console.error) {
  let cached = [];

  const recalculate = () => callback(activePresenceCount(cached));

  const unsubscribe = onSnapshot(
    query(collection(db, 'streams', streamId, 'viewers'), limit(5001)),
    snap => {
      cached = snap.docs.map(item => item.data());
      recalculate();
    },
    onError
  );

  const timer = setInterval(recalculate, 30_000);

  return () => {
    clearInterval(timer);
    unsubscribe();
  };
}

export async function startViewerPresence(uid, streamId) {
  if (!uid || !streamId) return () => {};

  const presenceRef = doc(db, 'streams', streamId, 'viewers', uid);
  const existing = await getDoc(presenceRef);

  if (existing.exists()) {
    await updateDoc(presenceRef, { lastSeen: serverTimestamp(), expiresAt: Timestamp.fromMillis(Date.now() + 2 * 60 * 1000) });
  } else {
    await setDoc(presenceRef, {
      uid,
      joinedAt: serverTimestamp(),
      lastSeen: serverTimestamp(),
      expiresAt: Timestamp.fromMillis(Date.now() + 2 * 60 * 1000)
    });
  }

  const heartbeat = async () => {
    try {
      await updateDoc(presenceRef, { lastSeen: serverTimestamp(), expiresAt: Timestamp.fromMillis(Date.now() + 2 * 60 * 1000) });
    } catch (error) {
      console.warn('Não foi possível atualizar a presença do espectador.', error);
    }
  };

  const timer = setInterval(heartbeat, 30_000);

  return () => {
    clearInterval(timer);
    deleteDoc(presenceRef).catch(() => {});
  };
}

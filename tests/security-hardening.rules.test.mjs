import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import {
  doc, setDoc, getDoc, getDocs, collection, query, limit,
  serverTimestamp, Timestamp, writeBatch, runTransaction, increment
} from 'firebase/firestore';

let env;
const as = (uid, verified = true) => env.authenticatedContext(uid, { email_verified: verified }).firestore();
const anon = () => env.unauthenticatedContext().firestore();

before(async () => {
  assert.match(process.env.FIRESTORE_EMULATOR_HOST || '', /^(127\.0\.0\.1|localhost):\d+$/);
  env = await initializeTestEnvironment({
    projectId: 'demo-zytrix-governance',
    firestore: { rules: readFileSync('firestore.rules', 'utf8') }
  });
});

after(async () => env?.cleanup());

beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async ctx => {
    const db = ctx.firestore();
    const old = Timestamp.fromMillis(1);
    await Promise.all([
      setDoc(doc(db, 'admins', 'admin'), { active: true }),
      setDoc(doc(db, 'channels', 'bob'), {
        ownerUid: 'bob', channelName: 'Bob', description: '', avatarURL: '', bannerURL: '',
        categoryId: 'Gaming', isLive: true, currentStreamId: 'live1', createdAt: old
      }),
      setDoc(doc(db, 'streams', 'live1'), {
        streamerUid: 'bob', channelId: 'bob', title: 'Live', description: '',
        categoryId: 'Gaming', thumbnailURL: '', status: 'live',
        playbackURL: 'https://www.twitch.tv/example', startedAt: old, endedAt: null,
        createdAt: old, viewerCount: 0
      }),
      setDoc(doc(db, 'wallets', 'alice'), {
        uid: 'alice', balance: 100, totalSent: 0, totalReceived: 0,
        lastTransactionId: 'seed-a', createdAt: old, updatedAt: old
      }),
      setDoc(doc(db, 'profiles', 'alice'), {
        uid: 'alice', username: 'Alice', photoURL: '', bio: '', createdAt: old, usernameUpdatedAt: old
      }),
      setDoc(doc(db, 'profiles', 'bob'), {
        uid: 'bob', username: 'Bob', photoURL: '', bio: '', createdAt: old, usernameUpdatedAt: old
      })
    ]);
  });
});

test('carteira nova começa em zero e exige e-mail verificado', async () => {
  const zero = {
    uid: 'carol', balance: 0, totalSent: 0, totalReceived: 0,
    lastTransactionId: '', createdAt: serverTimestamp(), updatedAt: serverTimestamp()
  };
  await assertSucceeds(setDoc(doc(as('carol'), 'wallets', 'carol'), zero));
  await assertFails(setDoc(doc(as('mallory'), 'wallets', 'mallory'), {
    ...zero, uid: 'mallory', balance: 500
  }));
  await assertFails(setDoc(doc(as('eve', false), 'wallets', 'eve'), {
    ...zero, uid: 'eve'
  }));
});

test('primeiro apoio não cria bônus escondido no destinatário', async () => {
  const db = as('alice');
  const sender = doc(db, 'wallets', 'alice');
  const recipient = doc(db, 'wallets', 'bob');
  const txRef = doc(db, 'zyCoinTransactions', 'support-sec');
  const alert = doc(db, 'streams', 'live1', 'supportAlerts', 'support-sec');
  const expiresAt = Timestamp.fromMillis(Date.now() + 24 * 60 * 60 * 1000);

  await assertSucceeds(runTransaction(db, async tx => {
    tx.update(sender, {
      balance: 50, totalSent: 50, totalReceived: 0,
      lastTransactionId: 'support-sec', updatedAt: serverTimestamp()
    });
    tx.set(recipient, {
      uid: 'bob', balance: 50, totalSent: 0, totalReceived: 50,
      lastTransactionId: 'support-sec', createdAt: serverTimestamp(), updatedAt: serverTimestamp()
    });
    tx.set(txRef, {
      transactionId: 'support-sec', fromUid: 'alice', toUid: 'bob', streamId: 'live1',
      amount: 50, type: 'stream_support', status: 'completed', createdAt: serverTimestamp()
    });
  }));
  await assertSucceeds(setDoc(alert, {
    transactionId: 'support-sec', fromUid: 'alice', streamId: 'live1', amount: 50,
    createdAt: serverTimestamp(), expiresAt
  }));
  const snap = await getDoc(doc(as('bob'), 'wallets', 'bob'));
  assert.equal(snap.data().balance, 50);
});

test('apoio e chat são bloqueados para e-mail não verificado', async () => {
  await assertFails(setDoc(doc(as('alice', false), 'streams', 'live1', 'chat', 'm1'), {
    uid: 'alice', text: 'oi', createdAt: serverTimestamp()
  }));
  await assertFails(setDoc(doc(as('alice', false), 'clips', 'c1'), {
    clipId: 'c1', streamId: 'live1', streamerUid: 'bob', creatorUid: 'alice',
    title: 'Momento', momentSeconds: 1, sourceUrl: 'https://www.twitch.tv/example',
    thumbnailURL: '', matureContent: false, createdAt: serverTimestamp()
  }));
});

test('admin não pode ser enumerado por usuário comum', async () => {
  await assertFails(getDoc(doc(as('alice'), 'admins', 'admin')));
  await assertFails(getDocs(query(collection(as('alice'), 'admins'), limit(10))));
  await assertSucceeds(getDoc(doc(as('admin'), 'admins', 'admin')));
  await assertSucceeds(getDocs(query(collection(as('admin'), 'admins'), limit(10))));
});

test('presença de espectadores é privada e tem TTL', async () => {
  const expiresAt = Timestamp.fromMillis(Date.now() + 2 * 60 * 1000);
  await assertSucceeds(setDoc(doc(as('alice'), 'streams', 'live1', 'viewers', 'alice'), {
    uid: 'alice', joinedAt: serverTimestamp(), lastSeen: serverTimestamp(), expiresAt
  }));
  await assertSucceeds(getDoc(doc(as('alice'), 'streams', 'live1', 'viewers', 'alice')));
  await assertFails(getDocs(query(collection(as('alice'), 'streams', 'live1', 'viewers'), limit(10))));
  await assertSucceeds(getDocs(query(collection(as('bob'), 'streams', 'live1', 'viewers'), limit(10))));
  await assertFails(setDoc(doc(as('mallory'), 'streams', 'live1', 'viewers', 'mallory'), {
    uid: 'mallory', joinedAt: serverTimestamp(), lastSeen: serverTimestamp()
  }));
});

test('grafo de seguidores não pode ser listado por terceiros', async () => {
  await env.withSecurityRulesDisabled(ctx => setDoc(
    doc(ctx.firestore(), 'channels', 'bob', 'followers', 'alice'),
    { uid: 'alice', followedAt: Timestamp.fromMillis(1) }
  ));
  await assertSucceeds(getDoc(doc(as('alice'), 'channels', 'bob', 'followers', 'alice')));
  await assertFails(getDocs(query(collection(as('alice'), 'channels', 'bob', 'followers'), limit(10))));
  await assertSucceeds(getDocs(query(collection(as('bob'), 'channels', 'bob', 'followers'), limit(10))));
});

test('URLs inseguras e imagens de tracking são recusadas pelas Rules', async () => {
  const db = as('alice');
  const old = Timestamp.fromMillis(1);
  await assertFails(setDoc(doc(db, 'profiles', 'alice'), {
    uid: 'alice', username: 'Alice', photoURL: 'https://tracker.example/pixel.png', bio: '',
    createdAt: old, usernameUpdatedAt: old
  }));
  await assertFails(setDoc(doc(db, 'clips', 'bad-url'), {
    clipId: 'bad-url', streamId: 'live1', streamerUid: 'bob', creatorUid: 'alice',
    title: 'Malicioso', momentSeconds: 1, sourceUrl: 'javascript:alert(1)',
    thumbnailURL: '', matureContent: false, createdAt: serverTimestamp()
  }));
  await assertFails(setDoc(doc(as('bob'), 'channelProfiles', 'bob'), {
    uid: 'bob', about: '', games: '', website: 'https://example.com',
    youtube: 'https://evil.example/youtube', instagram: '', tiktok: '', updatedAt: serverTimestamp()
  }));
});

test('chat exige rate document mesmo com slow mode zero', async () => {
  await env.withSecurityRulesDisabled(async ctx => {
    const db = ctx.firestore();
    await setDoc(doc(db, 'streams', 'live1', 'chatSettings', 'main'), {
      mode: 'everyone', slowModeSeconds: 0, allowLinks: true, blockExcessCaps: false,
      blockedWords: [], emergencyMode: false, updatedBy: 'bob', updatedAt: Timestamp.fromMillis(1)
    });
  });
  await assertFails(setDoc(doc(as('alice'), 'streams', 'live1', 'chat', 'without-rate'), {
    uid: 'alice', text: 'spam', createdAt: serverTimestamp()
  }));
  const db = as('alice');
  const batch = writeBatch(db);
  batch.set(doc(db, 'streams', 'live1', 'chatRate', 'alice'), {
    uid: 'alice', lastAt: serverTimestamp(),
    expiresAt: Timestamp.fromMillis(Date.now() + 2 * 60 * 60 * 1000)
  });
  batch.set(doc(db, 'streams', 'live1', 'chat', 'with-rate'), {
    uid: 'alice', text: 'mensagem válida', createdAt: serverTimestamp()
  });
  await assertSucceeds(batch.commit());
});

test('reação pública é efêmera e exige rate limit atômico', async () => {
  const db = as('alice');
  const batch = writeBatch(db);
  batch.set(doc(db, 'streams', 'live1', 'reactionRate', 'alice'), {
    uid: 'alice', lastAt: serverTimestamp(),
    expiresAt: Timestamp.fromMillis(Date.now() + 2 * 60 * 60 * 1000)
  });
  batch.set(doc(db, 'streams', 'live1', 'reactions', 'r1'), {
    uid: 'alice', emoji: '🔥', createdAt: serverTimestamp(),
    expiresAt: Timestamp.fromMillis(Date.now() + 10 * 60 * 1000)
  });
  await assertSucceeds(batch.commit());
  await assertSucceeds(getDoc(doc(anon(), 'streams', 'live1', 'reactions', 'r1')));
});

test('mint promocional pelo cliente está pausado', async () => {
  await env.withSecurityRulesDisabled(ctx => setDoc(doc(ctx.firestore(), 'coinPromotions', 'p1'), {
    promotionId: 'p1', title: 'Promo', description: '', amount: 25, maxClaims: 100,
    claimCount: 0, active: true, startsAt: Timestamp.fromMillis(1),
    endsAt: Timestamp.fromMillis(Date.now() + 3600000), createdBy: 'admin',
    createdAt: Timestamp.fromMillis(1), updatedAt: Timestamp.fromMillis(1)
  }));
  await assertFails(setDoc(doc(as('alice'), 'coinPromotions', 'p1', 'claims', 'alice'), {
    uid: 'alice', promotionId: 'p1', amount: 25, transactionId: 'x', createdAt: serverTimestamp()
  }));
});


test('YouTube Live é aceito e domínio falso continua bloqueado', async () => {
  const db = as('bob');
  await assertSucceeds(setDoc(doc(db, 'streams', 'live1'), {
    playbackURL: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ'
  }, { merge: true }));

  const snap = await getDoc(doc(db, 'streams', 'live1'));
  assert.equal(snap.data().playbackURL, 'https://www.youtube.com/watch?v=dQw4w9WgXcQ');

  await assertFails(setDoc(doc(db, 'streams', 'live1'), {
    playbackURL: 'https://youtube.com.evil.example/watch?v=dQw4w9WgXcQ'
  }, { merge: true }));
});

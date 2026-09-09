import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import {
  doc, setDoc, getDoc, collection, serverTimestamp, Timestamp,
  updateDoc, deleteDoc, writeBatch, runTransaction, increment
} from 'firebase/firestore';

let env;
const as = id => env.authenticatedContext(id, { email_verified: true }).firestore();
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
  await env.withSecurityRulesDisabled(async context => {
    const db = context.firestore();
    const old = Timestamp.fromMillis(1);
    await Promise.all([
      setDoc(doc(db, 'admins', 'admin'), { active: true }),
      setDoc(doc(db, 'streams', 'live1'), {
        streamerUid: 'bob', channelId: 'bob', title: 'Live', description: '',
        categoryId: 'Gaming', thumbnailURL: '', status: 'live',
        playbackURL: 'https://www.twitch.tv/example', startedAt: old, endedAt: null,
        createdAt: old, viewerCount: 0
      }),
      setDoc(doc(db, 'wallets', 'alice'), {
        uid: 'alice', balance: 500, totalSent: 0, totalReceived: 0,
        lastTransactionId: 'seed-a', createdAt: old, updatedAt: old
      }),
      setDoc(doc(db, 'wallets', 'bob'), {
        uid: 'bob', balance: 500, totalSent: 0, totalReceived: 0,
        lastTransactionId: 'seed-b', createdAt: old, updatedAt: old
      }),
      setDoc(doc(db, 'profiles', 'alice'), { uid: 'alice', username: 'Alice' }),
      setDoc(doc(db, 'profiles', 'bob'), { uid: 'bob', username: 'Bob' })
    ]);
  });
});

test('preferências são privadas e só o titular pode gravar', async () => {
  const ref = doc(as('alice'), 'users', 'alice', 'preferences', 'platform');
  await assertSucceeds(setDoc(ref, {
    uid: 'alice', hideMatureContent: true, safeMode: true,
    allowReactions: false, compactAlerts: true, updatedAt: serverTimestamp()
  }));
  await assertSucceeds(getDoc(ref));
  await assertFails(getDoc(doc(as('bob'), 'users', 'alice', 'preferences', 'platform')));
  await assertFails(setDoc(doc(as('bob'), 'users', 'alice', 'preferences', 'platform'), {
    uid: 'alice', hideMatureContent: false, safeMode: false,
    allowReactions: true, compactAlerts: false, updatedAt: serverTimestamp()
  }));
});

test('progresso começa em 10 XP e não permite farm imediato ou valor arbitrário', async () => {
  await env.withSecurityRulesDisabled(context => setDoc(
    doc(context.firestore(), 'streams', 'live1', 'viewers', 'alice'),
    { uid:'alice', joinedAt:Timestamp.fromMillis(Date.now()-1000), lastSeen:Timestamp.fromMillis(Date.now()), expiresAt:Timestamp.fromMillis(Date.now()+120000) }
  ));
  const ref = doc(as('alice'), 'users', 'alice', 'progress', 'main');
  const base = {
    uid: 'alice', xp: 10, watchMinutes: 10, streakDays: 1,
    lastActiveDay: '2026-09-08', lastStreamId: 'live1',
    lastWatchRewardAt: serverTimestamp(), updatedAt: serverTimestamp(), createdAt: serverTimestamp()
  };
  await assertSucceeds(setDoc(ref, base));
  await assertFails(updateDoc(ref, {
    xp: 20, watchMinutes: 20, streakDays: 1, lastActiveDay: '2026-09-08',
    lastStreamId: 'live1', lastWatchRewardAt: serverTimestamp(), updatedAt: serverTimestamp()
  }));
  await assertFails(setDoc(doc(as('bob'), 'users', 'bob', 'progress', 'main'), {
    ...base, uid: 'bob', xp: 9999
  }));
});

test('seguir categoria é exclusivo da própria conta e bloqueia update', async () => {
  const ref = doc(as('alice'), 'users', 'alice', 'followedCategories', 'Gaming');
  await assertSucceeds(setDoc(ref, { uid: 'alice', categoryId: 'Gaming', followedAt: serverTimestamp() }));
  await assertFails(updateDoc(ref, { categoryId: 'IRL' }));
  await assertFails(setDoc(doc(as('bob'), 'users', 'alice', 'followedCategories', 'IRL'), {
    uid: 'alice', categoryId: 'IRL', followedAt: serverTimestamp()
  }));
  await assertSucceeds(deleteDoc(ref));
});

test('agenda, recompensa e perfil público do canal só podem ser geridos pelo dono/admin', async () => {
  const startsAt = Timestamp.fromMillis(Date.now() + 3600000);
  await assertSucceeds(setDoc(doc(as('bob'), 'channels', 'bob', 'schedule', 's1'), {
    scheduleId: 's1', channelId: 'bob', title: 'Live marcada', description: '',
    startsAt, createdAt: serverTimestamp(), updatedAt: serverTimestamp()
  }));
  await assertFails(setDoc(doc(as('alice'), 'channels', 'bob', 'schedule', 's2'), {
    scheduleId: 's2', channelId: 'bob', title: 'Falsa', description: '',
    startsAt, createdAt: serverTimestamp(), updatedAt: serverTimestamp()
  }));

  await assertSucceeds(setDoc(doc(as('bob'), 'channels', 'bob', 'rewards', 'r1'), {
    rewardId: 'r1', channelId: 'bob', title: 'Escolher jogo', description: '',
    cost: 100, active: true, createdAt: serverTimestamp(), updatedAt: serverTimestamp()
  }));
  await assertFails(setDoc(doc(as('alice'), 'channels', 'bob', 'rewards', 'r2'), {
    rewardId: 'r2', channelId: 'bob', title: 'Fake', description: '',
    cost: 1, active: true, createdAt: serverTimestamp(), updatedAt: serverTimestamp()
  }));

  await assertSucceeds(setDoc(doc(as('bob'), 'channelProfiles', 'bob'), {
    uid: 'bob', about: 'Criador', games: 'Valorant', website: '', youtube: '',
    instagram: '', tiktok: '', updatedAt: serverTimestamp()
  }));
  await assertFails(setDoc(doc(as('alice'), 'channelProfiles', 'bob'), {
    uid: 'bob', about: 'Invadido', games: '', website: '', youtube: '',
    instagram: '', tiktok: '', updatedAt: serverTimestamp()
  }));
});

test('código de criador não pode ser sequestrado por outra conta', async () => {
  const ref = doc(as('bob'), 'creatorCodes', 'boblive');
  await assertSucceeds(setDoc(ref, {
    code: 'boblive', creatorUid: 'bob', createdAt: serverTimestamp(), updatedAt: serverTimestamp()
  }));
  await assertFails(updateDoc(doc(as('alice'), 'creatorCodes', 'boblive'), {
    creatorUid: 'alice', updatedAt: serverTimestamp()
  }));
  await assertSucceeds(setDoc(doc(as('alice'), 'users', 'alice', 'creatorAttribution', 'current'), {
    uid: 'alice', code: 'boblive', creatorUid: 'bob', updatedAt: serverTimestamp()
  }));
});

test('clipe válido é público; criador não pode falsificar streamer ou editar depois', async () => {
  const ref = doc(as('alice'), 'clips', 'clip1');
  await assertSucceeds(setDoc(ref, {
    clipId: 'clip1', streamId: 'live1', streamerUid: 'bob', creatorUid: 'alice',
    title: 'Momento', momentSeconds: 45, sourceUrl: 'https://www.twitch.tv/example',
    thumbnailURL: '', matureContent: false, createdAt: serverTimestamp()
  }));
  await assertSucceeds(getDoc(doc(anon(), 'clips', 'clip1')));
  await assertFails(updateDoc(ref, { title: 'Alterado' }));
  await assertFails(setDoc(doc(as('alice'), 'clips', 'clip2'), {
    clipId: 'clip2', streamId: 'live1', streamerUid: 'alice', creatorUid: 'alice',
    title: 'Fake', momentSeconds: 0, sourceUrl: '', thumbnailURL: '',
    matureContent: false, createdAt: serverTimestamp()
  }));
});

test('somente streamer/admin adiciona moderador; moderador pode configurar chat sem virar admin global', async () => {
  const modRef = doc(as('bob'), 'streams', 'live1', 'moderators', 'carol');
  await assertSucceeds(setDoc(modRef, { uid: 'carol', addedBy: 'bob', createdAt: serverTimestamp() }));
  await assertFails(setDoc(doc(as('alice'), 'streams', 'live1', 'moderators', 'mallory'), {
    uid: 'mallory', addedBy: 'alice', createdAt: serverTimestamp()
  }));
  await assertSucceeds(setDoc(doc(as('carol'), 'streams', 'live1', 'chatSettings', 'main'), {
    mode: 'followers', slowModeSeconds: 5, allowLinks: false,
    blockExcessCaps: true, blockedWords: ['spam'], emergencyMode: false,
    updatedBy: 'carol', updatedAt: serverTimestamp()
  }));
  await assertFails(setDoc(doc(as('carol'), 'admins', 'carol'), { active: true }));
});

test('chat followers-only bloqueia não seguidor e libera seguidor', async () => {
  await env.withSecurityRulesDisabled(async context => {
    const db = context.firestore();
    await setDoc(doc(db, 'streams', 'live1', 'chatSettings', 'main'), {
      mode: 'followers', slowModeSeconds: 0, allowLinks: true,
      blockExcessCaps: false, blockedWords: [], emergencyMode: false,
      updatedBy: 'bob', updatedAt: Timestamp.fromMillis(1)
    });
  });
  const denied = writeBatch(as('alice'));
  denied.set(doc(as('alice'), 'streams', 'live1', 'chatRate', 'alice'), {
    uid:'alice', lastAt:serverTimestamp(), expiresAt:Timestamp.fromMillis(Date.now()+2*60*60*1000)
  });
  denied.set(doc(as('alice'), 'streams', 'live1', 'chat', 'm1'), {
    uid: 'alice', text: 'oi', createdAt: serverTimestamp()
  });
  await assertFails(denied.commit());
  await env.withSecurityRulesDisabled(context => setDoc(
    doc(context.firestore(), 'channels', 'bob', 'followers', 'alice'),
    { uid: 'alice', followedAt: Timestamp.fromMillis(1) }
  ));
  const db = as('alice');
  const allowed = writeBatch(db);
  allowed.set(doc(db, 'streams', 'live1', 'chatRate', 'alice'), {
    uid:'alice', lastAt:serverTimestamp(), expiresAt:Timestamp.fromMillis(Date.now()+2*60*60*1000)
  });
  allowed.set(doc(db, 'streams', 'live1', 'chat', 'm2'), {
    uid: 'alice', text: 'agora posso falar', createdAt: serverTimestamp()
  });
  await assertSucceeds(allowed.commit());
});

test('reação exige rate document atômico e emoji permitido', async () => {
  const db = as('alice');
  await assertFails(setDoc(doc(db, 'streams', 'live1', 'reactions', 'bad1'), {
    uid: 'alice', emoji: '🔥', createdAt: serverTimestamp(), expiresAt:Timestamp.fromMillis(Date.now()+10*60*1000)
  }));
  const batch = writeBatch(db);
  batch.set(doc(db, 'streams', 'live1', 'reactionRate', 'alice'), {
    uid: 'alice', lastAt: serverTimestamp(), expiresAt:Timestamp.fromMillis(Date.now()+2*60*60*1000)
  });
  batch.set(doc(db, 'streams', 'live1', 'reactions', 'ok1'), {
    uid: 'alice', emoji: '🔥', createdAt: serverTimestamp(), expiresAt:Timestamp.fromMillis(Date.now()+10*60*1000)
  });
  await assertSucceeds(batch.commit());
  const invalid = writeBatch(db);
  invalid.update(doc(db, 'streams', 'live1', 'reactionRate', 'alice'), { lastAt: serverTimestamp(), expiresAt:Timestamp.fromMillis(Date.now()+2*60*60*1000) });
  invalid.set(doc(db, 'streams', 'live1', 'reactions', 'bad2'), {
    uid: 'alice', emoji: '💰', createdAt: serverTimestamp(), expiresAt:Timestamp.fromMillis(Date.now()+10*60*1000)
  });
  await assertFails(invalid.commit());
});

test('enquete criada pelo streamer aceita um voto atômico e bloqueia voto duplicado', async () => {
  const pollRef = doc(as('bob'), 'streams', 'live1', 'polls', 'p1');
  await assertSucceeds(setDoc(pollRef, {
    pollId: 'p1', kind: 'poll', question: 'Qual?', option0: 'A', option1: 'B',
    option2: '', option3: '', count0: 0, count1: 0, count2: 0, count3: 0,
    status: 'active', resultIndex: null, createdBy: 'bob',
    createdAt: serverTimestamp(), updatedAt: serverTimestamp()
  }));

  const db = as('alice');
  const voteBatch = writeBatch(db);
  voteBatch.update(doc(db, 'streams', 'live1', 'polls', 'p1'), {
    count0: 1, updatedAt: serverTimestamp()
  });
  voteBatch.set(doc(db, 'streams', 'live1', 'polls', 'p1', 'votes', 'alice'), {
    uid: 'alice', optionIndex: 0, createdAt: serverTimestamp()
  });
  await assertSucceeds(voteBatch.commit());

  const duplicate = writeBatch(db);
  duplicate.update(doc(db, 'streams', 'live1', 'polls', 'p1'), {
    count1: 1, updatedAt: serverTimestamp()
  });
  duplicate.set(doc(db, 'streams', 'live1', 'polls', 'p1', 'votes', 'alice'), {
    uid: 'alice', optionIndex: 1, createdAt: serverTimestamp()
  });
  await assertFails(duplicate.commit());
});

test('resgate de recompensa move Zy Coins somente com transação + redemption atômicos', async () => {
  await env.withSecurityRulesDisabled(context => setDoc(
    doc(context.firestore(), 'channels', 'bob', 'rewards', 'r1'),
    { rewardId: 'r1', channelId: 'bob', title: 'Escolher jogo', description: '', cost: 100, active: true,
      createdAt: Timestamp.fromMillis(1), updatedAt: Timestamp.fromMillis(1) }
  ));

  const db = as('alice');
  const sender = doc(db, 'wallets', 'alice');
  const recipient = doc(db, 'wallets', 'bob');
  const txRef = doc(db, 'zyCoinTransactions', 'redeem1');
  const redemption = doc(db, 'rewardRedemptions', 'redeem1');

  await assertSucceeds(runTransaction(db, async tx => {
    const senderSnap = await tx.get(sender);
    assert.equal(senderSnap.data().balance, 500);
    tx.update(sender, {
      balance: 400, totalSent: 100, totalReceived: 0,
      lastTransactionId: 'redeem1', updatedAt: serverTimestamp()
    });
    tx.update(recipient, {
      balance: increment(100), totalReceived: increment(100),
      lastTransactionId: 'redeem1', updatedAt: serverTimestamp()
    });
    tx.set(txRef, {
      transactionId: 'redeem1', fromUid: 'alice', toUid: 'bob', streamId: 'live1',
      amount: 100, rewardId: 'r1', type: 'reward_redeem', status: 'completed',
      createdAt: serverTimestamp()
    });
    tx.set(redemption, {
      redemptionId: 'redeem1', rewardId: 'r1', channelId: 'bob', uid: 'alice',
      cost: 100, status: 'pending_fulfillment', createdAt: serverTimestamp()
    });
  }));

  await assertFails(updateDoc(doc(as('alice'), 'wallets', 'alice'), { balance: 999999 }));
});

test('promoção só pode ser criada por admin e claim exige contador, carteira e transação atômicos', async () => {
  const start = Timestamp.fromMillis(Date.now() - 60000);
  const end = Timestamp.fromMillis(Date.now() + 3600000);
  await assertFails(setDoc(doc(as('alice'), 'coinPromotions', 'promo1'), {
    promotionId: 'promo1', title: 'Bônus', description: '', amount: 25,
    maxClaims: 100, claimCount: 0, active: true, startsAt: start, endsAt: end,
    createdBy: 'alice', createdAt: serverTimestamp(), updatedAt: serverTimestamp()
  }));
  await env.withSecurityRulesDisabled(context => setDoc(doc(context.firestore(), 'coinPromotions', 'promo1'), {
    promotionId: 'promo1', title: 'Bônus', description: '', amount: 25,
    maxClaims: 100, claimCount: 0, active: true, startsAt: start, endsAt: end,
    createdBy: 'admin', createdAt: Timestamp.fromMillis(1), updatedAt: Timestamp.fromMillis(1)
  }));

  const db = as('alice');
  await assertFails(runTransaction(db, async tx => {
    const promoRef = doc(db, 'coinPromotions', 'promo1');
    const walletRef = doc(db, 'wallets', 'alice');
    const promo = await tx.get(promoRef);
    const wallet = await tx.get(walletRef);
    assert.equal(promo.data().claimCount, 0);
    assert.equal(wallet.data().balance, 500);
    tx.update(promoRef, { claimCount: 1, updatedAt: serverTimestamp() });
    tx.update(walletRef, { balance: 525, lastTransactionId: 'promo-tx', updatedAt: serverTimestamp() });
    tx.set(doc(db, 'zyCoinTransactions', 'promo-tx'), {
      transactionId: 'promo-tx', fromUid: 'zytrix', toUid: 'alice', amount: 25,
      promotionId: 'promo1', type: 'promotion_claim', status: 'completed', createdAt: serverTimestamp()
    });
    tx.set(doc(db, 'coinPromotions', 'promo1', 'claims', 'alice'), {
      uid: 'alice', promotionId: 'promo1', amount: 25, transactionId: 'promo-tx', createdAt: serverTimestamp()
    });
  }));
  await assertFails(setDoc(doc(as('alice'), 'coinPromotions', 'promo1', 'claims', 'alice'), {
    uid: 'alice', promotionId: 'promo1', amount: 25, transactionId: 'fake', createdAt: serverTimestamp()
  }));
});

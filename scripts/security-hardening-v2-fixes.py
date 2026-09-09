from pathlib import Path
import re


def read(path):
    return Path(path).read_text(encoding='utf-8')


def write(path, text):
    Path(path).write_text(text, encoding='utf-8')


def replace_once(text, old, new, label):
    if old not in text:
        raise SystemExit(f'anchor not found: {label}')
    return text.replace(old, new, 1)


# -----------------------------------------------------------------------------
# Firestore Rules: reduce expression cost and make support alerts second phase.
# -----------------------------------------------------------------------------
rules = read('firestore.rules')
if '// SECURITY-HARDENING-V2-FIXES' not in rules:
    rules = rules.replace(
        "service cloud.firestore {\n  match /databases/{database}/documents {",
        "service cloud.firestore {\n  // SECURITY-HARDENING-V2-FIXES\n  match /databases/{database}/documents {",
        1,
    )

old_wallet_update = '''      allow update:
        if isAdmin()
        || (
          getAfter(
            /databases/$(database)/documents/zyCoinTransactions/$(request.resource.data.lastTransactionId)
          ).data.type == "stream_support"
          && (
            validSenderWalletUpdate(uid)
            || validRecipientWalletUpdate(uid)
          )
        )
        || (
          getAfter(
            /databases/$(database)/documents/zyCoinTransactions/$(request.resource.data.lastTransactionId)
          ).data.type == "reward_redeem"
          && (
            validSenderWalletUpdate(uid)
            || validRecipientWalletUpdate(uid)
          )
        )
        || (
          getAfter(
            /databases/$(database)/documents/zyCoinTransactions/$(request.resource.data.lastTransactionId)
          ).data.type == "promotion_claim"
          && validPromotionWalletUpdate(uid)
        );'''
new_wallet_update = '''      allow update:
        if isAdmin()
        || validSenderWalletUpdate(uid)
        || validRecipientWalletUpdate(uid);'''
rules = replace_once(rules, old_wallet_update, new_wallet_update, 'wallet update simplification')

support_pattern = re.compile(
    r'''      // ================================================\n      // ALERTAS PÚBLICOS DE APOIO\n.*?      match /supportAlerts/\{alertId\} \{.*?\n      \}\n\n\n      // ================================================\n      // CHAT EM TEMPO REAL''',
    re.S,
)
support_replacement = '''      // ================================================
      // ALERTAS PÚBLICOS DE APOIO
      // ================================================
      // O movimento financeiro é concluído primeiro. O alerta público é
      // criado em uma segunda escrita e só é aceito quando referencia uma
      // transação stream_support já existente e imutável. Isso evita estourar
      // o limite de expressões das Rules sem permitir alertas falsos.
      // ================================================

      match /supportAlerts/{alertId} {

        allow read:
          if true;

        allow create:
          if verifiedUser()

          && request.resource.data.transactionId == alertId
          && request.resource.data.fromUid == request.auth.uid
          && request.resource.data.streamId == streamId
          && validCoinAmount(request.resource.data.amount)
          && request.resource.data.createdAt == request.time

          && request.resource.data.expiresAt is timestamp
          && request.resource.data.expiresAt >= request.time + duration.value(23, "h")
          && request.resource.data.expiresAt <= request.time + duration.value(25, "h")

          && validOptionalSupportMessage(request.resource.data)

          && request.resource.data.keys().hasOnly([
            "transactionId",
            "fromUid",
            "streamId",
            "amount",
            "createdAt",
            "message",
            "expiresAt"
          ])

          && exists(
            /databases/$(database)/documents/zyCoinTransactions/$(alertId)
          )

          && get(
            /databases/$(database)/documents/zyCoinTransactions/$(alertId)
          ).data.transactionId == alertId

          && get(
            /databases/$(database)/documents/zyCoinTransactions/$(alertId)
          ).data.fromUid == request.auth.uid

          && get(
            /databases/$(database)/documents/zyCoinTransactions/$(alertId)
          ).data.toUid == get(
            /databases/$(database)/documents/streams/$(streamId)
          ).data.streamerUid

          && get(
            /databases/$(database)/documents/zyCoinTransactions/$(alertId)
          ).data.streamId == streamId

          && get(
            /databases/$(database)/documents/zyCoinTransactions/$(alertId)
          ).data.amount == request.resource.data.amount

          && get(
            /databases/$(database)/documents/zyCoinTransactions/$(alertId)
          ).data.type == "stream_support"

          && get(
            /databases/$(database)/documents/zyCoinTransactions/$(alertId)
          ).data.status == "completed"

          && (
            (
              !request.resource.data.keys().hasAll(["message"])
              && !get(
                /databases/$(database)/documents/zyCoinTransactions/$(alertId)
              ).data.keys().hasAll(["message"])
            )
            || (
              request.resource.data.keys().hasAll(["message"])
              && get(
                /databases/$(database)/documents/zyCoinTransactions/$(alertId)
              ).data.keys().hasAll(["message"])
              && request.resource.data.message == get(
                /databases/$(database)/documents/zyCoinTransactions/$(alertId)
              ).data.message
            )
          );

        allow update, delete:
          if false;
      }


      // ================================================
      // CHAT EM TEMPO REAL'''
rules, count = support_pattern.subn(support_replacement, rules, count=1)
if count != 1:
    raise SystemExit('supportAlerts block not replaced')

for path in ['firestore.rules', 'firebase/firestore.rules', 'REGRAS-PARA-COLAR-NO-FIREBASE.txt']:
    write(path, rules)


# -----------------------------------------------------------------------------
# Frontend: support transaction first, public alert second (best effort).
# -----------------------------------------------------------------------------
path = 'assets/js/live.js'
t = read(path)
old = '''            tx.set(alertRef, {
                transactionId: txRef.id,
                fromUid: user.uid,
                streamId: stream.id,
                amount,
                createdAt: serverTimestamp()
            });
'''
t = replace_once(t, old, '', 'base support alert in transaction')
needle = '''        }
        msg.innerHTML = `<div class="message ok">Apoio de ◈ ${amount.toLocaleString('pt-BR')} enviado!</div>`;'''
replacement = '''        }
        await setDoc(alertRef, {
            transactionId: txRef.id,
            fromUid: user.uid,
            streamId: stream.id,
            amount,
            createdAt: serverTimestamp(),
            expiresAt: Timestamp.fromMillis(Date.now() + 24 * 60 * 60 * 1000)
        }).catch(error => console.warn('Apoio concluído, mas o alerta público não pôde ser criado.', error));
        msg.innerHTML = `<div class="message ok">Apoio de ◈ ${amount.toLocaleString('pt-BR')} enviado!</div>`;'''
t = replace_once(t, needle, replacement, 'base support second phase')
write(path, t)

path = 'assets/js/live-extras.js'
t = read(path)
old = '''      tx.set(alertRef, {
        transactionId: txRef.id,
        fromUid: currentUser.uid,
        streamId: stream.id,
        amount,
        message,
        createdAt: serverTimestamp(),
        expiresAt: Timestamp.fromMillis(Date.now() + 24 * 60 * 60 * 1000)
      });
'''
t = replace_once(t, old, '', 'enhanced support alert in transaction')
needle = '''    }
    feedback.innerHTML = `<div class="message ok">Apoio de ◈ ${amount.toLocaleString('pt-BR')} enviado!</div>`;'''
replacement = '''    }
    await setDoc(alertRef, {
      transactionId: txRef.id,
      fromUid: currentUser.uid,
      streamId: stream.id,
      amount,
      message,
      createdAt: serverTimestamp(),
      expiresAt: Timestamp.fromMillis(Date.now() + 24 * 60 * 60 * 1000)
    }).catch(error => console.warn('Apoio concluído, mas o alerta público não pôde ser criado.', error));
    feedback.innerHTML = `<div class="message ok">Apoio de ◈ ${amount.toLocaleString('pt-BR')} enviado!</div>`;'''
t = replace_once(t, needle, replacement, 'enhanced support second phase')
write(path, t)


# -----------------------------------------------------------------------------
# Update legacy tests to the hardened contract.
# -----------------------------------------------------------------------------
path = 'tests/firestore.rules.test.mjs'
t = read(path)
old = '''  await assertSucceeds(runTransaction(db,async tx=>{
    const sender=await tx.get(senderRef);
    tx.update(senderRef,{balance:450,totalSent:50,totalReceived:0,lastTransactionId:'support1',updatedAt:serverTimestamp()});
    tx.update(recipientRef,{balance:increment(50),totalReceived:increment(50),lastTransactionId:'support1',updatedAt:serverTimestamp()});
    tx.set(txRef,{transactionId:'support1',fromUid:'alice',toUid:'bob',streamId:'live1',amount:50,type:'stream_support',status:'completed',createdAt:serverTimestamp()});
    tx.set(alertRef,{transactionId:'support1',fromUid:'alice',streamId:'live1',amount:50,createdAt:serverTimestamp()});
  }));
  await assertSucceeds(getDoc(doc(env.unauthenticatedContext().firestore(),'streams','live1','supportAlerts','support1')));
  await assertFails(setDoc(doc(as('carol'),'streams','live1','supportAlerts','fake'),{transactionId:'fake',fromUid:'carol',streamId:'live1',amount:50,createdAt:serverTimestamp()}));'''
new = '''  await assertSucceeds(runTransaction(db,async tx=>{
    const sender=await tx.get(senderRef);
    tx.update(senderRef,{balance:450,totalSent:50,totalReceived:0,lastTransactionId:'support1',updatedAt:serverTimestamp()});
    tx.update(recipientRef,{balance:increment(50),totalReceived:increment(50),lastTransactionId:'support1',updatedAt:serverTimestamp()});
    tx.set(txRef,{transactionId:'support1',fromUid:'alice',toUid:'bob',streamId:'live1',amount:50,type:'stream_support',status:'completed',createdAt:serverTimestamp()});
  }));
  await assertSucceeds(setDoc(alertRef,{transactionId:'support1',fromUid:'alice',streamId:'live1',amount:50,createdAt:serverTimestamp(),expiresAt:Timestamp.fromMillis(Date.now()+24*60*60*1000)}));
  await assertSucceeds(getDoc(doc(env.unauthenticatedContext().firestore(),'streams','live1','supportAlerts','support1')));
  await assertFails(setDoc(doc(as('carol'),'streams','live1','supportAlerts','fake'),{transactionId:'fake',fromUid:'carol',streamId:'live1',amount:50,createdAt:serverTimestamp(),expiresAt:Timestamp.fromMillis(Date.now()+24*60*60*1000)}));'''
t = replace_once(t, old, new, 'legacy support alert test')
old = '''  const db=as('alice'),senderRef=doc(db,'wallets','alice'),recipientRef=doc(db,'wallets','bob'),txRef=doc(db,'zyCoinTransactions','support-new-wallet'),alertRef=doc(db,'streams','live1','supportAlerts','support-new-wallet');
  await assertFails(getDoc(recipientRef));
  await assertSucceeds(runTransaction(db,async tx=>{await tx.get(senderRef);tx.update(senderRef,{balance:475,totalSent:25,totalReceived:0,lastTransactionId:'support-new-wallet',updatedAt:serverTimestamp()});tx.set(recipientRef,{uid:'bob',balance:525,totalSent:0,totalReceived:25,lastTransactionId:'support-new-wallet',createdAt:serverTimestamp(),updatedAt:serverTimestamp()});tx.set(txRef,{transactionId:'support-new-wallet',fromUid:'alice',toUid:'bob',streamId:'live1',amount:25,type:'stream_support',status:'completed',createdAt:serverTimestamp()});tx.set(alertRef,{transactionId:'support-new-wallet',fromUid:'alice',streamId:'live1',amount:25,createdAt:serverTimestamp()});}));
  await env.withSecurityRulesDisabled(async c=>{const snap=await getDoc(doc(c.firestore(),'wallets','bob'));assert.equal(snap.data().balance,525);assert.equal(snap.data().totalReceived,25);});'''
new = '''  const db=as('alice'),senderRef=doc(db,'wallets','alice'),recipientRef=doc(db,'wallets','bob'),txRef=doc(db,'zyCoinTransactions','support-new-wallet');
  await assertFails(getDoc(recipientRef));
  await assertSucceeds(runTransaction(db,async tx=>{await tx.get(senderRef);tx.update(senderRef,{balance:475,totalSent:25,totalReceived:0,lastTransactionId:'support-new-wallet',updatedAt:serverTimestamp()});tx.set(recipientRef,{uid:'bob',balance:25,totalSent:0,totalReceived:25,lastTransactionId:'support-new-wallet',createdAt:serverTimestamp(),updatedAt:serverTimestamp()});tx.set(txRef,{transactionId:'support-new-wallet',fromUid:'alice',toUid:'bob',streamId:'live1',amount:25,type:'stream_support',status:'completed',createdAt:serverTimestamp()});}));
  await env.withSecurityRulesDisabled(async c=>{const snap=await getDoc(doc(c.firestore(),'wallets','bob'));assert.equal(snap.data().balance,25);assert.equal(snap.data().totalReceived,25);});'''
t = replace_once(t, old, new, 'legacy first recipient wallet test')
write(path, t)

path = 'tests/platform-expansion.rules.test.mjs'
t = read(path)
needle = '''test('progresso começa em 10 XP e não permite farm imediato ou valor arbitrário', async () => {
  const ref = doc(as('alice'), 'users', 'alice', 'progress', 'main');'''
replacement = '''test('progresso começa em 10 XP e não permite farm imediato ou valor arbitrário', async () => {
  await env.withSecurityRulesDisabled(context => setDoc(
    doc(context.firestore(), 'streams', 'live1', 'viewers', 'alice'),
    { uid:'alice', joinedAt:Timestamp.fromMillis(Date.now()-1000), lastSeen:Timestamp.fromMillis(Date.now()), expiresAt:Timestamp.fromMillis(Date.now()+120000) }
  ));
  const ref = doc(as('alice'), 'users', 'alice', 'progress', 'main');'''
t = replace_once(t, needle, replacement, 'progress presence test')

chat_pattern = re.compile(r"test\('chat followers-only bloqueia não seguidor e libera seguidor', async \(\) => \{.*?\n\}\);", re.S)
chat_new = '''test('chat followers-only bloqueia não seguidor e libera seguidor', async () => {
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
});'''
t, n = chat_pattern.subn(chat_new, t, count=1)
if n != 1:
    raise SystemExit('chat legacy test not replaced')

reaction_pattern = re.compile(r"test\('reação exige rate document atômico e emoji permitido', async \(\) => \{.*?\n\}\);", re.S)
reaction_new = '''test('reação exige rate document atômico e emoji permitido', async () => {
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
});'''
t, n = reaction_pattern.subn(reaction_new, t, count=1)
if n != 1:
    raise SystemExit('reaction legacy test not replaced')

promo_title = "test('promoção só pode ser criada por admin e claim exige contador, carteira e transação atômicos', async () => {"
pos = t.find(promo_title)
if pos == -1:
    raise SystemExit('promotion test not found')
commit_pos = t.find('await assertSucceeds(runTransaction(db, async tx => {', pos)
if commit_pos == -1:
    raise SystemExit('promotion allowed transaction anchor not found')
t = t[:commit_pos] + t[commit_pos:].replace('await assertSucceeds(runTransaction(db, async tx => {', 'await assertFails(runTransaction(db, async tx => {', 1)
write(path, t)

print('Security hardening v2 regression fixes applied.')

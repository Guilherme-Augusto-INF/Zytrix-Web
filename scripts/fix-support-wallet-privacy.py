from pathlib import Path


def replace_once(text, old, new, label):
    if old not in text:
        raise SystemExit(f'Anchor not found: {label}')
    return text.replace(old, new, 1)

# firebase.js: expose atomic increment transform.
p = Path('assets/js/firebase.js')
s = p.read_text(encoding='utf-8')
s = s.replace('serverTimestamp, writeBatch, runTransaction } from', 'serverTimestamp, writeBatch, runTransaction, increment } from')
s = s.replace('serverTimestamp, writeBatch, runTransaction };', 'serverTimestamp, writeBatch, runTransaction, increment };')
p.write_text(s, encoding='utf-8')

# config-live.js: proactively initialize the streamer's own wallet.
p = Path('assets/js/config-live.js')
s = p.read_text(encoding='utf-8')
if 'ensureWallet' not in s.split('\n', 1)[0]:
    s = s.replace('writeBatch } from \'./firebase.js\';', 'writeBatch, ensureWallet } from \'./firebase.js\';')
if 'await ensureWallet(user.uid);' not in s:
    s = replace_once(
        s,
        "    channel = channelSnap.data();\n",
        "    channel = channelSnap.data();\n    await ensureWallet(user.uid);\n",
        'streamer wallet initialization'
    )
p.write_text(s, encoding='utf-8')

# live.js: never read the recipient wallet. Use blind atomic increment;
# if recipient wallet does not exist, retry the whole support transaction
# with the already-secured recipient-wallet create path.
p = Path('assets/js/live.js')
s = p.read_text(encoding='utf-8')
if 'increment' not in s.split('\n', 1)[0]:
    s = s.replace('runTransaction } from \'./firebase.js\';', 'runTransaction, increment } from \'./firebase.js\';')

old = '''        await runTransaction(db, async tx => {
            const senderSnap = await tx.get(senderRef);
            const recipientSnap = await tx.get(recipientRef);
            if (!senderSnap.exists()) throw new Error('WALLET_MISSING');
            const sender = senderSnap.data();
            if ((sender.balance || 0) < amount) throw new Error('INSUFFICIENT_FUNDS');
            tx.update(senderRef, {
                balance: sender.balance - amount,
                totalSent: (sender.totalSent || 0) + amount,
                lastTransactionId: txRef.id,
                updatedAt: serverTimestamp()
            });
            if (recipientSnap.exists()) {
                const recipient = recipientSnap.data();
                tx.update(recipientRef, {
                    balance: (recipient.balance || 0) + amount,
                    totalReceived: (recipient.totalReceived || 0) + amount,
                    lastTransactionId: txRef.id,
                    updatedAt: serverTimestamp()
                });
            } else {
                tx.set(recipientRef, {
                    uid: stream.streamerUid,
                    balance: 500 + amount,
                    totalSent: 0,
                    totalReceived: amount,
                    lastTransactionId: txRef.id,
                    createdAt: serverTimestamp(),
                    updatedAt: serverTimestamp()
                });
            }
            tx.set(txRef, {
                transactionId: txRef.id,
                fromUid: user.uid,
                toUid: stream.streamerUid,
                streamId: stream.id,
                amount,
                type: 'stream_support',
                status: 'completed',
                createdAt: serverTimestamp()
            });
            tx.set(alertRef, {
                transactionId: txRef.id,
                fromUid: user.uid,
                streamId: stream.id,
                amount,
                createdAt: serverTimestamp()
            });
        });
'''
new = '''        const commitSupport = async createRecipientWallet => runTransaction(db, async tx => {
            const senderSnap = await tx.get(senderRef);
            if (!senderSnap.exists()) throw new Error('WALLET_MISSING');
            const sender = senderSnap.data();
            if ((sender.balance || 0) < amount) throw new Error('INSUFFICIENT_FUNDS');

            tx.update(senderRef, {
                balance: sender.balance - amount,
                totalSent: (sender.totalSent || 0) + amount,
                lastTransactionId: txRef.id,
                updatedAt: serverTimestamp()
            });

            if (createRecipientWallet) {
                tx.set(recipientRef, {
                    uid: stream.streamerUid,
                    balance: 500 + amount,
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
                fromUid: user.uid,
                toUid: stream.streamerUid,
                streamId: stream.id,
                amount,
                type: 'stream_support',
                status: 'completed',
                createdAt: serverTimestamp()
            });
            tx.set(alertRef, {
                transactionId: txRef.id,
                fromUid: user.uid,
                streamId: stream.id,
                amount,
                createdAt: serverTimestamp()
            });
        });

        try {
            await commitSupport(false);
        } catch (error) {
            if (String(error?.code || '').includes('not-found')) {
                await commitSupport(true);
            } else {
                throw error;
            }
        }
'''
if old not in s:
    raise SystemExit('Anchor not found: live support transaction')
s = s.replace(old, new, 1)
p.write_text(s, encoding='utf-8')

# Rules tests: exercise both paths without ever reading the recipient wallet.
p = Path('tests/firestore.rules.test.mjs')
s = p.read_text(encoding='utf-8')
s = s.replace('deleteDoc,runTransaction}', 'deleteDoc,runTransaction,increment}')
old_test = '''  await assertSucceeds(runTransaction(db,async tx=>{
    const sender=await tx.get(senderRef);const recipient=await tx.get(recipientRef);
    tx.update(senderRef,{balance:450,totalSent:50,totalReceived:0,lastTransactionId:'support1',updatedAt:serverTimestamp()});
    tx.update(recipientRef,{balance:550,totalSent:0,totalReceived:50,lastTransactionId:'support1',updatedAt:serverTimestamp()});
    tx.set(txRef,{transactionId:'support1',fromUid:'alice',toUid:'bob',streamId:'live1',amount:50,type:'stream_support',status:'completed',createdAt:serverTimestamp()});
    tx.set(alertRef,{transactionId:'support1',fromUid:'alice',streamId:'live1',amount:50,createdAt:serverTimestamp()});
  }));
'''
new_test = '''  await assertSucceeds(runTransaction(db,async tx=>{
    const sender=await tx.get(senderRef);
    tx.update(senderRef,{balance:450,totalSent:50,totalReceived:0,lastTransactionId:'support1',updatedAt:serverTimestamp()});
    tx.update(recipientRef,{balance:increment(50),totalReceived:increment(50),lastTransactionId:'support1',updatedAt:serverTimestamp()});
    tx.set(txRef,{transactionId:'support1',fromUid:'alice',toUid:'bob',streamId:'live1',amount:50,type:'stream_support',status:'completed',createdAt:serverTimestamp()});
    tx.set(alertRef,{transactionId:'support1',fromUid:'alice',streamId:'live1',amount:50,createdAt:serverTimestamp()});
  }));
'''
if old_test not in s:
    raise SystemExit('Anchor not found: support rules test')
s = s.replace(old_test, new_test, 1)

if "ALLOW apoio cria carteira ausente sem ler saldo do destinatário" not in s:
    s += '''\n\ntest('ALLOW apoio cria carteira ausente sem ler saldo do destinatário',async()=>{\n  const old=Timestamp.fromMillis(1);\n  await env.withSecurityRulesDisabled(async c=>{const db=c.firestore();await setDoc(doc(db,'streams','live1'),{streamerUid:'bob',channelId:'bob',title:'Live',description:'',categoryId:'Games',thumbnailURL:'',status:'live',playbackURL:'https://www.twitch.tv/example',startedAt:old,endedAt:null,createdAt:old,viewerCount:0});await setDoc(doc(db,'wallets','alice'),{uid:'alice',balance:500,totalSent:0,totalReceived:0,lastTransactionId:'seed-a',createdAt:old,updatedAt:old});});\n  const db=as('alice'),senderRef=doc(db,'wallets','alice'),recipientRef=doc(db,'wallets','bob'),txRef=doc(db,'zyCoinTransactions','support-new-wallet'),alertRef=doc(db,'streams','live1','supportAlerts','support-new-wallet');\n  await assertFails(getDoc(recipientRef));\n  await assertSucceeds(runTransaction(db,async tx=>{const sender=await tx.get(senderRef);tx.update(senderRef,{balance:475,totalSent:25,totalReceived:0,lastTransactionId:'support-new-wallet',updatedAt:serverTimestamp()});tx.set(recipientRef,{uid:'bob',balance:525,totalSent:0,totalReceived:25,lastTransactionId:'support-new-wallet',createdAt:serverTimestamp(),updatedAt:serverTimestamp()});tx.set(txRef,{transactionId:'support-new-wallet',fromUid:'alice',toUid:'bob',streamId:'live1',amount:25,type:'stream_support',status:'completed',createdAt:serverTimestamp()});tx.set(alertRef,{transactionId:'support-new-wallet',fromUid:'alice',streamId:'live1',amount:25,createdAt:serverTimestamp()});}));\n  await env.withSecurityRulesDisabled(async c=>{const snap=await getDoc(doc(c.firestore(),'wallets','bob'));assert.equal(snap.data().balance,525);assert.equal(snap.data().totalReceived,25);});\n});\n'''
p.write_text(s, encoding='utf-8')

print('wallet privacy fix applied')

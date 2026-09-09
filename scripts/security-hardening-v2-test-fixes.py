from pathlib import Path

# Fix Firestore-instance mismatch in the followers-only chat test.
p = Path('tests/platform-expansion.rules.test.mjs')
t = p.read_text(encoding='utf-8')
old = """  const denied = writeBatch(as('alice'));
  denied.set(doc(as('alice'), 'streams', 'live1', 'chatRate', 'alice'), {
    uid:'alice', lastAt:serverTimestamp(), expiresAt:Timestamp.fromMillis(Date.now()+2*60*60*1000)
  });
  denied.set(doc(as('alice'), 'streams', 'live1', 'chat', 'm1'), {
    uid: 'alice', text: 'oi', createdAt: serverTimestamp()
  });
"""
new = """  const deniedDb = as('alice');
  const denied = writeBatch(deniedDb);
  denied.set(doc(deniedDb, 'streams', 'live1', 'chatRate', 'alice'), {
    uid:'alice', lastAt:serverTimestamp(), expiresAt:Timestamp.fromMillis(Date.now()+2*60*60*1000)
  });
  denied.set(doc(deniedDb, 'streams', 'live1', 'chat', 'm1'), {
    uid: 'alice', text: 'oi', createdAt: serverTimestamp()
  });
"""
if old not in t:
    raise SystemExit('chat test anchor not found')
t = t.replace(old, new, 1)
p.write_text(t, encoding='utf-8')

# Match the new two-phase support architecture in the security regression test.
p = Path('tests/security-hardening.rules.test.mjs')
t = p.read_text(encoding='utf-8')
old = """    tx.set(txRef, {
      transactionId: 'support-sec', fromUid: 'alice', toUid: 'bob', streamId: 'live1',
      amount: 50, type: 'stream_support', status: 'completed', createdAt: serverTimestamp()
    });
    tx.set(alert, {
      transactionId: 'support-sec', fromUid: 'alice', streamId: 'live1', amount: 50,
      createdAt: serverTimestamp(), expiresAt
    });
  }));
  const snap = await getDoc(doc(as('bob'), 'wallets', 'bob'));
"""
new = """    tx.set(txRef, {
      transactionId: 'support-sec', fromUid: 'alice', toUid: 'bob', streamId: 'live1',
      amount: 50, type: 'stream_support', status: 'completed', createdAt: serverTimestamp()
    });
  }));
  await assertSucceeds(setDoc(alert, {
    transactionId: 'support-sec', fromUid: 'alice', streamId: 'live1', amount: 50,
    createdAt: serverTimestamp(), expiresAt
  }));
  const snap = await getDoc(doc(as('bob'), 'wallets', 'bob'));
"""
if old not in t:
    raise SystemExit('support test anchor not found')
t = t.replace(old, new, 1)
p.write_text(t, encoding='utf-8')

print('Final security tests patched.')

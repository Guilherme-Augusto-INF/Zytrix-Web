from pathlib import Path

RULE_FILES = [
    Path('firestore.rules'),
    Path('firebase/firestore.rules'),
    Path('REGRAS-PARA-COLAR-NO-FIREBASE.txt'),
]

src = RULE_FILES[0].read_text(encoding='utf-8')

old_wallet = '''      allow update:\n        if validSenderWalletUpdate(uid)\n        || validRecipientWalletUpdate(uid)\n        || validPromotionWalletUpdate(uid)\n        || isAdmin();'''
new_wallet = '''      allow update:\n        if isAdmin()\n        || (\n          getAfter(\n            /databases/$(database)/documents/zyCoinTransactions/$(request.resource.data.lastTransactionId)\n          ).data.type == "stream_support"\n          && (\n            validSenderWalletUpdate(uid)\n            || validRecipientWalletUpdate(uid)\n          )\n        )\n        || (\n          getAfter(\n            /databases/$(database)/documents/zyCoinTransactions/$(request.resource.data.lastTransactionId)\n          ).data.type == "reward_redeem"\n          && (\n            validSenderWalletUpdate(uid)\n            || validRecipientWalletUpdate(uid)\n          )\n        )\n        || (\n          getAfter(\n            /databases/$(database)/documents/zyCoinTransactions/$(request.resource.data.lastTransactionId)\n          ).data.type == "promotion_claim"\n          && validPromotionWalletUpdate(uid)\n        );'''

old_tx = '''      allow create:\n        if validSupportTransactionCreate(\n          transactionId\n        )\n        || validRewardTransactionCreate(\n          transactionId\n        )\n        || validPromotionTransactionCreate(\n          transactionId\n        );'''
new_tx = '''      allow create:\n        if (\n          request.resource.data.type == "stream_support"\n          && validSupportTransactionCreate(transactionId)\n        )\n        || (\n          request.resource.data.type == "reward_redeem"\n          && validRewardTransactionCreate(transactionId)\n        )\n        || (\n          request.resource.data.type == "promotion_claim"\n          && validPromotionTransactionCreate(transactionId)\n        );'''

for label, old in [('wallet dispatcher', old_wallet), ('transaction dispatcher', old_tx)]:
    if src.count(old) != 1:
        raise SystemExit(f'{label}: expected exactly one anchor, found {src.count(old)}')

src = src.replace(old_wallet, new_wallet, 1).replace(old_tx, new_tx, 1)

for path in RULE_FILES:
    path.write_text(src, encoding='utf-8')

print('Rule dispatch optimized and all copies synchronized.')

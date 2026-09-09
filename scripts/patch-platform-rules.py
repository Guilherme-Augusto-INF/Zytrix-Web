from pathlib import Path

RULE_FILES = [
    Path('firestore.rules'),
    Path('firebase/firestore.rules'),
    Path('REGRAS-PARA-COLAR-NO-FIREBASE.txt'),
]

src = RULE_FILES[0].read_text(encoding='utf-8')
if 'PLATFORM EXPANSION V1' in src:
    print('Platform rules already applied; syncing copies.')
    for path in RULE_FILES[1:]:
        path.write_text(src, encoding='utf-8')
    raise SystemExit(0)


def require(text, needle, count=None):
    found = text.count(needle)
    if found == 0:
        raise SystemExit(f'Anchor not found: {needle[:120]!r}')
    if count is not None and found != count:
        raise SystemExit(f'Unexpected count {found} != {count}: {needle[:100]!r}')
    return found


def replace_once(text, old, new):
    require(text, old, 1)
    return text.replace(old, new, 1)


# -----------------------------------------------------------------------------
# Helpers: support messages, platform stream fields, moderation and new
# transactional wallet paths. Inserted before the existing ADMINS section.
# -----------------------------------------------------------------------------
helper_anchor = '''

    // ==================================================
    // ADMINS
    // ==================================================
'''
require(src, helper_anchor, 1)

helpers = r'''

    // ==================================================
    // PLATFORM EXPANSION V1 - FUNÇÕES
    // ==================================================

    function validOptionalSupportMessage(data) {
      return !data.keys().hasAll(["message"])
        || (
          data.message is string
          && data.message.size() <= 120
        );
    }

    function validPlatformStreamFields(data) {
      return (
          !data.keys().hasAll(["supportGoalLabel"])
          || (
            data.supportGoalLabel is string
            && data.supportGoalLabel.size() <= 60
          )
        )
        && (
          !data.keys().hasAll(["supportGoalCoins"])
          || (
            data.supportGoalCoins is int
            && data.supportGoalCoins >= 0
            && data.supportGoalCoins <= 10000000
          )
        )
        && (
          !data.keys().hasAll(["supportAlertTheme"])
          || data.supportAlertTheme in ["classic", "minimal", "celebrate", "neon"]
        )
        && (
          !data.keys().hasAll(["supportAlertMinCoins"])
          || (
            data.supportAlertMinCoins is int
            && data.supportAlertMinCoins >= 1
            && data.supportAlertMinCoins <= 100000
          )
        )
        && (
          !data.keys().hasAll(["supportAlertDurationMs"])
          || (
            data.supportAlertDurationMs is int
            && data.supportAlertDurationMs >= 2500
            && data.supportAlertDurationMs <= 10000
          )
        )
        && (
          !data.keys().hasAll(["vodURL"])
          || (
            data.vodURL is string
            && data.vodURL.size() <= 2048
          )
        )
        && (
          !data.keys().hasAll(["raidTargetStreamId"])
          || (
            data.raidTargetStreamId is string
            && data.raidTargetStreamId.size() <= 128
          )
        )
        && (
          !data.keys().hasAll(["hostTargetStreamId"])
          || (
            data.hostTargetStreamId is string
            && data.hostTargetStreamId.size() <= 128
          )
        );
    }

    function isStreamOwner(streamId, uid) {
      return loggedIn()
        && uid is string
        && exists(
          /databases/$(database)/documents/streams/$(streamId)
        )
        && get(
          /databases/$(database)/documents/streams/$(streamId)
        ).data.streamerUid == uid;
    }

    function isStreamModerator(streamId, uid) {
      return loggedIn()
        && uid is string
        && exists(
          /databases/$(database)/documents/streams/$(streamId)/moderators/$(uid)
        );
    }

    function canModerateStream(streamId) {
      return loggedIn()
        && (
          isAdmin()
          || isStreamOwner(streamId, request.auth.uid)
          || isStreamModerator(streamId, request.auth.uid)
        );
    }

    function validChatSettingsData(streamId, data) {
      return canModerateStream(streamId)
        && data.mode in ["everyone", "followers", "members"]
        && data.slowModeSeconds is int
        && data.slowModeSeconds >= 0
        && data.slowModeSeconds <= 120
        && data.allowLinks is bool
        && data.blockExcessCaps is bool
        && data.blockedWords is list
        && data.blockedWords.size() <= 40
        && data.emergencyMode is bool
        && data.updatedBy == request.auth.uid
        && data.updatedAt == request.time
        && data.keys().hasOnly([
          "mode",
          "slowModeSeconds",
          "allowLinks",
          "blockExcessCaps",
          "blockedWords",
          "emergencyMode",
          "updatedBy",
          "updatedAt"
        ]);
    }

    function platformChatWriteAllowed(streamId, text) {
      let settingsPath =
        /databases/$(database)/documents/streams/$(streamId)/chatSettings/main;
      let ratePath =
        /databases/$(database)/documents/streams/$(streamId)/chatRate/$(request.auth.uid);
      let streamerUid = get(
        /databases/$(database)/documents/streams/$(streamId)
      ).data.streamerUid;

      return !exists(settingsPath)
        || canModerateStream(streamId)
        || (
          get(settingsPath).data.emergencyMode == false
          && (
            get(settingsPath).data.mode == "everyone"
            || (
              get(settingsPath).data.mode == "followers"
              && exists(
                /databases/$(database)/documents/channels/$(streamerUid)/followers/$(request.auth.uid)
              )
            )
            || (
              get(settingsPath).data.mode == "members"
              && exists(
                /databases/$(database)/documents/channels/$(streamerUid)/members/$(request.auth.uid)
              )
            )
          )
          && (
            get(settingsPath).data.allowLinks == true
            || !text.matches('.*(https?://|www\\.).*')
          )
          && (
            get(settingsPath).data.slowModeSeconds == 0
            || (
              getAfter(ratePath).data.uid == request.auth.uid
              && getAfter(ratePath).data.lastAt == request.time
              && (
                !exists(ratePath)
                || request.time >= get(ratePath).data.lastAt
                   + duration.value(get(settingsPath).data.slowModeSeconds, "s")
              )
            )
          )
        );
    }

    function validPromotionWalletUpdate(uid) {
      let txId = request.resource.data.lastTransactionId;
      let txData = getAfter(
        /databases/$(database)/documents/zyCoinTransactions/$(txId)
      ).data;
      let promoPath =
        /databases/$(database)/documents/coinPromotions/$(txData.promotionId);
      let claimPath =
        /databases/$(database)/documents/coinPromotions/$(txData.promotionId)/claims/$(uid);

      return isOwner(uid)
        && validWalletShape(request.resource.data, uid)
        && txData.transactionId == txId
        && txData.type == "promotion_claim"
        && txData.status == "completed"
        && txData.fromUid == "zytrix"
        && txData.toUid == uid
        && validCoinAmount(txData.amount)
        && exists(promoPath)
        && get(promoPath).data.amount == txData.amount
        && getAfter(claimPath).data.uid == uid
        && getAfter(claimPath).data.transactionId == txId
        && request.resource.data.uid == resource.data.uid
        && request.resource.data.createdAt == resource.data.createdAt
        && request.resource.data.updatedAt == request.time
        && request.resource.data.balance == resource.data.balance + txData.amount
        && request.resource.data.totalSent == resource.data.totalSent
        && request.resource.data.totalReceived == resource.data.totalReceived
        && request.resource.data.diff(resource.data).affectedKeys().hasOnly([
          "balance",
          "lastTransactionId",
          "updatedAt"
        ]);
    }

    function validRewardTransactionCreate(transactionId) {
      let data = request.resource.data;
      let rewardPath =
        /databases/$(database)/documents/channels/$(data.toUid)/rewards/$(data.rewardId);
      let streamPath =
        /databases/$(database)/documents/streams/$(data.streamId);
      let senderPath =
        /databases/$(database)/documents/wallets/$(data.fromUid);
      let recipientPath =
        /databases/$(database)/documents/wallets/$(data.toUid);
      let redemptionPath =
        /databases/$(database)/documents/rewardRedemptions/$(transactionId);
      let senderBefore = get(senderPath).data;
      let senderAfter = getAfter(senderPath).data;
      let recipientAfter = getAfter(recipientPath).data;
      let redemption = getAfter(redemptionPath).data;

      return loggedIn()
        && !isBanned(request.auth.uid)
        && data.transactionId == transactionId
        && data.fromUid == request.auth.uid
        && data.toUid is string
        && data.toUid.size() > 0
        && data.toUid != data.fromUid
        && data.streamId is string
        && data.streamId.size() > 0
        && data.rewardId is string
        && data.rewardId.size() > 0
        && data.rewardId.size() <= 128
        && validCoinAmount(data.amount)
        && data.type == "reward_redeem"
        && data.status == "completed"
        && data.createdAt == request.time
        && data.keys().hasOnly([
          "transactionId",
          "fromUid",
          "toUid",
          "streamId",
          "amount",
          "rewardId",
          "type",
          "status",
          "createdAt"
        ])
        && exists(rewardPath)
        && get(rewardPath).data.rewardId == data.rewardId
        && get(rewardPath).data.channelId == data.toUid
        && get(rewardPath).data.active == true
        && get(rewardPath).data.cost == data.amount
        && exists(streamPath)
        && get(streamPath).data.streamerUid == data.toUid
        && exists(senderPath)
        && senderBefore.balance is int
        && senderBefore.balance >= data.amount
        && senderAfter.uid == data.fromUid
        && senderAfter.createdAt == senderBefore.createdAt
        && senderAfter.updatedAt == request.time
        && senderAfter.lastTransactionId == transactionId
        && senderAfter.balance == senderBefore.balance - data.amount
        && senderAfter.totalSent == senderBefore.totalSent + data.amount
        && senderAfter.totalReceived == senderBefore.totalReceived
        && recipientAfter.uid == data.toUid
        && recipientAfter.updatedAt == request.time
        && recipientAfter.lastTransactionId == transactionId
        && (
          (
            exists(recipientPath)
            && recipientAfter.createdAt == get(recipientPath).data.createdAt
            && recipientAfter.balance == get(recipientPath).data.balance + data.amount
            && recipientAfter.totalSent == get(recipientPath).data.totalSent
            && recipientAfter.totalReceived == get(recipientPath).data.totalReceived + data.amount
          )
          || (
            !exists(recipientPath)
            && recipientAfter.createdAt == request.time
            && recipientAfter.balance == 500 + data.amount
            && recipientAfter.totalSent == 0
            && recipientAfter.totalReceived == data.amount
          )
        )
        && redemption.redemptionId == transactionId
        && redemption.rewardId == data.rewardId
        && redemption.channelId == data.toUid
        && redemption.uid == data.fromUid
        && redemption.cost == data.amount
        && redemption.status == "pending_fulfillment"
        && redemption.createdAt == request.time
        && redemption.keys().hasOnly([
          "redemptionId",
          "rewardId",
          "channelId",
          "uid",
          "cost",
          "status",
          "createdAt"
        ]);
    }

    function validPromotionTransactionCreate(transactionId) {
      let data = request.resource.data;
      let promoPath =
        /databases/$(database)/documents/coinPromotions/$(data.promotionId);
      let claimPath =
        /databases/$(database)/documents/coinPromotions/$(data.promotionId)/claims/$(request.auth.uid);
      let walletPath =
        /databases/$(database)/documents/wallets/$(request.auth.uid);
      let promo = get(promoPath).data;
      let promoAfter = getAfter(promoPath).data;
      let claim = getAfter(claimPath).data;
      let walletBefore = get(walletPath).data;
      let walletAfter = getAfter(walletPath).data;

      return loggedIn()
        && !isBanned(request.auth.uid)
        && data.transactionId == transactionId
        && data.fromUid == "zytrix"
        && data.toUid == request.auth.uid
        && data.promotionId is string
        && data.promotionId.size() > 0
        && data.promotionId.size() <= 128
        && validCoinAmount(data.amount)
        && data.type == "promotion_claim"
        && data.status == "completed"
        && data.createdAt == request.time
        && data.keys().hasOnly([
          "transactionId",
          "fromUid",
          "toUid",
          "amount",
          "promotionId",
          "type",
          "status",
          "createdAt"
        ])
        && exists(promoPath)
        && promo.active == true
        && promo.amount == data.amount
        && promo.startsAt is timestamp
        && promo.endsAt is timestamp
        && request.time >= promo.startsAt
        && request.time <= promo.endsAt
        && promo.claimCount is int
        && promo.maxClaims is int
        && promo.claimCount < promo.maxClaims
        && promoAfter.claimCount == promo.claimCount + 1
        && promoAfter.updatedAt == request.time
        && promoAfter.diff(promo).affectedKeys().hasOnly([
          "claimCount",
          "updatedAt"
        ])
        && !exists(claimPath)
        && claim.uid == request.auth.uid
        && claim.promotionId == data.promotionId
        && claim.amount == data.amount
        && claim.transactionId == transactionId
        && claim.createdAt == request.time
        && claim.keys().hasOnly([
          "uid",
          "promotionId",
          "amount",
          "transactionId",
          "createdAt"
        ])
        && exists(walletPath)
        && walletAfter.uid == request.auth.uid
        && walletAfter.createdAt == walletBefore.createdAt
        && walletAfter.updatedAt == request.time
        && walletAfter.lastTransactionId == transactionId
        && walletAfter.balance == walletBefore.balance + data.amount
        && walletAfter.totalSent == walletBefore.totalSent
        && walletAfter.totalReceived == walletBefore.totalReceived;
    }

    function validPromotionCounterUpdate(promotionId) {
      let claimPath =
        /databases/$(database)/documents/coinPromotions/$(promotionId)/claims/$(request.auth.uid);
      let claim = getAfter(claimPath).data;
      let txData = getAfter(
        /databases/$(database)/documents/zyCoinTransactions/$(claim.transactionId)
      ).data;

      return loggedIn()
        && !isBanned(request.auth.uid)
        && resource.data.active == true
        && resource.data.startsAt is timestamp
        && resource.data.endsAt is timestamp
        && request.time >= resource.data.startsAt
        && request.time <= resource.data.endsAt
        && resource.data.claimCount < resource.data.maxClaims
        && request.resource.data.claimCount == resource.data.claimCount + 1
        && request.resource.data.updatedAt == request.time
        && request.resource.data.diff(resource.data).affectedKeys().hasOnly([
          "claimCount",
          "updatedAt"
        ])
        && !exists(claimPath)
        && claim.uid == request.auth.uid
        && claim.promotionId == promotionId
        && claim.amount == resource.data.amount
        && txData.transactionId == claim.transactionId
        && txData.type == "promotion_claim"
        && txData.status == "completed"
        && txData.toUid == request.auth.uid
        && txData.promotionId == promotionId
        && txData.amount == resource.data.amount;
    }

    function validPollVoteUpdate(streamId, pollId) {
      let votePath =
        /databases/$(database)/documents/streams/$(streamId)/polls/$(pollId)/votes/$(request.auth.uid);
      let vote = getAfter(votePath).data;

      return loggedIn()
        && !isBanned(request.auth.uid)
        && resource.data.status == "active"
        && request.resource.data.pollId == resource.data.pollId
        && request.resource.data.kind == resource.data.kind
        && request.resource.data.question == resource.data.question
        && request.resource.data.option0 == resource.data.option0
        && request.resource.data.option1 == resource.data.option1
        && request.resource.data.option2 == resource.data.option2
        && request.resource.data.option3 == resource.data.option3
        && request.resource.data.createdBy == resource.data.createdBy
        && request.resource.data.createdAt == resource.data.createdAt
        && request.resource.data.status == resource.data.status
        && request.resource.data.resultIndex == resource.data.resultIndex
        && request.resource.data.updatedAt == request.time
        && !exists(votePath)
        && vote.uid == request.auth.uid
        && vote.createdAt == request.time
        && vote.optionIndex is int
        && vote.optionIndex >= 0
        && vote.optionIndex <= 3
        && (
          (
            vote.optionIndex == 0
            && resource.data.option0.size() > 0
            && request.resource.data.count0 == resource.data.count0 + 1
            && request.resource.data.count1 == resource.data.count1
            && request.resource.data.count2 == resource.data.count2
            && request.resource.data.count3 == resource.data.count3
          )
          || (
            vote.optionIndex == 1
            && resource.data.option1.size() > 0
            && request.resource.data.count1 == resource.data.count1 + 1
            && request.resource.data.count0 == resource.data.count0
            && request.resource.data.count2 == resource.data.count2
            && request.resource.data.count3 == resource.data.count3
          )
          || (
            vote.optionIndex == 2
            && resource.data.option2.size() > 0
            && request.resource.data.count2 == resource.data.count2 + 1
            && request.resource.data.count0 == resource.data.count0
            && request.resource.data.count1 == resource.data.count1
            && request.resource.data.count3 == resource.data.count3
          )
          || (
            vote.optionIndex == 3
            && resource.data.option3.size() > 0
            && request.resource.data.count3 == resource.data.count3 + 1
            && request.resource.data.count0 == resource.data.count0
            && request.resource.data.count1 == resource.data.count1
            && request.resource.data.count2 == resource.data.count2
          )
        );
    }
'''

src = src.replace(helper_anchor, helpers + helper_anchor, 1)

# Wallet helpers that were support-only can also accept a strictly validated
# reward_redeem transaction. Promotion claims use their own validator.
wallet_type_old = '''        && tx.type
            == "stream_support"'''
require(src, wallet_type_old, 3)
src = src.replace(wallet_type_old, '''        && tx.type
            in ["stream_support", "reward_redeem"]''', 3)

# Support transaction accepts an optional public message, while old clients
# without the field remain valid.
start = src.index('    function validSupportTransactionCreate(transactionId) {')
end = src.index(helper_anchor, start)
block = src[start:end]
block = replace_once(
    block,
    '''        && data.createdAt
            == request.time

        && data.keys().hasAll([''',
    '''        && data.createdAt
            == request.time

        && validOptionalSupportMessage(data)

        && data.keys().hasAll([''',
)
old_has_only = '''        && data.keys().hasOnly([
          "transactionId",
          "fromUid",
          "toUid",
          "streamId",
          "amount",
          "type",
          "status",
          "createdAt"
        ])'''
new_has_only = '''        && data.keys().hasOnly([
          "transactionId",
          "fromUid",
          "toUid",
          "streamId",
          "amount",
          "type",
          "status",
          "createdAt",
          "message"
        ])'''
block = replace_once(block, old_has_only, new_has_only)
src = src[:start] + block + src[end:]

# Extend create/update fields of streams without making them mandatory.
stream_start = src.index('    match /streams/{streamId} {')
support_start = src.index('      // ALERTAS PÚBLICOS DE APOIO', stream_start)
stream_head = src[stream_start:support_start]

stream_head = replace_once(
    stream_head,
    '''        && request.resource.data.keys().hasAll([
          "streamerUid",''',
    '''        && validPlatformStreamFields(
          request.resource.data
        )

        && request.resource.data.keys().hasAll([
          "streamerUid",''',
)
stream_head = replace_once(
    stream_head,
    '''          "viewerCount",
          "supportAlertSound",
          "matureContent"
        ]);''',
    '''          "viewerCount",
          "supportAlertSound",
          "matureContent",
          "supportGoalLabel",
          "supportGoalCoins",
          "supportAlertTheme",
          "supportAlertMinCoins",
          "supportAlertDurationMs",
          "vodURL",
          "raidTargetStreamId",
          "hostTargetStreamId"
        ]);''',
)
stream_head = replace_once(
    stream_head,
    '''          && request.resource.data
              .diff(resource.data)''',
    '''          && validPlatformStreamFields(
            request.resource.data
          )

          && request.resource.data
              .diff(resource.data)''',
)
stream_head = replace_once(
    stream_head,
    '''                "endedAt",
                "supportAlertSound",
                "matureContent"
              ])''',
    '''                "endedAt",
                "supportAlertSound",
                "matureContent",
                "supportGoalLabel",
                "supportGoalCoins",
                "supportAlertTheme",
                "supportAlertMinCoins",
                "supportAlertDurationMs",
                "vodURL",
                "raidTargetStreamId",
                "hostTargetStreamId"
              ])''',
)
src = src[:stream_start] + stream_head + src[support_start:]

# Support alert mirrors the optional message from the trusted transaction.
support_start = src.index('      match /supportAlerts/{alertId} {')
support_end = src.index('      // CHAT EM TEMPO REAL', support_start)
support_block = src[support_start:support_end]
support_block = replace_once(
    support_block,
    '''          && request.resource.data.createdAt
              == request.time

          && request.resource.data.keys().hasOnly([''',
    '''          && request.resource.data.createdAt
              == request.time

          && validOptionalSupportMessage(
            request.resource.data
          )

          && request.resource.data.keys().hasOnly([''',
)
support_block = replace_once(
    support_block,
    '''            "streamId",
            "amount",
            "createdAt"
          ])''',
    '''            "streamId",
            "amount",
            "createdAt",
            "message"
          ])''',
)
support_block = replace_once(
    support_block,
    '''          && getAfter(
            /databases/$(database)/documents/zyCoinTransactions/$(alertId)
          ).data.amount == request.resource.data.amount

          && getAfter(''',
    '''          && getAfter(
            /databases/$(database)/documents/zyCoinTransactions/$(alertId)
          ).data.amount == request.resource.data.amount

          && (
            (
              !request.resource.data.keys().hasAll(["message"])
              && !getAfter(
                /databases/$(database)/documents/zyCoinTransactions/$(alertId)
              ).data.keys().hasAll(["message"])
            )
            || (
              request.resource.data.keys().hasAll(["message"])
              && getAfter(
                /databases/$(database)/documents/zyCoinTransactions/$(alertId)
              ).data.keys().hasAll(["message"])
              && request.resource.data.message == getAfter(
                /databases/$(database)/documents/zyCoinTransactions/$(alertId)
              ).data.message
            )
          )

          && getAfter(''',
)
src = src[:support_start] + support_block + src[support_end:]

# Existing chat rule must honor the new access mode / emergency / slow-mode
# rules; otherwise the legacy composer would be a bypass.
chat_start = src.index('      match /chat/{messageId} {', stream_start)
chat_end = src.index('      // MODERAÇÃO DO CHAT', chat_start)
chat_block = src[chat_start:chat_end]
chat_block = replace_once(
    chat_block,
    '''          && request.resource.data.keys().hasOnly([
            "uid",''',
    '''          && platformChatWriteAllowed(
            streamId,
            request.resource.data.text
          )

          && request.resource.data.keys().hasOnly([
            "uid",''',
)
src = src[:chat_start] + chat_block + src[chat_end:]

# Wallet update grants promotion claims through a dedicated exact validator.
src = replace_once(
    src,
    '''      allow update:
        if validSenderWalletUpdate(uid)
        || validRecipientWalletUpdate(uid)
        || isAdmin();''',
    '''      allow update:
        if validSenderWalletUpdate(uid)
        || validRecipientWalletUpdate(uid)
        || validPromotionWalletUpdate(uid)
        || isAdmin();''',
)

# Transaction creation dispatches by strict type-specific validators.
src = replace_once(
    src,
    '''      allow create:
        if validSupportTransactionCreate(
          transactionId
        );''',
    '''      allow create:
        if validSupportTransactionCreate(
          transactionId
        )
        || validRewardTransactionCreate(
          transactionId
        )
        || validPromotionTransactionCreate(
          transactionId
        );''',
)

# -----------------------------------------------------------------------------
# New explicit collection rules. Insert before the existing global moderation
# section. No wildcard write access is introduced.
# -----------------------------------------------------------------------------
platform_anchor = '''

    // ==================================================
    // MODERAÇÃO GLOBAL
    // ==================================================
'''
require(src, platform_anchor, 1)

platform_rules = r'''

    // ==================================================
    // PLATFORM EXPANSION V1 - PREFERÊNCIAS E PROGRESSO
    // ==================================================

    match /users/{uid}/preferences/{prefId} {
      allow read:
        if isOwner(uid) || isAdmin();

      allow create, update:
        if isOwner(uid)
        && prefId == "platform"
        && request.resource.data.uid == uid
        && request.resource.data.hideMatureContent is bool
        && request.resource.data.safeMode is bool
        && request.resource.data.allowReactions is bool
        && request.resource.data.compactAlerts is bool
        && request.resource.data.updatedAt == request.time
        && request.resource.data.keys().hasOnly([
          "uid",
          "hideMatureContent",
          "safeMode",
          "allowReactions",
          "compactAlerts",
          "updatedAt"
        ]);

      allow delete:
        if isOwner(uid) || isAdmin();
    }

    match /users/{uid}/progress/{progressId} {
      allow read:
        if isOwner(uid) || isAdmin();

      allow create:
        if isOwner(uid)
        && progressId == "main"
        && request.resource.data.uid == uid
        && request.resource.data.xp == 10
        && request.resource.data.watchMinutes == 10
        && request.resource.data.streakDays == 1
        && request.resource.data.lastActiveDay is string
        && request.resource.data.lastActiveDay.size() <= 10
        && request.resource.data.lastStreamId is string
        && request.resource.data.lastStreamId.size() > 0
        && request.resource.data.lastStreamId.size() <= 128
        && exists(
          /databases/$(database)/documents/streams/$(request.resource.data.lastStreamId)
        )
        && request.resource.data.lastWatchRewardAt == request.time
        && request.resource.data.updatedAt == request.time
        && request.resource.data.createdAt == request.time
        && request.resource.data.keys().hasOnly([
          "uid",
          "xp",
          "watchMinutes",
          "streakDays",
          "lastActiveDay",
          "lastStreamId",
          "lastWatchRewardAt",
          "updatedAt",
          "createdAt"
        ]);

      allow update:
        if isOwner(uid)
        && progressId == "main"
        && request.resource.data.uid == resource.data.uid
        && request.resource.data.createdAt == resource.data.createdAt
        && resource.data.lastWatchRewardAt is timestamp
        && request.time >= resource.data.lastWatchRewardAt + duration.value(9, "m")
        && request.resource.data.xp == resource.data.xp + 10
        && request.resource.data.watchMinutes == resource.data.watchMinutes + 10
        && request.resource.data.streakDays is int
        && request.resource.data.streakDays >= 1
        && (
          request.resource.data.streakDays == resource.data.streakDays
          || request.resource.data.streakDays == resource.data.streakDays + 1
          || request.resource.data.streakDays == 1
        )
        && request.resource.data.lastActiveDay is string
        && request.resource.data.lastActiveDay.size() <= 10
        && request.resource.data.lastStreamId is string
        && request.resource.data.lastStreamId.size() > 0
        && request.resource.data.lastStreamId.size() <= 128
        && exists(
          /databases/$(database)/documents/streams/$(request.resource.data.lastStreamId)
        )
        && request.resource.data.lastWatchRewardAt == request.time
        && request.resource.data.updatedAt == request.time
        && request.resource.data.diff(resource.data).affectedKeys().hasOnly([
          "xp",
          "watchMinutes",
          "streakDays",
          "lastActiveDay",
          "lastStreamId",
          "lastWatchRewardAt",
          "updatedAt"
        ]);

      allow delete:
        if isOwner(uid) || isAdmin();
    }

    match /users/{uid}/followedCategories/{categoryId} {
      allow read:
        if isOwner(uid) || isAdmin();

      allow create:
        if isOwner(uid)
        && !isBanned(uid)
        && request.resource.data.uid == uid
        && request.resource.data.categoryId == categoryId
        && request.resource.data.followedAt == request.time
        && request.resource.data.keys().hasOnly([
          "uid",
          "categoryId",
          "followedAt"
        ]);

      allow update:
        if false;

      allow delete:
        if isOwner(uid) || isAdmin();
    }

    match /users/{uid}/creatorAttribution/{docId} {
      allow read:
        if isOwner(uid) || isAdmin();

      allow create, update:
        if isOwner(uid)
        && docId == "current"
        && request.resource.data.uid == uid
        && request.resource.data.code is string
        && request.resource.data.code.matches('^[a-z0-9_-]{3,24}$')
        && request.resource.data.creatorUid is string
        && request.resource.data.creatorUid != uid
        && exists(
          /databases/$(database)/documents/creatorCodes/$(request.resource.data.code)
        )
        && get(
          /databases/$(database)/documents/creatorCodes/$(request.resource.data.code)
        ).data.creatorUid == request.resource.data.creatorUid
        && request.resource.data.updatedAt == request.time
        && request.resource.data.keys().hasOnly([
          "uid",
          "code",
          "creatorUid",
          "updatedAt"
        ]);

      allow delete:
        if isOwner(uid) || isAdmin();
    }

    match /users/{uid}/notificationState/{stateId} {
      allow create, update:
        if isOwner(uid)
        && stateId == "platform"
        && request.resource.data.uid == uid
        && request.resource.data.lastSeenAt == request.time
        && request.resource.data.updatedAt == request.time
        && request.resource.data.keys().hasOnly([
          "uid",
          "lastSeenAt",
          "updatedAt"
        ]);
    }


    // ==================================================
    // PLATFORM EXPANSION V1 - CANAL
    // ==================================================

    match /channels/{channelId}/members/{memberUid} {
      allow get:
        if loggedIn()
        && (
          request.auth.uid == memberUid
          || request.auth.uid == channelId
          || isAdmin()
        );

      allow list:
        if isOwner(channelId) || isAdmin();

      allow create:
        if (isOwner(channelId) || isAdmin())
        && request.resource.data.uid == memberUid
        && request.resource.data.addedBy == request.auth.uid
        && request.resource.data.createdAt == request.time
        && request.resource.data.keys().hasOnly([
          "uid",
          "addedBy",
          "createdAt"
        ]);

      allow update:
        if false;

      allow delete:
        if isOwner(channelId) || isAdmin();
    }

    match /channels/{channelId}/schedule/{scheduleId} {
      allow read:
        if true;

      allow create:
        if (isOwner(channelId) || isAdmin())
        && request.resource.data.scheduleId == scheduleId
        && request.resource.data.channelId == channelId
        && request.resource.data.title is string
        && request.resource.data.title.size() >= 1
        && request.resource.data.title.size() <= 80
        && request.resource.data.description is string
        && request.resource.data.description.size() <= 500
        && request.resource.data.startsAt is timestamp
        && request.resource.data.startsAt > request.time
        && request.resource.data.createdAt == request.time
        && request.resource.data.updatedAt == request.time
        && request.resource.data.keys().hasOnly([
          "scheduleId",
          "channelId",
          "title",
          "description",
          "startsAt",
          "createdAt",
          "updatedAt"
        ]);

      allow update:
        if (isOwner(channelId) || isAdmin())
        && request.resource.data.scheduleId == resource.data.scheduleId
        && request.resource.data.channelId == resource.data.channelId
        && request.resource.data.createdAt == resource.data.createdAt
        && request.resource.data.title is string
        && request.resource.data.title.size() >= 1
        && request.resource.data.title.size() <= 80
        && request.resource.data.description is string
        && request.resource.data.description.size() <= 500
        && request.resource.data.startsAt is timestamp
        && request.resource.data.updatedAt == request.time
        && request.resource.data.diff(resource.data).affectedKeys().hasOnly([
          "title",
          "description",
          "startsAt",
          "updatedAt"
        ]);

      allow delete:
        if isOwner(channelId) || isAdmin();
    }

    match /channels/{channelId}/rewards/{rewardId} {
      allow read:
        if true;

      allow create:
        if (isOwner(channelId) || isAdmin())
        && request.resource.data.rewardId == rewardId
        && request.resource.data.channelId == channelId
        && request.resource.data.title is string
        && request.resource.data.title.size() >= 1
        && request.resource.data.title.size() <= 60
        && request.resource.data.description is string
        && request.resource.data.description.size() <= 160
        && request.resource.data.cost is int
        && request.resource.data.cost >= 1
        && request.resource.data.cost <= 100000
        && request.resource.data.active is bool
        && request.resource.data.createdAt == request.time
        && request.resource.data.updatedAt == request.time
        && request.resource.data.keys().hasOnly([
          "rewardId",
          "channelId",
          "title",
          "description",
          "cost",
          "active",
          "createdAt",
          "updatedAt"
        ]);

      allow update:
        if (isOwner(channelId) || isAdmin())
        && request.resource.data.rewardId == resource.data.rewardId
        && request.resource.data.channelId == resource.data.channelId
        && request.resource.data.createdAt == resource.data.createdAt
        && request.resource.data.title is string
        && request.resource.data.title.size() >= 1
        && request.resource.data.title.size() <= 60
        && request.resource.data.description is string
        && request.resource.data.description.size() <= 160
        && request.resource.data.cost is int
        && request.resource.data.cost >= 1
        && request.resource.data.cost <= 100000
        && request.resource.data.active is bool
        && request.resource.data.updatedAt == request.time
        && request.resource.data.diff(resource.data).affectedKeys().hasOnly([
          "title",
          "description",
          "cost",
          "active",
          "updatedAt"
        ]);

      allow delete:
        if isOwner(channelId) || isAdmin();
    }

    match /channelProfiles/{uid} {
      allow read:
        if true;

      allow create, update:
        if isOwner(uid) || isAdmin()
        && request.resource.data.uid == uid
        && request.resource.data.about is string
        && request.resource.data.about.size() <= 800
        && request.resource.data.games is string
        && request.resource.data.games.size() <= 160
        && request.resource.data.website is string
        && request.resource.data.website.size() <= 2048
        && request.resource.data.youtube is string
        && request.resource.data.youtube.size() <= 2048
        && request.resource.data.instagram is string
        && request.resource.data.instagram.size() <= 2048
        && request.resource.data.tiktok is string
        && request.resource.data.tiktok.size() <= 2048
        && request.resource.data.updatedAt == request.time
        && request.resource.data.keys().hasOnly([
          "uid",
          "about",
          "games",
          "website",
          "youtube",
          "instagram",
          "tiktok",
          "updatedAt"
        ]);

      allow delete:
        if isOwner(uid) || isAdmin();
    }

    match /creatorCodes/{code} {
      allow read:
        if true;

      allow create:
        if loggedIn()
        && !isBanned(request.auth.uid)
        && code.matches('^[a-z0-9_-]{3,24}$')
        && request.resource.data.code == code
        && request.resource.data.creatorUid == request.auth.uid
        && request.resource.data.createdAt == request.time
        && request.resource.data.updatedAt == request.time
        && request.resource.data.keys().hasOnly([
          "code",
          "creatorUid",
          "createdAt",
          "updatedAt"
        ]);

      allow update:
        if loggedIn()
        && request.auth.uid == resource.data.creatorUid
        && request.resource.data.creatorUid == resource.data.creatorUid
        && request.resource.data.code == resource.data.code
        && request.resource.data.createdAt == resource.data.createdAt
        && request.resource.data.updatedAt == request.time
        && request.resource.data.diff(resource.data).affectedKeys().hasOnly([
          "updatedAt"
        ]);

      allow delete:
        if loggedIn()
        && (
          request.auth.uid == resource.data.creatorUid
          || isAdmin()
        );
    }


    // ==================================================
    // PLATFORM EXPANSION V1 - CLIPES
    // ==================================================

    match /clips/{clipId} {
      allow read:
        if true;

      allow create:
        if loggedIn()
        && !isBanned(request.auth.uid)
        && request.resource.data.clipId == clipId
        && request.resource.data.creatorUid == request.auth.uid
        && request.resource.data.streamId is string
        && request.resource.data.streamId.size() > 0
        && request.resource.data.streamId.size() <= 128
        && exists(
          /databases/$(database)/documents/streams/$(request.resource.data.streamId)
        )
        && request.resource.data.streamerUid == get(
          /databases/$(database)/documents/streams/$(request.resource.data.streamId)
        ).data.streamerUid
        && request.resource.data.title is string
        && request.resource.data.title.size() >= 1
        && request.resource.data.title.size() <= 80
        && request.resource.data.momentSeconds is int
        && request.resource.data.momentSeconds >= 0
        && request.resource.data.sourceUrl is string
        && request.resource.data.sourceUrl.size() <= 2048
        && request.resource.data.thumbnailURL is string
        && request.resource.data.thumbnailURL.size() <= 2048
        && request.resource.data.matureContent is bool
        && request.resource.data.createdAt == request.time
        && request.resource.data.keys().hasOnly([
          "clipId",
          "streamId",
          "streamerUid",
          "creatorUid",
          "title",
          "momentSeconds",
          "sourceUrl",
          "thumbnailURL",
          "matureContent",
          "createdAt"
        ]);

      allow update:
        if false;

      allow delete:
        if loggedIn()
        && (
          resource.data.creatorUid == request.auth.uid
          || resource.data.streamerUid == request.auth.uid
          || isAdmin()
        );
    }


    // ==================================================
    // PLATFORM EXPANSION V1 - INTERAÇÕES DA LIVE
    // ==================================================

    match /streams/{streamId}/moderators/{uid} {
      allow get:
        if loggedIn()
        && (
          request.auth.uid == uid
          || isStreamOwner(streamId, request.auth.uid)
          || isAdmin()
        );

      allow list:
        if isStreamOwner(streamId, request.auth.uid) || isAdmin();

      allow create:
        if (isStreamOwner(streamId, request.auth.uid) || isAdmin())
        && request.resource.data.uid == uid
        && uid != get(
          /databases/$(database)/documents/streams/$(streamId)
        ).data.streamerUid
        && request.resource.data.addedBy == request.auth.uid
        && request.resource.data.createdAt == request.time
        && request.resource.data.keys().hasOnly([
          "uid",
          "addedBy",
          "createdAt"
        ]);

      allow update:
        if false;

      allow delete:
        if isStreamOwner(streamId, request.auth.uid) || isAdmin();
    }

    match /streams/{streamId}/chatSettings/{docId} {
      allow read:
        if true;

      allow create, update:
        if docId == "main"
        && validChatSettingsData(streamId, request.resource.data);

      allow delete:
        if isStreamOwner(streamId, request.auth.uid) || isAdmin();
    }

    match /streams/{streamId}/chatRate/{uid} {
      allow get:
        if isOwner(uid) || isAdmin();

      allow list:
        if false;

      allow create:
        if isOwner(uid)
        && request.resource.data.uid == uid
        && request.resource.data.lastAt == request.time
        && request.resource.data.keys().hasOnly(["uid", "lastAt"]);

      allow update:
        if isOwner(uid)
        && request.resource.data.uid == resource.data.uid
        && request.resource.data.lastAt == request.time
        && request.resource.data.diff(resource.data).affectedKeys().hasOnly(["lastAt"]);

      allow delete:
        if isOwner(uid) || isAdmin();
    }

    match /streams/{streamId}/chat/{messageId} {
      allow delete:
        if loggedIn()
        && (
          resource.data.uid == request.auth.uid
          || isAdmin()
          || (
            canModerateStream(streamId)
            && resource.data.uid != get(
              /databases/$(database)/documents/streams/$(streamId)
            ).data.streamerUid
            && !isAdminUid(resource.data.uid)
          )
        );
    }

    match /streams/{streamId}/chatBans/{uid} {
      allow read:
        if loggedIn()
        && (
          request.auth.uid == uid
          || canModerateStream(streamId)
        );

      allow create, update:
        if canModerateStream(streamId)
        && (
          isAdmin()
          || (
            uid != get(
              /databases/$(database)/documents/streams/$(streamId)
            ).data.streamerUid
            && !isAdminUid(uid)
          )
        )
        && request.resource.data.uid == uid
        && request.resource.data.bannedBy == request.auth.uid
        && request.resource.data.reason in ["mute", "ban"]
        && request.resource.data.createdAt == request.time
        && (
          request.resource.data.expiresAt == null
          || request.resource.data.expiresAt is timestamp
        )
        && request.resource.data.keys().hasOnly([
          "uid",
          "bannedBy",
          "reason",
          "createdAt",
          "expiresAt"
        ]);

      allow delete:
        if canModerateStream(streamId)
        && (
          isAdmin()
          || (
            uid != get(
              /databases/$(database)/documents/streams/$(streamId)
            ).data.streamerUid
            && !isAdminUid(uid)
          )
        );
    }

    match /streams/{streamId}/chatConfig/{docId} {
      allow create, update:
        if docId == "main"
        && canModerateStream(streamId)
        && request.resource.data.pinnedMessageId is string
        && request.resource.data.pinnedMessageId.size() > 0
        && request.resource.data.pinnedMessageId.size() <= 128
        && exists(
          /databases/$(database)/documents/streams/$(streamId)/chat/$(request.resource.data.pinnedMessageId)
        )
        && request.resource.data.updatedBy == request.auth.uid
        && request.resource.data.updatedAt == request.time
        && request.resource.data.keys().hasOnly([
          "pinnedMessageId",
          "updatedBy",
          "updatedAt"
        ]);

      allow delete:
        if docId == "main" && canModerateStream(streamId);
    }

    match /streams/{streamId}/reactionRate/{uid} {
      allow get:
        if isOwner(uid) || isAdmin();

      allow list:
        if false;

      allow create:
        if isOwner(uid)
        && request.resource.data.uid == uid
        && request.resource.data.lastAt == request.time
        && request.resource.data.keys().hasOnly(["uid", "lastAt"]);

      allow update:
        if isOwner(uid)
        && request.resource.data.uid == resource.data.uid
        && request.resource.data.lastAt == request.time
        && request.time >= resource.data.lastAt + duration.value(1, "s")
        && request.resource.data.diff(resource.data).affectedKeys().hasOnly(["lastAt"]);

      allow delete:
        if isOwner(uid) || isAdmin();
    }

    match /streams/{streamId}/reactions/{reactionId} {
      allow read:
        if true;

      allow create:
        if loggedIn()
        && !isBanned(request.auth.uid)
        && request.resource.data.uid == request.auth.uid
        && request.resource.data.emoji in ["❤️", "😂", "🔥", "👏", "😮"]
        && request.resource.data.createdAt == request.time
        && request.resource.data.keys().hasOnly([
          "uid",
          "emoji",
          "createdAt"
        ])
        && getAfter(
          /databases/$(database)/documents/streams/$(streamId)/reactionRate/$(request.auth.uid)
        ).data.lastAt == request.time;

      allow update, delete:
        if false;
    }

    match /streams/{streamId}/polls/{pollId} {
      allow read:
        if true;

      allow create:
        if canModerateStream(streamId)
        && request.resource.data.pollId == pollId
        && request.resource.data.kind in ["poll", "prediction"]
        && request.resource.data.question is string
        && request.resource.data.question.size() >= 1
        && request.resource.data.question.size() <= 100
        && request.resource.data.option0 is string
        && request.resource.data.option0.size() >= 1
        && request.resource.data.option0.size() <= 50
        && request.resource.data.option1 is string
        && request.resource.data.option1.size() >= 1
        && request.resource.data.option1.size() <= 50
        && request.resource.data.option2 is string
        && request.resource.data.option2.size() <= 50
        && request.resource.data.option3 is string
        && request.resource.data.option3.size() <= 50
        && request.resource.data.count0 == 0
        && request.resource.data.count1 == 0
        && request.resource.data.count2 == 0
        && request.resource.data.count3 == 0
        && request.resource.data.status == "active"
        && request.resource.data.resultIndex == null
        && request.resource.data.createdBy == request.auth.uid
        && request.resource.data.createdAt == request.time
        && request.resource.data.updatedAt == request.time
        && request.resource.data.keys().hasOnly([
          "pollId",
          "kind",
          "question",
          "option0",
          "option1",
          "option2",
          "option3",
          "count0",
          "count1",
          "count2",
          "count3",
          "status",
          "resultIndex",
          "createdBy",
          "createdAt",
          "updatedAt"
        ]);

      allow update:
        if validPollVoteUpdate(streamId, pollId)
        || (
          canModerateStream(streamId)
          && request.resource.data.pollId == resource.data.pollId
          && request.resource.data.kind == resource.data.kind
          && request.resource.data.question == resource.data.question
          && request.resource.data.option0 == resource.data.option0
          && request.resource.data.option1 == resource.data.option1
          && request.resource.data.option2 == resource.data.option2
          && request.resource.data.option3 == resource.data.option3
          && request.resource.data.count0 == resource.data.count0
          && request.resource.data.count1 == resource.data.count1
          && request.resource.data.count2 == resource.data.count2
          && request.resource.data.count3 == resource.data.count3
          && request.resource.data.createdBy == resource.data.createdBy
          && request.resource.data.createdAt == resource.data.createdAt
          && request.resource.data.status in ["closed", "resolved"]
          && (
            request.resource.data.resultIndex == null
            || (
              request.resource.data.resultIndex is int
              && request.resource.data.resultIndex >= 0
              && request.resource.data.resultIndex <= 3
            )
          )
          && request.resource.data.updatedAt == request.time
          && request.resource.data.diff(resource.data).affectedKeys().hasOnly([
            "status",
            "resultIndex",
            "updatedAt"
          ])
        );

      allow delete:
        if isStreamOwner(streamId, request.auth.uid) || isAdmin();
    }

    match /streams/{streamId}/polls/{pollId}/votes/{uid} {
      allow get:
        if isOwner(uid) || canModerateStream(streamId);

      allow list:
        if canModerateStream(streamId);

      allow create:
        if isOwner(uid)
        && !isBanned(uid)
        && request.resource.data.uid == uid
        && request.resource.data.optionIndex is int
        && request.resource.data.optionIndex >= 0
        && request.resource.data.optionIndex <= 3
        && request.resource.data.createdAt == request.time
        && request.resource.data.keys().hasOnly([
          "uid",
          "optionIndex",
          "createdAt"
        ])
        && getAfter(
          /databases/$(database)/documents/streams/$(streamId)/polls/$(pollId)
        ).data.updatedAt == request.time;

      allow update, delete:
        if false;
    }


    // ==================================================
    // PLATFORM EXPANSION V1 - RECOMPENSAS / PROMOÇÕES
    // ==================================================

    match /rewardRedemptions/{redemptionId} {
      allow get:
        if loggedIn()
        && (
          resource.data.uid == request.auth.uid
          || resource.data.channelId == request.auth.uid
          || isAdmin()
        );

      allow list:
        if loggedIn()
        && (
          resource.data.uid == request.auth.uid
          || resource.data.channelId == request.auth.uid
          || isAdmin()
        );

      allow create:
        if loggedIn()
        && request.resource.data.redemptionId == redemptionId
        && request.resource.data.uid == request.auth.uid
        && request.resource.data.status == "pending_fulfillment"
        && request.resource.data.createdAt == request.time
        && request.resource.data.keys().hasOnly([
          "redemptionId",
          "rewardId",
          "channelId",
          "uid",
          "cost",
          "status",
          "createdAt"
        ])
        && getAfter(
          /databases/$(database)/documents/zyCoinTransactions/$(redemptionId)
        ).data.type == "reward_redeem"
        && getAfter(
          /databases/$(database)/documents/zyCoinTransactions/$(redemptionId)
        ).data.fromUid == request.auth.uid
        && getAfter(
          /databases/$(database)/documents/zyCoinTransactions/$(redemptionId)
        ).data.rewardId == request.resource.data.rewardId
        && getAfter(
          /databases/$(database)/documents/zyCoinTransactions/$(redemptionId)
        ).data.toUid == request.resource.data.channelId
        && getAfter(
          /databases/$(database)/documents/zyCoinTransactions/$(redemptionId)
        ).data.amount == request.resource.data.cost;

      allow update:
        if loggedIn()
        && (
          request.auth.uid == resource.data.channelId
          || isAdmin()
        )
        && resource.data.status == "pending_fulfillment"
        && request.resource.data.status == "fulfilled"
        && request.resource.data.fulfilledBy == request.auth.uid
        && request.resource.data.fulfilledAt == request.time
        && request.resource.data.diff(resource.data).affectedKeys().hasOnly([
          "status",
          "fulfilledBy",
          "fulfilledAt"
        ]);

      allow delete:
        if false;
    }

    match /coinPromotions/{promotionId} {
      allow read:
        if true;

      allow create:
        if isAdmin()
        && request.resource.data.promotionId == promotionId
        && request.resource.data.title is string
        && request.resource.data.title.size() >= 1
        && request.resource.data.title.size() <= 60
        && request.resource.data.description is string
        && request.resource.data.description.size() <= 160
        && request.resource.data.amount is int
        && request.resource.data.amount >= 1
        && request.resource.data.amount <= 10000
        && request.resource.data.maxClaims is int
        && request.resource.data.maxClaims >= 1
        && request.resource.data.maxClaims <= 100000
        && request.resource.data.claimCount == 0
        && request.resource.data.active == true
        && request.resource.data.startsAt is timestamp
        && request.resource.data.endsAt is timestamp
        && request.resource.data.endsAt > request.resource.data.startsAt
        && request.resource.data.createdBy == request.auth.uid
        && request.resource.data.createdAt == request.time
        && request.resource.data.updatedAt == request.time
        && request.resource.data.keys().hasOnly([
          "promotionId",
          "title",
          "description",
          "amount",
          "maxClaims",
          "claimCount",
          "active",
          "startsAt",
          "endsAt",
          "createdBy",
          "createdAt",
          "updatedAt"
        ]);

      allow update:
        if isAdmin()
        || validPromotionCounterUpdate(promotionId);

      allow delete:
        if false;
    }

    match /coinPromotions/{promotionId}/claims/{uid} {
      allow get:
        if isOwner(uid) || isAdmin();

      allow list:
        if isAdmin();

      allow create:
        if isOwner(uid)
        && !isBanned(uid)
        && request.resource.data.uid == uid
        && request.resource.data.promotionId == promotionId
        && request.resource.data.amount is int
        && request.resource.data.amount >= 1
        && request.resource.data.amount <= 10000
        && request.resource.data.transactionId is string
        && request.resource.data.transactionId.size() > 0
        && request.resource.data.transactionId.size() <= 128
        && request.resource.data.createdAt == request.time
        && request.resource.data.keys().hasOnly([
          "uid",
          "promotionId",
          "amount",
          "transactionId",
          "createdAt"
        ])
        && getAfter(
          /databases/$(database)/documents/zyCoinTransactions/$(request.resource.data.transactionId)
        ).data.type == "promotion_claim"
        && getAfter(
          /databases/$(database)/documents/zyCoinTransactions/$(request.resource.data.transactionId)
        ).data.toUid == uid
        && getAfter(
          /databases/$(database)/documents/zyCoinTransactions/$(request.resource.data.transactionId)
        ).data.promotionId == promotionId
        && getAfter(
          /databases/$(database)/documents/zyCoinTransactions/$(request.resource.data.transactionId)
        ).data.amount == request.resource.data.amount;

      allow update, delete:
        if false;
    }
'''

src = src.replace(platform_anchor, platform_rules + platform_anchor, 1)

# Fix precedence on channelProfiles owner/admin write guard by wrapping the role
# expression. (Kept as a textual post-pass so the emitted rule is explicit.)
src = src.replace(
    '''      allow create, update:
        if isOwner(uid) || isAdmin()
        && request.resource.data.uid == uid''',
    '''      allow create, update:
        if (isOwner(uid) || isAdmin())
        && request.resource.data.uid == uid''',
    1,
)

# Synchronize every canonical rules copy.
for path in RULE_FILES:
    path.write_text(src, encoding='utf-8')

print(f'Platform rules patch applied: {len(src.splitlines())} lines')

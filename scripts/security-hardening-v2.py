from pathlib import Path
import json
import re

ROOT = Path('.')


def read(path):
    return Path(path).read_text(encoding='utf-8')


def write(path, text):
    Path(path).write_text(text, encoding='utf-8')


def once(text, old, new, label):
    if old not in text:
        raise SystemExit(f'anchor not found: {label}')
    return text.replace(old, new, 1)


def replace_all_rules(text):
    # Core auth + URL validation helpers.
    anchor = '''    function isAdmin() {
      return loggedIn()
        && isAdminUid(request.auth.uid);
    }
'''
    addition = anchor + '''
    function verifiedUser() {
      return loggedIn()
        && request.auth.token.email_verified == true;
    }

    function validHttpsURL(url) {
      return url is string
        && url.size() <= 2048
        && (
          url == ""
          || url.matches('^https://[^\\\\s]+$')
        );
    }

    function validStreamingURL(url) {
      return url is string
        && url.size() <= 2048
        && (
          url.matches('^https://(www\\\\.|m\\\\.|player\\\\.)?twitch\\\\.tv/.*$')
          || url.matches('^https://(www\\\\.|player\\\\.)?kick\\\\.com/.*$')
        );
    }

    function validPublicImageURL(url) {
      return url is string
        && url.size() <= 2048
        && (
          url == ""
          || url.matches('^https://([A-Za-z0-9-]+\\\\.)*googleusercontent\\\\.com/.*$')
          || url.matches('^https://firebasestorage\\\\.googleapis\\\\.com/.*$')
          || url.matches('^https://storage\\\\.googleapis\\\\.com/.*$')
          || url.matches('^https://static-cdn\\\\.jtvnw\\\\.net/.*$')
          || url.matches('^https://clips-media-assets2\\\\.twitch\\\\.tv/.*$')
          || url.matches('^https://([A-Za-z0-9-]+\\\\.)*kick\\\\.com/.*$')
        );
    }

    function validYouTubeURL(url) {
      return url == ""
        || (validHttpsURL(url) && url.matches('^https://(www\\\\.)?(youtube\\\\.com|youtu\\\\.be)/.*$'));
    }

    function validInstagramURL(url) {
      return url == ""
        || (validHttpsURL(url) && url.matches('^https://(www\\\\.)?instagram\\\\.com/.*$'));
    }

    function validTikTokURL(url) {
      return url == ""
        || (validHttpsURL(url) && url.matches('^https://(www\\\\.)?tiktok\\\\.com/.*$'));
    }
'''
    text = once(text, anchor, addition, 'core security helpers')

    text = once(text, '''    function validPhotoURL(url) {
      return url is string
        && url.size() <= 2048;
    }
''', '''    function validPhotoURL(url) {
      return validPublicImageURL(url);
    }
''', 'photo url validator')

    # Free-wallet farm removal: new wallets start at zero and recipient fallback only receives transfer amount.
    text = text.replace('== 500 + tx.amount', '== tx.amount')
    text = text.replace('== 500 + data.amount', '== data.amount')
    text = once(text, '''          && request.resource.data.balance
              == 500
''', '''          && verifiedUser()

          && request.resource.data.balance
              == 0
''', 'initial wallet zero')

    # High-value operations require a verified email.
    for label, old, new in [
      ('support verified', '      return loggedIn()\n\n        && !isBanned(\n          request.auth.uid\n        )\n\n        && data.transactionId', '      return verifiedUser()\n\n        && !isBanned(\n          request.auth.uid\n        )\n\n        && data.transactionId'),
      ('reward verified', '      return loggedIn()\n        && !isBanned(request.auth.uid)\n        && data.transactionId == transactionId\n        && data.fromUid == request.auth.uid\n        && data.toUid is string\n        && data.toUid.size() > 0\n        && data.toUid != data.fromUid\n        && data.streamId is string\n        && data.streamId.size() > 0\n        && data.rewardId is string', '      return verifiedUser()\n        && !isBanned(request.auth.uid)\n        && data.transactionId == transactionId\n        && data.fromUid == request.auth.uid\n        && data.toUid is string\n        && data.toUid.size() > 0\n        && data.toUid != data.fromUid\n        && data.streamId is string\n        && data.streamId.size() > 0\n        && data.rewardId is string'),
    ]:
        if old in text:
            text = text.replace(old, new, 1)

    # Admin identities are no longer enumerable.
    text = once(text, '''    match /admins/{uid} {

      allow read:
        if true;

      allow create, update, delete:
        if false;
    }
''', '''    match /admins/{uid} {

      allow get:
        if isOwner(uid)
        || isAdmin();

      allow list:
        if isAdmin();

      allow create, update, delete:
        if false;
    }
''', 'admin privacy')

    # Stream creation/update and URLs.
    text = once(text, '''      allow create:
        if loggedIn()

        && !isBanned(
          request.auth.uid
        )
''', '''      allow create:
        if verifiedUser()

        && !isBanned(
          request.auth.uid
        )
''', 'stream verified create')
    text = once(text, '''          loggedIn()

          && !isBanned(request.auth.uid)
''', '''          verifiedUser()

          && !isBanned(request.auth.uid)
''', 'stream verified update') if '''          loggedIn()

          && !isBanned(request.auth.uid)
''' in text else text
    # exact formatted update branch
    text = text.replace('''          loggedIn()

          && !isBanned(
            request.auth.uid
          )

          && resource.data.streamerUid''', '''          verifiedUser()

          && !isBanned(
            request.auth.uid
          )

          && resource.data.streamerUid''', 1)

    text = once(text, '''        && validPlatformStreamFields(
          request.resource.data
        )

        && request.resource.data.keys().hasAll([''', '''        && validPlatformStreamFields(
          request.resource.data
        )

        && validStreamingURL(request.resource.data.playbackURL)
        && validPublicImageURL(request.resource.data.thumbnailURL)

        && request.resource.data.keys().hasAll([''', 'stream create url validation')
    text = once(text, '''          && validPlatformStreamFields(
            request.resource.data
          )

          && request.resource.data
              .diff(resource.data)''', '''          && validPlatformStreamFields(
            request.resource.data
          )

          && validStreamingURL(request.resource.data.playbackURL)
          && validPublicImageURL(request.resource.data.thumbnailURL)

          && request.resource.data
              .diff(resource.data)''', 'stream update url validation')

    # Optional VOD is Twitch/Kick only, not arbitrary links.
    text = once(text, '''        && (
          !data.keys().hasAll(["vodURL"])
          || (
            data.vodURL is string
            && data.vodURL.size() <= 2048
          )
        )''', '''        && (
          !data.keys().hasAll(["vodURL"])
          || data.vodURL == ""
          || validStreamingURL(data.vodURL)
        )''', 'vod url rules')

    # Public support alerts become ephemeral (24h TTL) and only verified users can create them.
    text = once(text, '''        allow create:
          if loggedIn()

          && request.resource.data.transactionId''', '''        allow create:
          if verifiedUser()

          && request.resource.data.transactionId''', 'support alert verified')
    text = once(text, '''          && request.resource.data.createdAt
              == request.time

          && validOptionalSupportMessage(''', '''          && request.resource.data.createdAt
              == request.time

          && request.resource.data.expiresAt is timestamp
          && request.resource.data.expiresAt >= request.time + duration.value(23, "h")
          && request.resource.data.expiresAt <= request.time + duration.value(25, "h")

          && validOptionalSupportMessage(''', 'support alert ttl')
    text = once(text, '''            "amount",
            "createdAt",
            "message"
          ])''', '''            "amount",
            "createdAt",
            "message",
            "expiresAt"
          ])''', 'support alert ttl field')

    # Chat: verified accounts and an absolute 1s rate cap even with slow mode off.
    text = once(text, '''        allow create:
          if loggedIn()

          && !isChatRestricted(''', '''        allow create:
          if verifiedUser()

          && !isChatRestricted(''', 'chat verified')
    old_rate = '''          && (
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
          )'''
    new_rate = '''          && getAfter(ratePath).data.uid == request.auth.uid
          && getAfter(ratePath).data.lastAt == request.time
          && getAfter(ratePath).data.expiresAt is timestamp
          && getAfter(ratePath).data.expiresAt > request.time
          && getAfter(ratePath).data.expiresAt <= request.time + duration.value(3, "h")
          && (
            !exists(ratePath)
            || request.time >= get(ratePath).data.lastAt
               + duration.value(
                   get(settingsPath).data.slowModeSeconds > 1
                     ? get(settingsPath).data.slowModeSeconds
                     : 1,
                   "s"
                 )
          )'''
    text = once(text, old_rate, new_rate, 'absolute chat rate')

    # Chat rate document carries TTL.
    text = once(text, '''        && request.resource.data.lastAt == request.time
        && request.resource.data.keys().hasOnly(["uid", "lastAt"]);''', '''        && request.resource.data.lastAt == request.time
        && request.resource.data.expiresAt is timestamp
        && request.resource.data.expiresAt > request.time
        && request.resource.data.expiresAt <= request.time + duration.value(3, "h")
        && request.resource.data.keys().hasOnly(["uid", "lastAt", "expiresAt"]);''', 'chat rate create ttl')
    text = once(text, '''        && request.resource.data.lastAt == request.time
        && request.resource.data.diff(resource.data).affectedKeys().hasOnly(["lastAt"]);''', '''        && request.resource.data.lastAt == request.time
        && request.resource.data.expiresAt is timestamp
        && request.resource.data.expiresAt > request.time
        && request.resource.data.expiresAt <= request.time + duration.value(3, "h")
        && request.resource.data.diff(resource.data).affectedKeys().hasOnly(["lastAt", "expiresAt"]);''', 'chat rate update ttl')

    # Reactions: verified + ephemeral TTL.
    # First occurrence after reactionRate block; apply exact globally only once each.
    text = once(text, '''        && request.resource.data.lastAt == request.time
        && request.resource.data.keys().hasOnly(["uid", "lastAt"]);

      allow update:
        if isOwner(uid)
        && request.resource.data.uid == resource.data.uid
        && request.resource.data.lastAt == request.time
        && request.time >= resource.data.lastAt + duration.value(1, "s")
        && request.resource.data.diff(resource.data).affectedKeys().hasOnly(["lastAt"]);''', '''        && request.resource.data.lastAt == request.time
        && request.resource.data.expiresAt is timestamp
        && request.resource.data.expiresAt > request.time
        && request.resource.data.expiresAt <= request.time + duration.value(3, "h")
        && request.resource.data.keys().hasOnly(["uid", "lastAt", "expiresAt"]);

      allow update:
        if isOwner(uid)
        && request.resource.data.uid == resource.data.uid
        && request.resource.data.lastAt == request.time
        && request.time >= resource.data.lastAt + duration.value(1, "s")
        && request.resource.data.expiresAt is timestamp
        && request.resource.data.expiresAt > request.time
        && request.resource.data.expiresAt <= request.time + duration.value(3, "h")
        && request.resource.data.diff(resource.data).affectedKeys().hasOnly(["lastAt", "expiresAt"]);''', 'reaction rate ttl')
    text = once(text, '''      allow create:
        if loggedIn()
        && !isBanned(request.auth.uid)
        && request.resource.data.uid == request.auth.uid
        && request.resource.data.emoji in ["❤️", "😂", "🔥", "👏", "😮"]
        && request.resource.data.createdAt == request.time
        && request.resource.data.keys().hasOnly([
          "uid",
          "emoji",
          "createdAt"
        ])''', '''      allow create:
        if verifiedUser()
        && !isBanned(request.auth.uid)
        && request.resource.data.uid == request.auth.uid
        && request.resource.data.emoji in ["❤️", "😂", "🔥", "👏", "😮"]
        && request.resource.data.createdAt == request.time
        && request.resource.data.expiresAt is timestamp
        && request.resource.data.expiresAt >= request.time + duration.value(5, "m")
        && request.resource.data.expiresAt <= request.time + duration.value(15, "m")
        && request.resource.data.keys().hasOnly([
          "uid",
          "emoji",
          "createdAt",
          "expiresAt"
        ])''', 'reaction ttl and verified')

    # Poll votes and clips are verified interactions.
    text = text.replace('''      return loggedIn()
        && !isBanned(request.auth.uid)
        && resource.data.status == "active"''', '''      return verifiedUser()
        && !isBanned(request.auth.uid)
        && resource.data.status == "active"''', 1)
    text = once(text, '''      allow create:
        if loggedIn()
        && !isBanned(request.auth.uid)
        && request.resource.data.clipId == clipId''', '''      allow create:
        if verifiedUser()
        && !isBanned(request.auth.uid)
        && request.resource.data.clipId == clipId''', 'clip verified')
    text = once(text, '''        && request.resource.data.sourceUrl is string
        && request.resource.data.sourceUrl.size() <= 2048
        && request.resource.data.thumbnailURL is string
        && request.resource.data.thumbnailURL.size() <= 2048''', '''        && (
          request.resource.data.sourceUrl == ""
          || validStreamingURL(request.resource.data.sourceUrl)
        )
        && validPublicImageURL(request.resource.data.thumbnailURL)''', 'clip url validation')
    text = once(text, '''      allow create:
        if isOwner(uid)
        && !isBanned(uid)
        && request.resource.data.uid == uid
        && request.resource.data.optionIndex is int''', '''      allow create:
        if isOwner(uid)
        && verifiedUser()
        && !isBanned(uid)
        && request.resource.data.uid == uid
        && request.resource.data.optionIndex is int''', 'poll vote verified')

    # Creator identity actions require verified email.
    text = once(text, '''      allow create:
        if loggedIn()
        && !isBanned(request.auth.uid)
        && code.matches''', '''      allow create:
        if verifiedUser()
        && !isBanned(request.auth.uid)
        && code.matches''', 'creator code verified')
    text = once(text, '''      allow create, update:
        if isOwner(uid)
        && docId == "current"''', '''      allow create, update:
        if isOwner(uid)
        && verifiedUser()
        && docId == "current"''', 'creator attribution verified')

    # Channel profile social URLs are scheme/host constrained in Rules.
    text = once(text, '''        && request.resource.data.website is string
        && request.resource.data.website.size() <= 2048
        && request.resource.data.youtube is string
        && request.resource.data.youtube.size() <= 2048
        && request.resource.data.instagram is string
        && request.resource.data.instagram.size() <= 2048
        && request.resource.data.tiktok is string
        && request.resource.data.tiktok.size() <= 2048''', '''        && validHttpsURL(request.resource.data.website)
        && validYouTubeURL(request.resource.data.youtube)
        && validInstagramURL(request.resource.data.instagram)
        && validTikTokURL(request.resource.data.tiktok)''', 'channel profile url validation')

    # Viewer presence privacy + TTL. Only self can get; streamer/admin can list.
    old_viewers = '''    match /streams/{streamId}/viewers/{viewerUid} {

      allow read:
        if loggedIn();


      allow create:
        if isOwner(viewerUid)

        && request.resource.data.uid
            == viewerUid

        && request.resource.data.joinedAt
            == request.time

        && request.resource.data.lastSeen
            == request.time

        && request.resource.data.keys().hasOnly([
          "uid",
          "joinedAt",
          "lastSeen"
        ]);


      allow update:
        if isOwner(viewerUid)

        && request.resource.data.uid
            == resource.data.uid

        && request.resource.data.joinedAt
            == resource.data.joinedAt

        && request.resource.data.lastSeen
            == request.time

        && request.resource.data
            .diff(resource.data)
            .affectedKeys()
            .hasOnly([
              "lastSeen"
            ]);
'''
    new_viewers = '''    match /streams/{streamId}/viewers/{viewerUid} {

      allow get:
        if isOwner(viewerUid)
        || isAdmin()
        || (
          loggedIn()
          && get(/databases/$(database)/documents/streams/$(streamId)).data.streamerUid == request.auth.uid
        );

      allow list:
        if isAdmin()
        || (
          loggedIn()
          && get(/databases/$(database)/documents/streams/$(streamId)).data.streamerUid == request.auth.uid
        );


      allow create:
        if isOwner(viewerUid)

        && request.resource.data.uid
            == viewerUid

        && request.resource.data.joinedAt
            == request.time

        && request.resource.data.lastSeen
            == request.time

        && request.resource.data.expiresAt is timestamp
        && request.resource.data.expiresAt >= request.time + duration.value(1, "m")
        && request.resource.data.expiresAt <= request.time + duration.value(3, "m")

        && request.resource.data.keys().hasOnly([
          "uid",
          "joinedAt",
          "lastSeen",
          "expiresAt"
        ]);


      allow update:
        if isOwner(viewerUid)

        && request.resource.data.uid
            == resource.data.uid

        && request.resource.data.joinedAt
            == resource.data.joinedAt

        && request.resource.data.lastSeen
            == request.time

        && request.resource.data.expiresAt is timestamp
        && request.resource.data.expiresAt >= request.time + duration.value(1, "m")
        && request.resource.data.expiresAt <= request.time + duration.value(3, "m")

        && request.resource.data
            .diff(resource.data)
            .affectedKeys()
            .hasOnly([
              "lastSeen",
              "expiresAt"
            ]);
'''
    text = once(text, old_viewers, new_viewers, 'viewer privacy ttl')

    # Followers graph: self lookup + owner/admin listing only.
    text = once(text, '''      match /followers/{followerUid} {

        allow read:
          if true;
''', '''      match /followers/{followerUid} {

        allow get:
          if isOwner(followerUid)
          || isOwner(channelId)
          || isAdmin();

        allow list:
          if isOwner(channelId)
          || isAdmin();
''', 'follower graph privacy')

    # Progress must correspond to current private presence; verified account only.
    text = once(text, '''      allow create:
        if isOwner(uid)
        && progressId == "main"''', '''      allow create:
        if isOwner(uid)
        && verifiedUser()
        && progressId == "main"''', 'progress verified create')
    text = once(text, '''        && exists(
          /databases/$(database)/documents/streams/$(request.resource.data.lastStreamId)
        )
        && request.resource.data.lastWatchRewardAt == request.time''', '''        && exists(
          /databases/$(database)/documents/streams/$(request.resource.data.lastStreamId)
        )
        && exists(
          /databases/$(database)/documents/streams/$(request.resource.data.lastStreamId)/viewers/$(uid)
        )
        && get(
          /databases/$(database)/documents/streams/$(request.resource.data.lastStreamId)/viewers/$(uid)
        ).data.lastSeen >= request.time - duration.value(2, "m")
        && request.resource.data.lastWatchRewardAt == request.time''', 'progress presence create')
    text = once(text, '''      allow update:
        if isOwner(uid)
        && progressId == "main"''', '''      allow update:
        if isOwner(uid)
        && verifiedUser()
        && progressId == "main"''', 'progress verified update')
    # Second exists(stream) occurrence in progress update.
    progress_marker = '''        && exists(
          /databases/$(database)/documents/streams/$(request.resource.data.lastStreamId)
        )
        && request.resource.data.lastWatchRewardAt == request.time'''
    if progress_marker in text:
        text = text.replace(progress_marker, '''        && exists(
          /databases/$(database)/documents/streams/$(request.resource.data.lastStreamId)
        )
        && exists(
          /databases/$(database)/documents/streams/$(request.resource.data.lastStreamId)/viewers/$(uid)
        )
        && get(
          /databases/$(database)/documents/streams/$(request.resource.data.lastStreamId)/viewers/$(uid)
        ).data.lastSeen >= request.time - duration.value(2, "m")
        && request.resource.data.lastWatchRewardAt == request.time''', 1)

    # Disable public promotion minting until server/App Check backed claim path exists.
    text = once(text, '''        || (
          request.resource.data.type == "promotion_claim"
          && validPromotionTransactionCreate(transactionId)
        );''', '''        ;''', 'disable promotion tx client mint')
    # Claims cannot be created by clients.
    claim_start = '''      allow create:
        if isOwner(uid)
        && !isBanned(uid)
        && request.resource.data.uid == uid
        && request.resource.data.promotionId == promotionId'''
    if claim_start in text:
        start = text.index(claim_start)
        end = text.index('''

      allow update, delete:
        if false;''', start)
        text = text[:start] + '''      allow create:
        if false;''' + text[end:]

    # Orders should also require verified email.
    text = once(text, '''      allow create:
        if loggedIn()

        && !isBanned(
          request.auth.uid
        )

        && request.resource.data.uid''', '''      allow create:
        if verifiedUser()

        && !isBanned(
          request.auth.uid
        )

        && request.resource.data.uid''', 'orders verified')

    return text


# Patch all three rule copies from one authoritative source.
rules = replace_all_rules(read('firestore.rules'))
for path in ['firestore.rules', 'firebase/firestore.rules', 'REGRAS-PARA-COLAR-NO-FIREBASE.txt']:
    write(path, rules)

# Firebase web SDK upgrade + zero-balance wallet + Timestamp export.
path = 'assets/js/firebase.js'
t = read(path)
t = t.replace('firebasejs/10.12.5/', 'firebasejs/12.18.0/')
t = t.replace('runTransaction, increment } from', 'runTransaction, increment, Timestamp } from')
t = t.replace('runTransaction, increment };', 'runTransaction, increment, Timestamp };')
t = t.replace('balance: 500, totalSent: 0, totalReceived: 0', 'balance: 0, totalSent: 0, totalReceived: 0')
write(path, t)

# Authentication UI hardening.
path = 'assets/js/auth-pages.js'
t = read(path)
t = once(t, "import { header, footer } from './ui.js';", "import { header, footer } from './ui.js';\nimport { strongPassword, genericAuthMessage, localRedirect } from './security.js';", 'auth security import')
t = t.replace("            location.href = 'index.html';", "            location.href = localRedirect(new URLSearchParams(location.search).get('redirect'), 'index.html');", 1)
t = once(t, "            if (name.length < 2)\n                throw new Error('Nome muito curto.');", "            if (name.length < 2)\n                throw new Error('Nome muito curto.');\n            if (!strongPassword(password))\n                throw new Error('Use pelo menos 10 caracteres, com letra e número.');", 'password strength')
t = t.replace("            await sendPasswordResetEmail(auth, String(fd.get('email')));\n            show('Link de recuperação enviado para seu e-mail.', 'ok');", "            await sendPasswordResetEmail(auth, String(fd.get('email'))).catch(() => {});\n            show('Se existir uma conta para esse e-mail, enviaremos as instruções de recuperação.', 'ok');")
t = once(t, "        show(err?.message?.replace('Firebase: ', '') || 'Não foi possível concluir a operação.');", "        if (mode === 'register' && ['Nome muito curto.', 'Use pelo menos 10 caracteres, com letra e número.'].includes(err?.message)) show(err.message);\n        else if (mode === 'reset') show('Se existir uma conta para esse e-mail, enviaremos as instruções de recuperação.', 'ok');\n        else show(genericAuthMessage());", 'generic auth errors')
t = t.replace("    location.href = 'index.html';", "    location.href = localRedirect(new URLSearchParams(location.search).get('redirect'), 'index.html');")
write(path, t)

# Social presence/follower listeners: bounded and private.
path = 'assets/js/social.js'
t = read(path)
t = once(t, "  writeBatch\n} from './firebase.js';", "  writeBatch,\n  query,\n  limit,\n  Timestamp\n} from './firebase.js';", 'social imports')
t = t.replace("    collection(db, 'channels', channelId, 'followers'),", "    query(collection(db, 'channels', channelId, 'followers'), limit(1001)),")
t = t.replace("    collection(db, 'streams', streamId, 'viewers'),", "    query(collection(db, 'streams', streamId, 'viewers'), limit(5001)),")
t = t.replace("      joinedAt: serverTimestamp(),\n      lastSeen: serverTimestamp()", "      joinedAt: serverTimestamp(),\n      lastSeen: serverTimestamp(),\n      expiresAt: Timestamp.fromMillis(Date.now() + 2 * 60 * 1000)")
t = t.replace("    await updateDoc(presenceRef, { lastSeen: serverTimestamp() });", "    await updateDoc(presenceRef, { lastSeen: serverTimestamp(), expiresAt: Timestamp.fromMillis(Date.now() + 2 * 60 * 1000) });")
t = t.replace("      await updateDoc(presenceRef, { lastSeen: serverTimestamp() });", "      await updateDoc(presenceRef, { lastSeen: serverTimestamp(), expiresAt: Timestamp.fromMillis(Date.now() + 2 * 60 * 1000) });")
t = once(t, "  return () => clearInterval(timer);", "  return () => {\n    clearInterval(timer);\n    deleteDoc(presenceRef).catch(() => {});\n  };", 'presence cleanup')
write(path, t)

# Live social: do not enumerate viewer/follower identities for ordinary viewers.
path = 'assets/js/live-social.js'
t = read(path)
t = t.replace("  return Number(activeViewers || 0).toLocaleString('pt-BR');", "  return currentUser?.uid === stream?.streamerUid ? Number(activeViewers || 0).toLocaleString('pt-BR') : 'Privado';")
t = t.replace("<strong id=\"live-follower-count\">${followerCount.toLocaleString('pt-BR')}</strong>", "<strong id=\"live-follower-count\">${currentUser?.uid === stream.streamerUid ? followerCount.toLocaleString('pt-BR') : 'Privado'}</strong>")
t = once(t, "  try {\n    stopPresence = await startViewerPresence(currentUser.uid, streamId);\n    stopViewers = watchActiveViewers(", "  try {\n    stopPresence = await startViewerPresence(currentUser.uid, streamId);\n    if (currentUser.uid !== stream?.streamerUid) { activeViewers = null; renderPanel(); return; }\n    stopViewers = watchActiveViewers(", 'private viewer list ui')
# follower subscription only for channel owner.
t = once(t, "  stopFollowers = watchFollowerCount(\n    stream.streamerUid,", "  if (currentUser?.uid === stream.streamerUid) stopFollowers = watchFollowerCount(\n    stream.streamerUid,", 'private follower list ui')
write(path, t)

# Live VOD strict URL.
path = 'assets/js/live-vod.js'
t = read(path)
t = once(t, "import { escapeAttr } from './ui.js';", "import { escapeAttr } from './ui.js';\nimport { safeStreamingUrl } from './security.js';", 'vod security import')
t = re.sub(r"function validUrl\(value\) \{.*?\n\}", "function validUrl(value) { return safeStreamingUrl(value); }", t, count=1, flags=re.S)
t = t.replace('rel="noopener noreferrer"', 'rel="noopener noreferrer external" referrerpolicy="no-referrer"')
write(path, t)

# Clips strict external links/images.
path = 'assets/js/clips.js'
t = read(path)
t = once(t, "import { getPlatformPreferences, filterMature } from './platform-core.js';", "import { getPlatformPreferences, filterMature } from './platform-core.js';\nimport { safeStreamingUrl, safeImageUrl } from './security.js';", 'clips security import')
t = t.replace("${item.thumbnailURL ? `<img src=\"${escapeAttr(item.thumbnailURL)}\"", "${safeImageUrl(item.thumbnailURL) ? `<img src=\"${escapeAttr(safeImageUrl(item.thumbnailURL))}\" referrerpolicy=\"no-referrer\"")
t = t.replace("${item.sourceUrl ? `<a class=\"btn\" href=\"${escapeAttr(item.sourceUrl)}\" target=\"_blank\" rel=\"noopener noreferrer\">Abrir origem/VOD</a>` : ''}", "${safeStreamingUrl(item.sourceUrl) ? `<a class=\"btn\" href=\"${escapeAttr(safeStreamingUrl(item.sourceUrl))}\" target=\"_blank\" rel=\"noopener noreferrer external\" referrerpolicy=\"no-referrer\">Abrir origem/VOD</a>` : ''}")
write(path, t)

# Creator Center strict social/VOD URLs and verified gate.
path = 'assets/js/creator-center.js'
t = read(path)
t = once(t, "import { SUPPORT_ALERT_SOUNDS, normalizeSupportAlertSound, playSupportAlertSound, unlockSupportAlertAudio } from './support-alert-sound.js';", "import { SUPPORT_ALERT_SOUNDS, normalizeSupportAlertSound, playSupportAlertSound, unlockSupportAlertAudio } from './support-alert-sound.js';\nimport { safeStreamingUrl, safeSocialUrl } from './security.js';", 'creator security import')
t = re.sub(r"function safeUrl\(value = ''\) \{.*?\n\}", "function safeUrl(value = '') { return safeStreamingUrl(value); }", t, count=1, flags=re.S)
t = t.replace("website: safeUrl(document.querySelector('#channel-website').value),", "website: safeSocialUrl('website', document.querySelector('#channel-website').value),")
t = t.replace("youtube: safeUrl(document.querySelector('#channel-youtube').value),", "youtube: safeSocialUrl('youtube', document.querySelector('#channel-youtube').value),")
t = t.replace("instagram: safeUrl(document.querySelector('#channel-instagram').value),", "instagram: safeSocialUrl('instagram', document.querySelector('#channel-instagram').value),")
t = t.replace("tiktok: safeUrl(document.querySelector('#channel-tiktok').value),", "tiktok: safeSocialUrl('tiktok', document.querySelector('#channel-tiktok').value),")
t = once(t, "  user = current;\n  loadAll().catch", "  user = current;\n  if (!user.emailVerified) { root.innerHTML = '<div class=\"card panel\"><h1>Verifique seu e-mail</h1><p class=\"muted\">Recursos do criador ficam bloqueados até a verificação da conta.</p></div>'; return; }\n  loadAll().catch", 'creator verified ui')
write(path, t)

# Live extras: bounded alerts, TTLs, verified-gated high-value actions, strict URLs, zero recipient bonus.
path = 'assets/js/live-extras.js'
t = read(path)
t = t.replace("  increment,\n  ensureWallet", "  increment,\n  Timestamp,\n  ensureWallet")
t = once(t, "import { escapeHtml, escapeAttr } from './ui.js';", "import { escapeHtml, escapeAttr } from './ui.js';\nimport { safeStreamingUrl, safeImageUrl, safeSocialUrl } from './security.js';", 'live extras security import')
t = t.replace("balance: 500 + amount,", "balance: amount,")
t = t.replace("        message,\n        createdAt: serverTimestamp()\n      });", "        message,\n        createdAt: serverTimestamp(),\n        expiresAt: Timestamp.fromMillis(Date.now() + 24 * 60 * 60 * 1000)\n      });", 1)
# verified support
needle = "  if (currentUser.uid === stream.streamerUid) {"
t = t.replace(needle, "  if (!currentUser.emailVerified) { feedback.innerHTML = '<div class=\"message err\">Verifique seu e-mail para usar Zy Coins.</div>'; return; }\n  if (currentUser.uid === stream.streamerUid) {", 1)
# reaction TTL + verified
needle = "  if (!REACTIONS.includes(emoji)) return;\n  if (!currentUser) {"
t = t.replace(needle, "  if (!REACTIONS.includes(emoji)) return;\n  if (!currentUser) {", 1)
t = t.replace("  const eventRef = doc(collection(db, 'streams', streamId, 'reactions'));", "  if (!currentUser.emailVerified) return;\n  const eventRef = doc(collection(db, 'streams', streamId, 'reactions'));", 1)
t = t.replace("      tx.set(eventRef, { uid: currentUser.uid, emoji, createdAt: serverTimestamp() });\n      tx.set(rateRef, { uid: currentUser.uid, lastAt: serverTimestamp() }, { merge: true });", "      tx.set(eventRef, { uid: currentUser.uid, emoji, createdAt: serverTimestamp(), expiresAt: Timestamp.fromMillis(Date.now() + 10 * 60 * 1000) });\n      tx.set(rateRef, { uid: currentUser.uid, lastAt: serverTimestamp(), expiresAt: Timestamp.fromMillis(Date.now() + 2 * 60 * 60 * 1000) }, { merge: true });")
# poll/clip/reward verified
t = t.replace("  if (!activePoll || activePoll.status !== 'active'", "  if (!currentUser.emailVerified) { if (feedback) feedback.innerHTML = '<div class=\"message err\">Verifique seu e-mail para votar.</div>'; return; }\n  if (!activePoll || activePoll.status !== 'active'", 1)
t = t.replace("  const title = window.prompt('Título do clipe:'", "  if (!currentUser.emailVerified) { alert('Verifique seu e-mail para criar clipes.'); return; }\n  const title = window.prompt('Título do clipe:'", 1)
t = t.replace("      sourceUrl: String(stream.vodURL || stream.playbackURL || ''),\n      thumbnailURL: String(stream.thumbnailURL || ''),", "      sourceUrl: safeStreamingUrl(stream.vodURL || stream.playbackURL || ''),\n      thumbnailURL: safeImageUrl(stream.thumbnailURL || ''),")
t = t.replace("  if (currentUser.uid === stream.streamerUid) {\n    if (feedback) feedback.innerHTML = '<div class=\"message err\">O criador não pode resgatar a própria recompensa.</div>';", "  if (!currentUser.emailVerified) { if (feedback) feedback.innerHTML = '<div class=\"message err\">Verifique seu e-mail para resgatar.</div>'; return; }\n  if (currentUser.uid === stream.streamerUid) {\n    if (feedback) feedback.innerHTML = '<div class=\"message err\">O criador não pode resgatar a própria recompensa.</div>';", 1)
t = t.replace("balance: 500 + cost", "balance: cost")
# public about links strict.
t = t.replace("      ['Site', data.website],\n      ['YouTube', data.youtube],\n      ['Instagram', data.instagram],\n      ['TikTok', data.tiktok]\n    ].filter(([, value]) => value);", "      ['Site', safeSocialUrl('website', data.website)],\n      ['YouTube', safeSocialUrl('youtube', data.youtube)],\n      ['Instagram', safeSocialUrl('instagram', data.instagram)],\n      ['TikTok', safeSocialUrl('tiktok', data.tiktok)]\n    ].filter(([, value]) => value);")
t = t.replace('target="_blank" rel="noopener noreferrer"', 'target="_blank" rel="noopener noreferrer external" referrerpolicy="no-referrer"')
# bounded support alerts listener.
t = t.replace("stopAlerts = onSnapshot(collection(db, 'streams', streamId, 'supportAlerts'),", "stopAlerts = onSnapshot(query(collection(db, 'streams', streamId, 'supportAlerts'), orderBy('createdAt', 'desc'), limit(100)),")
# chat min rate + TTL client; rule enforces server-side.
t = t.replace("        const slow = Math.max(0, Math.min(120, Number(chatSettings?.slowModeSeconds || 0)));\n        if (last && slow > 0 && Date.now() - last < slow * 1000) throw new Error('slow-mode');", "        const slow = Math.max(1, Math.min(120, Number(chatSettings?.slowModeSeconds || 0) || 1));\n        if (last && Date.now() - last < slow * 1000) throw new Error('slow-mode');")
t = t.replace("        tx.set(rateRef, { uid: currentUser.uid, lastAt: serverTimestamp() }, { merge: true });", "        tx.set(rateRef, { uid: currentUser.uid, lastAt: serverTimestamp(), expiresAt: Timestamp.fromMillis(Date.now() + 2 * 60 * 60 * 1000) }, { merge: true });")
t = t.replace("    const text = input.value.trim();", "    if (!currentUser.emailVerified) { if (feedback) feedback.textContent = 'Verifique seu e-mail para conversar.'; return; }\n    const text = input.value.trim();", 1)
write(path, t)

# Base live: safe images, support TTL, zero recipient bonus, verified gate. Enhanced chat will own writes.
path = 'assets/js/live.js'
t = read(path)
t = t.replace("increment, serverTimestamp, ensureWallet", "increment, serverTimestamp, Timestamp, ensureWallet")
t = once(t, "import { getStreamingEmbed, streamingPlatformLabel } from './streaming.js';", "import { getStreamingEmbed, streamingPlatformLabel } from './streaming.js';\nimport { safeImageUrl } from './security.js';", 'live security import')
t = t.replace("src=\"${escapeHtml(streamerProfile.photoURL)}\"", "src=\"${escapeAttr(safeImageUrl(streamerProfile.photoURL))}\" referrerpolicy=\"no-referrer\"")
t = t.replace("balance: 500 + amount,", "balance: amount,")
# any alert payload in base support gets TTL.
t = t.replace("amount,\n                    createdAt: serverTimestamp()\n                });", "amount,\n                    createdAt: serverTimestamp(),\n                    expiresAt: Timestamp.fromMillis(Date.now() + 24 * 60 * 60 * 1000)\n                });")
# support verified UI.
t = t.replace("    if (!user) {\n        msg.innerHTML = '<div class=\"message err\">Faça login para apoiar.</div>';", "    if (!user) {\n        msg.innerHTML = '<div class=\"message err\">Faça login para apoiar.</div>';", 1)
# insert after support auth block when unique string available.
t = t.replace("    if (user.uid === stream.streamerUid) {", "    if (!user.emailVerified) { msg.innerHTML = '<div class=\"message err\">Verifique seu e-mail para usar Zy Coins.</div>'; return; }\n    if (user.uid === stream.streamerUid) {", 1)
# Base chat no longer writes directly; enhanced compositor loads on live page and enforces rate transaction.
start = t.find('async function sendChatMessage() {')
end = t.find('\nfunction setChatFeedback(', start)
if start != -1 and end != -1:
    old = t[start:end]
    new = '''async function sendChatMessage() {
    const feedback = document.querySelector('#chat-feedback');
    if (!user) { setChatFeedback('Faça login para enviar mensagens.', true); return; }
    if (!user.emailVerified) { setChatFeedback('Verifique seu e-mail para conversar.', true); return; }
    // O envio real é instalado por live-extras.js, que usa chatRate atômico.
    if (feedback) feedback.textContent = 'Preparando envio seguro...';
}
'''
    t = t[:start] + new + t[end:]
write(path, t)

# Public support alert viewer ignores expired events and profile image safety.
path = 'assets/js/live-support-alerts.js'
t = read(path)
t = once(t, "} from './support-alert-sound.js';", "} from './support-alert-sound.js';\nimport { safeImageUrl } from './security.js';", 'support alert image security')
t = t.replace("photoURL: String(snap.data().photoURL || '')", "photoURL: safeImageUrl(snap.data().photoURL || '')")
t = t.replace("    if (!event.transactionId || seen.has(event.transactionId)) continue;", "    if (!event.transactionId || seen.has(event.transactionId)) continue;\n    const expires = timestampMs(event.expiresAt);\n    if (expires && expires <= Date.now()) continue;")
write(path, t)

# Promotions claiming is paused until server/App Check path exists.
path = 'assets/js/profile-promotions.js'
t = read(path)
# Replace event handler/function if present by turning claim entrypoint into hard stop.
t = re.sub(r"async function claimPromotion\((.*?)\) \{.*?\n\}", "async function claimPromotion(\\1) {\n  alert('Resgates promocionais estão temporariamente pausados enquanto a emissão de Zy Coins migra para o backend seguro.');\n}", t, count=1, flags=re.S)
write(path, t)

# Platform XP: require own fresh presence before transaction and don't award immediately.
path = 'assets/js/platform-core.js'
t = read(path)
t = once(t, "  const ref = doc(db, 'users', uid, 'progress', 'main');", "  const presence = await getDoc(doc(db, 'streams', streamId, 'viewers', uid)).catch(() => null);\n  const seenAt = presence?.exists?.() ? timestampMs(presence.data().lastSeen) : 0;\n  if (!seenAt || Date.now() - seenAt > 2 * 60 * 1000) return { skipped: true, reason: 'presence-required' };\n  const ref = doc(db, 'users', uid, 'progress', 'main');", 'xp presence')
write(path, t)

# Strict CSP, clickjacking and transport headers.
path = 'vercel.json'
config = json.loads(read(path))
security_headers = [
  {"key":"Content-Security-Policy","value":"default-src 'self'; script-src 'self' https://www.gstatic.com https://apis.google.com https://accounts.google.com; style-src 'self' 'unsafe-inline'; connect-src 'self' https://*.googleapis.com https://*.firebaseio.com https://securetoken.googleapis.com https://identitytoolkit.googleapis.com https://accounts.google.com wss://*.firebaseio.com; img-src 'self' data: blob: https://*.googleusercontent.com https://firebasestorage.googleapis.com https://storage.googleapis.com https://static-cdn.jtvnw.net https://clips-media-assets2.twitch.tv https://*.kick.com; frame-src https://player.twitch.tv https://*.twitch.tv https://player.kick.com https://*.kick.com https://accounts.google.com; worker-src 'self' blob:; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'; upgrade-insecure-requests"},
  {"key":"X-Frame-Options","value":"DENY"},
  {"key":"Strict-Transport-Security","value":"max-age=63072000; includeSubDomains; preload"},
  {"key":"Cross-Origin-Opener-Policy","value":"same-origin-allow-popups"},
  {"key":"X-Permitted-Cross-Domain-Policies","value":"none"},
  {"key":"Origin-Agent-Cluster","value":"?1"}
]
for rule in config.get('headers', []):
    if rule.get('source') == '/(.*)':
        existing = {h['key'].lower() for h in rule.get('headers', [])}
        rule['headers'].extend(h for h in security_headers if h['key'].lower() not in existing)
write(path, json.dumps(config, ensure_ascii=False, indent=2) + '\n')

# Remove inline executable module bootstraps so CSP does not need unsafe-inline scripts.
for html in ROOT.glob('*.html'):
    text = html.read_text(encoding='utf-8')
    text = re.sub(
      r'<script\s+type="module">\s*import\s*\{\s*header\s*,\s*footer\s*\}\s*from\s*[\'\"]\.\/assets\/js\/ui\.js[\'\"];?\s*header\([^)]*\);\s*footer\(\);\s*<\/script>',
      '<script type="module" src="assets/js/page-shell.js"></script>',
      text,
      flags=re.S
    )
    html.write_text(text, encoding='utf-8')

# TTL configuration. TTL deletion is asynchronous; rules still hide/ignore expired data.
indexes = {
  "indexes": [],
  "fieldOverrides": [
    {"collectionGroup":"viewers","fieldPath":"expiresAt","ttl":True,"indexes":[]},
    {"collectionGroup":"supportAlerts","fieldPath":"expiresAt","ttl":True,"indexes":[]},
    {"collectionGroup":"reactions","fieldPath":"expiresAt","ttl":True,"indexes":[]},
    {"collectionGroup":"reactionRate","fieldPath":"expiresAt","ttl":True,"indexes":[]},
    {"collectionGroup":"chatRate","fieldPath":"expiresAt","ttl":True,"indexes":[]}
  ]
}
write('firestore.indexes.json', json.dumps(indexes, ensure_ascii=False, indent=2) + '\n')
fb = json.loads(read('firebase.json'))
fb.setdefault('firestore', {})['rules'] = 'firebase/firestore.rules'
fb['firestore']['indexes'] = 'firestore.indexes.json'
write('firebase.json', json.dumps(fb, ensure_ascii=False, indent=2) + '\n')

# Package scripts include security tests.
p = json.loads(read('package.json'))
p['scripts']['test'] = "node --test tests/report-model.test.mjs tests/security-utils.test.mjs"
p['scripts']['test:rules'] = "firebase emulators:exec --project demo-zytrix-governance --only firestore 'node --test --test-concurrency=1 tests/firestore.rules.test.mjs tests/platform-expansion.rules.test.mjs tests/security-hardening.rules.test.mjs'"
write('package.json', json.dumps(p, ensure_ascii=False, indent=2) + '\n')

print('Security hardening v2 patch applied.')

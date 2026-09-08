from pathlib import Path
import re


def replace_once(text, old, new, label):
    if old not in text:
        raise SystemExit(f'Anchor not found: {label}')
    return text.replace(old, new, 1)


# --------------------------------------------------
# live.js: create the public sanitized alert atomically
# with the existing protected Zy Coin transaction.
# --------------------------------------------------
live_path = Path('assets/js/live.js')
live = live_path.read_text(encoding='utf-8')
if "supportAlerts', txRef.id" not in live:
    live = replace_once(
        live,
        "        const txRef = doc(collection(db, 'zyCoinTransactions'));\n",
        "        const txRef = doc(collection(db, 'zyCoinTransactions'));\n        const alertRef = doc(db, 'streams', stream.id, 'supportAlerts', txRef.id);\n",
        'live alert ref'
    )
    tx_block = """            tx.set(txRef, {
                transactionId: txRef.id,
                fromUid: user.uid,
                toUid: stream.streamerUid,
                streamId: stream.id,
                amount,
                type: 'stream_support',
                status: 'completed',
                createdAt: serverTimestamp()
            });
"""
    live = replace_once(
        live,
        tx_block,
        tx_block + """            tx.set(alertRef, {
                transactionId: txRef.id,
                fromUid: user.uid,
                streamId: stream.id,
                amount,
                createdAt: serverTimestamp()
            });
""",
        'live atomic alert write'
    )
live_path.write_text(live, encoding='utf-8')


# --------------------------------------------------
# live.html: load the shared alert listener and the
# Twitch/Kick access compatibility layer.
# --------------------------------------------------
live_html_path = Path('live.html')
live_html = live_html_path.read_text(encoding='utf-8')
if 'live-support-alerts.js' not in live_html:
    anchor = """  <script src="assets/js/live.js" type="module">
  </script>
   <script type="module" src="assets/js/live-social.js"></script>
"""
    replacement = """  <script src="assets/js/live.js" type="module">
  </script>
  <script type="module" src="assets/js/live-support-alerts.js"></script>
  <script type="module" src="assets/js/live-player-access.js"></script>
   <script type="module" src="assets/js/live-social.js"></script>
"""
    live_html = replace_once(live_html, anchor, replacement, 'live module tags')
live_html_path.write_text(live_html, encoding='utf-8')


# --------------------------------------------------
# config-live.js: streamer-selectable synthesized sound
# and explicit 18+ flag.
# --------------------------------------------------
config_path = Path('assets/js/config-live.js')
config = config_path.read_text(encoding='utf-8')
if "./support-alert-sound.js" not in config:
    config = replace_once(
        config,
        "import { parseStreamingSource, streamingPlatformLabel } from './streaming.js';\n",
        "import { parseStreamingSource, streamingPlatformLabel } from './streaming.js';\nimport { SUPPORT_ALERT_SOUNDS, normalizeSupportAlertSound, playSupportAlertSound, unlockSupportAlertAudio } from './support-alert-sound.js';\n",
        'config sound import'
    )

if 'id="support-alert-sound"' not in config:
    pattern = re.compile(r'(          <div class="panel card stream-status-card">.*?          </div>)\n        </div>\n      </div>', re.S)
    match = pattern.search(config)
    if not match:
        raise SystemExit('Anchor not found: config status card')
    extra = r'''

          <div class="panel card stream-alert-settings">
            <div class="eyebrow">Alertas de apoio</div>
            <strong>Som dos Zy Coins</strong>
            <p class="muted">Escolha o som que os espectadores ouvirão quando alguém apoiar esta live.</p>
            <div class="stream-alert-sound-row">
              <select id="support-alert-sound" class="input">
                ${Object.entries(SUPPORT_ALERT_SOUNDS)
                  .map(([value, label]) => `<option value="${value}" ${normalizeSupportAlertSound(stream.supportAlertSound || 'coin') === value ? 'selected' : ''}>${escapeHtml(label)}</option>`)
                  .join('')}
              </select>
              <button id="preview-support-sound" type="button" class="btn">▶ Testar</button>
            </div>

            <label class="mature-setting" for="mature-content">
              <input id="mature-content" type="checkbox" ${stream.matureContent === true ? 'checked' : ''}>
              <span>
                <strong>Conteúdo 18+</strong>
                <small>Mostra uma confirmação na Zytrix e mantém as exigências de login/idade da Twitch ou Kick.</small>
              </span>
            </label>
          </div>'''
    config = config[:match.start()] + match.group(1) + extra + '\n        </div>\n      </div>' + config[match.end():]

if "const soundSelect = document.querySelector('#support-alert-sound');" not in config:
    config = replace_once(
        config,
        "    const playbackInput = document.querySelector('#playback-url');\n",
        "    const playbackInput = document.querySelector('#playback-url');\n    const soundSelect = document.querySelector('#support-alert-sound');\n    const previewSoundButton = document.querySelector('#preview-support-sound');\n",
        'config sound controls'
    )
    config = replace_once(
        config,
        "    playbackInput.addEventListener('input', refreshStreamingHint);\n",
        "    playbackInput.addEventListener('input', refreshStreamingHint);\n    previewSoundButton?.addEventListener('click', async () => {\n        const message = document.querySelector('#config-msg');\n        const sound = normalizeSupportAlertSound(soundSelect?.value || 'coin');\n        if (sound === 'none') {\n            if (message) message.innerHTML = '<div class=\"message ok\">Som de apoio desativado.</div>';\n            return;\n        }\n        const unlocked = await unlockSupportAlertAudio();\n        const played = unlocked && playSupportAlertSound(sound);\n        if (message) {\n            message.innerHTML = played\n                ? '<div class=\"message ok\">Prévia do som reproduzida.</div>'\n                : '<div class=\"message err\">O navegador bloqueou o áudio. Clique novamente após interagir com a página.</div>';\n        }\n    });\n",
        'config sound preview'
    )

if "const supportAlertSound = normalizeSupportAlertSound" not in config:
    config = replace_once(
        config,
        "    const source = parseStreamingSource(document.querySelector('#playback-url').value);\n",
        "    const source = parseStreamingSource(document.querySelector('#playback-url').value);\n    const supportAlertSound = normalizeSupportAlertSound(document.querySelector('#support-alert-sound')?.value || 'coin');\n    const matureContent = document.querySelector('#mature-content')?.checked === true;\n",
        'config collect settings'
    )
    config = replace_once(
        config,
        "        playbackURL: source.canonicalUrl,\n        source\n",
        "        playbackURL: source.canonicalUrl,\n        supportAlertSound,\n        matureContent,\n        source\n",
        'config return settings'
    )

if "supportAlertSound: form.supportAlertSound" not in config:
    config = config.replace(
        "            playbackURL: form.playbackURL\n",
        "            playbackURL: form.playbackURL,\n            supportAlertSound: form.supportAlertSound,\n            matureContent: form.matureContent\n"
    )
    config = config.replace(
        "                playbackURL: form.playbackURL,\n                status:",
        "                playbackURL: form.playbackURL,\n                supportAlertSound: form.supportAlertSound,\n                matureContent: form.matureContent,\n                status:"
    )
    config = config.replace(
        "                playbackURL: form.playbackURL,\n                status: 'offline'",
        "                playbackURL: form.playbackURL,\n                supportAlertSound: form.supportAlertSound,\n                matureContent: form.matureContent,\n                status: 'offline'"
    )
config_path.write_text(config, encoding='utf-8')


# --------------------------------------------------
# Firestore rules: validate settings and make only the
# sanitized support alert public. Wallet/transaction data
# remains protected.
# --------------------------------------------------
def patch_rules(path):
    text = path.read_text(encoding='utf-8')
    if 'function validSupportAlertSound' not in text:
        old = '''    function validCoinAmount(amount) {
      return amount is int
        && amount >= 1
        && amount <= 100000;
    }
'''
        new = old + '''
    function validSupportAlertSound(sound) {
      return sound in ["coin", "bell", "pop", "soft", "none"];
    }
'''
        text = replace_once(text, old, new, f'{path} sound helper')

    if '"supportAlertSound"' not in text.split('// ATUALIZAR LIVE', 1)[0].split('// CRIAR LIVE', 1)[-1]:
        text = replace_once(
            text,
            '''        && request.resource.data.viewerCount
            == 0

        && request.resource.data.keys().hasAll([
''',
            '''        && request.resource.data.viewerCount
            == 0

        && (
          !request.resource.data.keys().hasAll(["supportAlertSound"])
          || validSupportAlertSound(request.resource.data.supportAlertSound)
        )

        && (
          !request.resource.data.keys().hasAll(["matureContent"])
          || request.resource.data.matureContent is bool
        )

        && request.resource.data.keys().hasAll([
''',
            f'{path} create setting validation'
        )
        old_only = '''        && request.resource.data.keys().hasOnly([
          "streamerUid",
          "channelId",
          "title",
          "description",
          "categoryId",
          "thumbnailURL",
          "status",
          "playbackURL",
          "startedAt",
          "endedAt",
          "createdAt",
          "viewerCount"
        ]);
'''
        new_only = old_only.replace('          "viewerCount"\n', '          "viewerCount",\n          "supportAlertSound",\n          "matureContent"\n')
        text = replace_once(text, old_only, new_only, f'{path} create allowed settings')

    update_section = text.split('// ATUALIZAR LIVE', 1)[-1]
    if 'validSupportAlertSound(request.resource.data.supportAlertSound)' not in update_section.split('// EXCLUIR LIVE', 1)[0]:
        text = replace_once(
            text,
            '''          && request.resource.data.viewerCount
              == resource.data.viewerCount

          // STREAMER NÃO PODE ALTERAR VIEWERCOUNT
''',
            '''          && request.resource.data.viewerCount
              == resource.data.viewerCount

          && (
            !request.resource.data.keys().hasAll(["supportAlertSound"])
            || validSupportAlertSound(request.resource.data.supportAlertSound)
          )

          && (
            !request.resource.data.keys().hasAll(["matureContent"])
            || request.resource.data.matureContent is bool
          )

          // STREAMER NÃO PODE ALTERAR VIEWERCOUNT
''',
            f'{path} update setting validation'
        )
        text = replace_once(
            text,
            '''                "playbackURL",
                "startedAt",
                "endedAt"
              ])
''',
            '''                "playbackURL",
                "startedAt",
                "endedAt",
                "supportAlertSound",
                "matureContent"
              ])
''',
            f'{path} update allowed settings'
        )

    if 'match /supportAlerts/{alertId}' not in text:
        marker = '''      // ================================================
      // CHAT EM TEMPO REAL
      // ================================================
'''
        block = '''      // ================================================
      // ALERTAS PÚBLICOS DE APOIO
      // ================================================
      // Evento sanitizado criado obrigatoriamente na mesma
      // operação atômica do stream_support correspondente.
      // Não expõe saldo, carteira ou pedidos de compra.
      // ================================================

      match /supportAlerts/{alertId} {
        allow read:
          if true;

        allow create:
          if loggedIn()
          && request.resource.data.transactionId == alertId
          && request.resource.data.fromUid == request.auth.uid
          && request.resource.data.streamId == streamId
          && validCoinAmount(request.resource.data.amount)
          && request.resource.data.createdAt == request.time
          && request.resource.data.keys().hasOnly([
            "transactionId",
            "fromUid",
            "streamId",
            "amount",
            "createdAt"
          ])
          && get(
            /databases/$(database)/documents/streams/$(streamId)
          ).data.status == "live"
          && getAfter(
            /databases/$(database)/documents/zyCoinTransactions/$(alertId)
          ).data.transactionId == alertId
          && getAfter(
            /databases/$(database)/documents/zyCoinTransactions/$(alertId)
          ).data.fromUid == request.auth.uid
          && getAfter(
            /databases/$(database)/documents/zyCoinTransactions/$(alertId)
          ).data.toUid == get(
            /databases/$(database)/documents/streams/$(streamId)
          ).data.streamerUid
          && getAfter(
            /databases/$(database)/documents/zyCoinTransactions/$(alertId)
          ).data.streamId == streamId
          && getAfter(
            /databases/$(database)/documents/zyCoinTransactions/$(alertId)
          ).data.amount == request.resource.data.amount
          && getAfter(
            /databases/$(database)/documents/zyCoinTransactions/$(alertId)
          ).data.type == "stream_support"
          && getAfter(
            /databases/$(database)/documents/zyCoinTransactions/$(alertId)
          ).data.status == "completed"
          && getAfter(
            /databases/$(database)/documents/zyCoinTransactions/$(alertId)
          ).data.createdAt == request.time;

        allow update, delete:
          if false;
      }


'''
        text = replace_once(text, marker, block + marker, f'{path} support alerts rule')

    path.write_text(text, encoding='utf-8')


for rules_path in [Path('firestore.rules'), Path('firebase/firestore.rules'), Path('REGRAS-PARA-COLAR-NO-FIREBASE.txt')]:
    patch_rules(rules_path)


# --------------------------------------------------
# CSS: brand-specific alert layer, mature gate and settings.
# The alert sits above the third-party iframe, never obscuring it.
# --------------------------------------------------
styles_path = Path('assets/css/styles.css')
styles = styles_path.read_text(encoding='utf-8')
if 'ZYTRIX SUPPORT ALERT LAYER' not in styles:
    styles += r'''

/* ==================================================
   ZYTRIX SUPPORT ALERT LAYER
   ================================================== */
.player {
  position: relative;
}

.support-alert-stage {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-bottom: 10px;
  min-height: 0;
}

.support-alert-audio-control {
  align-self: flex-end;
  padding: 6px 9px;
  border: 1px solid #24445a;
  border-radius: 8px;
  background: #0d1722;
  color: #9fb1c5;
  font: inherit;
  font-size: 9px;
  cursor: pointer;
}

.support-alert-audio-control:hover {
  border-color: #58c8ed;
  color: #dff8ff;
}

.support-alert-card {
  display: grid;
  grid-template-columns: 44px minmax(0, 1fr);
  align-items: center;
  gap: 12px;
  padding: 12px 14px;
  border: 1px solid #2a6680;
  border-left: 4px solid #58c8ed;
  border-radius: 12px;
  background: #0b1824;
  box-shadow: 0 10px 26px rgba(0, 0, 0, 0.24);
  animation: zySupportEnter 220ms ease-out both;
}

.support-alert-card.is-leaving {
  animation: zySupportLeave 240ms ease-in both;
}

.support-alert-avatar {
  display: grid;
  place-items: center;
  width: 44px;
  height: 44px;
  border-radius: 50%;
  background: #58c8ed;
  color: #06131c;
  font-size: 16px;
  font-weight: 900;
  object-fit: cover;
}

.support-alert-copy {
  display: grid;
  gap: 2px;
  min-width: 0;
}

.support-alert-eyebrow {
  color: #58c8ed;
  font-size: 8px;
  font-weight: 900;
  letter-spacing: 0.12em;
}

.support-alert-copy strong {
  color: #f2f7fb;
  font-size: 14px;
  overflow-wrap: anywhere;
}

.support-alert-copy > span:last-child {
  color: #8fa2b5;
  font-size: 10px;
}

@keyframes zySupportEnter {
  from { opacity: 0; transform: translateY(-8px); }
  to { opacity: 1; transform: translateY(0); }
}

@keyframes zySupportLeave {
  from { opacity: 1; transform: translateY(0); }
  to { opacity: 0; transform: translateY(-6px); }
}

.twitch-embed-host {
  width: 100%;
  height: 100%;
}

.player-access-loading {
  position: absolute;
  left: 14px;
  right: 14px;
  bottom: 14px;
  padding: 8px 10px;
  border-radius: 8px;
  background: rgba(6, 13, 20, 0.9);
  color: #aebdca;
  font-size: 9px;
  pointer-events: none;
}

.player-access-fallback {
  height: 100%;
}

.platform-access-help {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-top: 8px;
  padding: 8px 10px;
  border: 1px solid #1b3041;
  border-radius: 9px;
  background: #0b141e;
  color: #7f91a4;
  font-size: 9px;
  line-height: 1.45;
}

.platform-access-help a {
  flex: 0 0 auto;
  color: #67d7f5;
  font-weight: 800;
}

.mature-stream-gate {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  width: 100%;
  height: 100%;
  padding: 28px;
  background: #080d13;
  color: #edf2f7;
  text-align: center;
}

.mature-stream-badge {
  display: grid;
  place-items: center;
  width: 48px;
  height: 48px;
  border: 2px solid #fb7185;
  border-radius: 50%;
  color: #fb7185;
  font-size: 15px;
  font-weight: 900;
}

.mature-stream-gate p {
  max-width: 560px;
  margin: 0;
  color: #98a8b8;
  font-size: 11px;
  line-height: 1.55;
}

.mature-stream-actions,
.stream-alert-sound-row {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.stream-alert-settings {
  margin-top: 12px;
  box-shadow: none;
}

.stream-alert-settings > p {
  margin: 7px 0 10px;
  font-size: 10px;
  line-height: 1.5;
}

.stream-alert-sound-row .input {
  flex: 1 1 170px;
}

.mature-setting {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  gap: 9px;
  align-items: flex-start;
  margin-top: 12px;
  padding-top: 12px;
  border-top: 1px solid #1b2a38;
  cursor: pointer;
}

.mature-setting input {
  margin-top: 3px;
}

.mature-setting span {
  display: grid;
  gap: 3px;
}

.mature-setting small {
  color: #8293a4;
  font-size: 9px;
  line-height: 1.45;
}

@media (max-width: 700px) {
  .support-alert-card {
    grid-template-columns: 38px minmax(0, 1fr);
    padding: 10px 11px;
  }
  .support-alert-avatar {
    width: 38px;
    height: 38px;
  }
  .support-alert-copy strong {
    font-size: 12px;
  }
  .platform-access-help {
    align-items: flex-start;
    flex-direction: column;
  }
  .mature-stream-gate {
    padding: 18px;
  }
}
'''
styles_path.write_text(styles, encoding='utf-8')


# --------------------------------------------------
# Emulator regression tests for alert integrity and
# streamer settings.
# --------------------------------------------------
test_path = Path('tests/firestore.rules.test.mjs')
tests = test_path.read_text(encoding='utf-8')
if 'runTransaction' not in tests.split("from 'firebase/firestore'", 1)[0]:
    tests = tests.replace(
        'collection,query,where,limit,writeBatch,serverTimestamp,Timestamp,updateDoc,deleteDoc',
        'collection,query,where,limit,writeBatch,serverTimestamp,Timestamp,updateDoc,deleteDoc,runTransaction'
    )

if "ALLOW alerta público somente quando acompanha apoio atômico válido" not in tests:
    tests += r'''

test('ALLOW alerta público somente quando acompanha apoio atômico válido',async()=>{
  const old=Timestamp.fromMillis(1);
  await env.withSecurityRulesDisabled(async c=>{
    const db=c.firestore();
    await setDoc(doc(db,'streams','live1'),{streamerUid:'bob',channelId:'bob',title:'Live',description:'',categoryId:'Games',thumbnailURL:'',status:'live',playbackURL:'https://www.twitch.tv/example',startedAt:old,endedAt:null,createdAt:old,viewerCount:0});
    await setDoc(doc(db,'wallets','alice'),{uid:'alice',balance:500,totalSent:0,totalReceived:0,lastTransactionId:'seed-a',createdAt:old,updatedAt:old});
    await setDoc(doc(db,'wallets','bob'),{uid:'bob',balance:500,totalSent:0,totalReceived:0,lastTransactionId:'seed-b',createdAt:old,updatedAt:old});
  });
  const db=as('alice');
  const senderRef=doc(db,'wallets','alice');
  const recipientRef=doc(db,'wallets','bob');
  const txRef=doc(db,'zyCoinTransactions','support1');
  const alertRef=doc(db,'streams','live1','supportAlerts','support1');
  await assertSucceeds(runTransaction(db,async tx=>{
    const sender=await tx.get(senderRef);const recipient=await tx.get(recipientRef);
    tx.update(senderRef,{balance:450,totalSent:50,totalReceived:0,lastTransactionId:'support1',updatedAt:serverTimestamp()});
    tx.update(recipientRef,{balance:550,totalSent:0,totalReceived:50,lastTransactionId:'support1',updatedAt:serverTimestamp()});
    tx.set(txRef,{transactionId:'support1',fromUid:'alice',toUid:'bob',streamId:'live1',amount:50,type:'stream_support',status:'completed',createdAt:serverTimestamp()});
    tx.set(alertRef,{transactionId:'support1',fromUid:'alice',streamId:'live1',amount:50,createdAt:serverTimestamp()});
  }));
  await assertSucceeds(getDoc(doc(env.unauthenticatedContext().firestore(),'streams','live1','supportAlerts','support1')));
  await assertFails(setDoc(doc(as('carol'),'streams','live1','supportAlerts','fake'),{transactionId:'fake',fromUid:'carol',streamId:'live1',amount:50,createdAt:serverTimestamp()}));
  await assertFails(updateDoc(alertRef,{amount:500}));
  await assertFails(deleteDoc(alertRef));
});

test('ALLOW streamer configurar som e 18+; DENY som fora da lista',async()=>{
  const old=Timestamp.fromMillis(1);
  await env.withSecurityRulesDisabled(c=>setDoc(doc(c.firestore(),'streams','live1'),{streamerUid:'bob',channelId:'bob',title:'Live',description:'',categoryId:'Games',thumbnailURL:'',status:'offline',playbackURL:'https://www.twitch.tv/example',startedAt:null,endedAt:null,createdAt:old,viewerCount:0}));
  const ref=doc(as('bob'),'streams','live1');
  await assertSucceeds(updateDoc(ref,{supportAlertSound:'bell',matureContent:true}));
  await assertFails(updateDoc(ref,{supportAlertSound:'remote-url'}));
  await assertFails(updateDoc(ref,{matureContent:'yes'}));
});
'''
test_path.write_text(tests, encoding='utf-8')

print('Support alert integration patch applied successfully.')

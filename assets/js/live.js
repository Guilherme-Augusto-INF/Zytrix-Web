import { auth, db, onAuthStateChanged, doc, getDoc, onSnapshot, collection, query, orderBy, limit, setDoc, deleteDoc, runTransaction, increment, serverTimestamp, Timestamp, ensureWallet } from './firebase.js';
import { header, footer, escapeHtml, escapeAttr } from './ui.js';
import { reportLink } from './report-link.js';
import { getStreamingEmbed, streamingPlatformLabel } from './streaming.js';
import { safeImageUrl } from './security.js';
header('ao-vivo');
footer();
reportLink(document.querySelector('#live-root'), 'stream', new URLSearchParams(location.search).get('stream') || localStorage.getItem('zytrixSelectedStream') || '');
const streamId = new URLSearchParams(location.search).get('stream') ||
    localStorage.getItem('zytrixSelectedStream') ||
    '';
const root = document.querySelector('#live-root');
let stream = null;
let streamerProfile = null;
let user = null;
let userProfile = null;
let balance = 0;
let selectedAmount = 50;
let walletUnsubscribe = null;
let chatUnsubscribe = null;
let lastChatSendAt = 0;
let chatRenderVersion = 0;
let currentUserIsAdmin = false;
let currentChatBan = null;
let banUnsubscribe = null;
let pinnedUnsubscribe = null;
let pinnedMessageId = '';
const roleCache = new Map();
const profileCache = new Map();
// ==================================================
// AUTENTICAÇÃO + CARTEIRA
// ==================================================
onAuthStateChanged(auth, async (currentUser) => {
    user = currentUser;
    userProfile = null;
    currentUserIsAdmin = false;
    currentChatBan = null;
    if (banUnsubscribe) {
        banUnsubscribe();
        banUnsubscribe = null;
    }
    if (walletUnsubscribe) {
        walletUnsubscribe();
        walletUnsubscribe = null;
    }
    if (user) {
        userProfile = await getCachedProfile(user.uid);
        currentUserIsAdmin = await isAdminUid(user.uid);
        startOwnBanListener();
        walletUnsubscribe = onSnapshot(doc(db, 'wallets', user.uid), snap => {
            balance = snap.exists() ? Number(snap.data().balance || 0) : 0;
            const el = document.querySelector('#balance');
            if (el)
                el.textContent = balance.toLocaleString('pt-BR');
        }, error => console.error('Erro ao acompanhar carteira:', error));
    }
    else {
        balance = 0;
    }
    updateChatComposerState();
});
// ==================================================
// PERFIS DO CHAT
// ==================================================
async function getCachedProfile(uid) {
    if (!uid)
        return { username: 'Usuário', photoURL: '' };
    if (profileCache.has(uid)) {
        return profileCache.get(uid);
    }
    try {
        const snap = await getDoc(doc(db, 'profiles', uid));
        const profile = snap.exists()
            ? {
                username: String(snap.data().username || 'Usuário'),
                photoURL: String(snap.data().photoURL || '')
            }
            : { username: 'Usuário', photoURL: '' };
        profileCache.set(uid, profile);
        return profile;
    }
    catch (error) {
        console.error('Erro ao carregar perfil do chat:', error);
        return { username: 'Usuário', photoURL: '' };
    }
}
async function isAdminUid(uid) {
    if (!uid)
        return false;
    if (roleCache.has(uid))
        return roleCache.get(uid) === 'admin';
    try {
        const snap = await getDoc(doc(db, 'admins', uid));
        const admin = snap.exists() && snap.data().active === true;
        roleCache.set(uid, admin ? 'admin' : 'user');
        return admin;
    }
    catch {
        return false;
    }
}
function isBanActive(ban) {
    if (!ban)
        return false;
    if (!ban.expiresAt)
        return true;
    const d = ban.expiresAt?.toDate?.();
    return d ? d.getTime() > Date.now() : true;
}
function canModerateChat() {
    return Boolean(user) && (currentUserIsAdmin || user.uid === stream?.streamerUid);
}
function startOwnBanListener() {
    if (!user || !streamId)
        return;
    if (banUnsubscribe)
        banUnsubscribe();
    banUnsubscribe = onSnapshot(doc(db, 'streams', streamId, 'chatBans', user.uid), snap => {
        currentChatBan = snap.exists() ? snap.data() : null;
        updateChatComposerState();
        if (isBanActive(currentChatBan) && currentChatBan?.expiresAt?.toDate) {
            const ms = currentChatBan.expiresAt.toDate().getTime() - Date.now() + 500;
            if (ms > 0 && ms < 86400000)
                setTimeout(updateChatComposerState, ms);
        }
    });
}
function startPinnedListener() {
    if (pinnedUnsubscribe)
        pinnedUnsubscribe();
    pinnedUnsubscribe = onSnapshot(doc(db, 'streams', streamId, 'chatConfig', 'main'), async (snap) => {
        pinnedMessageId = snap.exists() ? String(snap.data().pinnedMessageId || '') : '';
        await renderPinnedMessage();
    });
}
async function renderPinnedMessage() {
    const box = document.querySelector('#chat-pinned');
    if (!box)
        return;
    if (!pinnedMessageId) {
        box.classList.add('hidden');
        box.innerHTML = '';
        return;
    }
    try {
        const msgSnap = await getDoc(doc(db, 'streams', streamId, 'chat', pinnedMessageId));
        if (!msgSnap.exists()) {
            box.classList.add('hidden');
            return;
        }
        const m = msgSnap.data();
        const profile = await getCachedProfile(m.uid);
        box.innerHTML = `<strong>📌 ${escapeHtml(profile.username || 'Usuário')}</strong><span>${escapeHtml(String(m.text || ''))}</span>`;
        box.classList.remove('hidden');
    }
    catch {
        box.classList.add('hidden');
    }
}
// ==================================================
// INTERFACE DA LIVE
// ==================================================
function render() {
    if (!stream)
        return;
    const player = getStreamingEmbed(stream.playbackURL);
    const username = streamerProfile?.username || 'Streamer';
    const platformLabel = player
        ? streamingPlatformLabel(player.platform)
        : 'Plataforma não identificada';
    root.innerHTML = `
    <div class="player-layout">
      <div>
        <div class="player">
          ${player
        ? `<iframe
                src="${escapeAttr(player.embedUrl)}"
                title="Player ${escapeAttr(platformLabel)} de ${escapeAttr(username)}"
                allow="autoplay; fullscreen; picture-in-picture"
                allowfullscreen
                referrerpolicy="strict-origin-when-cross-origin"
              ></iframe>`
        : '<div class="state">Player indisponível. Vincule um canal válido da Twitch ou Kick.</div>'}
        </div>

        <div class="panel card" style="margin-top:14px">
          <div class="live-info-row">
            <div>
              <div>
                <span class="${stream.status === 'live' ? 'status-live' : 'status-offline'}">
                  ● ${stream.status === 'live' ? 'AO VIVO' : 'OFFLINE'}
                </span>
                <span class="muted">${escapeHtml(stream.categoryId || '')}</span>
                <span class="platform-badge platform-${player?.platform || 'unknown'}">
                  ${escapeHtml(platformLabel)}
                </span>
              </div>

              <h1 style="margin:8px 0">${escapeHtml(stream.title || 'Transmissão')}</h1>
              <p class="muted">${escapeHtml(stream.description || '')}</p>

              <div style="display:flex;align-items:center;gap:9px">
                ${streamerProfile?.photoURL
        ? `<img class="avatar" src="${escapeAttr(safeImageUrl(streamerProfile.photoURL))}" referrerpolicy="no-referrer" alt="${escapeHtml(username)}">`
        : `<span class="avatar">${escapeHtml(username.charAt(0).toUpperCase())}</span>`}
                <strong>${escapeHtml(username)}</strong>
              </div>
            </div>

            <div class="viewer-panel">
              <span class="muted" style="font-size:10px">ESPECTADORES</span>
              <strong>👁 ${Number(stream.viewerCount || 0).toLocaleString('pt-BR')}</strong>
            </div>
          </div>
        </div>

        <div class="card panel support-box">
          <div class="eyebrow">Zy Coins</div>
          <h3 style="margin:5px 0">Apoie ${escapeHtml(username)}</h3>
          <p class="muted">Seu saldo: ◈ <span id="balance">${balance.toLocaleString('pt-BR')}</span></p>

          <div class="support-values">
            ${[10, 50, 100, 500]
        .map(value => `<button class="btn ${value === selectedAmount ? 'active' : ''}" data-amount="${value}">◈ ${value}</button>`)
        .join('')}
            <input id="custom-amount" class="input" style="width:150px" type="number" min="1" max="100000" placeholder="Outro valor">
          </div>

          <button id="support-btn" class="btn btn-primary" style="margin-top:12px">Enviar apoio</button>
          <div id="support-msg"></div>
        </div>
      </div>

      <aside class="card chat">
        <div class="chat-header">
          <div>
            <div class="eyebrow">AO VIVO</div>
            <strong>Chat da transmissão</strong>
          </div>
          <span class="chat-live-dot" title="Chat em tempo real">●</span>
        </div>

        <div class="chat-notice">
          Mensagens sincronizadas em tempo real entre todos que estão nesta live.
        </div>

        <div id="chat-pinned" class="chat-pinned hidden"></div>

        <div id="chat-messages" class="chat-messages">
          <div class="state chat-loading">Carregando chat...</div>
        </div>

        <div id="chat-login-hint" class="chat-login-hint hidden">
          Entre na sua conta para participar do chat.
        </div>

        <div class="chat-input">
          <input id="chat-input" class="input" maxlength="300" placeholder="Enviar mensagem..." autocomplete="off">
          <button id="chat-send" class="btn btn-primary" type="button">➤</button>
        </div>

        <div class="chat-bottom-row">
          <span id="chat-feedback"></span>
          <span id="chat-counter">0/300</span>
        </div>
      </aside>
    </div>`;
    document.querySelectorAll('[data-amount]').forEach(button => {
        button.onclick = () => {
            selectedAmount = Number(button.dataset.amount);
            document.querySelectorAll('[data-amount]').forEach(item => {
                item.classList.toggle('active', item === button);
            });
            document.querySelector('#custom-amount').value = '';
        };
    });
    document.querySelector('#support-btn').onclick = support;
    bindChatComposer();
    startRealtimeChat();
    startPinnedListener();
    if (user)
        startOwnBanListener();
    updateChatComposerState();
}
// ==================================================
// CHAT EM TEMPO REAL
// ==================================================
function bindChatComposer() {
    const input = document.querySelector('#chat-input');
    const sendButton = document.querySelector('#chat-send');
    const counter = document.querySelector('#chat-counter');
    if (!input || !sendButton)
        return;
    input.addEventListener('input', () => {
        if (counter)
            counter.textContent = `${input.value.length}/300`;
    });
    input.addEventListener('keydown', event => {
        if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault();
            sendChatMessage();
        }
    });
    sendButton.addEventListener('click', sendChatMessage);
}
function updateChatComposerState() {
    const input = document.querySelector('#chat-input');
    const sendButton = document.querySelector('#chat-send');
    const loginHint = document.querySelector('#chat-login-hint');
    if (!input || !sendButton)
        return;
    const banned = isBanActive(currentChatBan);
    const canChat = Boolean(user) && stream?.status === 'live' && !banned;
    input.disabled = !canChat;
    sendButton.disabled = !canChat;
    if (!user) {
        input.placeholder = 'Faça login para conversar';
        loginHint?.classList.remove('hidden');
    }
    else if (banned) {
        const until = currentChatBan?.expiresAt?.toDate?.();
        input.placeholder = until ? `Você está silenciado até ${until.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}` : 'Você foi banido deste chat';
        loginHint?.classList.add('hidden');
    }
    else if (stream?.status !== 'live') {
        input.placeholder = 'O chat está fechado enquanto a live está offline';
        loginHint?.classList.add('hidden');
    }
    else {
        input.placeholder = 'Enviar mensagem...';
        loginHint?.classList.add('hidden');
    }
}
async function sendChatMessage() {
    const feedback = document.querySelector('#chat-feedback');
    if (!user) { setChatFeedback('Faça login para enviar mensagens.', true); return; }
    if (!user.emailVerified) { setChatFeedback('Verifique seu e-mail para conversar.', true); return; }
    // O envio real é instalado por live-extras.js, que usa chatRate atômico.
    if (feedback) feedback.textContent = 'Preparando envio seguro...';
}

function setChatFeedback(message, isError) {
    const feedback = document.querySelector('#chat-feedback');
    if (!feedback)
        return;
    feedback.textContent = message;
    feedback.className = isError ? 'chat-feedback error' : 'chat-feedback ok';
}
function startRealtimeChat() {
    if (!streamId)
        return;
    if (chatUnsubscribe) {
        chatUnsubscribe();
        chatUnsubscribe = null;
    }
    const messagesQuery = query(collection(db, 'streams', streamId, 'chat'), orderBy('createdAt', 'desc'), limit(100));
    chatUnsubscribe = onSnapshot(messagesQuery, async (snapshot) => {
        const version = ++chatRenderVersion;
        const messages = snapshot.docs
            .map(messageDoc => ({ id: messageDoc.id, ...messageDoc.data() }))
            .reverse();
        const hydrated = await Promise.all(messages.map(async (message) => ({
            ...message,
            profile: await getCachedProfile(message.uid),
            isAdmin: await isAdminUid(message.uid)
        })));
        if (version !== chatRenderVersion)
            return;
        renderChatMessages(hydrated);
    }, error => {
        console.error('Erro ao acompanhar chat:', error);
        const container = document.querySelector('#chat-messages');
        if (container) {
            container.innerHTML = `
          <div class="state chat-loading">
            Não foi possível carregar o chat.<br>
            <small>Confira as regras do Firestore.</small>
          </div>`;
        }
    });
}
function renderChatMessages(messages) {
    const container = document.querySelector('#chat-messages');
    if (!container)
        return;
    if (!messages.length) {
        container.innerHTML = `
      <div class="chat-empty">
        <strong>Seja o primeiro a falar 👋</strong>
        <span>As mensagens aparecerão aqui para todos que estiverem assistindo.</span>
      </div>`;
        return;
    }
    container.innerHTML = '';
    for (const message of messages) {
        const profile = message.profile || { username: 'Usuário', photoURL: '' };
        const username = profile.username || 'Usuário';
        const isOwn = user?.uid === message.uid;
        const authorIsStreamer = message.uid === stream?.streamerUid;
        const authorIsAdmin = message.isAdmin === true;
        const canDeleteMessage = Boolean(user)
            && (isOwn
                || currentUserIsAdmin
                || (canModerateChat() && !authorIsAdmin));
        const canPunishAuthor = Boolean(user)
            && canModerateChat()
            && message.uid !== user.uid
            && (currentUserIsAdmin || !authorIsAdmin);
        const article = document.createElement('article');
        article.className = `chat-message${isOwn ? ' own' : ''}`;
        article.dataset.messageId = message.id;
        const avatar = document.createElement(profile.photoURL ? 'img' : 'span');
        avatar.className = 'chat-avatar';
        if (profile.photoURL) {
            avatar.src = profile.photoURL;
            avatar.alt = username;
        }
        else {
            avatar.textContent = username.charAt(0).toUpperCase();
        }
        const body = document.createElement('div');
        body.className = 'chat-message-body';
        const meta = document.createElement('div');
        meta.className = 'chat-message-meta';
        const name = document.createElement('strong');
        name.textContent = username;
        if (authorIsStreamer || authorIsAdmin) {
            const badge = document.createElement('span');
            badge.className = 'chat-role-badge';
            badge.textContent = authorIsAdmin ? 'ADM' : 'STREAMER';
            name.append(' ', badge);
        }
        const time = document.createElement('span');
        time.textContent = formatMessageTime(message.createdAt);
        meta.append(name, time);
        const text = document.createElement('div');
        text.className = 'chat-message-text';
        // textContent evita executar HTML/JavaScript enviado pelo usuário.
        text.textContent = String(message.text || '');
        body.append(meta, text);
        if (canDeleteMessage) {
            const removeButton = document.createElement('button');
            removeButton.className = 'chat-delete';
            removeButton.type = 'button';
            removeButton.title = isOwn ? 'Excluir sua mensagem' : 'Remover mensagem';
            removeButton.setAttribute('aria-label', removeButton.title);
            removeButton.textContent = '×';
            removeButton.onclick = () => deleteChatMessage(message.id);
            article.append(avatar, body, removeButton);
            if (canModerateChat()) {
                const tools = document.createElement('div');
                tools.className = 'chat-mod-tools';
                const pin = document.createElement('button');
                pin.textContent = '📌';
                pin.title = 'Fixar/desafixar';
                pin.onclick = () => togglePin(message.id);
                tools.append(pin);
                if (canPunishAuthor) {
                    const mute = document.createElement('button');
                    mute.textContent = '⏱';
                    mute.title = 'Silenciar 10 min';
                    mute.onclick = () => muteUser(message.uid, 10);
                    const ban = document.createElement('button');
                    ban.textContent = '🚫';
                    ban.title = 'Banir/desbanir';
                    ban.onclick = () => toggleBanUser(message.uid);
                    tools.append(mute, ban);
                }
                article.append(tools);
            }
        }
        else {
            article.append(avatar, body);
        }
        container.appendChild(article);
        if (!isOwn) {
            reportLink(article, "chat", message.id, streamId, "append");
            reportLink(article, "profile", message.uid, "-", "append");
        }
    }
    container.scrollTop = container.scrollHeight;
}
function formatMessageTime(timestamp) {
    try {
        const date = timestamp?.toDate?.();
        if (!date)
            return 'agora';
        return date.toLocaleTimeString('pt-BR', {
            hour: '2-digit',
            minute: '2-digit'
        });
    }
    catch {
        return 'agora';
    }
}
async function deleteChatMessage(messageId) {
    if (!user || !streamId || !messageId)
        return;
    try {
        await deleteDoc(doc(db, 'streams', streamId, 'chat', messageId));
    }
    catch (error) {
        console.error('Erro ao excluir mensagem:', error);
        setChatFeedback('Você não tem permissão para remover esta mensagem.', true);
    }
}
async function togglePin(messageId) {
    if (!canModerateChat())
        return;
    const ref = doc(db, 'streams', streamId, 'chatConfig', 'main');
    if (pinnedMessageId === messageId) {
        await deleteDoc(ref);
    }
    else {
        await setDoc(ref, { pinnedMessageId: messageId, updatedBy: user.uid, updatedAt: serverTimestamp() });
    }
}
async function canPunishUser(uid) {
    if (!canModerateChat() || !uid || uid === user?.uid) {
        return false;
    }
    if (currentUserIsAdmin) {
        return true;
    }
    const targetIsAdmin = await isAdminUid(uid);
    if (targetIsAdmin) {
        setChatFeedback('Streamers não podem moderar administradores.', true);
        return false;
    }
    return true;
}
async function muteUser(uid, minutes = 10) {
    if (!(await canPunishUser(uid))) {
        return;
    }
    await setDoc(doc(db, 'streams', streamId, 'chatBans', uid), {
        uid,
        bannedBy: user.uid,
        reason: 'mute',
        createdAt: serverTimestamp(),
        expiresAt: new Date(Date.now() + minutes * 60000)
    });
    setChatFeedback(`Usuário silenciado por ${minutes} minutos.`, false);
}
async function toggleBanUser(uid) {
    if (!(await canPunishUser(uid))) {
        return;
    }
    const ref = doc(db, 'streams', streamId, 'chatBans', uid);
    const snap = await getDoc(ref);
    if (snap.exists() && !snap.data().expiresAt) {
        await deleteDoc(ref);
        setChatFeedback('Usuário desbanido.', false);
        return;
    }
    await setDoc(ref, {
        uid,
        bannedBy: user.uid,
        reason: 'ban',
        createdAt: serverTimestamp(),
        expiresAt: null
    });
    setChatFeedback('Usuário banido do chat.', false);
}
// ==================================================
// APOIO COM ZY COINS
// ==================================================
async function support() {
    const msg = document.querySelector('#support-msg');
    if (!user) {
        msg.innerHTML = '<div class="message err">Entre na sua conta para apoiar.</div>';
        return;
    }
    if (!user.emailVerified) { msg.innerHTML = '<div class="message err">Verifique seu e-mail para usar Zy Coins.</div>'; return; }
    if (user.uid === stream.streamerUid) {
        msg.innerHTML = '<div class="message err">Você não pode apoiar a própria live.</div>';
        return;
    }
    if (stream.status !== 'live') {
        msg.innerHTML = '<div class="message err">A live precisa estar ao vivo.</div>';
        return;
    }
    const custom = Number(document.querySelector('#custom-amount').value || 0);
    const amount = custom || selectedAmount;
    if (!Number.isInteger(amount) || amount < 1 || amount > 100000) {
        msg.innerHTML = '<div class="message err">Valor inválido.</div>';
        return;
    }
    try {
        await ensureWallet(user.uid);
        const senderRef = doc(db, 'wallets', user.uid);
        const recipientRef = doc(db, 'wallets', stream.streamerUid);
        const txRef = doc(collection(db, 'zyCoinTransactions'));
        const alertRef = doc(db, 'streams', stream.id, 'supportAlerts', txRef.id);
        const commitSupport = async (createRecipientWallet = false) => runTransaction(db, async (tx) => {
            const sender = await tx.get(senderRef);
            if (!sender.exists() || Number(sender.data().balance || 0) < amount) {
                throw new Error('saldo');
            }
            const senderData = sender.data();
            tx.update(senderRef, {
                balance: Number(senderData.balance) - amount,
                totalSent: Number(senderData.totalSent || 0) + amount,
                lastTransactionId: txRef.id,
                updatedAt: serverTimestamp()
            });
            if (createRecipientWallet) {
                tx.set(recipientRef, {
                    uid: stream.streamerUid,
                    balance: amount,
                    totalSent: 0,
                    totalReceived: amount,
                    lastTransactionId: txRef.id,
                    createdAt: serverTimestamp(),
                    updatedAt: serverTimestamp()
                });
            }
            else {
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
        });
        try {
            await commitSupport(false);
        }
        catch (error) {
            if (String(error?.code || '').includes('not-found')) {
                await commitSupport(true);
            }
            else {
                throw error;
            }
        }
        await setDoc(alertRef, {
            transactionId: txRef.id,
            fromUid: user.uid,
            streamId: stream.id,
            amount,
            createdAt: serverTimestamp(),
            expiresAt: Timestamp.fromMillis(Date.now() + 24 * 60 * 60 * 1000)
        }).catch(error => console.warn('Apoio concluído, mas o alerta público não pôde ser criado.', error));
        msg.innerHTML = `<div class="message ok">Apoio de ◈ ${amount.toLocaleString('pt-BR')} enviado!</div>`;
    }
    catch (error) {
        console.error(error);
        msg.innerHTML = `<div class="message err">${error.message === 'saldo'
            ? 'Saldo insuficiente.'
            : 'Não foi possível enviar o apoio.'}</div>`;
    }
}
// ==================================================
// CARREGAR LIVE
// ==================================================
if (!streamId) {
    root.innerHTML = '<div class="state">Live não encontrada. Selecione uma transmissão antes.</div>';
}
else {
    onSnapshot(doc(db, 'streams', streamId), async (snap) => {
        if (!snap.exists()) {
            root.innerHTML = '<div class="state">Live não encontrada.</div>';
            return;
        }
        stream = { id: snap.id, ...snap.data() };
        streamerProfile = stream.streamerUid
            ? await getCachedProfile(stream.streamerUid)
            : null;
        render();
    }, () => {
        root.innerHTML = '<div class="state">Erro ao carregar live.</div>';
    });
}

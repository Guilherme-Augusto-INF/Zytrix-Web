import { auth, db, onAuthStateChanged, doc, getDoc, onSnapshot, updateDoc, query, collection, where, limit, getDocs, serverTimestamp, writeBatch } from './firebase.js';
import { header, footer, escapeHtml, escapeAttr } from './ui.js';
import { parseStreamingSource, streamingPlatformLabel } from './streaming.js';
header();
footer();
const root = document.querySelector('#profile-root');
let user = null;
let profile = null;
let account = null;
let wallet = null;
let channel = null;
let stream = null;
let walletUnsubscribe = null;
function dateText(timestamp) {
    try {
        return timestamp?.toDate?.().toLocaleDateString('pt-BR', {
            day: '2-digit',
            month: 'long',
            year: 'numeric'
        }) || 'Data indisponível';
    }
    catch {
        return 'Data indisponível';
    }
}
async function findStream(uid) {
    const streamQuery = query(collection(db, 'streams'), where('streamerUid', '==', uid), limit(1));
    const result = await getDocs(streamQuery);
    if (result.empty) {
        return null;
    }
    return {
        id: result.docs[0].id,
        ...result.docs[0].data()
    };
}
async function load() {
    const [profileSnap, accountSnap, walletSnap, channelSnap] = await Promise.all([
        getDoc(doc(db, 'profiles', user.uid)),
        getDoc(doc(db, 'users', user.uid)),
        getDoc(doc(db, 'wallets', user.uid)),
        getDoc(doc(db, 'channels', user.uid))
    ]);
    profile = profileSnap.exists() ? profileSnap.data() : null;
    account = accountSnap.exists() ? accountSnap.data() : null;
    wallet = walletSnap.exists() ? walletSnap.data() : null;
    channel = channelSnap.exists() ? channelSnap.data() : null;
    stream = channel ? await findStream(user.uid) : null;
    render();
    if (walletUnsubscribe) {
        walletUnsubscribe();
        walletUnsubscribe = null;
    }
    walletUnsubscribe = onSnapshot(doc(db, 'wallets', user.uid), snapshot => {
        if (!snapshot.exists()) {
            return;
        }
        wallet = snapshot.data();
        const balanceElement = document.querySelector('#wallet-balance');
        if (balanceElement) {
            balanceElement.textContent = Number(wallet.balance || 0).toLocaleString('pt-BR');
        }
    }, error => {
        console.error('Erro ao acompanhar saldo:', error);
    });
}
function render() {
    if (!profile || !account) {
        root.innerHTML = '<div class="state">Perfil indisponível.</div>';
        return;
    }
    const initials = (profile.username || 'U').charAt(0).toUpperCase();
    const streamSource = parseStreamingSource(stream?.playbackURL || '');
    const platformLabel = streamSource
        ? streamingPlatformLabel(streamSource.platform)
        : 'Não vinculada';
    root.innerHTML = `
    <div class="card panel">
      <h1 style="text-align:center;margin-top:0">Perfil</h1>

      <div class="profile-grid">
        <div>
          ${profile.photoURL
        ? `<img class="profile-photo" src="${escapeAttr(profile.photoURL)}" alt="Foto de ${escapeAttr(profile.username || 'usuário')}">`
        : `<div class="profile-photo" style="display:grid;place-items:center;font-size:42px;color:#334155">${escapeHtml(initials)}</div>`}

          <button id="edit-toggle" class="btn" style="width:140px;margin-top:8px">
            Editar perfil
          </button>
        </div>

        <div class="info-list">
          <div class="info-row">
            <strong>Nome</strong>
            <span>${escapeHtml(profile.username || '')}</span>
          </div>

          <div class="info-row">
            <strong>ID</strong>
            <span>${escapeHtml(account.zytrixId || user.uid)}</span>
          </div>

          <div class="info-row">
            <strong>Membro desde</strong>
            <span>${dateText(account.createdAt)}</span>
          </div>

          <div class="info-row">
            <strong>E-mail</strong>
            <span>
              ${escapeHtml(user.email || '')}
              ${user.emailVerified ? '✓' : '(não verificado)'}
            </span>
          </div>

          <div class="info-row">
            <strong>Zy Coins</strong>
            <span class="coin-pill">
              ◈ <span id="wallet-balance">${Number(wallet?.balance || 0).toLocaleString('pt-BR')}</span>
            </span>
          </div>

          <div class="info-row">
            <strong>Bio</strong>
            <span>${escapeHtml(profile.bio || 'Nenhuma descrição adicionada.')}</span>
          </div>
        </div>
      </div>

      <div id="edit-area" class="hidden" style="margin-top:18px">
        <div class="form-group">
          <label for="edit-name">Nome</label>
          <input
            id="edit-name"
            class="input"
            maxlength="30"
            value="${escapeAttr(profile.username || '')}"
          >
        </div>

        <div class="form-group">
          <label for="edit-photo">URL da foto</label>
          <input
            id="edit-photo"
            class="input"
            value="${escapeAttr(profile.photoURL || '')}"
          >
        </div>

        <div class="form-group">
          <label for="edit-bio">Bio</label>
          <textarea
            id="edit-bio"
            class="input textarea"
            maxlength="500"
          >${escapeHtml(profile.bio || '')}</textarea>
        </div>

        <button id="save-profile" class="btn btn-primary">
          Salvar alterações
        </button>

        <div id="profile-msg"></div>
      </div>
    </div>

    <div class="card panel" style="margin-top:16px">
      <div class="eyebrow">Streamer</div>

      ${channel
        ? `
          <h2>Seu canal está pronto</h2>

          <p class="muted">
            Status:
            <span class="${stream?.status === 'live' ? 'status-live' : 'status-offline'}">
              ${stream?.status === 'live' ? 'AO VIVO' : 'OFFLINE'}
            </span>
          </p>

          <div class="stream-source-summary">
            <span class="platform-badge platform-${streamSource?.platform || 'unknown'}">
              ${escapeHtml(platformLabel)}
            </span>

            ${streamSource
            ? `<a href="${escapeAttr(streamSource.canonicalUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(streamSource.canonicalUrl)}</a>`
            : '<span class="muted">Nenhum canal de transmissão válido vinculado.</span>'}
          </div>

          <p class="muted" style="margin-top:10px">
            Você pode trocar entre Twitch e Kick no painel de configuração da live.
          </p>

          <a class="btn btn-primary" href="config-live.html">
            Configurar live
          </a>
        `
        : `
          <h2>Você deseja fazer lives?</h2>

          <p class="muted">
            Vincule um canal da Twitch ou da Kick para criar seu canal na Zytrix.
          </p>

          <div class="form-group">
            <label for="stream-url">Link da Twitch ou Kick</label>
            <input
              id="stream-url"
              class="input"
              placeholder="https://www.twitch.tv/seucanal ou https://kick.com/seucanal"
              autocomplete="url"
            >
            <small class="muted">
              Use a URL completa do canal. A Zytrix detecta a plataforma automaticamente.
            </small>
          </div>

          <button id="be-streamer" class="btn btn-primary">
            Criar meu canal
          </button>

          <div id="streamer-msg"></div>
        `}
    </div>

    <div style="margin-top:16px">
      <a class="btn btn-danger" href="sair.html">Sair da conta</a>
    </div>
  `;
    document.querySelector('#edit-toggle').onclick = () => {
        document.querySelector('#edit-area').classList.toggle('hidden');
    };
    document.querySelector('#save-profile').onclick = saveProfile;
    if (!channel) {
        document.querySelector('#be-streamer').onclick = createStreamer;
    }
}
async function saveProfile() {
    const message = document.querySelector('#profile-msg');
    const name = document.querySelector('#edit-name').value.trim();
    const photoURL = document.querySelector('#edit-photo').value.trim();
    const bio = document.querySelector('#edit-bio').value.trim();
    try {
        const data = {
            photoURL,
            bio
        };
        if (name !== profile.username) {
            data.username = name;
            data.usernameUpdatedAt = serverTimestamp();
        }
        await updateDoc(doc(db, 'profiles', user.uid), data);
        message.innerHTML = '<div class="message ok">Perfil atualizado.</div>';
        await load();
    }
    catch (error) {
        console.error(error);
        message.innerHTML = '<div class="message err">Não foi possível atualizar o perfil.</div>';
    }
}
async function createStreamer() {
    const message = document.querySelector('#streamer-msg');
    const input = document.querySelector('#stream-url');
    const source = parseStreamingSource(input.value);
    if (!source) {
        message.innerHTML = `
      <div class="message err">
        Use um link válido da Twitch ou da Kick.
      </div>
    `;
        return;
    }
    try {
        const existingStream = await findStream(user.uid);
        const streamId = existingStream?.id || user.uid;
        const batch = writeBatch(db);
        batch.set(doc(db, 'channels', user.uid), {
            ownerUid: user.uid,
            channelName: profile.username || 'Streamer',
            description: profile.bio || '',
            avatarURL: profile.photoURL || '',
            bannerURL: '',
            categoryId: existingStream?.categoryId || 'Just Chatting',
            isLive: existingStream?.status === 'live',
            currentStreamId: streamId,
            createdAt: serverTimestamp()
        }, { merge: true });
        if (existingStream) {
            batch.update(doc(db, 'streams', streamId), {
                playbackURL: source.canonicalUrl
            });
        }
        else {
            batch.set(doc(db, 'streams', streamId), {
                streamerUid: user.uid,
                channelId: user.uid,
                title: 'Minha primeira live na Zytrix',
                description: '',
                categoryId: 'Just Chatting',
                thumbnailURL: profile.photoURL || '',
                status: 'offline',
                playbackURL: source.canonicalUrl,
                startedAt: null,
                endedAt: null,
                createdAt: serverTimestamp(),
                viewerCount: 0
            });
        }
        await batch.commit();
        message.innerHTML = `
      <div class="message ok">
        Canal ${streamingPlatformLabel(source.platform)} vinculado e conta de streamer criada.
      </div>
    `;
        await load();
    }
    catch (error) {
        console.error(error);
        message.innerHTML = '<div class="message err">Não foi possível criar o canal.</div>';
    }
}
onAuthStateChanged(auth, async (currentUser) => {
    if (!currentUser) {
        location.href = 'login.html';
        return;
    }
    user = currentUser;
    try {
        await load();
    }
    catch (error) {
        console.error(error);
        root.innerHTML = '<div class="state">Não foi possível carregar seu perfil.</div>';
    }
});

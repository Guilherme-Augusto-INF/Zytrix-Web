import { auth, db, onAuthStateChanged, doc, getDoc, getDocs, query, collection, where, limit, updateDoc, serverTimestamp, writeBatch, ensureWallet } from './firebase.js';
import { header, footer, categories, escapeAttr, escapeHtml } from './ui.js';
import { parseStreamingSource, streamingPlatformLabel } from './streaming.js';
import { SUPPORT_ALERT_SOUNDS, normalizeSupportAlertSound, playSupportAlertSound, unlockSupportAlertAudio } from './support-alert-sound.js';
header();
footer();
const root = document.querySelector('#config-root');
let user = null;
let stream = null;
let channel = null;
async function load() {
    const channelSnap = await getDoc(doc(db, 'channels', user.uid));
    if (!channelSnap.exists()) {
        root.innerHTML = '<div class="state">Sua conta ainda não é streamer.</div>';
        return;
    }
    channel = channelSnap.data();
    await ensureWallet(user.uid);
    let streamId = channel.currentStreamId || '';
    if (!streamId) {
        const result = await getDocs(query(collection(db, 'streams'), where('streamerUid', '==', user.uid), limit(1)));
        if (!result.empty) {
            streamId = result.docs[0].id;
        }
    }
    if (!streamId) {
        root.innerHTML = '<div class="state">Live não encontrada.</div>';
        return;
    }
    const streamSnap = await getDoc(doc(db, 'streams', streamId));
    if (!streamSnap.exists()) {
        root.innerHTML = '<div class="state">Live não encontrada.</div>';
        return;
    }
    stream = {
        id: streamSnap.id,
        ...streamSnap.data()
    };
    render();
}
function render() {
    const categoryParts = String(stream.categoryId || 'Just Chatting').split(' - ');
    const mainCategory = categoryParts[0] || 'Just Chatting';
    const currentSubcategory = categoryParts.length > 1
        ? categoryParts.slice(1).join(' - ')
        : '';
    const currentSource = parseStreamingSource(stream.playbackURL || '');
    root.innerHTML = `
    <div class="card panel">
      <div class="eyebrow">Painel do streamer</div>
      <h1>Configurar live</h1>

      <div class="grid grid-2">
        <div>
          <div class="form-group">
            <label for="title">Título</label>
            <input
              id="title"
              class="input"
              maxlength="100"
              value="${escapeAttr(stream.title || '')}"
            >
          </div>

          <div class="form-group">
            <label for="description">Descrição</label>
            <textarea
              id="description"
              class="input textarea"
              maxlength="500"
            >${escapeHtml(stream.description || '')}</textarea>
          </div>

          <div class="form-group">
            <label for="thumbnail">Thumbnail URL</label>
            <input
              id="thumbnail"
              class="input"
              value="${escapeAttr(stream.thumbnailURL || '')}"
              autocomplete="url"
            >
          </div>

          <div class="form-group">
            <label for="playback-url">Canal de transmissão</label>
            <input
              id="playback-url"
              class="input"
              value="${escapeAttr(stream.playbackURL || '')}"
              placeholder="https://www.twitch.tv/seucanal ou https://kick.com/seucanal"
              autocomplete="url"
            >
            <small id="stream-platform-hint" class="stream-source-hint"></small>
          </div>
        </div>

        <div>
          <div class="form-group">
            <label for="category">Categoria</label>
            <select id="category" class="input">
              ${Object.keys(categories)
        .map(category => `
                  <option ${category === mainCategory ? 'selected' : ''}>
                    ${escapeHtml(category)}
                  </option>
                `)
        .join('')}
            </select>
          </div>

          <div class="form-group">
            <label for="subcategory">Subcategoria</label>
            <select id="subcategory" class="input"></select>
          </div>

          <div class="panel card stream-status-card">
            <strong>Status:</strong>
            <span class="${stream.status === 'live' ? 'status-live' : 'status-offline'}">
              ${stream.status === 'live' ? 'AO VIVO' : 'OFFLINE'}
            </span>

            <p class="muted">
              Espectadores: ${Number(stream.viewerCount || 0).toLocaleString('pt-BR')}
            </p>

            <p class="muted">
              Plataforma atual:
              <strong>${currentSource ? streamingPlatformLabel(currentSource.platform) : 'Não identificada'}</strong>
            </p>
          </div>

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
          </div>
        </div>
      </div>

      <div class="form-actions">
        <button id="save" class="btn">Salvar</button>
        ${stream.status === 'live'
        ? '<button id="toggle-live" class="btn btn-danger">Encerrar live</button>'
        : '<button id="toggle-live" class="btn btn-primary">Iniciar live</button>'}
      </div>

      <div id="config-msg"></div>
    </div>
  `;
    const categorySelect = document.querySelector('#category');
    const subcategorySelect = document.querySelector('#subcategory');
    const playbackInput = document.querySelector('#playback-url');
    const soundSelect = document.querySelector('#support-alert-sound');
    const previewSoundButton = document.querySelector('#preview-support-sound');
    function refreshSubcategories() {
        const options = categories[categorySelect.value] || [];
        subcategorySelect.innerHTML = `
      <option value="">Selecione...</option>
      ${options
            .map(subcategory => `
          <option ${subcategory === currentSubcategory ? 'selected' : ''}>
            ${escapeHtml(subcategory)}
          </option>
        `)
            .join('')}
    `;
    }
    function refreshStreamingHint() {
        const hint = document.querySelector('#stream-platform-hint');
        const source = parseStreamingSource(playbackInput.value);
        if (!playbackInput.value.trim()) {
            hint.textContent = 'Cole a URL completa de um canal da Twitch ou Kick.';
            hint.className = 'stream-source-hint';
            return;
        }
        if (!source) {
            hint.textContent = 'Link inválido. Use twitch.tv/... ou kick.com/...';
            hint.className = 'stream-source-hint error';
            return;
        }
        hint.textContent = `${streamingPlatformLabel(source.platform)} detectada: ${source.username}`;
        hint.className = 'stream-source-hint ok';
    }
    refreshSubcategories();
    refreshStreamingHint();
    categorySelect.onchange = refreshSubcategories;
    playbackInput.addEventListener('input', refreshStreamingHint);
    previewSoundButton?.addEventListener('click', async () => {
        const message = document.querySelector('#config-msg');
        const sound = normalizeSupportAlertSound(soundSelect?.value || 'coin');
        if (sound === 'none') {
            if (message) message.innerHTML = '<div class="message ok">Som de apoio desativado.</div>';
            return;
        }
        const unlocked = await unlockSupportAlertAudio();
        const played = unlocked && playSupportAlertSound(sound);
        if (message) {
            message.innerHTML = played
                ? '<div class="message ok">Prévia do som reproduzida.</div>'
                : '<div class="message err">O navegador bloqueou o áudio. Clique novamente após interagir com a página.</div>';
        }
    });
    document.querySelector('#save').onclick = save;
    document.querySelector('#toggle-live').onclick = toggle;
}
function collectForm({ requireSubcategory = false } = {}) {
    const title = document.querySelector('#title').value.trim();
    const description = document.querySelector('#description').value.trim();
    const thumbnailURL = document.querySelector('#thumbnail').value.trim();
    const category = document.querySelector('#category').value;
    const subcategory = document.querySelector('#subcategory').value;
    const source = parseStreamingSource(document.querySelector('#playback-url').value);
    const supportAlertSound = normalizeSupportAlertSound(document.querySelector('#support-alert-sound')?.value || 'coin');
    const matureContent = document.querySelector('#mature-content')?.checked === true;
    if (!source) {
        return {
            error: 'Informe um link válido da Twitch ou da Kick.'
        };
    }
    if (requireSubcategory && !subcategory) {
        return {
            error: 'Selecione uma subcategoria antes de iniciar.'
        };
    }
    return {
        title,
        description,
        thumbnailURL,
        category,
        categoryId: subcategory ? `${category} - ${subcategory}` : category,
        playbackURL: source.canonicalUrl,
        supportAlertSound,
        matureContent,
        source
    };
}
async function save() {
    const message = document.querySelector('#config-msg');
    const form = collectForm();
    if (form.error) {
        message.innerHTML = `<div class="message err">${escapeHtml(form.error)}</div>`;
        return;
    }
    try {
        await updateDoc(doc(db, 'streams', stream.id), {
            title: form.title,
            description: form.description,
            thumbnailURL: form.thumbnailURL,
            categoryId: form.categoryId,
            playbackURL: form.playbackURL,
            supportAlertSound: form.supportAlertSound,
            matureContent: form.matureContent
        });
        await updateDoc(doc(db, 'channels', user.uid), {
            categoryId: form.categoryId
        });
        message.innerHTML = `
      <div class="message ok">
        Configurações salvas. Plataforma: ${streamingPlatformLabel(form.source.platform)}.
      </div>
    `;
        await load();
    }
    catch (error) {
        console.error(error);
        message.innerHTML = '<div class="message err">Não foi possível salvar.</div>';
    }
}
async function toggle() {
    const message = document.querySelector('#config-msg');
    const starting = stream.status !== 'live';
    const form = collectForm({ requireSubcategory: starting });
    if (form.error) {
        message.innerHTML = `<div class="message err">${escapeHtml(form.error)}</div>`;
        return;
    }
    try {
        const batch = writeBatch(db);
        batch.update(doc(db, 'streams', stream.id), starting
            ? {
                title: form.title,
                description: form.description,
                thumbnailURL: form.thumbnailURL,
                categoryId: form.categoryId,
                playbackURL: form.playbackURL,
                supportAlertSound: form.supportAlertSound,
                matureContent: form.matureContent,
                status: 'live',
                startedAt: serverTimestamp(),
                endedAt: null
            }
            : {
                title: form.title,
                description: form.description,
                thumbnailURL: form.thumbnailURL,
                categoryId: form.categoryId,
                playbackURL: form.playbackURL,
                supportAlertSound: form.supportAlertSound,
                matureContent: form.matureContent,
                status: 'offline',
                endedAt: serverTimestamp()
            });
        batch.update(doc(db, 'channels', user.uid), {
            categoryId: form.categoryId,
            isLive: starting,
            currentStreamId: stream.id
        });
        await batch.commit();
        await load();
    }
    catch (error) {
        console.error(error);
        message.innerHTML = '<div class="message err">Não foi possível alterar o status.</div>';
    }
}
onAuthStateChanged(auth, currentUser => {
    if (!currentUser) {
        location.href = 'login.html';
        return;
    }
    user = currentUser;
    load().catch(error => {
        console.error(error);
        root.innerHTML = '<div class="state">Erro ao carregar o painel.</div>';
    });
});

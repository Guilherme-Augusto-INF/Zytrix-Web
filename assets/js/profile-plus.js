import {
  auth,
  db,
  onAuthStateChanged,
  doc,
  getDoc
} from './firebase.js';
import { escapeHtml } from './ui.js';
import {
  watchProgress,
  levelFromXp,
  achievementList,
  getPlatformPreferences,
  savePlatformPreferences,
  saveCreatorAttribution
} from './platform-core.js';

const root = document.querySelector('#profile-root');
let user = null;
let progress = null;
let prefs = null;
let stopProgress = null;
let observer = null;

function levelBadges(level, progressData) {
  const result = [`<span class="zy-badge">⭐ Nv. ${level.level} · ${escapeHtml(level.label)}</span>`];
  if (Number(progressData?.streakDays || 0) >= 3) result.push(`<span class="zy-badge">🔥 ${Number(progressData.streakDays)} dias</span>`);
  if (Number(progressData?.watchMinutes || 0) >= 300) result.push('<span class="zy-badge">🎬 Maratonista</span>');
  if (level.level >= 5) result.push('<span class="zy-badge">💎 Superfã</span>');
  return result.join('');
}

function baseProfileReady() {
  return Boolean(root?.querySelector('.profile-grid') || root?.querySelector('.info-list'));
}

function render() {
  if (!root || !user || !prefs || !baseProfileReady()) return;

  const existing = root.querySelector('#profile-plus');
  existing?.remove();

  const level = levelFromXp(progress?.xp || 0);
  const achievements = achievementList(progress || {});
  const unlocked = achievements.filter(item => item.unlocked).length;
  const section = document.createElement('section');
  section.id = 'profile-plus';
  section.className = 'profile-plus';
  section.innerHTML = `
    <div class="card panel" id="progresso">
      <div class="eyebrow">PROGRESSO</div>
      <div style="display:flex;justify-content:space-between;gap:12px;align-items:flex-end;flex-wrap:wrap">
        <div><h2 style="margin:5px 0">Nível ${level.level} · ${escapeHtml(level.label)}</h2><p class="muted">${Number(progress?.xp || 0).toLocaleString('pt-BR')} XP · ${Number(progress?.watchMinutes || 0).toLocaleString('pt-BR')} minutos acompanhados</p></div>
        <div class="badge-row">${levelBadges(level, progress)}</div>
      </div>
      <div class="profile-progress-bar"><span style="width:${Math.round(level.progress * 100)}%"></span></div>
      <p class="setting-help">${level.next ? `Próximo nível com ${level.next.minXp.toLocaleString('pt-BR')} XP.` : 'Você alcançou o maior nível cosmético atual.'} XP e badges não têm valor financeiro.</p>
    </div>

    <div class="card panel">
      <div class="eyebrow">CONQUISTAS</div>
      <h2>${unlocked}/${achievements.length} desbloqueadas</h2>
      <div class="achievement-grid">${achievements.map(item => `<article class="achievement-card ${item.unlocked ? 'unlocked' : ''}"><strong>${item.unlocked ? '✓ ' : '○ '}${escapeHtml(item.label)}</strong><span class="muted">${escapeHtml(item.description)}</span></article>`).join('')}</div>
    </div>

    <div class="card panel">
      <div class="eyebrow">PREFERÊNCIAS DE CONTEÚDO</div>
      <h2>Controle o que aparece para você</h2>
      <label class="toggle-line"><input id="pref-hide-mature" type="checkbox" ${prefs.hideMatureContent ? 'checked' : ''}><span><strong>Ocultar lives 18+</strong><small>Remove conteúdo marcado como maduro das recomendações e bloqueia a abertura até confirmação local.</small></span></label>
      <label class="toggle-line"><input id="pref-safe-mode" type="checkbox" ${prefs.safeMode ? 'checked' : ''}><span><strong>Modo de conteúdo sensível</strong><small>Aplica o filtro mais restritivo da Zytrix. Não é verificação parental nem substitui os controles das plataformas incorporadas.</small></span></label>
      <label class="toggle-line"><input id="pref-reactions" type="checkbox" ${prefs.allowReactions !== false ? 'checked' : ''}><span><strong>Mostrar reações ao vivo</strong><small>Permite as animações ❤️ 😂 🔥 👏 😮 durante transmissões.</small></span></label>
      <label class="toggle-line"><input id="pref-compact-alerts" type="checkbox" ${prefs.compactAlerts ? 'checked' : ''}><span><strong>Alertas compactos</strong><small>Preferência visual local para reduzir distrações.</small></span></label>
      <button id="save-platform-prefs" class="btn btn-primary">Salvar preferências</button>
      <div id="platform-prefs-feedback"></div>
    </div>

    <div class="card panel">
      <div class="eyebrow">CÓDIGO DE CRIADOR</div>
      <h2>Apoie um criador nas futuras compras</h2>
      <p class="muted">A preferência já fica registrada. Ela só terá efeito financeiro quando o Stripe e as regras de repasse estiverem concluídos.</p>
      <div class="creator-code-row"><input id="viewer-creator-code" class="input" maxlength="24" placeholder="Código do criador"><button id="set-viewer-creator-code" class="btn">Usar código</button><button id="clear-viewer-creator-code" class="btn btn-ghost">Limpar</button></div>
      <div id="viewer-creator-code-feedback"></div>
    </div>
  `;
  root.appendChild(section);
  bind();
}

function feedback(selector, text, error = false) {
  const el = document.querySelector(selector);
  if (el) el.innerHTML = `<div class="message ${error ? 'err' : 'ok'}">${escapeHtml(text)}</div>`;
}

function bind() {
  document.querySelector('#save-platform-prefs')?.addEventListener('click', async () => {
    try {
      prefs = {
        hideMatureContent: document.querySelector('#pref-hide-mature').checked,
        safeMode: document.querySelector('#pref-safe-mode').checked,
        allowReactions: document.querySelector('#pref-reactions').checked,
        compactAlerts: document.querySelector('#pref-compact-alerts').checked
      };
      await savePlatformPreferences(user.uid, prefs);
      feedback('#platform-prefs-feedback', 'Preferências salvas.');
    } catch (error) {
      feedback('#platform-prefs-feedback', 'Não foi possível salvar.', true);
    }
  });

  document.querySelector('#set-viewer-creator-code')?.addEventListener('click', async () => {
    const code = document.querySelector('#viewer-creator-code').value.trim().toLowerCase();
    if (!/^[a-z0-9_-]{3,24}$/.test(code)) {
      feedback('#viewer-creator-code-feedback', 'Código inválido.', true);
      return;
    }
    try {
      const snap = await getDoc(doc(db, 'creatorCodes', code));
      if (!snap.exists()) {
        feedback('#viewer-creator-code-feedback', 'Código de criador não encontrado.', true);
        return;
      }
      if (snap.data().creatorUid === user.uid) {
        feedback('#viewer-creator-code-feedback', 'Você não pode atribuir sua própria conta.', true);
        return;
      }
      await saveCreatorAttribution(user.uid, code, snap.data().creatorUid);
      feedback('#viewer-creator-code-feedback', `Código ${code} salvo.`);
    } catch (error) {
      feedback('#viewer-creator-code-feedback', 'Não foi possível salvar o código.', true);
    }
  });

  document.querySelector('#clear-viewer-creator-code')?.addEventListener('click', async () => {
    await saveCreatorAttribution(user.uid, '', '');
    document.querySelector('#viewer-creator-code').value = '';
    feedback('#viewer-creator-code-feedback', 'Atribuição removida.');
  });
}

function tryMount() {
  if (!user || !prefs || !root || !baseProfileReady()) return;

  // O observer acompanha apenas quando o perfil-base fica pronto.
  // Se o módulo já estiver montado, não renderize novamente: render()
  // remove/adiciona #profile-plus e isso geraria um loop de MutationObserver.
  if (root.querySelector('#profile-plus')) return;
  render();
}

function refreshFromProgress() {
  if (!user || !prefs || !root || !baseProfileReady()) return;

  // Atualizações reais de progresso podem redesenhar a seção. Como o DOM
  // termina com #profile-plus presente, o observer disparado por esse redraw
  // passa pelo guard de tryMount() e não entra em recursão.
  render();
}

onAuthStateChanged(auth, async current => {
  user = current;
  stopProgress?.();
  stopProgress = null;
  if (!user) return;

  prefs = await getPlatformPreferences(user.uid).catch(() => ({
    hideMatureContent: false,
    safeMode: false,
    allowReactions: true,
    compactAlerts: false
  }));

  stopProgress = watchProgress(user.uid, value => {
    progress = value;
    refreshFromProgress();
  }, () => {});

  tryMount();
});

if (root) {
  observer = new MutationObserver(tryMount);
  observer.observe(root, { childList: true, subtree: false });
}

window.addEventListener('pagehide', () => {
  stopProgress?.();
  observer?.disconnect();
});

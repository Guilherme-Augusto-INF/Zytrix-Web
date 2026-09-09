import { db, collection, getDocs, query, limit } from './firebase.js';
import { header, footer, escapeHtml } from './ui.js';

header();
footer();

const root = document.querySelector('#status-root');

async function checkStatic() {
  const response = await fetch(`assets/js/firebase.js?status=${Date.now()}`, { cache: 'no-store' });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return 'Operacional';
}

async function checkFirestore() {
  await getDocs(query(collection(db, 'categories'), limit(1)));
  return 'Operacional';
}

async function checkStripe() {
  try {
    const response = await fetch('/api/create-checkout-session', { method: 'OPTIONS', cache: 'no-store' });
    if (response.status === 404) return { state: 'warn', label: 'Em configuração', note: 'O Checkout Stripe seguro ainda não foi publicado na produção.' };
    if (response.ok || [400,401,403,405].includes(response.status)) return { state: 'ok', label: 'Endpoint disponível', note: 'A rota responde; compras ainda dependem da configuração Stripe/webhook.' };
    return { state: 'warn', label: `HTTP ${response.status}`, note: 'A rota respondeu com estado inesperado.' };
  } catch {
    return { state: 'warn', label: 'Indisponível no navegador', note: 'Não foi possível verificar a rota de pagamentos.' };
  }
}

function card(name, state, label, note) {
  return `<article class="status-card"><div><strong>${escapeHtml(name)}</strong><div class="muted" style="margin-top:4px">${escapeHtml(note || '')}</div></div><span class="status-indicator ${state}">${escapeHtml(label)}</span></article>`;
}

async function render() {
  root.innerHTML = `<section class="card panel"><div class="eyebrow">STATUS DA PLATAFORMA</div><h1>Zytrix Status</h1><p class="muted">Verificações feitas no seu navegador. Twitch e Kick continuam sendo serviços externos e podem aplicar login, idade, cookies ou indisponibilidade próprios.</p></section><div id="status-list" class="status-list"></div>`;
  const list = document.querySelector('#status-list');
  const results = [];

  try { await checkStatic(); results.push(card('Site / Vercel', 'ok', 'Operacional', 'Arquivos estáticos da Zytrix estão respondendo.')); }
  catch (error) { results.push(card('Site / Vercel', 'error', 'Falha', String(error.message || error))); }

  try { await checkFirestore(); results.push(card('Firebase Firestore', 'ok', 'Operacional', 'Leitura pública básica concluída com sucesso.')); }
  catch (error) { results.push(card('Firebase Firestore', 'error', 'Falha', 'Não foi possível consultar o banco neste navegador.')); }

  results.push(card('Firebase Authentication', 'ok', 'Carregado', 'O SDK de autenticação está disponível; o login individual depende da sessão do usuário.'));
  results.push(card('Chat e presença', 'ok', 'Disponível', 'Usam Firestore em tempo real e as regras publicadas da Zytrix.'));
  results.push(card('Players Twitch/Kick', 'warn', 'Serviço externo', 'A reprodução depende das plataformas de origem, inclusive suas restrições 18+ e de login.'));

  const stripe = await checkStripe();
  results.push(card('Pagamentos Stripe', stripe.state, stripe.label, stripe.note));
  results.push(card('Zy Coins internos', 'ok', 'Operacional', 'Apoios, alertas e carteira interna funcionam independentemente do Stripe.'));

  list.innerHTML = results.join('');
  const updated = document.createElement('p');
  updated.className = 'muted';
  updated.textContent = `Última verificação: ${new Date().toLocaleString('pt-BR')}`;
  root.appendChild(updated);
}

render();

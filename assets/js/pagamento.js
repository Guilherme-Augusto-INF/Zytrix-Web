import { auth, db, onAuthStateChanged, doc, getDoc, serverTimestamp, runTransaction, collection } from './firebase.js';
import { header, footer } from './ui.js';

header();
footer();

const raw = localStorage.getItem('zytrixSelectedCoinPackage');
let pack = null;
try {
    pack = raw ? JSON.parse(raw) : null;
} catch {
    pack = null;
}

const root = document.querySelector('#payment-root');
const checkoutState = new URLSearchParams(window.location.search).get('checkout');
let user = null;
let isAdmin = false;
let processing = false;
let feedbackHtml = '';

function checkoutMessage() {
    if (checkoutState === 'success') {
        return '<div class="message ok"><strong>Pagamento enviado para confirmação.</strong><br>As Zy Coins só são creditadas depois que o Stripe confirma o pagamento no servidor. Se o saldo ainda não mudou, aguarde a confirmação do meio de pagamento.</div>';
    }
    if (checkoutState === 'cancelled') {
        return '<div class="message err">Pagamento cancelado. Nenhuma Zy Coin foi creditada.</div>';
    }
    return '';
}

function render() {
    if (!pack || !pack.id || !Number.isFinite(Number(pack.coins)) || !Number.isFinite(Number(pack.priceCents))) {
        root.innerHTML = '<div class="state">Nenhum pacote selecionado. <a href="loja.html">Voltar à loja</a></div>';
        return;
    }

    const buttonLabel = processing
        ? 'ABRINDO CHECKOUT...'
        : isAdmin
          ? 'SIMULAR PAGAMENTO APROVADO'
          : 'PAGAR COM STRIPE';

    root.innerHTML = `
        <div class="card panel" style="max-width:620px;margin:auto">
            <div class="eyebrow">Pagamento</div>
            <h1>Finalizar pedido</h1>
            ${checkoutMessage()}
            <div class="info-row">
                <strong>Zy Coins</strong>
                <span class="coin-pill">◈ ${Number(pack.coins).toLocaleString('pt-BR')}</span>
            </div>
            <div class="info-row">
                <strong>Total</strong>
                <span>R$ ${(Number(pack.priceCents) / 100).toFixed(2).replace('.', ',')}</span>
            </div>
            <div class="form-group">
                <label>Pagamento seguro</label>
                <p class="muted" style="margin-top:8px">
                    O pagamento é concluído no Checkout hospedado pelo Stripe. Os meios disponíveis, como cartão e PIX, são apresentados pelo próprio Stripe conforme disponibilidade da conta e da transação.
                </p>
            </div>
            <p class="muted">
                O navegador não recebe a chave secreta do Stripe e não consegue creditar Zy Coins. O saldo é liberado somente após confirmação assinada no webhook do servidor.
            </p>
            ${isAdmin ? '<div class="message ok">Modo de demonstração de administrador ativo. Esta opção não usa dinheiro real.</div>' : ''}
            <button id="pay" class="btn btn-primary" ${processing ? 'disabled' : ''}>${buttonLabel}</button>
            <div id="pay-msg">${feedbackHtml}</div>
        </div>`;

    document.querySelector('#pay').onclick = pay;
}

function setFeedback(html) {
    feedbackHtml = html;
    const msg = document.querySelector('#pay-msg');
    if (msg) msg.innerHTML = feedbackHtml;
}

async function startStripeCheckout() {
    const idToken = await user.getIdToken();
    const response = await fetch('/api/create-checkout-session', {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${idToken}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({ packageId: pack.id }),
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.checkoutUrl) {
        const messages = {
            authentication_required: 'Sua sessão expirou. Entre novamente para continuar.',
            invalid_package: 'Este pacote não é válido para pagamento.',
            rate_limit_exceeded: 'Muitas tentativas de checkout. Tente novamente mais tarde.',
            checkout_unavailable: 'O checkout está temporariamente indisponível.',
        };
        throw new Error(messages[data.error] || 'Não foi possível abrir o checkout do Stripe.');
    }

    setFeedback('<div class="message ok">Redirecionando para o pagamento seguro do Stripe...</div>');
    window.location.assign(data.checkoutUrl);
}

async function runAdminDemo() {
    const orderRef = doc(collection(db, 'zyCoinOrders'));

    await runTransaction(db, async (tx) => {
        const walletRef = doc(db, 'wallets', user.uid);
        const ws = await tx.get(walletRef);
        if (!ws.exists()) throw new Error('Crie sua carteira abrindo a Loja primeiro.');

        const w = ws.data();
        tx.set(orderRef, {
            uid: user.uid,
            packageId: pack.id,
            coins: Number(pack.coins),
            priceCents: Number(pack.priceCents),
            paymentMethod: 'admin_demo',
            status: 'paid',
            mode: 'admin_demo',
            createdAt: serverTimestamp(),
            paidAt: serverTimestamp(),
        });
        tx.update(walletRef, {
            balance: Number(w.balance || 0) + Number(pack.coins),
            updatedAt: serverTimestamp(),
        });
    });

    setFeedback('<div class="message ok">Pagamento demonstrativo aprovado e Zy Coins creditadas.</div>');
}

async function pay() {
    if (!user) {
        setFeedback('<div class="message err">Faça login para continuar.</div>');
        return;
    }
    if (processing) return;

    processing = true;
    feedbackHtml = '';
    render();

    try {
        if (isAdmin) {
            await runAdminDemo();
        } else {
            await startStripeCheckout();
        }
    } catch (err) {
        console.error(err);
        setFeedback(`<div class="message err">${err?.message || 'Não foi possível iniciar o pagamento.'}</div>`);
    } finally {
        processing = false;
        render();
    }
}

onAuthStateChanged(auth, async (u) => {
    user = u;
    isAdmin = false;
    feedbackHtml = '';

    if (u) {
        const a = await getDoc(doc(db, 'admins', u.uid)).catch(() => null);
        isAdmin = !!a?.exists() && a.data().active === true;
    }

    render();
});

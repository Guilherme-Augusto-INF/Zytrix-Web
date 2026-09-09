import {prepareAcceptance,requireAcceptanceBeforeSignup,recordAcceptance} from './policy-acceptance.js';
import { auth, db, googleProvider, signInWithPopup, signInWithEmailAndPassword, createUserWithEmailAndPassword, sendEmailVerification, sendPasswordResetEmail, doc, setDoc, serverTimestamp, getDoc } from './firebase.js';
import { header, footer } from './ui.js';
import { strongPassword, genericAuthMessage, localRedirect } from './security.js';
header();
footer();
const form = document.querySelector('form[data-auth-form]');
const msg = document.querySelector('#message');
const mode = form?.dataset.mode;
await prepareAcceptance(form);
function show(text, type = 'err') { if (!msg)
    return; msg.textContent = text; msg.className = `message ${type}`; msg.classList.remove('hidden'); }
function googleAuthMessage(error) {
    const code = String(error?.code || '');
    if (code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request')
        return 'Login com Google cancelado.';
    if (code === 'auth/popup-blocked')
        return 'O navegador bloqueou a janela do Google. Libere pop-ups para a Zytrix e tente novamente.';
    if (code === 'auth/unauthorized-domain')
        return 'Este domínio da Zytrix ainda não está autorizado no Firebase Authentication.';
    if (code === 'auth/operation-not-allowed')
        return 'O login com Google não está habilitado no Firebase Authentication.';
    if (code === 'auth/account-exists-with-different-credential')
        return 'Este e-mail já está cadastrado com outro método de login. Entre pelo método original.';
    if (code === 'auth/network-request-failed')
        return 'Não foi possível conectar ao Google. Verifique a rede e tente novamente.';
    return 'Não foi possível entrar com Google.';
}
async function ensureDocs(user, username = 'Usuário', provider = 'password') {
    await recordAcceptance(user);
    const uref = doc(db, 'users', user.uid), pref = doc(db, 'profiles', user.uid);
    if (!(await getDoc(uref)).exists())
        await setDoc(uref, { uid: user.uid, zytrixId: `ZY-${user.uid.slice(0, 10).toUpperCase()}`, email: user.email || '', provider, createdAt: serverTimestamp(), lastLoginAt: serverTimestamp() });
    if (!(await getDoc(pref)).exists())
        await setDoc(pref, { uid: user.uid, username: username || user.displayName || 'Usuário', photoURL: user.photoURL || '', bio: '', createdAt: serverTimestamp(), usernameUpdatedAt: serverTimestamp() });
}
form?.addEventListener('submit', async (e) => {
    e.preventDefault();
    msg?.classList.add('hidden');
    const fd = new FormData(form);
    try {
        if (mode === 'login') {
            const cred = await signInWithEmailAndPassword(auth, String(fd.get('email')), String(fd.get('password')));
            await ensureDocs(cred.user, cred.user.displayName || 'Usuário', 'password');
            location.href = localRedirect(new URLSearchParams(location.search).get('redirect'), 'index.html');
        }
        if (mode === 'register') {
            requireAcceptanceBeforeSignup();
            const name = String(fd.get('username') || '').trim();
            const email = String(fd.get('email') || '').trim();
            const password = String(fd.get('password') || '');
            if (name.length < 2)
                throw new Error('Nome muito curto.');
            if (!strongPassword(password))
                throw new Error('Use pelo menos 10 caracteres, com letra e número.');
            const cred = await createUserWithEmailAndPassword(auth, email, password);
            await ensureDocs(cred.user, name, 'password');
            await sendEmailVerification(cred.user);
            show('Conta criada. Enviamos um e-mail de verificação.', 'ok');
            setTimeout(() => location.href = 'index.html', 1200);
        }
        if (mode === 'reset') {
            await sendPasswordResetEmail(auth, String(fd.get('email'))).catch(() => {});
            show('Se existir uma conta para esse e-mail, enviaremos as instruções de recuperação.', 'ok');
        }
    }
    catch (err) {
        console.warn('Falha na autenticação.', err?.code || err?.name || 'unknown');
        if (mode === 'register' && ['Nome muito curto.', 'Use pelo menos 10 caracteres, com letra e número.'].includes(err?.message)) show(err.message);
        else if (mode === 'reset') show('Se existir uma conta para esse e-mail, enviaremos as instruções de recuperação.', 'ok');
        else show(genericAuthMessage());
    }
});
const googleButton = document.querySelector('#google-login');
googleButton?.addEventListener('click', async () => {
    if (googleButton.disabled) return;
    googleButton.disabled = true;
    msg?.classList.add('hidden');
    try {
        requireAcceptanceBeforeSignup();
        const cred = await signInWithPopup(auth, googleProvider);
        try {
            await ensureDocs(cred.user, cred.user.displayName || 'Usuário', 'google');
        }
        catch (profileError) {
            console.warn('Google autenticou, mas a sincronização do perfil falhou.', profileError?.code || profileError?.name || 'unknown');
            const [userDoc, profileDoc] = await Promise.all([
                getDoc(doc(db, 'users', cred.user.uid)).catch(() => null),
                getDoc(doc(db, 'profiles', cred.user.uid)).catch(() => null)
            ]);
            if (!userDoc?.exists?.() || !profileDoc?.exists?.()) {
                show('Google autenticou, mas não foi possível concluir a configuração do perfil. Tente novamente em instantes.');
                return;
            }
        }
        location.href = localRedirect(new URLSearchParams(location.search).get('redirect'), 'index.html');
    }
    catch (err) {
        console.warn('Falha no login Google.', err?.code || err?.name || 'unknown');
        show(googleAuthMessage(err));
    }
    finally {
        googleButton.disabled = false;
    }
});

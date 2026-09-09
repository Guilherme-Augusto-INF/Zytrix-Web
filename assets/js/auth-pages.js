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
        console.warn('Falha na autenticação.');
        if (mode === 'register' && ['Nome muito curto.', 'Use pelo menos 10 caracteres, com letra e número.'].includes(err?.message)) show(err.message);
        else if (mode === 'reset') show('Se existir uma conta para esse e-mail, enviaremos as instruções de recuperação.', 'ok');
        else show(genericAuthMessage());
    }
});
document.querySelector('#google-login')?.addEventListener('click', async () => { try {
    requireAcceptanceBeforeSignup();
    const cred = await signInWithPopup(auth, googleProvider);
    await ensureDocs(cred.user, cred.user.displayName || 'Usuário', 'google');
    location.href = localRedirect(new URLSearchParams(location.search).get('redirect'), 'index.html');
}
catch (err) {
    console.warn('Falha na autenticação.');
    show('Não foi possível entrar com Google.');
} });

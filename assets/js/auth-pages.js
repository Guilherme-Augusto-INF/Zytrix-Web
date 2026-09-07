import { auth, db, googleProvider, signInWithPopup, signInWithEmailAndPassword, createUserWithEmailAndPassword, sendEmailVerification, sendPasswordResetEmail, doc, setDoc, serverTimestamp, getDoc } from './firebase.js';
import { header, footer } from './ui.js';
header();
footer();
const form = document.querySelector('form[data-auth-form]');
const msg = document.querySelector('#message');
const mode = form?.dataset.mode;
function show(text, type = 'err') { if (!msg)
    return; msg.textContent = text; msg.className = `message ${type}`; msg.classList.remove('hidden'); }
async function ensureDocs(user, username = 'Usuário', provider = 'password') {
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
            location.href = 'index.html';
        }
        if (mode === 'register') {
            const name = String(fd.get('username') || '').trim();
            const email = String(fd.get('email') || '').trim();
            const password = String(fd.get('password') || '');
            if (name.length < 2)
                throw new Error('Nome muito curto.');
            const cred = await createUserWithEmailAndPassword(auth, email, password);
            await ensureDocs(cred.user, name, 'password');
            await sendEmailVerification(cred.user);
            show('Conta criada. Enviamos um e-mail de verificação.', 'ok');
            setTimeout(() => location.href = 'index.html', 1200);
        }
        if (mode === 'reset') {
            await sendPasswordResetEmail(auth, String(fd.get('email')));
            show('Link de recuperação enviado para seu e-mail.', 'ok');
        }
    }
    catch (err) {
        console.error(err);
        show(err?.message?.replace('Firebase: ', '') || 'Não foi possível concluir a operação.');
    }
});
document.querySelector('#google-login')?.addEventListener('click', async () => { try {
    const cred = await signInWithPopup(auth, googleProvider);
    await ensureDocs(cred.user, cred.user.displayName || 'Usuário', 'google');
    location.href = 'index.html';
}
catch (err) {
    console.error(err);
    show('Não foi possível entrar com Google.');
} });

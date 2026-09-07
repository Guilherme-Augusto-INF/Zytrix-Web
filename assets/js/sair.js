import { auth, signOut } from './firebase.js';
import { header, footer } from './ui.js';
header();
footer();
const msg = document.querySelector('#logout-msg');
document.querySelector('#logout-btn').onclick = async () => { try {
    await signOut(auth);
    msg.innerHTML = '<div class="message ok">Sessão encerrada.</div>';
    setTimeout(() => location.href = 'index.html', 700);
}
catch {
    msg.innerHTML = '<div class="message err">Não foi possível sair.</div>';
} };

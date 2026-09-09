import { auth, onAuthStateChanged } from './firebase.js';
import { watchFollowedCategories, setCategoryFollow } from './platform-core.js';

const category = new URLSearchParams(location.search).get('categoria') || '';
let user = null;
let followed = new Set();
let stop = null;
let observer = null;

function mount() {
  const title = document.querySelector('#category-title');
  if (!title || !category) return;
  let button = document.querySelector('#follow-current-category');
  if (!button) {
    button = document.createElement('button');
    button.id = 'follow-current-category';
    button.type = 'button';
    button.className = 'btn follow-category-button';
    title.parentElement?.appendChild(button);
  }
  if (!user) {
    button.textContent = 'Entrar para seguir';
    button.classList.remove('is-following');
    button.onclick = () => location.href = `login.html?redirect=${encodeURIComponent(location.pathname + location.search)}`;
    return;
  }
  const active = followed.has(category);
  button.textContent = active ? 'Seguindo categoria ✓' : 'Seguir categoria';
  button.classList.toggle('is-following', active);
  button.onclick = () => setCategoryFollow(user.uid, category, !active);
}

onAuthStateChanged(auth, current => {
  user = current;
  stop?.();
  stop = null;
  if (user) stop = watchFollowedCategories(user.uid, value => { followed = value; mount(); }, () => {});
  else { followed = new Set(); mount(); }
});

observer = new MutationObserver(() => {
  if (document.querySelector('#category-title')) {
    mount();
    observer.disconnect();
  }
});
if (document.querySelector('#category-title')) mount();
else observer.observe(document.documentElement, { childList:true, subtree:true });
window.addEventListener('pagehide', () => { stop?.(); observer?.disconnect(); });

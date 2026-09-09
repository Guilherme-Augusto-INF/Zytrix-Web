const HTTPS = 'https:';

const HOST_GROUPS = Object.freeze({
  twitch: ['twitch.tv', 'www.twitch.tv', 'm.twitch.tv', 'player.twitch.tv'],
  kick: ['kick.com', 'www.kick.com', 'player.kick.com'],
  youtube: ['youtube.com', 'www.youtube.com', 'youtu.be'],
  instagram: ['instagram.com', 'www.instagram.com'],
  tiktok: ['tiktok.com', 'www.tiktok.com'],
  profileImages: [
    'lh3.googleusercontent.com',
    'firebasestorage.googleapis.com',
    'storage.googleapis.com',
    'static-cdn.jtvnw.net',
    'clips-media-assets2.twitch.tv',
    'files.kick.com',
    'images.kick.com'
  ]
});

function exactOrSubdomain(hostname, allowed) {
  const host = String(hostname || '').toLowerCase();
  return allowed.some(item => host === item || host.endsWith(`.${item}`));
}

export function parseSafeHttpsUrl(value = '', allowedHosts = []) {
  const text = String(value || '').trim();
  if (!text) return null;
  try {
    const url = new URL(text);
    if (url.protocol !== HTTPS) return null;
    if (url.username || url.password) return null;
    if (url.port && url.port !== '443') return null;
    if (allowedHosts.length && !exactOrSubdomain(url.hostname, allowedHosts)) return null;
    return url;
  } catch {
    return null;
  }
}

export function safeHttpsUrl(value = '', allowedHosts = []) {
  return parseSafeHttpsUrl(value, allowedHosts)?.toString() || '';
}

export function safeStreamingUrl(value = '') {
  return safeHttpsUrl(value, [...HOST_GROUPS.twitch, ...HOST_GROUPS.kick]);
}

export function safeSocialUrl(kind, value = '') {
  const key = String(kind || '').toLowerCase();
  if (!value) return '';
  if (key === 'website') return safeHttpsUrl(value);
  const hosts = HOST_GROUPS[key] || [];
  return safeHttpsUrl(value, hosts);
}

export function safeImageUrl(value = '') {
  if (!value) return '';
  return safeHttpsUrl(value, HOST_GROUPS.profileImages);
}

export function hardenExternalLink(anchor, value, allowedHosts = []) {
  if (!anchor) return false;
  const safe = safeHttpsUrl(value, allowedHosts);
  if (!safe) {
    anchor.removeAttribute('href');
    anchor.setAttribute('aria-disabled', 'true');
    return false;
  }
  anchor.href = safe;
  anchor.target = '_blank';
  anchor.rel = 'noopener noreferrer external';
  anchor.referrerPolicy = 'no-referrer';
  return true;
}

export function hardenExternalImage(image, value) {
  if (!image) return false;
  const safe = safeImageUrl(value);
  if (!safe) {
    image.removeAttribute('src');
    return false;
  }
  image.src = safe;
  image.referrerPolicy = 'no-referrer';
  image.loading = image.loading || 'lazy';
  image.decoding = image.decoding || 'async';
  return true;
}

export function localRedirect(value = '', fallback = 'index.html') {
  const text = String(value || '').trim();
  if (!text) return fallback;
  try {
    const candidate = new URL(text, location.origin);
    if (candidate.origin !== location.origin) return fallback;
    if (!/^https?:$/.test(candidate.protocol)) return fallback;
    return `${candidate.pathname}${candidate.search}${candidate.hash}`;
  } catch {
    return fallback;
  }
}

export function genericAuthMessage() {
  return 'Não foi possível autenticar com os dados informados.';
}

export function strongPassword(value = '') {
  const password = String(value);
  return password.length >= 10 && /[A-Za-zÀ-ÿ]/.test(password) && /\d/.test(password);
}

export const SECURITY_LIMITS = Object.freeze({
  supportAlertDocs: 100,
  followerCountDocs: 1001,
  viewerCountDocs: 5001,
  chatMinIntervalMs: 1000
});

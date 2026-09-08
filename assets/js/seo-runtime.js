const PRODUCTION_ORIGIN = 'https://zytrix-lives.vercel.app';

const allowedParams = new Set(['stream', 'categoria', 'subcategoria']);
const cleanPath = location.pathname.replace(/\.html$/i, '');
const canonical = new URL(cleanPath || '/', PRODUCTION_ORIGIN);

for (const [key, value] of new URLSearchParams(location.search)) {
  if (allowedParams.has(key) && value) {
    canonical.searchParams.append(key, value);
  }
}

const canonicalLink = document.querySelector('link[rel="canonical"]');
if (canonicalLink) canonicalLink.href = canonical.href;

const ogUrl = document.querySelector('meta[property="og:url"]');
if (ogUrl) ogUrl.content = canonical.href;

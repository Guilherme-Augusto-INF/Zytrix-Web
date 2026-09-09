from pathlib import Path


def replace(path, old, new, count=None):
    p = Path(path)
    text = p.read_text(encoding='utf-8')
    occurrences = text.count(old)
    if occurrences == 0:
        raise SystemExit(f'Anchor not found in {path}: {old[:80]!r}')
    if count is not None and occurrences != count:
        raise SystemExit(f'Unexpected occurrence count in {path}: {occurrences} != {count}')
    p.write_text(text.replace(old, new), encoding='utf-8')
    print(f'patched {path}: {occurrences} occurrence(s)')


# Avoid self-triggering MutationObserver loops in modules that render into their own roots.
replace(
    'assets/js/live-extras.js',
    "observer.observe(root, { childList: true, subtree: true });",
    "observer.observe(root, { childList: true, subtree: false });",
    1,
)
replace(
    'assets/js/profile-plus.js',
    "observer.observe(root, { childList: true, subtree: true });",
    "observer.observe(root, { childList: true, subtree: false });",
    1,
)
replace(
    'assets/js/profile-promotions.js',
    "observer.observe(root, { childList: true, subtree: true });",
    "observer.observe(root, { childList: true, subtree: false });",
    1,
)

# Stop notifications-plus from removing/re-adding itself on every root mutation.
replace(
    'assets/js/notifications-plus.js',
    "function tryMount() {\n  if (!root?.querySelector('.state')) mount();\n}",
    "function tryMount() {\n  if (root?.querySelector('#notifications-plus')) return;\n  if (!root?.querySelector('.state')) mount();\n}",
    1,
)

# Stop admin-promotions from repeatedly recreating its own section.
replace(
    'assets/js/admin-promotions.js',
    "function tryMount() {\n  if (!root || !user) return;\n  if (root.querySelector('.state')) return;\n  mount();\n}",
    "function tryMount() {\n  if (!root || !user) return;\n  if (root.querySelector('#admin-promotions')) return;\n  if (root.querySelector('.state')) return;\n  mount();\n}",
    1,
)

# Avoid a composite Firestore index for streamer clips; sort the small result client-side.
replace(
    'assets/js/notifications-plus.js',
    "getDocs(query(collection(db, 'clips'), where('streamerUid', '==', user.uid), orderBy('createdAt', 'desc'), limit(20))).catch(() => null)",
    "getDocs(query(collection(db, 'clips'), where('streamerUid', '==', user.uid), limit(20))).catch(() => null)",
    1,
)
replace(
    'assets/js/notifications-plus.js',
    "data.clips = clips?.docs?.map(item => ({ id: item.id, ...item.data() })) || [];",
    "data.clips = (clips?.docs?.map(item => ({ id: item.id, ...item.data() })) || []).sort((a, b) => tsMs(b.createdAt) - tsMs(a.createdAt));",
    1,
)

# Category page gets follow-category controls and the shared platform stylesheet.
replace(
    'categoria.html',
    '  <link rel="stylesheet" href="assets/css/features.css">',
    '  <link rel="stylesheet" href="assets/css/features.css">\n  <link rel="stylesheet" href="assets/css/platform.css">',
    1,
)
replace(
    'categoria.html',
    '   <script type="module" src="assets/js/global-features.js"></script>',
    '   <script type="module" src="assets/js/category-follow.js"></script>\n   <script type="module" src="assets/js/global-features.js"></script>',
    1,
)

# Observe just long enough to find the category title; auth/category state handles subsequent updates.
replace(
    'assets/js/category-follow.js',
    "observer = new MutationObserver(mount);\nobserver.observe(document.documentElement, { childList:true, subtree:true });\nmount();",
    "observer = new MutationObserver(() => {\n  if (document.querySelector('#category-title')) {\n    mount();\n    observer.disconnect();\n  }\n});\nif (document.querySelector('#category-title')) mount();\nelse observer.observe(document.documentElement, { childList:true, subtree:true });",
    1,
)

# Alert themes used by live-support-alerts.js.
platform_css = Path('assets/css/platform.css')
css = platform_css.read_text(encoding='utf-8')
marker = '.mature-hidden-card { display: none !important; }'
if '.support-alert-theme-neon' not in css:
    addition = r'''
.support-alert-theme-minimal {
  box-shadow: none !important;
  border-color: #334155 !important;
  background: rgba(2, 6, 23, .94) !important;
}
.support-alert-theme-celebrate {
  border-color: #f59e0b !important;
  box-shadow: 0 16px 44px rgba(245, 158, 11, .18) !important;
}
.support-alert-theme-neon {
  border-color: #22d3ee !important;
  box-shadow: 0 0 0 1px rgba(34, 211, 238, .25), 0 0 30px rgba(139, 92, 246, .32) !important;
}
.support-alert-burst {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  pointer-events: none;
  font-size: 30px;
  letter-spacing: 20px;
  color: #fde68a;
  animation: zySupportBurst 1.35s ease-out forwards;
}
@keyframes zySupportBurst {
  0% { opacity: 0; transform: scale(.65); }
  20% { opacity: 1; }
  100% { opacity: 0; transform: scale(1.35); }
}
'''
    if marker not in css:
        raise SystemExit('platform.css marker not found')
    css = css.replace(marker, addition + '\n' + marker, 1)
    platform_css.write_text(css, encoding='utf-8')

print('platform stability patch complete')

from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def read(path):
    return (ROOT / path).read_text(encoding='utf-8')


def write(path, text):
    (ROOT / path).write_text(text, encoding='utf-8')


def replace_once(text, old, new, label):
    if new in text:
        return text
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f'{label}: esperado 1 match, encontrado {count}')
    return text.replace(old, new, 1)


# Regras: playback/VOD do YouTube + CDNs oficiais de thumbnail.
for path in ['firestore.rules', 'firebase/firestore.rules', 'REGRAS-PARA-COLAR-NO-FIREBASE.txt']:
    text = read(path)
    text = replace_once(
        text,
        "          url.matches('^https://(www\\\\.|m\\\\.|player\\\\.)?twitch\\\\.tv/.*$')\n          || url.matches('^https://(www\\\\.|player\\\\.)?kick\\\\.com/.*$')",
        "          url.matches('^https://(www\\\\.|m\\\\.|player\\\\.)?twitch\\\\.tv/.*$')\n          || url.matches('^https://(www\\\\.|player\\\\.)?kick\\\\.com/.*$')\n          || url.matches('^https://(www\\\\.|m\\\\.)?youtube\\\\.com/(watch\\\\?v=[A-Za-z0-9_-]{11}.*|live/[A-Za-z0-9_-]{11}.*|embed/[A-Za-z0-9_-]{11}.*)$')\n          || url.matches('^https://(www\\\\.)?youtu\\\\.be/[A-Za-z0-9_-]{11}.*$')",
        f'{path}: validStreamingURL'
    )
    text = replace_once(
        text,
        "          || url.matches('^https://([A-Za-z0-9-]+\\\\.)*kick\\\\.com/.*$')",
        "          || url.matches('^https://([A-Za-z0-9-]+\\\\.)*kick\\\\.com/.*$')\n          || url.matches('^https://i\\\\.ytimg\\\\.com/.*$')\n          || url.matches('^https://img\\\\.youtube\\\\.com/.*$')\n          || url.matches('^https://yt3\\\\.ggpht\\\\.com/.*$')",
        f'{path}: youtube image CDN'
    )
    write(path, text)

# Configuração da live.
path = 'assets/js/config-live.js'
text = read(path)
replacements = [
    ('placeholder="https://www.twitch.tv/seucanal ou https://kick.com/seucanal"',
     'placeholder="https://youtube.com/watch?v=... | twitch.tv/... | kick.com/..."'),
    ('Cole a URL completa de um canal da Twitch ou Kick.',
     'Cole a URL de uma live/vídeo do YouTube ou de um canal da Twitch/Kick.'),
    ('Link inválido. Use twitch.tv/... ou kick.com/...',
     'Link inválido. Use youtube.com/watch?v=..., youtu.be/..., twitch.tv/... ou kick.com/...'),
    ('Informe um link válido da Twitch ou da Kick.',
     'Informe um link válido do YouTube, Twitch ou Kick.'),
    ('mantém as exigências de login/idade da Twitch ou Kick.',
     'mantém as exigências de login/idade da plataforma de origem.')
]
for old, new in replacements:
    text = text.replace(old, new)
write(path, text)

# Perfil / criação do canal.
path = 'assets/js/perfil.js'
text = read(path)
replacements = [
    ('Você pode trocar entre Twitch e Kick no painel de configuração da live.',
     'Você pode trocar entre YouTube, Twitch e Kick no painel de configuração da live.'),
    ('Vincule um canal da Twitch ou da Kick para criar seu canal na Zytrix.',
     'Vincule uma live do YouTube ou um canal da Twitch/Kick para criar seu canal na Zytrix.'),
    ('Link da Twitch ou Kick', 'Link do YouTube, Twitch ou Kick'),
    ('placeholder="https://www.twitch.tv/seucanal ou https://kick.com/seucanal"',
     'placeholder="https://youtube.com/watch?v=... | twitch.tv/... | kick.com/..."'),
    ('Use um link válido da Twitch ou da Kick.',
     'Use um link válido do YouTube, Twitch ou Kick.')
]
for old, new in replacements:
    text = text.replace(old, new)
write(path, text)

# Mensagem de fallback da live.
path = 'assets/js/live.js'
text = read(path).replace(
    'Player indisponível. Vincule um canal válido da Twitch ou Kick.',
    'Player indisponível. Vincule uma live válida do YouTube, Twitch ou Kick.'
)
write(path, text)

# Texto de clipes/VOD.
path = 'assets/js/live-extras.js'
text = read(path).replace(
    'Como a transmissão vem da Twitch/Kick, a Zytrix salva o momento e o link; o vídeo continua sujeito ao VOD/clipe da plataforma de origem.',
    'Como a transmissão vem do YouTube/Twitch/Kick, a Zytrix salva o momento e o link; o vídeo continua sujeito ao VOD/clipe da plataforma de origem.'
)
write(path, text)

# Documentação básica.
path = 'README.md'
text = read(path)
text = text.replace('## Twitch e Kick', '## YouTube, Twitch e Kick')
text = text.replace(
    'O campo `playbackURL` da live aceita um canal da Twitch ou Kick.',
    'O campo `playbackURL` aceita uma live/vídeo incorporável do YouTube ou um canal da Twitch/Kick.'
)
write(path, text)

# Teste de Rules específico para YouTube.
path = 'tests/security-hardening.rules.test.mjs'
text = read(path)
marker = "test('YouTube Live é aceito e domínio falso continua bloqueado',"
if marker not in text:
    text += """

test('YouTube Live é aceito e domínio falso continua bloqueado', async () => {
  const db = as('bob');
  await assertSucceeds(setDoc(doc(db, 'streams', 'live1'), {
    playbackURL: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ'
  }, { merge: true }));

  const snap = await getDoc(doc(db, 'streams', 'live1'));
  assert.equal(snap.data().playbackURL, 'https://www.youtube.com/watch?v=dQw4w9WgXcQ');

  await assertFails(setDoc(doc(db, 'streams', 'live1'), {
    playbackURL: 'https://youtube.com.evil.example/watch?v=dQw4w9WgXcQ'
  }, { merge: true }));
});
"""
write(path, text)

# Sanidade: as 3 regras devem ficar idênticas.
a = read('firestore.rules')
b = read('firebase/firestore.rules')
c = read('REGRAS-PARA-COLAR-NO-FIREBASE.txt')
if not (a == b == c):
    raise RuntimeError('As três cópias das Firestore Rules divergiram.')

print('YouTube Live patch aplicado com sucesso.')

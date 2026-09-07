# Zytrix — HTML/CSS/JavaScript

Versão web tradicional do Zytrix, sem React e sem Figma Sites.

## Produção

A versão Web está publicada em:

https://zytrix-web.vercel.app

## Tecnologias

- HTML5
- CSS3
- JavaScript ES Modules
- Firebase Authentication
- Cloud Firestore
- Twitch Embed
- Kick Embed
- Vercel
- Firebase Hosting (configuração também incluída)

## Páginas

- `index.html` — início, destaques e lives ao vivo
- `ao-vivo.html` — todas as lives, filtros e pesquisa
- `categorias.html` — categorias principais
- `categoria.html` — página reutilizável por categoria/subcategoria
- `live.html` — player Twitch/Kick, chat em tempo real e apoio com Zy Coins
- `sobre.html` — página institucional
- `login.html` — login por e-mail/senha e Google
- `registro.html` — cadastro por e-mail/senha e Google
- `recuperar-senha.html` — recuperação de senha
- `perfil.html` — perfil, saldo e criação de conta streamer
- `config-live.html` — configuração, Twitch/Kick e status da live
- `loja.html` — pacotes de Zy Coins
- `pagamento.html` — pagamento demonstrativo/pedido pendente
- `sair.html` — logout

## Firebase

O arquivo `assets/js/firebase.js` contém a configuração pública do projeto Firebase `zytrix-ca4f2`.

As regras completas estão em:

- `firestore.rules`
- `firebase/firestore.rules`
- `REGRAS-PARA-COLAR-NO-FIREBASE.txt`

No Firebase Console, mantenha habilitados os provedores necessários em Authentication e adicione o domínio de produção da Vercel em **Authentication > Settings > Authorized domains**.

## Como executar localmente

Não use `file:///`. Rode o projeto por HTTP.

Com Live Server, use **Go Live** no VS Code.

Ou no terminal:

```bash
python -m http.server 5500
```

Depois abra:

```text
http://localhost:5500
```

## Twitch e Kick

O campo `playbackURL` da live aceita um canal da Twitch ou Kick.

Exemplos:

```text
https://www.twitch.tv/ablu25
https://kick.com/seucanal
```

A plataforma é detectada automaticamente.

Para Twitch, o player usa `player.twitch.tv` e inclui `location.hostname` como parâmetro `parent`, funcionando em localhost, Live Server e domínio Vercel.

Para Kick, o player usa `player.kick.com/USERNAME` com autoplay e mute configurados por query string.

Um streamer pode trocar entre Twitch e Kick em `config-live.html`.

## Chat em tempo real

Cada live possui mensagens em:

```text
streams/{streamId}/chat/{messageId}
```

As mensagens são sincronizadas com `onSnapshot` e guardam:

```text
uid
text
createdAt
```

Nome e foto são lidos de `profiles/{uid}`.

A moderação inclui:

- apagar mensagem própria;
- streamer moderar o próprio chat;
- administrador moderar qualquer chat;
- silenciar por tempo determinado;
- banir/desbanir;
- fixar/desafixar mensagem;
- badges de STREAMER e ADM.

As regras impedem que um streamer aplique punição em um administrador.

## Zy Coins

As carteiras usam:

```text
wallets/{uid}
```

O apoio na live usa transação atômica do Firestore para debitar o espectador, creditar o streamer e registrar `zyCoinTransactions`.

A tela de pagamento continua propositalmente demonstrativa. Não use dados reais de cartão no frontend.

## Vercel

O projeto inclui `vercel.json` e está publicado como projeto `zytrix-web`.

Produção:

https://zytrix-web.vercel.app

Depois do deploy, adicione `zytrix-web.vercel.app` em **Firebase Authentication > Settings > Authorized domains**.

## Estrutura principal

```text
assets/
├── css/
│   └── styles.css
└── js/
    ├── firebase.js
    ├── streaming.js
    ├── ui.js
    ├── live.js
    ├── perfil.js
    ├── config-live.js
    └── ...
```

## Navegação

Quando o usuário não está autenticado, a navbar mostra **Entrar** e **Registrar**. Quando está autenticado, mostra **Perfil**.

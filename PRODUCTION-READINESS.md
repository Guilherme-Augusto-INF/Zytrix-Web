# Zytrix — Production Readiness

Data da auditoria: 08/09/2026

## Resultado atual

**Status: CONDICIONAL / pronto para validação autenticada final.**

A camada pública, a integração dos novos módulos e o deploy de produção passaram nos testes automatizados disponíveis. Restam duas validações que dependem do ambiente autenticado do Firebase: publicar as regras atualizadas do Firestore e executar o smoke test com contas reais de usuário/streamer/admin.

## Implementado nesta etapa

- painel resumido do streamer em `config-live.html`;
- botões manuais **Iniciar live** e **Encerrar live** preservados;
- contagem de seguidores;
- presença de espectadores autenticados ativos na Zytrix com heartbeat de 30 s e janela de 90 s;
- seguir / deixar de seguir streamer na página da live;
- resumo de seguidores e canais seguidos no perfil;
- página `notificacoes.html`;
- badge/aviso na navegação quando canal seguido está ao vivo;
- página `admin.html` protegida pela verificação `admins/{uid}.active == true`;
- painel administrativo de leitura para usuários, streamers, lives, chat, banimentos, Zy Coins, pedidos e categorias;
- CI permanente em `.github/workflows/quality-check.yml`.

## Verificações automatizadas — PASS

- sintaxe de todos os arquivos `assets/js/*.js` com `node --check`;
- referências locais de CSS e JavaScript em todas as páginas HTML;
- existência dos novos módulos sociais/admin;
- consistência entre `firestore.rules`, `firebase/firestore.rules` e `REGRAS-PARA-COLAR-NO-FIREBASE.txt`;
- presença das regras de espectadores;
- scripts sociais carregados em `live.html`, `perfil.html` e `config-live.html`;
- workflow de qualidade concluído com sucesso no GitHub Actions.

## Vercel — PASS

Projeto: `zytrix-web`

Produção: https://zytrix-web.vercel.app

Deployment validado: `dpl_9EyvSVadDeozeQt68H7yX3exf2GJ`

Verificado em produção:

- `/` → HTTP 200;
- `/admin` → HTTP 200;
- `/notificacoes` → HTTP 200;
- novos arquivos JS/CSS servidos com MIME correto;
- headers `X-Content-Type-Options`, `Referrer-Policy` e `Permissions-Policy` ativos;
- clean URLs funcionando.

Observação: o runtime da Vercel registra um `DEP0169` sobre `url.parse()`. A aplicação não chama `url.parse()` no proxy atual e as requisições respondem HTTP 200; portanto o aviso é tratado como não bloqueante e provavelmente pertence à camada de runtime da plataforma.

## Firestore — AÇÃO NECESSÁRIA

As regras do repositório ganharam:

`streams/{streamId}/viewers/{viewerUid}`

Elas permitem que um usuário autenticado mantenha apenas a própria presença, preservam `uid` e `joinedAt`, e limitam updates ao `lastSeen`. A leitura da presença exige login.

**As regras precisam ser publicadas no Firebase Console antes de validar o contador “Zytrix agora”.**

Arquivo pronto para copiar:

`REGRAS-PARA-COLAR-NO-FIREBASE.txt`

## Smoke test autenticado ainda necessário

Depois de publicar as regras, validar no navegador:

1. usuário A entra em uma live do usuário B e usa **Seguir**;
2. abrir a mesma conta em outra página e confirmar **Seguindo** / contagem;
3. confirmar a presença em “Zytrix agora” com duas contas autenticadas;
4. streamer inicia a live pelo botão manual e o seguidor recebe badge/aviso de live;
5. `notificacoes.html` mostra a live seguida primeiro;
6. streamer encerra a live e a notificação volta para offline;
7. conta comum acessa `admin.html` e recebe acesso negado;
8. conta com `admins/{uid}.active == true` abre o painel e visualiza métricas;
9. repetir chat, mute, ban, mensagem fixada e Zy Coins para garantir ausência de regressões;
10. validar login Google no domínio `zytrix-web.vercel.app`.

## Critério para PASS final

Mudar o status para **PRODUCTION READINESS: PASS** quando as regras novas estiverem publicadas e os 10 passos do smoke test autenticado forem concluídos sem regressões bloqueantes.

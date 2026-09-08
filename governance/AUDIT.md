# Zytrix — auditoria de governança, 8 de setembro de 2026

Base: Guilherme-Augusto-INF/Zytrix-Web, main 9d8b45e77d4c7349bf33a37102939c5cbbf3d513. Produção observada: zytrix-lives.vercel.app, deployment dpl_2CrFgtUay4bAPHgJgVio6efMScLL, projeto prj_RIZKlfqoO8LEgRqg258hC0jgtkS2, equipe team_7faiMzAW5sdaS8Bu11qX4Ev2. Código HTML/CSS/JS ES Modules; sem React, sem Code Layers.

CONFIRMADO no código não significa operação aprovada em produção. Não foram criadas contas reais nem alterados dados de usuários nesta auditoria. Regras em repositório não comprovam regras publicadas.

| Área | Classificação | Evidência e limite |
|---|---|---|
| Cadastro e login por senha | CONFIRMADO | auth-pages.js; formulário observado em produção; criação real não testada |
| Firebase Authentication | CONFIRMADO | firebase.js, projeto zytrix-ca4f2; configuração pública |
| Google Sign-In | CONFIRMADO no código | GoogleAuthProvider/signInWithPopup; configuração e login real NÃO VERIFICADOS |
| Envio de verificação de e-mail | CONFIRMADO no código | sendEmailVerification no cadastro; entrega NÃO VERIFICADA |
| Bloqueio de todas as funções até verificar e-mail | NÃO IMPLEMENTADO | regras existentes não o exigem globalmente |
| Recuperação de senha | CONFIRMADO no código | sendPasswordResetEmail; entrega NÃO VERIFICADA |
| Firestore | CONFIRMADO | SDK, listeners, transações e três cópias das regras |
| Regras efetivamente publicadas | NÃO VERIFICADO | falta acesso administrativo autenticado ao Firebase |
| Storage como upload de arquivos | NÃO IMPLEMENTADO no cliente | bucket configurado, sem import getStorage/upload; regras do bucket NÃO VERIFICADAS |
| Perfil/nome/foto/bio | CONFIRMADO | profiles; foto por URL, sem upload próprio |
| Alterar nome | CONFIRMADO no código | cooldown de 7 dias nas regras |
| Livestream própria/ingestão RTMP | NÃO IMPLEMENTADO | incorpora player externo |
| Configuração de livestream | CONFIRMADO | streams/channels; início e fim manuais |
| Título, descrição, categoria, thumbnail e link | CONFIRMADO | config-live.js/perfil.js |
| Views | CONFIRMADO no código | viewerCount legado + viewers com heartbeat/limiar de 90 s; não confundir com audiência da Twitch/Kick |
| Twitch e Kick | CONFIRMADO | streaming.js e embeds; propriedade dos canais não comprovada por OAuth |
| Chat próprio e conteúdo de usuário | CONFIRMADO | streams/{id}/chat; perfil e metadados públicos |
| Seguir/notificações | CONFIRMADO | users/{uid}/following, channels/{id}/followers; avisos na sessão |
| Histórico de visualização | NÃO VERIFICADO como gravação ativa | permissões watchHistory existem, não encontrado escritor ativo |
| Dados privados | CONFIRMADO no desenho das regras | users restrito ao titular/admin; exceções de carteiras/transações precisam revisão própria |
| Dados públicos | CONFIRMADO nas regras | profiles, channels, streams, chat, seguidores e admins; não é privacidade total |
| Presença de espectadores | CONFIRMADO nas regras | leitura por autenticados; TTL não existe |
| Cookies próprios explicitamente escritos | NÃO IMPLEMENTADO no código auditado | não encontrado document.cookie |
| localStorage | CONFIRMADO | live selecionada/nome/título; pacote de moedas |
| sessionStorage | CONFIRMADO | aviso de live já visto |
| Persistência de sessão Firebase | CONFIRMADO como dependência | mecanismo efetivo do navegador precisa de inspeção específica |
| Analytics | NÃO VERIFICADO externo | measurementId existe, inicialização getAnalytics/gtag não encontrada |
| Logs de aplicação | CONFIRMADO no código | console.warn/error; revisão não equivale a configuração de retenção dos provedores |
| Vercel | CONFIRMADO | domínio e projeto correlacionados via API; último deploy falho não era o alias ativo |
| APIs/terceiros | CONFIRMADO | Firebase/Google, gstatic SDK, Twitch, Kick, Vercel, hosts de imagens variáveis |
| Pagamentos reais | NÃO IMPLEMENTADO | pagamento demonstrativo; não coleta cartão |
| Carteiras/apoios/pedidos | CONFIRMADO no código | wallets, zyCoinTransactions, zyCoinOrders |
| Painel administrativo existente | CONFIRMADO | somente leitura; documento admins ativo, regras do backend |
| Moderador global separado do admin | NÃO IMPLEMENTADO | streamer modera seu chat; nenhum papel global moderator provisionado |
| Remoção/mute/ban de chat | CONFIRMADO no código | live.js e regras; não é suspensão global |
| Denúncias antes desta alteração | NÃO IMPLEMENTADO | nenhuma coleção/interface localizada |
| Novo recebimento/fila | CONFIRMADO na implementação e emulador | gated por governance/config; produção ainda não ativada |
| Suspensão global da conta | NÃO IMPLEMENTADO | Auth e demais escritas não têm sanção global |
| Remover live/perfil via painel | NÃO IMPLEMENTADO no painel | regras permitem admin; UI não aplicava |
| Exclusão completa da conta | NÃO IMPLEMENTADO | sair não exclui Auth, dados ou subcoleções |
| Recurso/apelação | NÃO IMPLEMENTADO | exige canal real, procedimento e identificação de decisão |
| Idade mínima/verificação/supervisão | NÃO IMPLEMENTADO | decisão do responsável pendente, não inferida |
| Retenção/expurgo | NÃO IMPLEMENTADO como rotina auditada | prazos e justificativas dependem do responsável |
| Contratos, região, transferência internacional, DPO | NÃO VERIFICADO | não inventados |

## Arquitetura entregue

- Cinco documentos originais e hub, conteúdo em governance/policies.json, versão/status em governance/release.json, HTML estático gerado por scripts/build-policies.py.
- Minutas noindex, com links no footer e cadastro. Sem aceite exigido de documento incompleto. Sem histórico anterior inventado.
- Recebimento autenticado e e-mail verificado, transação atômica report + chave de duplicidade + intervalo de 60 segundos por conta. Texto até 1.000 caracteres, sem anexos/IP coletado pelo formulário. Backend verifica alvo e recusa auto-denúncia.
- reports: relato e resultado visíveis apenas ao remetente/admin. reportKeys/reportLimits privados ao titular; mutation vinculada a uma nova denúncia. moderationAudit: apenas admin, criação atômica com decisão, sem edição/exclusão pelo cliente. Identidade do administrador fica no log interno.
- Nova denúncia permitida após fechamento da anterior. Referência removida não é aceita como se existisse; canal alternativo permanece pendente.
- Fila limitada a 30 por consulta (regras permitem no máximo 50), carregamento e renderização textual segura. Não há detecção automática, SLA, banimento por quantidade de denúncias ou entrega de aviso fictícia.
- Aceite preparado por versão com timestamp servidor, imutável no cliente; não habilitado na minuta. Google no login também passa pelo fluxo quando ativado. Não é prova jurídica completa nem verificação etária.

## Dados por finalidade

O mapa público está na Política de Privacidade. A confirmação final das bases, contratos, prazos e transferências é responsabilidade do controlador com assessoria jurídica. Não foi assumido consentimento universal. Dados sensíveis eventualmente enviados em relatos exigem avaliação específica; legítimo interesse não é uma base genérica para dados sensíveis.

## Limites operacionais antes de ativar

1. Identificar controlador e contato real para privacidade, segurança, direitos autorais e recurso. Publicar procedimento para pessoas sem conta/sem acesso.
2. Decidir público etário e limites de conteúdo sexual/nudez. Avaliar melhor interesse, proteção por padrão, aferição de idade e supervisão aplicáveis; não coletar documento/biometria por improviso.
3. Designar responsável pela fila e rotina operacional. O recurso técnico não cria capacidade humana de atendimento.
4. Publicar as regras no Firebase correto, testar produção com contas controladas e só então criar governance/config por acesso privilegiado. Clientes não podem ativar recursos.
5. Implementar exclusão completa e pedido de direitos, retenção/expurgo, recurso, comunicação de medidas e eventual suspensão global. Não anunciar essas funções antes de testá-las.
6. Reduzir exposição histórica de admins, seguidores e presença mediante migração compatível com badges/contadores. A nova fila não depende de tornar dados privados públicos.

## Referências jurídicas consultadas

- LGPD, texto atualizado: https://www.planalto.gov.br/ccivil_03/_ato2015-2018/2018/lei/l13709.htm
- ECA Digital, Lei 15.211/2025: https://www.planalto.gov.br/ccivil_03/_ato2023-2026/2025/lei/l15211.htm
- Decreto 12.880/2026: https://www.planalto.gov.br/ccivil_03/_ato2023-2026/2026/decreto/d12880.htm
- Enunciado CD/ANPD 1/2023: https://dspace.mj.gov.br/handle/1/10215

A análise de menores não se limita ao art. 14 da LGPD: precisa considerar o ECA Digital e a regulamentação vigente. Escolher 18+ em um texto não elimina automaticamente obrigações quando houver acesso provável de menores. Não houve validação jurídica profissional.

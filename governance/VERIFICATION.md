# Verificação — 8 de setembro de 2026

## Resultados reproduzíveis

- `npm run build`: PASS, 6 páginas estáticas geradas a partir do conteúdo versionado.
- `npm test`: PASS, 3 testes de validação (IDs, contexto, tamanho, Unicode/HTML).
- `npm run test:rules`: PASS, 15 testes no Firebase Emulator, projeto isolado demo-zytrix-governance, sem tocar em usuários reais.
- `npm run check`: PASS, sintaxe de todos os JS, referências locais das novas páginas, rotas, IDs, âncoras, um H1 por página e igualdade das 3 cópias das regras.
- `git diff --check`: PASS.
- Typecheck/lint formal: N/A, projeto JS sem configuração anterior. Sintaxe verificada; não equivale a TypeScript ou ESLint.

## Preview Vercel

Preview final: https://zytrix-jv2lpx7v9-guilhermeaugusto2525-1431.vercel.app/termos
Deployment: dpl_FxvT75frzm7ZyPYnw5oPvuW5DNXv, READY, projeto Zytrix correto.

Primeiro preview: dpl_CxqQTCyuzMi81FGA8VK7AjHWCyNu. As cinco políticas, hub, formulário, fila e cadastro foram abertos no navegador. Índice e navegação entre documentos funcionaram; cadastro mostra links e aviso de minuta; anônimo não pode enviar denúncia nem acessar a fila. Rota inexistente apresentou 404. Captura visual verificou hierarquia, identidade e largura de leitura no desktop. Segundo preview confirmou a correção de numeração duplicada e campo de contexto oculto.

O fetch do conector para previews encontrou autenticação/redirecionamentos; não foi contabilizado como sucesso HTTP das páginas. O teste visual foi feito no navegador de preview.

## Segurança em produção: leitura anônima, sem mutações

- `streams?pageSize=1`: HTTP 200 (controle positivo).
- `reports/qa-smoke-nonexistent`: HTTP 403.
- `moderationAudit/qa-smoke-nonexistent`: HTTP 403.
- `governance/config`: HTTP 403.

Não foi usada uma denúncia real nesses testes. O Firebase CLI respondeu `Failed to authenticate`; regras de produção e configurações administrativas não foram obtidas ou modificadas.

## Casos cobertos no emulador

Alvo ausente, removido, contexto errado, auto-denúncia, live offline, perfil, mensagem, campos extras, tipo/motivo inválido, texto gigante, Unicode, HTML/script como texto, anônimo, e-mail não verificado, falsificação de remetente, falta de rate limit/trava, flood, duplicidade, corrida concorrente, novo fato após conclusão, IDOR, listagem indevida, identidade administrativa no log privado, auto-promoção, alteração de configuração por cliente, admin legítimo, usuário/moderador não provisionado, decisão sem auditoria, log imutável, versão de aceite inválida, timestamp forjado e aceite desativado.

## Limitações de validação

- Não houve teste em celular real, viewport mobile real, leitor de tela ou medição certificada WCAG. CSS responsivo, landmarks, labels, skip link e foco foram implementados; isso não equivale a PASS integral de acessibilidade/mobile.
- Login real por Google/senha, entrega de e-mail, sessões expiradas reais e operação administrativa em produção não foram testados por ausência de acesso e contas controladas.
- Rede lenta/indisponibilidade não foram simuladas em E2E; o cliente mantém estado de envio e não confirma sucesso antes da gravação.
- Não existe papel global de moderador, suspensão global ou exclusão integral. Não há como certificar esses fluxos por testes inexistentes.
- Reporte de alvo removido, usuário sem conta e contestação dependem de canal operacional ainda não definido.
- Nenhum erro do site foi observado no console nas páginas visitadas; mensagens da extensão do navegador foram separadas da aplicação.
- As regras legadas de carteiras, canais e presença não receberam uma auditoria completa nesta alteração. Os testes novos não certificam o produto inteiro.

## Gate de operação

Páginas podem ser disponibilizadas como minutas explícitas. Denúncias e aceite não devem ser ativados enquanto faltarem responsáveis, canal, decisão etária/controles, publicação e teste das regras. Documentos incompletos ficam fora do sitemap e com noindex. Ativação exige atualizar documentos, preservar versão, rever sitemap/headers e validar o fluxo inteiro.

PRODUCTION READINESS DO SISTEMA COMPLETO: FAIL.

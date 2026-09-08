# Revisão adversarial /devil

| Crítica | Classificação | Tratamento |
|---|---|---|
| Políticas afirmam funções inexistentes | CRÍTICA VÁLIDA | Minutas identificam lacunas; não prometem exclusão, suspensão global, recurso operacional, SLA ou equipe 24/7 |
| Idade mínima inventada | CRÍTICA VÁLIDA | Nenhuma idade ativada; decisão específica pendente |
| Nome do moderador acessível ao denunciante | CRÍTICA VÁLIDA | Identificador removido do documento de resultado e mantido apenas no audit privado |
| Denúncia duplicada/flood por chamadas diretas | CRÍTICA VÁLIDA | Trava e intervalo servidor vinculados à mesma transação; ALLOW/DENY em emulador |
| Bloqueio vitalício de novo relato no mesmo alvo | CRÍTICA VÁLIDA | Nova denúncia permitida após encerramento; teste inclui novo fato |
| Decisão sem evidência de auditoria | CRÍTICA VÁLIDA | Fechamento e log indivisíveis; edição/exclusão do log negadas |
| HTML/script no relato executa no painel | FALSO POSITIVO após correção de desenho | textContent em todas as renderizações de dados; HTML tratado como texto |
| Usuário altera campo para virar admin | FALSO POSITIVO nas regras testadas | admins não permite escrita pelo cliente; testes negam auto-promoção |
| Botão escondido é a autorização | FALSO POSITIVO | backend verifica admin para decisões e leitura da fila |
| Ausência de IP no formulário inviabiliza segurança | CRÍTICA FRACA | IP não é necessário para controle por conta; camada multi-conta ainda é uma limitação real |
| Muitas contas burlam o limite por usuário | CRÍTICA VÁLIDA RESTANTE | Limite mínimo não é proteção global contra Sybil/DDoS; requer App Check/abuso de Auth e operação de risco |
| Encerramento de análise aplicado como banimento | CRÍTICA VÁLIDA | UI deixa explícito que não aplica sanção automaticamente; resultados não fingem aviso enviado |
| Fila sem operador é recebimento abandonado | CRÍTICA VÁLIDA | Ativação negada por padrão; responsável e rotina são requisitos reais |
| Denunciante sem conta, conta inacessível ou alvo removido sem canal | CRÍTICA VÁLIDA RESTANTE | Marcado bloqueador de ativação, não inventado e-mail |
| Banimento de chat é suspensão global | CRÍTICA VÁLIDA | Documentos distinguem medidas; suspensão global não implementada |
| Apagar Auth resolve eliminação LGPD | CRÍTICA VÁLIDA | Não foi colocado botão incompleto de exclusão; processo integral pendente |
| Regras versionadas equivalem a regras publicadas | CRÍTICA VÁLIDA | Produção não confirmada; recursos gated; nenhum PASS de Firebase em produção |
| Seguidores/presença/admins são inteiramente privados | CRÍTICA VÁLIDA RESTANTE | Auditoria e privacidade expõem o comportamento real; migração exige validação de funções existentes |
| Contexto educativo permite qualquer material | CRÍTICA VÁLIDA | Exceções limitadas; material de abuso infantil não pode ser redistribuído |
| Sem SLA voluntário não há prazo legal | CRÍTICA VÁLIDA | Ausência de promessa de SLA não exclui obrigações e prazos legais; revisão jurídica necessária |
| Minutas incompletas indexadas como política final | CRÍTICA VÁLIDA | noindex e status explícito; incluir no sitemap somente após vigência |
| Âncora principal duplicada na seção de conteúdo | CRÍTICA VÁLIDA | Corrigida; teste de IDs/âncoras |

Risco de produção permanece FAIL até resolução dos bloqueadores. Os testes do novo módulo não são uma auditoria exaustiva de todas as regras legadas de Zy Coins, URLs e canais.

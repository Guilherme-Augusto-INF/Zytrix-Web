# Stripe + Zy Coins — integração segura

Status: **implementada na branch `stripe-zycoins`, ainda não ativada em produção**.

O fluxo real substitui o pedido demonstrativo de usuários comuns por Stripe Checkout hospedado. O modo `admin_demo` permanece separado apenas para demonstração acadêmica.

## Arquitetura

1. Usuário autenticado escolhe um pacote de Zy Coins.
2. O navegador envia somente `packageId` + Firebase ID token para `/api/create-checkout-session`.
3. O backend valida o token e seleciona preço, quantidade e Stripe Price ID por uma tabela confiável no servidor.
4. O backend cria `zyCoinOrders/{orderId}` e uma Stripe Checkout Session.
5. O usuário paga no Checkout hospedado pelo Stripe.
6. O retorno para `/pagamento?checkout=success` é apenas informativo e **não libera moedas**.
7. `/api/stripe-webhook` verifica a assinatura Stripe e valida valor, moeda, UID, pacote, order ID e session ID.
8. Uma transação do Firestore credita a carteira, registra `zyCoinTransactions/{orderId}` e marca o pedido como pago.
9. Reenvios do mesmo webhook são idempotentes: um pedido já `paid` não recebe crédito novamente.

## Pacotes Stripe de teste

| Package ID | Zy Coins | Valor | Stripe test Price ID |
| --- | ---: | ---: | --- |
| `zy100` | 100 | R$ 4,90 | `price_1UDS0KQz853TlIRbSg7UJCAV` |
| `zy500` | 500 | R$ 14,90 | `price_1UDS0QQz853TlIRbsyyxrgUN` |
| `zy1200` | 1.200 | R$ 29,90 | `price_1UDS0WQz853TlIRbS78FwjlX` |
| `zy2500` | 2.500 | R$ 49,90 | `price_1UDS0dQz853TlIRbS8tDl4iS` |

Esses IDs pertencem ao **modo de teste** da conta Stripe Zytrix. Não usar em produção/livemode.

## Variáveis obrigatórias na Vercel

Configurar no projeto `zytrix-web` sem gravar os valores no GitHub/Figma:

```text
STRIPE_SECRET_KEY=sk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...
FIREBASE_PROJECT_ID=zytrix-ca4f2
FIREBASE_CLIENT_EMAIL=<service-account-email>
FIREBASE_PRIVATE_KEY=<private-key-completa>
SITE_URL=https://zytrix-lives.vercel.app
```

Opcional, para domínios personalizados adicionais que precisam iniciar Checkout:

```text
ALLOWED_CHECKOUT_ORIGINS=https://seu-dominio.example,https://outro-dominio.example
```

`FIREBASE_PRIVATE_KEY` pode ser armazenada pela Vercel com quebras de linha reais ou com `\n`; o helper do servidor normaliza o segundo formato.

## Webhook Stripe

Depois que as funções estiverem implantadas, criar no Stripe um endpoint apontando para:

```text
https://zytrix-lives.vercel.app/api/stripe-webhook
```

Eventos necessários:

- `checkout.session.completed`
- `checkout.session.async_payment_succeeded`
- `checkout.session.async_payment_failed`
- `checkout.session.expired`

Copiar o signing secret `whsec_...` fornecido pelo Stripe para `STRIPE_WEBHOOK_SECRET` na Vercel e fazer novo deploy.

## Formas de pagamento

O Checkout usa métodos dinâmicos do Stripe. Não confiar em um seletor de cartão/PIX implementado no navegador.

Na configuração Stripe auditada em modo de teste em 08/09/2026:

- cartão: disponível e ligado;
- Apple Pay: disponível;
- PIX: indisponível/desligado na conta naquele momento;
- Google Pay: indisponível;
- boleto: indisponível.

Para PIX, revisar **Stripe Dashboard → Settings → Payment methods → Pix** e concluir qualquer requisito de elegibilidade/ativação da conta. O código não deve tentar forçar um método que o Stripe informa como indisponível.

## Teste mínimo antes do merge

1. Implantar a branch/pacote em ambiente de teste com todas as variáveis.
2. Fazer login como usuário comum do Zytrix.
3. Comprar `zy100` usando cartão de teste do Stripe.
4. Confirmar que o navegador é redirecionado ao Checkout hospedado.
5. Confirmar que retornar para `checkout=success` sozinho não altera o saldo.
6. Confirmar recebimento de `checkout.session.completed` no webhook.
7. Confirmar `zyCoinOrders/{orderId}.status == "paid"`.
8. Confirmar incremento de exatamente 100 moedas na carteira.
9. Confirmar criação de `zyCoinTransactions/{orderId}` com `type: "purchase"` e `source: "stripe"`.
10. Reenviar o mesmo evento pelo Stripe e confirmar que o saldo não aumenta novamente.
11. Testar checkout cancelado e sessão expirada.
12. Testar package ID inválido e requisição sem Firebase ID token.
13. Confirmar rate limit após tentativas excessivas.

## Regras de segurança antes do merge final

O backend Firebase Admin ignora Firestore Security Rules, portanto as regras do cliente devem ser endurecidas no rollout final:

- usuário comum não pode criar/atualizar pedido Stripe diretamente;
- usuário pode ler somente os próprios pedidos quando necessário;
- administrador pode manter o fluxo `admin_demo` se ele ainda for necessário para o TCC;
- cliente nunca pode aumentar o próprio saldo por compra;
- compras Stripe e transações `purchase` são escritas exclusivamente pelo backend/webhook.

Não publicar regras novas antes do backend estar funcional, para não quebrar o fluxo demonstrativo atualmente em produção.

## Antes de ativar dinheiro real

- recriar/copiar os produtos e preços para **livemode** e substituir os test Price IDs no backend;
- trocar `STRIPE_SECRET_KEY` para chave live e criar webhook live separado;
- concluir cadastro e requisitos da conta Stripe;
- revisar política de reembolso, chargebacks/disputas e reversão de Zy Coins;
- revisar Termos/Privacidade para refletir pagamentos reais em vez de apenas protótipo;
- revisar obrigações fiscais e Stripe Tax antes de coletar impostos;
- executar novamente testes de idempotência, fraude, race condition e crédito duplicado.

## Arquivos da integração

- `api/create-checkout-session.js`
- `api/stripe-webhook.js`
- `server/firebase-admin.js`
- `server/zycoins.js`
- `assets/js/pagamento.js`
- `package.json`
- `.github/workflows/export-vercel-site.yml`

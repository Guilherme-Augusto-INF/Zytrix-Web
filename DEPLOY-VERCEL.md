# Deploy do Zytrix na Vercel

Este diretório já contém `vercel.json` para publicação como site estático.

## Firebase Authentication
Depois que o domínio final da Vercel for criado, adicione esse domínio em:
Firebase Console → Authentication → Settings → Authorized domains.

Exemplo: `zytrix-tcc.vercel.app`.

## Firestore Rules
As regras estão em `firestore.rules` e `firebase/firestore.rules`. A Vercel não publica regras do Firestore; publique-as separadamente no Firebase Console ou Firebase CLI.

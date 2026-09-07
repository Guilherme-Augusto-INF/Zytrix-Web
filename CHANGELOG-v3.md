# Zytrix v3 — Twitch + Kick

Principais mudanças:

- suporte a Twitch e Kick com detecção automática pela URL;
- novo módulo `assets/js/streaming.js`;
- `perfil.js` aceita link da Twitch ou Kick ao criar conta streamer;
- `config-live.js` permite trocar a plataforma/canal e salva a URL canônica;
- `live.js` monta o player correto de Twitch ou Kick;
- badges de plataforma nos cards e na página da live;
- chat em tempo real preservado;
- moderação de chat preservada e endurecida;
- streamer não pode banir/silenciar/remover mensagem de administrador;
- regras do Firestore atualizadas;
- CSS limpo: removidas duplicações e sequências literais `\\n`;
- HTML/JS/CSS reorganizados para leitura em múltiplas linhas;
- arquivos verificados por servidor local e checagem de sintaxe ES Modules.

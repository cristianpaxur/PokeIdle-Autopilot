# IdleBot

Para instalar no computador do usuário, execute `scripts/install-windows.ps1` no Windows onde o IdleBot deve rodar. Acompanhe o script até o painel ficar saudável e a página do QR abrir. O [guia de instalação](docs/instalacao.md) descreve o fluxo.

- O instalador inicia o Docker, prepara o monitor pelo túnel e abre o QR. O celular escaneia o código e abre o monitor pelo navegador.
- A pessoa entra em cada conta do PokeIdle.io e responde às confirmações de primeira execução que o Windows ou o Docker exibirem. Retome a instalação quando o sistema estiver pronto.
- Guarde a senha do painel em `.env.docker`. Entregue o endereço e indique onde o usuário pode consultar a senha localmente. Mantenha senhas, perfis de navegador e bancos de dados fora do Git e do chat.
- Para reabrir o código, use **QR do celular** no painel local. O QR dá acesso à visualização, portanto mantenha-o no computador do usuário. Se faltar acesso ao celular, verifique a resposta HTTPS do monitor e descreva o que foi testado.
- Para desenvolvimento, rode `npm ci` e `npm test` com Node.js 24 ou mais recente. Os testes de navegador usam o Edge instalado.

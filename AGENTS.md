# IdleBot

Para um pedido de instalação no computador do usuário, siga o [guia de instalação](docs/instalacao.md). Use o script `scripts/install-windows.ps1` e confirme que o Docker deixou o serviço saudável. Trabalhe no Windows onde o IdleBot deve rodar.

- Para acesso pelo celular, use **Tailscale Serve** e passe o endereço HTTPS exibido pelo comando ao script com `-RemoteOrigin`. Preserve configurações de outros serviços no Tailscale.
- A pessoa faz os logins do Tailscale e do PokeIdle.io e responde às verificações que os aplicativos exibirem. Continue a instalação depois de cada login necessário.
- Guarde a senha do painel em `.env.docker`. Entregue o endereço e indique onde o usuário pode consultar a senha localmente. Mantenha senhas, perfis de navegador e bancos de dados fora do Git e do chat.
- Abra o endereço HTTPS no PC e mostre **QR do celular**. Confirme com a pessoa se o painel abriu pelo 4G ou 5G. Se faltar acesso ao celular, descreva o ponto da instalação que foi verificado.
- Para desenvolvimento, rode `npm ci` e `npm test` com Node.js 24 ou mais recente. Os testes de navegador usam o Edge instalado.

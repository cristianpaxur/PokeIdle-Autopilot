# Instalar o IdleBot

## Windows

[Baixe o ZIP do projeto](https://github.com/cristianpaxur/PokeIdle-Autopilot/archive/refs/heads/main.zip), extraia a pasta e abra **Instalar IdleBot.cmd**. O instalador inicia o Docker Desktop, baixa o que for necessário e abre o QR code no PC quando o monitor estiver disponível.

Escaneie com a câmera do celular. O monitor abre no navegador, inclusive pelo 4G ou 5G. Ele mostra os avisos, as métricas da fase de caça e os anúncios em aberto por perfil. Quando a transmissão estiver disponível, ela aparece abaixo dos dados do perfil.

## Pedir a instalação a uma IA

Envie o link do repositório a uma IA que tenha acesso ao computador de destino e use este pedido.

> Baixe este repositório no meu Windows, execute o instalador do IdleBot e deixe o QR do celular aberto. Siga o AGENTS.md e acompanhe a instalação até o painel e o monitor responderem.

A IA também pode executar o instalador pelo PowerShell na pasta do repositório.

```powershell
.\scripts\install-windows.ps1
```

## Abrir o painel do PC

Abra [o painel local](http://127.0.0.1:4097) com o usuário `idlebot` e a senha que o instalador guardou em `.env.docker`. Para ver o código novamente, clique em **QR do celular**, ao lado de **Ver 4 telas**. Guarde o QR para uso próprio, pois ele dá acesso à visualização.

No primeiro uso de cada perfil, abra **Ações → Operação → Assumir controle**, entre com a sua conta do PokeIdle.io e clique em **Devolver ao robô** quando o jogo carregar. Se o Windows ou o Docker pedir uma confirmação de primeira execução ou reinício, conclua essa etapa e reabra o instalador. [Requisitos do Docker Desktop](https://docs.docker.com/desktop/setup/install/windows-install/)

O PC e o Docker precisam permanecer ligados para o monitor funcionar. O endereço HTTPS é temporário. Se mudar após uma reconexão ou reinício, abra **QR do celular** no painel e escaneie o código atualizado. [Quick Tunnels da Cloudflare](https://developers.cloudflare.com/tunnel/get-started/quick-tunnels/)

## Configurar a aplicação no Dokploy

1. Crie uma **Application** a partir deste repositório, na branch `main`. Selecione **Dockerfile** como **Build Type**, com **Dockerfile Path** `Dockerfile` e **Docker Context Path** `.`. Deixe **Docker Build Stage** em branco. [Configuração de build](https://docs.dokploy.com/docs/core/applications/build-type#dockerfile)
2. Em **Environment**, configure `IDLEBOT_ORIGIN` com a URL HTTPS exata do painel, como `https://idlebot.example.com`, e `IDLEBOT_PASSWORD` com uma senha forte de pelo menos 12 caracteres. Adicione a senha como variável de execução da aplicação. A origem deve conter só protocolo, domínio e porta, se houver.
3. Em **Domains**, adicione o mesmo domínio, use o caminho `/`, defina **Container Port** como `4096` e habilite **HTTPS** com um certificado válido. O proxy do Dokploy encaminha o painel e as conexões WebSocket pela mesma origem. Use o domínio para acessar o painel. [Domínios no Dokploy](https://docs.dokploy.com/docs/core/domains)
4. Em **Advanced → Volumes/Mounts**, adicione um **Volume Mount** chamado `idlebot-data` no caminho `/data`. Mantenha uma réplica e use a ordem `stop-first` nas atualizações para evitar que duas instâncias abram o mesmo banco e os mesmos perfis ao mesmo tempo. Configure 25 segundos de prazo para encerrar o contêiner. Em instalações com múltiplos nós, mantenha a aplicação no nó que possui o volume. [Volumes e opções do Swarm](https://docs.dokploy.com/docs/core/applications/advanced)
5. Clique em **Deploy** e abra o domínio configurado. Entre com o usuário `idlebot` e a senha de **Environment**. No cartão de cada perfil, abra **Ações → Operação → Assumir controle** para entrar no jogo. Clique em **Devolver ao robô** quando terminar.

O healthcheck da imagem consulta `/health` pela interface interna `127.0.0.1:4096` e espera HTTP `204`. Se o painel retornar `403` pelo domínio, confira se o endereço aberto é o mesmo de `IDLEBOT_ORIGIN`, incluindo a porta, se houver.

O volume `/data` armazena o banco SQLite, os perfis Chromium e o arquivo opcional `/data/idlebot.local.json`. Preserve esse volume ao atualizar. Caso use uma pasta do host como bind mount, ela precisa permitir escrita pelo UID e GID `1000` do contêiner.

O botão **QR do celular** continua usando um túnel temporário da Cloudflare para o monitor somente leitura. Ele depende de conectividade de saída do servidor e aparece quando o túnel estiver disponível.

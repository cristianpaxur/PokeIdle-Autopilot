# Instalar o IdleBot no Windows

[Baixe o ZIP do projeto](https://github.com/cristianpaxur/PokeIdle-Autopilot/archive/refs/heads/main.zip), extraia a pasta e abra **Instalar IdleBot.cmd**. O instalador inicia o Docker Desktop, baixa o que for necessário e abre o QR code no PC quando o monitor estiver disponível.

Escaneie com a câmera do celular. O monitor abre no navegador, inclusive pelo 4G ou 5G. Ele mostra as capturas, o progresso das vendas e as transmissões dos perfis que estiverem caçando. As telas ao vivo ficam no botão **Ver telas ao vivo**.

## Pedir a instalação a uma IA

Envie o link do repositório a uma IA que tenha acesso ao computador de destino e use este pedido.

> Baixe este repositório no meu Windows, execute o instalador do IdleBot e deixe o QR do celular aberto. Siga o AGENTS.md e acompanhe a instalação até o painel e o monitor responderem.

A IA também pode executar o instalador pelo PowerShell na pasta do repositório.

```powershell
.\scripts\install-windows.ps1
```

## Abrir o painel do PC

Abra [o painel local](http://127.0.0.1:4097) com o usuário `idlebot` e a senha que o instalador guardou em `.env.docker`. Para ver o código novamente, clique em **QR do celular**, ao lado de **Ver 4 telas**. Guarde o QR para uso próprio, pois ele dá acesso à visualização.

No primeiro uso de cada perfil, clique em **Assumir controle**, entre com a sua conta do PokeIdle.io e clique em **Devolver ao robô** quando o jogo carregar. Se o Windows ou o Docker pedir uma confirmação de primeira execução ou reinício, conclua essa etapa e reabra o instalador. [Requisitos do Docker Desktop](https://docs.docker.com/desktop/setup/install/windows-install/)

O PC e o Docker precisam permanecer ligados para o monitor funcionar. O endereço HTTPS é temporário. Se mudar após uma reconexão ou reinício, abra **QR do celular** no painel e escaneie o código atualizado. [Quick Tunnels da Cloudflare](https://developers.cloudflare.com/tunnel/get-started/quick-tunnels/)

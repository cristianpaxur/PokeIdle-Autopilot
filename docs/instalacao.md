# Instalar o IdleBot no Windows

O IdleBot roda no Docker Desktop com contêineres Linux. Cada instalação guarda o histórico e os perfis nos volumes do Docker. Para acessar pelo celular fora de casa, use o Tailscale no PC e no celular. [Docker Desktop para Windows](https://docs.docker.com/desktop/setup/install/windows-install/) · [Instalação do Tailscale](https://tailscale.com/docs/install)

## Pedir a instalação a uma IA

Envie o link do repositório à IA que tem acesso ao computador de destino e use este pedido.

> Baixe este repositório no meu Windows e instale o IdleBot. Siga o `AGENTS.md` e o guia `docs/instalacao.md`. Configure o acesso privado pelo celular com Tailscale Serve e mostre o QR code no painel. Avise quando eu precisar fazer login no Tailscale ou no jogo.

## Instalar e configurar o acesso pelo celular

1. Clone o repositório com Git ou baixe e extraia o ZIP do GitHub. Abra o PowerShell na pasta extraída, onde fica `compose.yaml`.
2. Instale e abra o Docker Desktop se ele ainda não estiver disponível. Confirme `docker compose version` e `docker info --format '{{.OSType}}'`. O segundo comando deve retornar `linux`. Se o Docker pedir WSL 2, atualização ou reinício, conclua a etapa indicada pelo instalador. [Pré-requisitos do Docker Desktop](https://docs.docker.com/desktop/setup/install/windows-install/)
3. Instale o Tailscale no Windows e no celular. Entre com a mesma conta nos dois aparelhos. Se usar o WinGet no Windows, os pacotes são `Docker.DockerDesktop` e `Tailscale.Tailscale`. [Download oficial do Tailscale](https://tailscale.com/download)
4. No PowerShell como administrador, confira `tailscale serve status`. Se a porta HTTPS 8443 estiver livre no Serve, execute o comando abaixo. Se já houver um proxy para o IdleBot, reutilize o endereço dele. Se a porta estiver ocupada por outro serviço, escolha outra e preserve o serviço existente. Aceite o HTTPS pelo link exibido se o Tailscale solicitar e repita o comando. [Tailscale Serve no Windows](https://tailscale.com/docs/reference/examples/serve)

   ```powershell
   tailscale serve --bg --https=8443 4097
   ```

   O `4097` é a porta local padrão do IdleBot. Se a instalação já usa `IDLEBOT_PORT` em `.env.docker`, informe essa porta no lugar de `4097`.

5. No PowerShell da pasta do projeto, execute o instalador com o endereço HTTPS mostrado pelo Tailscale, incluindo a porta quando houver. O script cria `.env.docker` e uma senha aleatória quando necessário, preserva a senha existente e inicia o serviço.

   ```powershell
   .\scripts\install-windows.ps1 -RemoteOrigin 'https://nome-do-pc.rede.ts.net:8443'
   ```

6. Abra o mesmo endereço HTTPS no PC. Use o usuário `idlebot` e a senha de `.env.docker`. Clique em **QR do celular** e escaneie o código com a câmera do celular com o Tailscale ativo. O código contém o endereço do painel. Entre com as mesmas credenciais do painel no navegador do celular.
7. Desligue o Wi-Fi do celular para confirmar o acesso pelo 4G ou 5G. Veja o progresso das vendas nos cartões ou abra **Ver 4 telas**. O PC precisa ficar ligado, com Docker Desktop e Tailscale ativos.

No primeiro acesso de cada perfil, use **Assumir controle**, entre na sua conta do PokeIdle.io e clique em **Devolver ao robô** quando o jogo carregar.

## Instalar para acesso local

Em uma instalação nova, execute `.\scripts\install-windows.ps1` sem parâmetros e abra [o painel local](http://127.0.0.1:4097). Para ativar o acesso pelo celular depois, repita o instalador com `-RemoteOrigin`. O mesmo endereço HTTPS passa a ser usado pelo PC e pelo celular.

Para voltar uma instalação remota à URL local, remova a linha `IDLEBOT_ORIGIN` de `.env.docker`, rode o instalador novamente e desative a porta do Serve usada para o IdleBot com `tailscale serve --https=8443 off`, ajustando a porta conforme o passo 4. [Desativar o Tailscale Serve](https://tailscale.com/docs/reference/tailscale-cli/serve#disable-tailscale-serve)

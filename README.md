# IdleBot

Painel local para até quatro contas próprias do PokeIdle.io. Usa o botão comum de captura, que está disponível para contas gratuitas.

Para instalar em outro Windows, pedir a instalação a uma IA ou configurar o QR code de acesso pelo celular, consulte o [guia de instalação](docs/instalacao.md).

## Rodar no Docker

Com o Docker Desktop iniciado, execute o instalador nesta pasta. Ele gera a senha do painel na primeira instalação.

```powershell
.\scripts\install-windows.ps1
```

Abra o [painel Docker](http://127.0.0.1:4097), use o usuário `idlebot` e a senha do arquivo `.env.docker`. O botão **Ver 4 telas** reúne as quatro transmissões. **Assumir controle** pausa o robô do perfil antes de liberar teclado e mouse. **Devolver ao robô** fecha o canal de controle e retoma o perfil. Se o painel for fechado no meio do controle, o perfil fica pausado. Abra o painel novamente e clique em **Devolver ao robô**.

Faça o primeiro login de cada conta pelo controle manual do respectivo perfil. Depois que o jogo carregar, devolva a sessão ao robô. O Docker mantém o histórico e os quatro perfis em volumes próprios. Para usar a configuração opcional descrita abaixo, copie `idlebot.local.json` para `/data/idlebot.local.json` no serviço `idlebot` e reinicie o serviço.

A porta do painel é publicada no endereço local do host. Para acessar de outro dispositivo, use o fluxo com Tailscale Serve do [guia de instalação](docs/instalacao.md). O painel mostra **QR do celular** quando aberto pelo endereço HTTPS configurado.

## Iniciar no Windows

Com Node.js 24 ou mais recente e Microsoft Edge instalado, execute nesta pasta.

```powershell
npm ci
npm start
```

Abra [o painel local](http://127.0.0.1:4096). Na primeira execução, abra o **Perfil 01** e autentique uma conta gratuita no navegador normal que abrir. Conclua a configuração inicial que o jogo pedir. Quando o jogo carregar, feche a janela do PokeIdle. O IdleBot reabre o mesmo perfil e retoma a sessão. Acompanhe uma captura no painel antes de abrir os outros perfis.

Se a sessão expirar, o perfil passa novamente pelo navegador normal. O botão **Entrar** reabre a janela de autenticação caso a anterior tenha sido fechada antes do login.

Depois de abrir um perfil, ele volta a iniciar nas próximas execuções do IdleBot. O Windows e o processo precisam continuar ativos para o jogo operar. **Fechar** desconecta o perfil. **Pausar** suspende as ações do IdleBot enquanto a janela continua aberta.

O painel escuta em `127.0.0.1`. Perfis de navegador, preferências e o histórico ficam em `%LOCALAPPDATA%\IdleBot`, fora da pasta sincronizada pelo OneDrive.

## Operação

- Cada perfil tem a meta de vender **20 Pokémon em Gemas** no Mercado da Comunidade. O painel mostra vendas confirmadas e anúncios em andamento. Ao atingir a meta, o bot fecha a sessão e conserva o progresso no próximo início do IdleBot.
- O robô começa em uma rota liberada e avança um patamar depois de observar um minuto de caça com pelo menos 12 abates. Se o Pokémon desmaiar duas vezes em até 90 segundos, tenta uma rota mais fácil e deixa a anterior em repouso por dez minutos. O bot respeita a espera do jogo entre as trocas. Usa o arremesso comum, as opções nativas de cura e retorno e repõe consumíveis com ouro acima da reserva.
- Se o jogo oferecer uma nova versão, o IdleBot usa o botão de atualização e retoma a sessão salva. A operação depende do Windows ligado e da sessão autenticada. O navegador normal abre quando o jogo exige novo login.
- O Mercado usa ao menos três vendas comparáveis em Gemas e estima o preço pela mediana. As comparações consideram espécie, shiny, potência, nível, qualidade e IV quando disponíveis. A interface do jogo decide a elegibilidade. O IdleBot protege Pokémon da equipe, iniciais e Pokémon marcados na Coleção.
- O anúncio automático usa o prazo mínimo mostrado pelo jogo e respeita o teto de custo de estadia. O app usa o extrato de vendas e a lista de anúncios para recuperar respostas perdidas e liberar vagas quando um Pokémon retorna ao estoque. Enquanto os anúncios já cobrem a meta restante, o IdleBot aguarda as compras e poupa Poké Bolas.
- O saque automático exige um endereço próprio para receber USDT na Solana. Um pedido pendente ou incerto bloqueia outro até o jogo confirmar o resultado. O jogo pode pedir revisão ou verificação de identidade.

Consulte o [guia do PokeIdle.io](docs/pokeidle.md) para os sistemas do jogo, as regras de venda e a relação com o IdleBot.

## Configuração opcional

Crie `idlebot.local.json` na raiz do projeto. O array `profiles` corresponde aos perfis 01 a 04. Os perfis omitidos usam os padrões. Reinicie o processo para aplicar mudanças.

```json
{
  "port": 4096,
  "channel": "msedge",
  "profiles": [
    {
      "autoStart": false,
      "hunt": "",
      "goldReserve": 10000,
      "maxListingFee": 100000,
      "marketEnabled": true,
      "withdrawal": {
        "enabled": false,
        "wallet": "",
        "maxGems": 1000,
        "reserveGems": 0,
        "intervalHours": 24
      }
    }
  ]
}
```

- `hunt` vazio ativa a progressão automática. Uma rota fixa usa o slug do jogo e mantém o perfil nela.
- `channel` também aceita `chrome`.
- Para ativar saques, informe `withdrawal.wallet` com o endereço público da sua carteira Solana e ajuste `enabled`. O jogo valida o destino na janela de saque. Use `maxGems` para limitar cada pedido.

## Verificação

```powershell
npm test
```

Os testes usam o Edge e páginas de teste locais para verificar os controles da captura e do anúncio. O teste de produção de captura, publicação e saque requer uma sessão autenticada e as condições correspondentes no jogo. Consulte as [regras do PokeIdle.io](https://pokeidle.io/terms).

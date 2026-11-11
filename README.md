<h1 align="center">PokeIdle Autopilot</h1>

<p align="center">
  <strong>Automatize a caça e as vendas no PokeIdle.io em até quatro contas próprias.</strong><br>
  Windows e Docker · Painel em português · Monitoramento pelo celular
</p>

<p align="center">
  <a href="#instalação">Instalar</a> ·
  <a href="#modos-de-caça">Modos de caça</a> ·
  <a href="#monitor-no-celular">Monitor no celular</a> ·
  <a href="docs/pokeidle.md">Guia do jogo</a>
</p>

<p align="center">
  <img src="docs/imagens/caca-pokeidle.gif" width="800" alt="Charmander se movimentando e enfrentando Metapod durante uma caça no PokeIdle.io">
</p>

## Instalação

1. Baixe e extraia o [ZIP do projeto](https://github.com/cristianpaxur/PokeIdle-Autopilot/archive/refs/heads/main.zip) no Windows.
2. Abra **Instalar IdleBot.cmd**. O instalador prepara o Docker Desktop e abre o QR do monitor quando ele estiver disponível.
3. Abra o [painel local](http://127.0.0.1:4097) com o usuário `idlebot` e a senha gerada no arquivo `.env.docker`, na pasta do projeto.
4. Em cada perfil que quiser usar, clique em **Assumir controle**, entre na sua conta do PokeIdle.io e clique em **Devolver ao robô** quando o jogo carregar.

Se o Windows ou o Docker pedir uma confirmação ou reinício, conclua a etapa e execute o instalador novamente. O [guia de instalação](docs/instalacao.md) também explica como pedir a instalação a uma IA com acesso ao PC.

<details>
<summary><strong>Instalar ou atualizar pelo Git</strong></summary>

No PowerShell, clone o repositório e execute o instalador.

```powershell
git clone https://github.com/cristianpaxur/PokeIdle-Autopilot.git
cd PokeIdle-Autopilot
.\scripts\install-windows.ps1
```

Para atualizar uma instalação feita pelo Git, execute na pasta do repositório.

```powershell
git pull --ff-only
.\scripts\install-windows.ps1
```

O instalador reconstrói o serviço Docker. As sessões de login e o histórico ficam nos volumes do Docker.

</details>

## Modos de caça

Escolha o **Modo de caça** em cada perfil. O painel salva a escolha entre sessões.

| Modo | O que o IdleBot faz |
| --- | --- |
| **Progressão e Outland** | Compara rotas liberadas pelo XP líquido do treinador por hora, treina um Pokémon principal e passa para a Outland quando o treinador chega ao nível 150. Na Outland, coleta tokens e fragmentos para venda. |
| **Shiny** | Caça em rotas comuns com espécies que têm forma shiny, repõe Poké Bolas e registra as capturas confirmadas pelo jogo. Pode anunciar os shinies que o bot capturou. |

O bot usa a mediana de pelo menos três vendas comparáveis para cotar os anúncios em Gemas. **Gemas líquidas/h** divide o valor das vendas confirmadas após a comissão pelo tempo medido de caça. As métricas de caça começam a acumular dados com esta versão. [Regras de venda e cálculo das métricas](docs/pokeidle.md#como-o-rendimento-é-medido)

## Painel

- **Caça** mostra a rota, o estado e a tela de cada perfil. Alterne entre **24 h** e **7 dias** para acompanhar tempo de caça, drops, encontros e vendas. Na progressão, abra **XP das hunts** para comparar rotas. Consulte **Atenção** quando um perfil precisar de ação ou estiver tentando se recuperar. No Docker, **Ver 4 telas** abre o mosaico.
- **Meus Pokémon** reúne os Pokémon da equipe, do Depot e da Coleção por perfil. Busque por nome, apelido ou ID e abra a ficha de um exemplar para ver seus atributos.
- **Mercado** consulta os anúncios ativos de itens e Pokémon, com filtros de busca e moeda e preços por unidade em Coins e Gemas. Deixe pelo menos um perfil conectado ao jogo sob controle do robô para consultar.

## Monitor no celular

Escaneie o QR que o instalador abre no PC. Pelo navegador do celular, acompanhe as métricas de cada perfil, os avisos e as transmissões disponíveis em modo somente leitura. O monitor funciona pelo Wi-Fi, 4G ou 5G enquanto o PC e o Docker estiverem ativos.

Clique em **QR do celular** no painel do PC para exibir o código novamente. Se o endereço temporário mudar, escaneie o código atualizado. Guarde o QR para uso próprio, pois ele dá acesso ao monitor.

## Configuração e desenvolvimento

<details>
<summary><strong>Configuração opcional por perfil</strong></summary>

Crie `idlebot.local.json` na raiz do projeto. O array `profiles` corresponde aos perfis 01 a 04. Os perfis omitidos usam os padrões.

```json
{
  "port": 4096,
  "channel": "msedge",
  "profiles": [
    {
      "autoStart": false,
      "mode": "farm",
      "hunt": "",
      "goldReserve": 10000,
      "maxListingFee": 100000,
      "marketEnabled": true,
      "minListingGems": 1,
      "repriceAfterHours": 0,
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

- Use `mode: "farm"` para progressão e Outland ou `mode: "shiny"` para captura. O padrão é `farm`. A escolha salva no painel tem prioridade.
- Informe em `hunt` o slug de uma rota preferida. Ela precisa estar liberada e servir à fase atual.
- `goldReserve` protege uma reserva de ouro. `maxListingFee` limita o custo de estadia de cada anúncio.
- Com `marketEnabled: false`, o perfil deixa de criar anúncios. Para ativar saques, use `withdrawal.enabled` e informe o endereço público de uma carteira Solana.
- `minListingGems` define o preço bruto mínimo, em Gemas, por unidade. O mínimo do próprio jogo continua valendo.
- `repriceAfterHours` define a idade mínima para revisar um anúncio do bot. O valor `0` desativa a retirada de anúncios ativos. Com a revisão ativa, o bot só solicita a retirada se a cotação cair pelo menos 10%, respeitar o preço mínimo e couber na reserva de ouro. A republicação aguarda a devolução confirmada pelo jogo.

No Docker, copie o arquivo para o volume do serviço e reinicie para aplicar.

```powershell
docker compose --env-file .env.docker cp idlebot.local.json idlebot:/data/idlebot.local.json
docker compose --env-file .env.docker restart idlebot
```

</details>

<details>
<summary><strong>Rodar sem Docker e executar os testes</strong></summary>

Com Node.js 24 ou mais recente e Microsoft Edge instalado, execute os comandos abaixo. A configuração aceita também o canal `chrome`.

```powershell
npm ci
npm start
```

Abra o [painel local](http://127.0.0.1:4096) e inicie o **Perfil 01**. Faça login na janela do jogo e feche-a depois que a sessão carregar. O IdleBot reabre o mesmo perfil e retoma a sessão. Os dados locais ficam em `%LOCALAPPDATA%\IdleBot`.

Para rodar os testes, use `npm test`. Os testes de navegador usam o Microsoft Edge e páginas de teste locais.

</details>

## Jogo e créditos

PokeIdle Autopilot é um projeto comunitário independente para contas próprias. As vendas dependem de compras de outros jogadores no Mercado da Comunidade. [Termos do PokeIdle.io](https://pokeidle.io/terms)

A animação mostra uma sessão no [PokeIdle.io](https://pokeidle.io/). A arte exibida no jogo pertence aos respectivos titulares.

# IdleBot

Painel local para até quatro contas próprias do PokeIdle.io. Usa o botão comum de captura, que está disponível para contas gratuitas.

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

- O robô escolhe uma rota disponível quando a conta está sem rota. Usa o arremesso comum e as opções nativas de cura e retorno. Reabastece consumíveis com ouro do jogo acima da reserva.
- O Mercado usa ao menos três vendas comparáveis em Gemas e estima o preço pela mediana. As comparações consideram espécie, shiny, potência, nível, qualidade e IV quando disponíveis. A interface do jogo decide a elegibilidade. O IdleBot protege Pokémon da equipe, iniciais e Pokémon marcados na Coleção.
- O anúncio automático usa o prazo mínimo mostrado pelo jogo e respeita o teto de custo de estadia. O painel distingue cotação, anúncio confirmado e venda registrada. Se a resposta de publicação se perder, o app verifica os anúncios e o extrato antes de qualquer nova publicação.
- O saque automático exige um endereço próprio para receber USDT na Solana. Um pedido pendente ou incerto bloqueia outro até o jogo confirmar o resultado. O jogo pode pedir revisão ou verificação de identidade.

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

- `hunt` vazio usa a rota atual ou a primeira rota liberada. Uma rota fixa usa o slug do jogo.
- `channel` também aceita `chrome`.
- Para ativar saques, informe `withdrawal.wallet` com o endereço público da sua carteira Solana e ajuste `enabled`. O jogo valida o destino na janela de saque. Use `maxGems` para limitar cada pedido.

## Verificação

```powershell
npm test
```

Os testes usam o Edge e páginas de teste locais para verificar os controles da captura e do anúncio. O teste de produção de captura, publicação e saque requer uma sessão autenticada e as condições correspondentes no jogo. Consulte as [regras do PokeIdle.io](https://pokeidle.io/terms).

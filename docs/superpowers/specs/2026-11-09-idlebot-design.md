# IdleBot

O IdleBot roda no Windows com até quatro perfis de navegador persistentes e um painel em português disponível apenas neste computador. Cada perfil usa a sessão de uma conta própria do PokeIdle.io. O usuário entra e conclui as verificações que o jogo exigir no navegador normal. Ao fechar a janela, o IdleBot retoma o mesmo perfil. O IdleBot guarda os perfis no diretório de dados locais do Windows.

## Caça

A sessão inicia ou retoma a região configurada, usa as opções nativas de cura e retorno à caça e repõe suprimentos com ouro do jogo acima de uma reserva configurável. O robô lança a Poké Bola pelo botão comum. Ele registra capturas confirmadas pelo servidor com o identificador do Pokémon, sem depender de VIP. Só um perfil pode operar cada conta.

## Mercado e saque

O robô avalia Pokémon capturados durante a operação. Ele usa vendas concluídas em Gemas de Pokémon da mesma espécie, condição shiny e potência comparável. O Pokémon permanece no estoque se as referências forem insuficientes ou se o jogo o considerar inelegível. A estimativa separa preço bruto, comissão e custo de estadia em ouro. Publicações e saques aguardam confirmação do jogo. Um resultado incerto bloqueia a repetição automática da operação.

O saque fica disponível por configuração local com endereço Solana explícito, limite por operação e intervalo mínimo. O cliente do jogo valida o endereço e o painel distingue pedido enviado de saque pago.

## Painel e critérios

O painel mostra a atividade de cada perfil, capturas, shinies, estoque cotado, anúncios, vendas líquidas e saques. O histórico local sobrevive ao reinício. Testes cobrem precificação, persistência, proteção contra duplicação e o fluxo simulado do navegador. A validação de produção começa com uma conta gratuita autenticada antes de habilitar operações financeiras nas quatro contas.

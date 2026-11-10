# PokeIdle.io e a meta de 20 vendas

Levantamento do cliente público 1.414.1, da Pokepédia integrada e dos Termos de Uso consultados em 9 de novembro de 2026. A Wiki fica no menu do jogo e reúne as regras detalhadas. Seus números variam com a versão e com os dados que o servidor envia. [Jogo e Pokepédia](https://pokeidle.io/app) · [Termos de Uso](https://pokeidle.io/terms)

## Da caça ao Mercado da Comunidade

| Etapa | Como funciona no jogo | Como o IdleBot usa |
| --- | --- | --- |
| Abrir uma rota | O nível do treinador libera as hunts. O Hunt Analyser estima XP e ouro e mostra tipos, fraquezas e drops. A luta progride enquanto a sessão está aberta. | Começa em uma rota liberada, progride depois de observar abates consistentes e recua quando ocorrem desmaios frequentes. Aceita uma rota fixa por perfil. |
| Manter a equipe | Um Pokémon ativo luta por vez. Se a equipe cair, o Centro Pokémon pode curá-la. Consumíveis e automações nativas ajudam a voltar à hunt. | Usa cura e retorno nativos e repõe suprimentos compráveis com ouro acima da reserva. |
| Capturar | O corpo permanece disponível por tempo limitado e aceita uma tentativa. Bola e estágio da espécie influenciam a chance. O nível da captura pode ser limitado pelo teto da espécie. | Usa o arremesso comum e grava o identificador informado pelo servidor quando a captura é confirmada. |
| Selecionar | A faixa padrão do Mercado exige nível 50 e nota 3,5. Shiny, P5, lendários e míticos têm exceções. A tela também verifica restrições como skin equipada e XP Share. | Avalia capturas registradas fora da equipe e preserva iniciais e Coleção. A tela nativa confirma a elegibilidade. |
| Cotar e publicar | A Tabela de preços registra compras concluídas, com filtros por tipo, moeda e características. Os Pokémon ficam sob custódia do Mercado durante o anúncio, com custo em ouro por dia. | Consulta até três páginas em Gemas. Exige três comparáveis distintos de espécie, shiny, potência, nível e, quando disponíveis, qualidade e IV. Publica pela mediana no prazo mínimo, dentro do teto de taxa e da reserva de ouro. |
| Vender | O comprador é outro jogador. A venda aparece no extrato pessoal com data e preço. Cancelamento e expiração podem devolver o Pokémon. | Cruza o extrato com os anúncios do próprio bot. Registra cada Pokémon uma vez, reconcilia anúncios em aberto e libera uma vaga quando o Pokémon voltou ao inventário. |

Fontes para as etapas acima. [Pokepédia integrada](https://pokeidle.io/pokepedia.mjs) · [Cliente do jogo](https://pokeidle.io/app.js?v=1.414.1) · [Página oficial](https://pokeidle.io/)

## Como a meta é medida

- Cada conta tem **20 vendas confirmadas em Gemas**. Uma venda conta quando o extrato de vendas da conta confirma o Pokémon e o preço de um anúncio registrado pelo IdleBot. Vendas de itens, em Coins, entre contas vinculadas ou sem registro de anúncio do bot ficam fora da meta.
- O bot consulta o extrato ao reconectar e durante a caça. Anúncios pendentes, incertos ou publicados ocupam vagas até o jogo confirmar a venda ou o retorno do Pokémon. A lista do jogo também informa quantos anúncios estão ocupando a vitrine.
- Quando os anúncios em aberto já cobrem as vendas restantes, o bot poupa Poké Bolas e acompanha o extrato. Ele pode voltar a capturar se uma vaga for liberada. Na 20ª venda registrada, fecha a sessão. O banco local preserva o progresso e o status de conclusão.
- Sessões novas precisam de login e configuração inicial. O jogo também pode exigir reautenticação ou aceite de termos. Disponibilidade de compradores, comparáveis, ouro e Pokémon elegíveis determina o ritmo de venda. Com `marketEnabled: false`, o perfil deixa de criar anúncios.

Os Termos permitem automação na caça e no Mercado dentro das mesmas regras do jogo, inclusive os limites de contas, de frequência e de negociação. [Termos de Uso](https://pokeidle.io/terms)

## Mapa da Pokepédia

| Área | Capítulos e mecânicas |
| --- | --- |
| Começo e progressão | Primeiros passos, níveis e XP, bônus de Twitch e Kick e Boost dos Atrasados. Inclui onboarding, time, Depot e progressão do treinador. |
| Ficha do Pokémon | Stats, qualidade, IV, nota, poder, potência I–V, shiny, lendários, míticos e Pokédex. Use a ficha para conhecer a espécie, nível de captura, raridade e atributos que afetam o preço. |
| Transformações e inventário | Evolução e pedras, Oferenda, Sacrifício, Mega Evolução, Chocadeira, Mystery Eggs e Ovo Shiny. Algumas escolhas consomem itens ou Pokémon de forma permanente. |
| Caça e combate | Combate, efetividade de tipos, Dias Sazonais, captura, desmaio, cura, automações, Mapa e Hunt Analyser. Rotas liberadas variam em dificuldade, rendimento e espécies. |
| Conteúdo avançado | Bosses, Arena Mística, Safári, casas com XP Share, bicicletas, Z-Moves e TMs de área. Tickets e outros requisitos dão acesso a atividades específicas. |
| Competição e comunidade | Guilds, PvP ranqueado e amistoso, treinamento, campeonatos, Showdown, ginásios, minigames e rankings. Configurações de tela, chat, amigos e Comércio completam a interface social. |
| Economia | Market do NPC para suprimentos e vendas próprias do jogo, Mercado da Comunidade para negociar com jogadores, Loja de Diamantes, indicações, votos, Discord, Passe de Batalha, Gemas e taxas. O extrato de vendas e a tabela de preços ficam no Mercado da Comunidade. |

Para os valores vigentes, consulte o capítulo correspondente e a tela do jogo. [Pokepédia integrada](https://pokeidle.io/pokepedia.mjs)

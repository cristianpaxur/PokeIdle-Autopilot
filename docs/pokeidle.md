# PokeIdle.io e o rendimento em Gemas

Levantamento do cliente público 1.414.1, da Pokepédia integrada e dos Termos de Uso consultados em 9 de novembro de 2026. A Wiki fica no menu do jogo e reúne as regras detalhadas. Seus números variam com a versão e com os dados que o servidor envia. [Jogo e Pokepédia](https://pokeidle.io/app) · [Termos de Uso](https://pokeidle.io/terms)

## Da caça ao Mercado da Comunidade

| Etapa | Como funciona no jogo | Como o IdleBot usa |
| --- | --- | --- |
| Abrir uma rota | O nível do treinador libera as hunts. O Hunt Analyser estima XP e ouro e mostra tipos, fraquezas e drops. A luta progride enquanto a sessão está aberta. | Treina o Pokémon principal até liberar a Outland no nível 150. Na progressão, prioriza hunts liberadas e seguras com vantagem de tipo, inclusive de nível menor. Se nenhuma estiver disponível, usa as demais rotas seguras. O modo Shiny usa as rotas comuns que têm espécies com forma shiny. |
| Manter a equipe | Um Pokémon ativo luta por vez. Se a equipe cair, o Centro Pokémon pode curá-la. Consumíveis e automações nativas ajudam a voltar à hunt. | Usa cura e retorno nativos e repõe suprimentos compráveis com ouro acima da reserva. |
| Capturar | O corpo permanece disponível por tempo limitado e aceita uma tentativa. Bola e estágio da espécie influenciam a chance. O nível da captura pode ser limitado pelo teto da espécie. | No modo Shiny, usa a captura do jogo e grava o identificador informado pelo servidor quando a captura é confirmada. |
| Selecionar | A faixa padrão do Mercado exige nível 50 e nota 3,5. Shiny, P5, lendários e míticos têm exceções. A tela também verifica restrições como skin equipada e XP Share. | Avalia capturas registradas fora da equipe e preserva iniciais e Coleção. A tela nativa confirma a elegibilidade. |
| Cotar e publicar | A Tabela de preços registra compras concluídas, com filtros por tipo, moeda e características. Os Pokémon ficam sob custódia do Mercado durante o anúncio, com custo em ouro por dia. | Na Outland, cota Bronze Boss Token e fragmentos de Chave, Bicicleta e Shiny Stone e anuncia uma unidade por vez. No modo Shiny, cota shinies capturados pelo bot. Usa a mediana de pelo menos três vendas comparáveis. |
| Vender | O comprador é outro jogador. A venda aparece no extrato pessoal com data e preço. Cancelamento e expiração podem devolver o produto. | Cruza o extrato com os anúncios do bot e usa o valor líquido de vendas confirmadas para calcular o rendimento. |

Fontes para as etapas acima. [Pokepédia integrada](https://pokeidle.io/pokepedia.mjs) · [Cliente do jogo](https://pokeidle.io/app.js?v=1.414.1) · [Página oficial](https://pokeidle.io/)

## Como o rendimento é medido

- **Gemas líquidas/h** divide o valor após a comissão de anúncios da estratégia vendidos em Gemas pelo tempo acumulado de caça da conta, incluindo a progressão e o modo Shiny. A medição começa com esta versão e exclui tempo pausado, desconectado ou sob controle manual.
- O bot consulta o extrato ao reconectar e durante a caça. Vendas em Coins, entre contas vinculadas ou sem correspondência com um anúncio do bot ficam fora da taxa. O banco local guarda o tempo de caça e as vendas entre reinícios.

O painel usa as medições da fase ativa nas últimas 24 horas ou sete dias, agrupadas por hora. Na Outland, conta os tokens e fragmentos confirmados em combate. No Shiny, conta como encontro elegível cada selvagem derrotado cuja espécie tenha uma forma shiny. O custo de suprimentos usa as bolas, poções e revives consumidos e seus preços de referência em ouro. Esses indicadores passam a acumular dados com a atualização.

O bot compara as rotas Shiny depois de pelo menos seis minutos de caça por rota. Na Outland, testa tiers liberados e compara drops depois de pelo menos vinte minutos por rota. Desmaios e consumo de suprimentos reduzem a pontuação de uma rota. Quando uma conta fica três minutos sem abates ou progresso de XP, o bot tenta retomar a rota, escolher uma alternativa segura e, se necessário, recarregar a sessão.

## Comparação de XP na progressão

O bot testa hunts liberadas com vantagem de tipo em janelas de 90 segundos. Compara o ganho líquido de XP do treinador por hora para acelerar a liberação da Outland e registra também o XP do Pokémon principal. Perdas de XP e tempo no Centro após desmaios entram na conta. As rotas bloqueadas por desmaios frequentes saem da seleção.

Depois de testar até três candidatas, permanece cinco minutos na melhor medida antes de explorar outras. Reutiliza medições recentes de até 30 minutos, com o mesmo Pokémon e configuração e nível semelhante. Pausas, desconexões e controle manual encerram a janela em andamento. O painel mostra as observações em **XP das hunts**, e o banco local guarda as janelas concluídas para os próximos reinícios.
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

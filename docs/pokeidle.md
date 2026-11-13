# PokeIdle.io e o rendimento em Gemas

Levantamento do cliente público 1.414.1, da Pokepédia integrada e dos Termos de Uso consultados em 9 de novembro de 2026. A Wiki fica no menu do jogo e reúne as regras detalhadas. Seus números variam com a versão e com os dados que o servidor envia. [Jogo e Pokepédia](https://pokeidle.io/app) · [Termos de Uso](https://pokeidle.io/terms)

## Da caça ao Mercado da Comunidade

| Etapa | Como funciona no jogo | Como o IdleBot usa |
| --- | --- | --- |
| Abrir uma rota | O nível do treinador libera as hunts. O Hunt Analyser estima XP e ouro e mostra tipos, fraquezas e drops. A luta progride enquanto a sessão está aberta. | Treina o Pokémon principal até liberar a Outland no nível 150. Na progressão, prioriza hunts liberadas e seguras com vantagem de tipo, inclusive de nível menor. Se nenhuma estiver disponível, usa as demais rotas seguras. O modo Shiny usa as rotas comuns que têm espécies com forma shiny. |
| Manter a equipe | Um Pokémon ativo luta por vez. Se a equipe cair, o Centro Pokémon pode curá-la. Consumíveis e automações nativas ajudam a voltar à hunt. | Usa cura e retorno nativos e repõe suprimentos compráveis com ouro acima da reserva. |
| Capturar | O corpo permanece disponível por tempo limitado e aceita uma tentativa. Bola e estágio da espécie influenciam a chance. O nível da captura pode ser limitado pelo teto da espécie. | Permite desligar a captura, capturar somente no modo Shiny ou em qualquer hunt, com filtro de espécies e bola automática ou fixa. Grava o identificador informado pelo servidor quando a captura é confirmada. |
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

## Planejador por conta

O planejador também mantém uma estratégia autônoma de progressão, equipe e rendimento, com recompensas, casas, bicicletas, XP Share, Mystery Eggs e reservas de recursos. As rotinas vêm ligadas por padrão. Consulte o [mapa completo de decisões, protocolos conferidos e cobertura de cada sistema](estrategia.md).

Em cada perfil, **Planejador** permite ajustar compra e uso de poções e revives, reserva de ouro, limite de gasto nas últimas 60 minutos, estoque desejado em minutos, limiar de HP, evolução automática, busca de pedras e prioridade durante eventos. As preferências ficam no banco local e sobrevivem à atualização do Docker.

O planejador primeiro verifica cura e suprimentos. Escolhe a poção pelo HP máximo e pelo custo da cura útil, mantendo opções de reserva na fila nativa. A quantidade considera o consumo observado, com estoque inicial mínimo e teto de 500 unidades por item de reposição. Poções fracas não substituem o estoque de cura adequada quando há uma opção viável. Cada compra tem intenção persistida antes do envio; confirmação pelo evento do jogo ou pelo inventário. Uma resposta ausente mantém o custo reservado e impede novo pedido até receber inventário recente, após dois minutos.

Na estratégia Farm, mantém o Pokémon principal. Se nível e pedra estiverem disponíveis, solicita a evolução e confirma pela mudança de espécie. Sem pedra, procura hunts liberadas de espécies que soltam o item, começando por níveis menores; essa busca não exige vantagem de tipo. Dois desmaios bloqueiam a rota por dez minutos. Cada tentativa tem um limite configurável de tempo de caça; ao atingir o limite, volta à progressão por dez minutos antes de tentar novamente. A busca de pedra não entra no ranking de XP das hunts.

As evoluções automáticas cobrem cadeias determinísticas de Kanto e Johto com requisitos conhecidos, incluindo Charmander, Squirtle e Bulbasaur. Evoluções ramificadas, shiny, variantes Outland e casos dependentes de regras não resolvidas de outra geração/teto de captura ficam fora da ação automática. Pedras são obtidas na caça: esta etapa não compra pedras nem gasta Gemas ou sacrifica Pokémon.

Os eventos globais de XP já se aplicam automaticamente. O bot lê os multiplicadores publicados pelo servidor, suas fontes e vencimentos, e o dia sazonal. Com **Priorizar XP durante eventos temporários**, adia a busca de pedra durante um bônus global de XP do treinador; uma evolução com pedra já disponível continua prioritária. VIP e outros bônus permanentes não adiam a busca. Início, fim e mudanças de bônus ou dia sazonal reiniciam a comparação de hunts para não misturar condições diferentes. Ginásios, bosses e Safári também são adiados durante o evento, salvo quando **Permitir atividades durante eventos de XP** estiver ligado. PvP ranqueado e raid semanal podem continuar em paralelo à caça. Guerras de guilda e eventos externos seguem sem executor.

O motivo da decisão fica visível no cartão e no monitor do celular. Dentro do planejador aparecem estoque, gasto reservado, evolução, bônus e a última ação com seu estado de confirmação. Pausas e controle manual impedem ações; a preferência de pausa sobrevive à reinicialização.

Regras conferidas no cliente público 1.420.0 em 12/11/2026: [Pokepédia](https://pokeidle.io/pokepedia.mjs), [ramificações e pedras](https://pokeidle.io/shared/evolucoes-ramificadas.mjs), [ajustes de evolução](https://pokeidle.io/shared/evolucoes-cruzadas.mjs).

## Captura e escolha de bolas

Em **Ações → Preferências → Captura**, cada conta escolhe **Desligada**, **Somente no modo Shiny** ou **Em qualquer hunt**. O padrão continua sendo somente no modo Shiny. É possível capturar todas as espécies elegíveis ou selecionar uma lista com busca por nome. A seleção vale para os encontros da hunt atual; não muda a escolha da hunt. No modo de captura somente Shiny, espécies sem versão shiny ficam de fora. Seleção vazia não significa capturar todas.

O modo **Automático: custo-benefício** calcula a chance base por espécie com os parâmetros enviados pelo servidor e o helper oficial de raridade/degrau. Considera o alvo caído, aplica piso e teto do jogo e compara `preço em ouro / chance`. Só usa bolas compráveis com ouro que atendem à chance mínima e ao teto de preço. Os padrões são chance mínima de **0,5%** (ajustável com até duas casas decimais) e teto de **10.000 ouro por bola**. Dados ausentes ou nenhuma bola adequada impedem o arremesso; o painel explica o motivo. A estimativa não inclui bônus temporários, pity shiny nem representa lucro em Gemas ou garantia de captura.

No modo **Bola fixa**, usa exatamente a bola selecionada e pode usar uma bola premium já existente no estoque. Se acabar, não substitui por outra. A opção **Comprar bolas automaticamente** repõe as bolas escolhidas apenas com ouro, obedecendo reserva, limite de gasto por hora e teto de preço por bola. Um estoque grande de bolas fracas não conta como estoque da escolhida. Se uma reposição excede o orçamento, outra bola adequada para outra espécie ainda pode ser reposta.

O robô desliga os arremessos automáticos nativos enquanto controla a conta para que eles não ignorem o filtro. Antes de arremessar, seleciona a bola no jogo, confere o alvo e revalida modo, estoque, pausa, conta e conexão. **Ações → Planejador** apresenta a bola avaliada para cada espécie, a chance base, o custo estimado por captura e o último resultado confirmado.

Regras conferidas em 13/11/2026: [cliente e tabela de captura](https://pokeidle.io/app.js), [fator por degrau e raridade](https://pokeidle.io/shared/captura-degrau.mjs).

## Ginásios e bosses

O painel separa as opções de suprimentos, progressão, ginásios e bosses. As avaliações de ambos os sistemas ficam disponíveis mesmo quando o objetivo atual é XP ou busca de pedra. Um limite de tentativas considera todas as intenções nas últimas 24 horas móveis, incluindo pendências e respostas incertas, e permanece salvo ao reiniciar.

Os ginásios deste servidor são PvP assíncronos a partir do nível 150. O benefício é dano adicional para Pokémon do tipo correspondente: 25%, 10% e 5% para os três primeiros lugares; dois tipos usam o maior bônus, sem somar. O bot considera os tipos do principal e só age para melhorar seu bônus. Monta até cinco espécies distintas entre os Pokémon disponíveis, mantendo os registrados em outro ginásio. O registro não retira o Pokémon da hunt. O poder é calculado pelo helper oficial do jogo, no nível comprimido da arena, e a formação usa o posicionamento automático oficial.

O bot pode registrar uma equipe para alcançar o pódio, assumir um ginásio vazio ou desafiar um líder quando o poder supera a margem configurada. Confirma o registro e relê o painel antes de desafiar. Não retira lideranças automaticamente. A margem de força é um critério conservador, não probabilidade de vitória: tipos e formação do adversário também influenciam a luta. O cooldown oficial de cada tipo é de 24 horas. Resultado é confirmado por `ginasio.desafio`, distinguindo vitória de transferência de liderança; resposta ausente bloqueia repetição automática.

Os bosses jogáveis atuais começam no nível 300. O bot lê requisito do treinador, nível recomendado por membro, tamanho ideal da equipe e custo da ficha no catálogo recebido do jogo. Um Pokémon forte não compensa os demais abaixo do nível: o jogo calcula penalidade por membro. Exige a margem individual configurada, HP de pelo menos 80% em todos, vantagem ofensiva do principal e ausência de fraqueza defensiva. Usa somente fichas acima da reserva e nunca compra fichas nem gasta Gemas nessa atividade. Drops são incertos; elegibilidade não representa lucro em Gemas previsto.

Cada boss é uma tentativa isolada: confirma a repetição nativa desligada antes de entrar, acompanha resultado e prazo, cura no Centro e confirma o retorno à hunt. A repetição nativa do jogo continua até após derrotas e desconexões; por isso não é usada pelo planejador. Ao atingir o prazo, solicita a saída, sem devolução da ficha. Derrota ou resultado incerto adia esse boss por 24 horas. Pausa/controle manual impedem novos comandos; uma batalha já enviada ao servidor pode continuar enquanto o robô está pausado.

Padrões: ginásios e bosses ligados; até duas tentativas de cada nas últimas 24 h; margem de força de ginásio de 25%; nível individual de 120% do recomendado para boss; uma ficha de reserva; duração máxima de dez minutos; atividades durante eventos de XP desligadas. Shiny mantém seu objetivo e não inicia essas atividades. Batalhas de boss não entram nas métricas das hunts; mudanças no bônus de ginásio reiniciam a comparação de XP.

Fontes oficiais 1.420.0: [ginásios e força](https://pokeidle.io/shared/ginasios.mjs), [formação do tabuleiro](https://pokeidle.io/shared/pvp-tabuleiro.mjs), [catálogo de bosses](https://pokeidle.io/shared/bosses-lendarios.mjs), [Pokepédia e regras de repetição](https://pokeidle.io/pokepedia.mjs), [protocolo do cliente](https://pokeidle.io/app.js?v=1.420.0).

## PvP, Safári e raids

Os três modos vêm ligados e são avaliados automaticamente. O PvP ranqueado exige nível 150, tem formação independente e mantém a caça enquanto espera adversário. Por padrão, o bot limita a 12 buscas/24 h, cancela filas após três minutos e descansa uma hora após duas derrotas seguidas.

O Safári usa um ticket próprio por 24 h quando existem ao menos três alvos úteis, vagas e 40 bolas apropriadas. Prioriza coleção e possíveis melhorias utilizáveis, repõe dentro do orçamento e confirma a saída e a volta à caça. Mesmo que a captura comum esteja configurada com bola premium fixa, o Safári automático só considera bolas compráveis com ouro.

A raid semanal usa o calendário e o custo oficiais, mantém uma ficha de reserva e inscreve uma vez por edição. Prepara a equipe pelo poder no nível real; a batalha e o eventual bônus acontecem no servidor. O bot continua caçando durante a espera. Consultas e resultados reconciliam as intenções persistidas para evitar gastos repetidos após desconexão.

Veja [critérios, recuperação e fontes oficiais](estrategia.md#pvp-safári-e-raid-semanal). Os ajustes opcionais ficam em **Preferências → Ginásios e bosses**; a participação não depende de abrir ou salvar essa tela.

## Limites de operação

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

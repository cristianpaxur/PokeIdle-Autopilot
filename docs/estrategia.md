# Estratégia autônoma da conta

O objetivo padrão é **equilibrar progressão, equipe e rendimento**. As rotinas novas vêm ligadas; não é necessário configurar o painel para usá-las. O bot observa a conta conectada, escolhe uma melhoria aplicável, grava a intenção, envia a ação e confirma o efeito no jogo. A caça continua quando uma melhoria precisa aguardar dados ou recursos.

Este levantamento cobre a Pokepédia e os protocolos do cliente público **1.420.0**, consultados em **13/11/2026**. Os catálogos e requisitos recebidos do servidor prevalecem sobre exemplos da documentação. A cobertura abaixo distingue as rotinas executáveis do conteúdo apenas identificado. Autonomia das rotinas implementadas não significa que todos os modos do jogo tenham um executor.

## O ciclo de decisões

1. Recuperar conexão e atividade em andamento; curar e repor suprimentos dentro do orçamento.
2. Manter/evoluir o principal pelas regras já suportadas.
3. Resgatar o Passe disponível; promover um principal claramente melhor antes de distribuir reservas; equipar a melhor bicicleta própria; ativar uma casa guardada quando houver capacidade; preencher postos de XP Share.
4. Fabricar a primeira casa/bicicleta quando houver fragmentos, equipar XP Share da bolsa e incubar Mystery Eggs comuns.
5. Completar vagas da equipe com candidatos utilizáveis, saudáveis e de nível próximo ao principal.
6. Avaliar ginásios, bosses, PvP, Safári e raid semanal; continuar medindo hunts e vender excedentes com base em vendas comparáveis.

Cada ação tem um motivo. O painel em **Ações → Planejador** mostra oportunidades, impedimentos, próximos desbloqueios, recursos reservados e resultados recentes. **Preferências → Autonomia** oferece ajustes opcionais; a execução não depende de abrir essa tela.

## Regras das rotinas novas

| Rotina | Decisão automática | Confirmação |
| --- | --- | --- |
| Passe | Usa o helper oficial para verificar o dia do servidor, nível mínimo e trilha disponível, incluindo VIP já adquirido. Não compra VIP. | Atualização do Passe ou recibo específico de resgate. |
| Bicicleta | Escolhe maior velocidade entre bicicletas próprias não anunciadas e respeita `trocaLiberaEm`. | A bicicleta escolhida aparece equipada no estado recebido. |
| Casas | Ativa uma casa guardada quando houver espaço em `maxEmUso`, priorizando capacidade × porcentagem de XP. | A casa aparece em uso. |
| XP Share da casa | Preenche somente postos explicitamente vazios com reservas da equipe, começando por níveis menores. Não move ocupantes existentes. | O Pokémon aparece no posto escolhido. |
| XP Share como item | Usa um item próprio em uma reserva sem equipamento e sem registro em casa. | O item aparece equipado no Pokémon. |
| Principal | Usa poder calculado pelo helper oficial e efetividade ofensiva/defensiva na rota atual. Exige ganho mínimo de 25% no índice e mantém o escolhido por pelo menos 15 min. O índice não é probabilidade de vitória. | O jogo informa o novo ativo; só então muda o principal persistido. |
| Vagas da equipe | Adiciona uma espécie diferente do Depot em vaga livre, com HP ≥80%, nível ≥80% do principal e elegibilidade oficial. Preserva Coleção, iniciais fora da equipe e Pokémon em casas/equipados. | O exemplar aparece no slot escolhido. |
| Mystery Eggs | Usa ovos P2–P4 da bolsa em slots já liberados, priorizando maior potência. Não compra incubadoras, luzes ou ovos. Ovos shiny são preservados. | Ovo e slot aparecem no estado ou no recibo de colocação; o jogo faz o nascimento. |
| Fabricação inicial | Guarda o custo publicado de fragmentos e fabrica uma primeira casa e bicicleta, até existir uma unidade própria disponível. Não faz rerolls nem sacrifica equipamentos. | Uma nova unidade aparece no inventário correspondente. |

No modo Shiny, a escolha e o preenchimento da equipe são mantidos como estão; recompensas e benefícios passivos continuam disponíveis. Trocas de bicicleta e principal separam as medições de XP para que as condições antigas não contaminem a comparação.

O Mercado preserva a reserva configurada de fichas de boss e, a partir do desbloqueio, o custo de uma tentativa. Quando as regras da raid estão disponíveis, também preserva o maior entre esse valor e a reserva mais o custo de inscrição na raid. Protege os Pokémon das formações PvP/raid e os fragmentos necessários à primeira casa/bicicleta. O estoque e as formações são verificados novamente depois de consultar a cotação. Depois de obter o benefício permanente, os próximos fragmentos ficam disponíveis para venda.

## PvP, Safári e raid semanal

Os três modos vêm **ativados por padrão**, inclusive para preferências salvas antes desta atualização. O planejador compara as oportunidades e explica no painel quando participa ou aguarda. Os limites abaixo são decisões da estratégia padrão do bot, não limites gerais do jogo.

| Modo | Quando vale participar | Execução e limites padrão |
| --- | --- | --- |
| PvP ranqueado | Treinador nível 150 ou mais, coleção e regras completas, formação disponível e cooldown encerrado. | Escolhe até cinco Pokémon pelo poder oficial de arena e monta posições. Até 12 buscas/24 h; cancela uma busca após 3 min e descansa 60 min após duas derrotas consecutivas. A fila é gratuita e a caça continua. |
| Safári | Ticket próprio, pelo menos três espécies úteis, três vagas no Depot, 40 bolas apropriadas e nenhum evento de XP priorizado. | Usa um ticket para uma hora. Prioriza espécies ainda ausentes e utilizáveis, depois melhorias possíveis de nível e espécies futuras. Repõe bolas compráveis com ouro dentro do orçamento compartilhado. Após 60 s sem alvos úteis ou bolas viáveis, pede saída; confirma encerramento, cura e retorno à caça. |
| Raid semanal | Inscrições abertas, equipe calculada com poder no nível real e ficha suficiente para pagar a inscrição mantendo uma ficha reservada. | Inscreve uma vez na edição, prepara até cinco Pokémon na ordem escolhida e só troca uma equipe válida por ganho de pelo menos 10%. Batalha e eventual bônus são aplicados pelo servidor; a caça continua durante a espera. Não exige guild. |

O Safári usa o pool completo e os níveis de captura dos helpers oficiais. Os tetos são derivados do catálogo evolutivo completo, incluindo remapeamento de Outland, cadeias truncadas e evoluções entre gerações, como no cliente do jogo. Qualidade, IVs, potência e shiny não são presumidos antes de capturar. As chances exibidas são a base oficial, sem prometer o resultado nem incorporar um bônus cuja composição não esteja publicada. Bolas premium não entram nessa rotina automática. A ordem dos alvos úteis prevalece sobre a posição deles na tela. Falta temporária dos dados de chance não é tratada como falta de bolas e não autoriza abandonar a visita.

As repetições nativas de PvP e lançamento de bolas são desligadas quando o bot assume esses modos, para manter o orçamento e a seleção de alvos. O replay automático de PvP é desativado para não cobrir a caça. A formação de caça permanece independente da formação PvP/raid.

Uma intenção é persistida antes de gastar ficha ou ticket. Uma resposta perdida não autoriza outro gasto: a raid fica reservada durante a edição e a tentativa de Safári conta no limite das últimas 24 h. Ao reconectar, o bot retoma uma fila ou visita existente e consulta o estado autoritativo. A saída do Safári é confirmada no servidor antes de liberar o fluxo normal.

## Mapa do conteúdo encontrado

| Sistemas da Pokepédia/cliente | Cobertura nesta versão |
| --- | --- |
| Primeiros passos e conta | Login e configuração inicial pertencem ao jogo. Depois da autenticação, o ciclo automático continua. |
| Níveis, XP, mapa, Hunt Analyser e Outland | Seleção de rotas, medição de XP/drops, proteção contra desmaios e recuperação de caça. |
| Stats, qualidade, IV, nota, poder, potência e tipos | Entradas para comparar equipe e ginásios; não modifica IV/qualidade automaticamente. |
| Combate, captura, morte, cura e automações | Usa os recursos nativos e o planejador de captura/suprimentos. |
| Shiny, lendários, míticos e Pokédex | Espécies e exemplares reconhecidos. A busca exaustiva de toda a Pokédex não está integrada. |
| Evolução e pedras | Cadeias determinísticas já suportadas; busca de pedras, limites de tempo e evolução confirmada. Ramificações especiais não são escolhidas por adivinhação. |
| Casa, XP Share e bicicletas | Gestão automática de recursos próprios, postos e fabricação inicial. O cliente atual suporta várias casas em uso. |
| Chocadeira e Mystery Eggs | Incubação automática de P2–P4 existentes. |
| Ovo Shiny, Shiny Stone, Mega Evolução, TMs, Z-Moves e refino | Mapeados; transformação/refino e alocação permanente de golpes ainda sem executor específico. Recursos preservados. |
| Oferenda e Sacrifício | Mapeados; sem destruição automática de Pokémon. |
| Dias sazonais, eventos, bônus de live e Boost dos Atrasados | Observa bônus aplicados e reavalia hunts. Não compra boosts nem opera Twitch/Kick. |
| Bosses e ginásios | Avaliação de elegibilidade, formação/força, orçamento de fichas, tentativas e resultado. |
| Safári | Entrada, seleção de capturas, suprimentos, encerramento e retorno automáticos. |
| Arena Mística | Mapeada; tickets preservados, sem executor específico. |
| Raid semanal | Inscrição e formação automáticas; bônus recebido entra na avaliação de caça. |
| Guilds e guerras | Observa bônus recebidos; não altera filiação nem inscreve guerras. |
| PvP ranqueado | Formação, fila, resultados, cooldown e pausas automáticos a partir do nível 150. |
| PvP amistoso e treinamento | Regras mapeadas; sem executor específico. |
| Campeonatos, Showdown, minigames e rankings | Identificados; sem execução autônoma desses modos. |
| Market NPC, Mercado da Comunidade, Gemas e taxas | Compra suprimentos permitidos, cota/anuncia excedentes previstos e reconcilia vendas. Saques conservam a configuração existente. |
| Passe de Batalha | Resgate automático da recompensa disponível. |
| Loja de Diamantes, indicações, votos e Discord | Identificados; não compra moeda premium nem atua em serviços externos. |
| Configurações, chat, amigos, Comércio e cosméticos | Preserva configurações sociais; não envia mensagens, faz trocas diretas ou aplica cosméticos. |

## Memória e recuperação

As intenções e o histórico ficam no SQLite local, separados por conta. Só há uma ação estratégica pendente por vez. Pausa, controle manual e reconexão invalidam envios preparados; os dados são conferidos novamente depois das consultas assíncronas.

Resposta ausente não significa sucesso. Depois de dois minutos, a intenção fica incerta e o bot recarrega a sessão para obter um estado completo, no máximo uma vez a cada cinco minutos. Um erro correspondente ao comando encerra a tentativa e impõe espera de 15 minutos. Um estado relevante permite reconciliar o resultado. Se o estado completo não confirma uma ação que pode consumir recursos, o bot libera as outras melhorias e suspende novas tentativas daquela rotina por 24 horas. A caça permanece disponível.

Os recibos de Passe, fabricação e nascimento de ovos permitem fechar somente as janelas de sucesso reconhecidas. Isso evita que recompensas cubram a área de captura. O fechamento respeita o controle manual, inclusive quando a pausa começa durante a preparação do clique; recibos recebidos durante uma pausa ficam disponíveis ao retomar. Uma evolução recente adia mudanças de equipe e novas atribuições de XP Share por até dois minutos, preservando candidatos à promoção sem bloquear benefícios independentes.

## Fontes oficiais

- [Pokepédia: índice e regras de todas as áreas](https://pokeidle.io/pokepedia.mjs).
- [Cliente 1.420.0: telas, comandos e respostas](https://pokeidle.io/app.js?v=1.420.0).
- [Casas, capacidade e XP](https://pokeidle.io/shared/casas.mjs) e [bicicletas e velocidade](https://pokeidle.io/shared/bicicletas.mjs).
- [Passe de Batalha e virada diária](https://pokeidle.io/shared/passe-batalha.mjs).
- [Chocadeira e catálogo de ovos](https://pokeidle.io/shared/chocadeira.mjs).
- [Poder e atributos](https://pokeidle.io/shared/nota-pokemon.mjs), [elegibilidade por nível](https://pokeidle.io/shared/pokemon-nivel-treinador.mjs) e [XP Share equipado](https://pokeidle.io/shared/xp-share-held.mjs).
- [Ginásios](https://pokeidle.io/shared/ginasios.mjs) e [bosses e custos](https://pokeidle.io/shared/bosses-lendarios.mjs).
- [PvP: requisitos e ranqueamento](https://pokeidle.io/shared/pvp-rank.mjs) e [tabuleiro](https://pokeidle.io/shared/pvp-tabuleiro.mjs).
- [Raid semanal: calendário, ficha e limites](https://pokeidle.io/shared/raid.mjs).
- [Safári: ticket, duração e nível capturado](https://pokeidle.io/shared/safari.mjs) e [piso de nível das espécies](https://pokeidle.io/shared/reduzir-nivel.mjs).
- [Tetos de captura](https://pokeidle.io/shared/teto-captura.mjs), [evoluções entre gerações](https://pokeidle.io/shared/evolucoes-cruzadas.mjs) e [remapeamento Outland](https://pokeidle.io/shared/outland.mjs).

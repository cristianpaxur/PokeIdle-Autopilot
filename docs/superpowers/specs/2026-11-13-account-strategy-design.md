# Jogador estratégico por conta

Objetivo escolhido em 13/11/2026: equilibrar progressão, equipe e rendimento. O bot deve observar recursos da conta, escolher uma melhoria útil, confirmar o efeito e continuar a caça. A mudança amplia o planejador existente; não substitui a medição de XP nem as rotinas de ginásios, bosses e Mercado.

## Evidências e decisões

Cliente público `1.420.0`, Pokepédia e módulos oficiais consultados em 13/11/2026. A página inicial simplifica algumas regras: o cliente suporta várias casas em uso (`maxEmUso`), registros de XP por casa e XP Share como item equipado. O Passe usa o dia do servidor no fuso de Brasília. Pokémon não iniciais só podem lutar até cinco níveis acima do treinador. Bicicletas têm cooldown próprio.

O fluxo será determinístico e explicável, sem serviço de IA externo: observar → avaliar oportunidades e impedimentos → executar uma ação → confirmar pelo estado do jogo → persistir o resultado. O horizonte mostra os próximos desbloqueios e o mapa de conteúdo distingue execução automática, observação e escolha manual. Dados ausentes não representam recursos disponíveis.

## Execução

Depois de cura, suprimentos e evolução: resgatar recompensa disponível do Passe; melhorar o principal apenas com ganho mínimo e intervalo entre trocas, antes de reservar candidatos para XP passivo; equipar bicicleta própria melhor; ativar casa guardada quando há capacidade; preencher postos vazios com reservas da equipe; fabricar a primeira casa/bicicleta com fragmentos próprios; equipar XP Share disponível em outra reserva; incubar ovos comuns existentes; preencher vagas da equipe com Pokémon utilizáveis de nível próximo à equipe. Mantém ocupantes existentes, Coleção, iniciais e anúncios. O modo Shiny conserva sua equipe; benefícios passivos e recompensa continuam disponíveis.

As comparações de poder e elegibilidade e o cálculo do Passe usam helpers oficiais no navegador do jogo. Catálogos de casas, bicicletas e XP Share vêm do `welcome`. Não inventar poderes a partir do nível, nem tratar poder como probabilidade de vitória. Não baixar/remover membros para preencher vagas; não deslocar ocupantes das casas automaticamente.

Steering do usuário: a operação deve ser autônoma, sem configuração ou decisões rotineiras no painel. As rotinas vêm ligadas. Incubar Mystery Eggs P2–P4 da bolsa em slots já liberados, priorizando potência, e reservar fragmentos para fabricar uma primeira casa e bicicleta. Confirmar o resultado, não somente o consumo. Ovos shiny e equipamentos existentes não são consumidos. Refino, TMs, Mega, Oferenda, Sacrifício, Safari, Arena Mística, PvP, raids e sistemas sociais ficam mapeados com limites explícitos de cobertura. Não comprar VIP, Gemas ou Diamantes, nem enviar chat.

## Estado e confirmação

Uma intenção persistida antes do envio, uma ação estratégica pendente por conta. Confirmação somente por estado relevante atualizado ou recibo específico. Pausa, controle manual, desconexão, mudança de sessão, atividade em curso e dados desatualizados impedem novos envios. Sem confirmação por dois minutos, ressincronizar o estado com intervalo mínimo de cinco minutos entre recargas; reconciliar uma resposta recente antes de repetir. Erros correspondentes ao comando recebem espera persistida de 15 minutos. Se o estado completo continuar sem resultado de uma operação consumível, liberar as demais rotinas e suspender aquele domínio por 24 horas. Uma troca de principal atualiza o treinamento apenas depois da confirmação e reinicia a medição.

Recibos de Passe, casa, bicicleta e ovos identificam janelas de sucesso que precisam ser fechadas para liberar captura. Guardá-los durante pausa, limpar na troca de geração da página e conferir controle automático antes do clique. A intenção recente de evolução adia reorganização de equipe e novas atribuições de XP Share, preservando candidatos à promoção; não bloqueia benefícios independentes indefinidamente.

O Mercado preserva a reserva configurada de fichas e, quando o boss é acessível, o custo de uma tentativa. Reavaliar o estoque depois da cotação assíncrona. O painel mostra objetivos, oportunidades, impedimentos, reservas e histórico; valores oriundos do jogo são texto.

## Validação

Node.js 24+, `npm ci`, testes de política e integração com SQLite em memória, transporte em Edge com servidor local e painel. Cobrir dados ausentes, preferência desligada, cooldowns, tipo desfavorável, elegibilidade, preservação da Coleção, múltiplas casas, confirmação, reinício, pausa durante await e reserva no Mercado. Executar a suíte completa; registrar limitações de validação em conta real.

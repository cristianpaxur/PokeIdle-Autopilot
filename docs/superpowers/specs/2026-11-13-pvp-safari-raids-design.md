# PvP, Safári e raids autônomos

## Objetivo e autorização

O usuário pediu execução autônoma dos três modos, com decisão de quando participar, sem configuração ou escolhas rotineiras. Manter o objetivo já escolhido: equilibrar progressão, equipe e rendimento. A autorização cobre implementação, testes e atualização local pelo instalador do projeto.

## Modelo

Estender o coordenador existente de atividades com políticas independentes de PvP, Safári e raid semanal. Todas vêm ligadas por padrão. Uma transação de atividade por conta usa o mesmo `runtime.activity` e histórico persistido; efeitos de cada comando precisam de confirmação. PvP e inscrição de raid não suspendem a caça do servidor. O Safári suspende medição de hunts e tem retorno confirmado.

Usar regras, calendários, cálculos de poder e pool de espécies dos módulos oficiais do cliente1.420.0, consultado em13/11/2026. Ausência de dados produz espera/reconsulta, nunca elegibilidade presumida. O painel explica decisão, custo, impedimento e resultado.

## Decisões

- PvP: mínimo oficial de nível150; calcular e posicionar formação própria, sem mudar a equipe de caça. A fila não custa ouro/ficha e a luta é automática. Limitar tentativas diárias e suspender após sequência de derrotas; usar histórico confirmado, sem afirmar probabilidade de vitória com base em poder. Cancelar busca excessivamente longa, reconciliar partidas não vistas e impedir reentrada duplicada após reconexão. Desativar abertura automática do replay para manter os controles de caça acessíveis.
- Safári: usar somente ticket já obtido, uma unidade por visita; comparar interesse das espécies, estoque/orçamento de bolas e evento de XP antes da entrada. Selecionar alvos visíveis por espécie e lacunas/benefício para equipe; qualidade e potência só ficam conhecidas depois da captura. Usar a regra oficial de nível do Pokémon capturado. Captura e reposição respeitam orçamento; não prolongar a visita comprando tickets. Acompanhar término, confirmar saída e voltar à melhor hunt disponível.
- Raid semanal: participação pessoal, sem requisito de guild. Consultar edição e janela oficiais, preservar reserva de fichas, selecionar até cinco Pokémon por poder real no nível atual e confirmar inscrição/equipe em ordem. A luta e o bônus são automáticos; a inscrição não mantém o coordenador ocupado até o dia da batalha. Reavaliar equipe antes do fechamento se houver melhora relevante. Não alterar filiação, cargos ou recursos coletivos de guild.

## Integração e recuperação

`GameState` conserva caches separados de PvP e raid e não perde dados bons em mensagens de erro. O navegador admite apenas consultas e comandos implementados, com IDs/slots/formações validados. Depois de consultas assíncronas, verificar conta, navegador, geração, pausa e configurações novamente.

Intenções de entrada e inscrição são persistidas antes do envio. Resposta desconhecida causa reconsulta e espera, sem repetir consumo. Retorno ao Centro/hunt e resultados correlacionam a tentativa correta. Atividade em andamento é retomada após reinício; operações independentes não ficam presas indefinidamente. Formação reservada não pode ser anunciada no Mercado durante a tentativa.

## Validação

Testar políticas puras; integração real de Session/SQLite em memória; protocolo e helpers em Edge com módulos locais controlados; painel e defaults. Cobrir custos, horários, derrotas, fila, pausa durante await, erro, reinício, duplicação, expiração de Safári e retorno. Executar suíte completa serial, revisão independente e instalador Windows. Verificar painel e monitor HTTPS sem expor credenciais ou QR. Não inventar validação em batalha real se a conta ainda não for elegível.

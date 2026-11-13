# Ginásios e bosses no planejador

> Execução autorizada pelo usuário: implementar, atualizar Docker e testar nas contas conectadas. Aplicar testes de comportamento antes do código e revisão independente.

**Objetivo:** decidir quando registrar/desafiar ginásios ou gastar uma ficha em boss, explicando benefício, requisitos e impedimentos.

**Arquitetura:** `activity-policy.mjs` decide sem efeitos; `activities.mjs` coordena consultas e ações serializadas, confirma pelo servidor e persiste intenções/resultados em `planner_state`. `AccountPlanner` integra prioridades; painel usa a mesma API de preferências. Node 24+, sem dependência nova, Edge para testes do painel.

**Fontes:** cliente oficial 1.420.0 e módulos shared de PokeIdle.io, consultados em 12/11/2026. Ginásios reais são PvP assíncrono a partir do nível 150, não líderes NPC; bosses começam no nível 300. Dados de clones não são requisitos.

## Critérios

- Ginásios: priorizar tipos do Pokémon principal, melhorar o bônus de dano atual, montar até cinco espécies diferentes disponíveis sem tirar Pokémon de outro ginásio. Poder calculado pelo helper oficial `poderNoGinasio`, nunca usar o poder bruto como equivalente. Margem de força configurável; não apresentar a razão de poder como probabilidade de vitória. Respeitar cooldown do servidor e limite diário local. Sem abandono automático de liderança.
- Bosses: ficha e catálogo oficiais, acesso, membros da equipe próximos do nível recomendado (um forte não compensa outros fracos), HP e vantagem de tipo. Só fichas excedentes à reserva, com limite diário, uma tentativa por vez e duração máxima. Sem compra de fichas, sem gasto em Gemas, sem afirmar lucro que não foi medido. Uma derrota/resultado incerto bloqueia novas tentativas automáticas daquele boss por 24h.
- A prioridade de evento existente adia novas atividades quando `activitiesDuringXpEvents` está desligado. Shiny mantém seu objetivo. Suprimentos, cura e evolução pronta antecedem novas atividades.
- Confirmar `boss.auto=false` no estado antes de entrar. Nunca assumir que desconectar ou pausar para o combate no servidor. Ao encerrar boss, curar e retomar a estratégia de hunt. Atividade iniciada manualmente não é assumida pelo planejador.
- Intenção persistida antes de comandos com efeito. Resultado sem confirmação é incerto e não será repetido cegamente após timeout/reinício. Respeitar pausa/controle manual em cada envio. Excluir boss das métricas de hunt e invalidar comparação de XP após mudança no bônus de ginásio.
- Painel mostra avaliações de ambos os sistemas mesmo quando a decisão principal é XP/suprimentos. Preferências e histórico de tentativas sobrevivem a reinícios.

## Contrato de preferências e apresentação

Novas preferências: `autoGyms=true`, `gymMinAdvantagePercent=25` (0–200), `gymAttemptsPerDay=2` (0–18), `autoBosses=true`, `bossTeamLevelPercent=120` (100–300), `bossTokenReserve=1` (0–1000000), `bossAttemptsPerDay=2` (0–100), `bossMaxMinutes=10` (1–60), `activitiesDuringXpEvents=false`.

`planner.activities`: `{gym, boss, active, history}`. Cada avaliação contém `code`, `title`, `reason` e campos factuais opcionais (`target`, `powerRatio`, `bonusBefore`, `bonusAfter`, `tokens`, `cost`, `attempts`, `limit`). Histórico limitado às últimas 10 tentativas, sem nome de outros jogadores no monitor.

## Trabalho e verificação

- [x] Regras puras e testes (`src/activity-policy.mjs`, `test/activity-policy.test.mjs`): nível, equipe/tipos, força oficial, bônus, reserva, limite diário, evento, derrota e dados ausentes.
- [x] Estado e execução (`src/activities.mjs`, `src/planner.mjs`, `src/planning.mjs`, `src/session.mjs`, `src/game-state.mjs`, `src/browser.mjs`, `src/catalog.mjs`): protocolo oficial, consulta com cache, intenções persistentes, confirmação/reconciliação, volta à hunt, isolamento das métricas; testes de integração com Ledger real e transporte simulado.
- [x] Painel (`web/planner.js`, `web/style.css`, `test/planner-dashboard.test.mjs`): opções agrupadas, motivos de participação/adiamento, tentativa atual e histórico, preservando formulário em edição.
- [x] Revisão, `npm ci`, suíte completa, documentação, `git diff --check`, instalar por `scripts/install-windows.ps1`, verificar saúde/QR/HTTPS, preferências e bloqueios nas contas reais. Sem alegar combate ao vivo quando a conta não tem o requisito.

## Decisões de execução

- Reutilizar branch `codex/progression-planner` e preservar alterações da entrega anterior.
- O usuário autorizou a implementação e deploy; detalhes operacionais serão resolvidos dentro deste escopo.
- As contas conectadas estão abaixo de 150/300; validação real deve demonstrar a decisão correta de continuar progredindo. Fluxos de combate terão testes com estados oficiais representativos, sem forçar acesso bloqueado.

## Resultado verificado em 12/11/2026

- Revisão independente concluída após corrigir reconciliação, saída com confirmação, atualização de força, relógio do servidor e prazos após pausa. Consultas de ginásios sem resposta não atrasam a escolha normal da hunt.
- `npm test -- --test-concurrency=1 --test-timeout=120000`: 147 testes aprovados, sem falhas, cancelamentos ou testes ignorados. Node 24 e Edge instalado. A navegação da fixture do painel aguarda DOM e o controle efetivo, sem depender do evento de carga completa em 3,5 segundos.
- Atualização pelo instalador Windows concluída, contêiner saudável e página local do QR aberta. Onze arquivos do planejador, integração e painel conferidos por SHA-256 entre checkout e contêiner.
- Nos três perfis conectados, o navegador real exibiu os bloqueios de nível 150/300, salvou as preferências existentes e confirmou sua preservação após recarregar, sem erros JavaScript. Os três retomaram hunts e nenhuma tentativa de ginásio ou boss foi iniciada.
- Monitor HTTPS conferido pelo QR local: saúde HTTP 204 e estado autenticado HTTP 200. O QR e suas credenciais permaneceram locais.
- Não houve combate real de ginásio ou boss, pois os perfis ainda não atendem aos requisitos. Entrada, registro/desafio, vitória, derrota, timeout, reinício e retorno à hunt foram validados nos testes automatizados.

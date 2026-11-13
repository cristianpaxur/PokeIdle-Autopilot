# PvP, Safari and Raids Implementation Plan

**Goal:** Executar e decidir PvP, Safári e raid semanal automaticamente nas contas conectadas.

**Architecture:** Políticas puras separadas alimentam `AdvancedActivities`, integrado ao `ActivityPlanner` existente e ao mesmo registro persistente. `GameState` mantém respostas autoritativas; `GameBrowser.activityData` calcula regras oficiais e formações. Session continua caçando durante atividades paralelas e assume captura/retorno do Safári.

**Tech Stack:** Node.js24+, ESM, SQLite nativo e Playwright/Edge; sem dependências novas.

**Spec:** [Projeto](../specs/2026-11-13-pvp-safari-raids-design.md).

## Restrições globais

- Preservar alterações concorrentes, credenciais, bancos e perfis. Não criar commit de alterações alheias.
- Entradas consumíveis: somente inventário próprio e intenção persistida antes do comando.
- Dados oficiais ausentes: consultar ou aguardar. Não inferir vitória garantida, preço de venda ou potência de encontro.
- Pausa/conta/geração/configuração conferidas depois de awaits.
- `runtime.activity` é exclusivo entre gym,boss,pvp,safari,raid; raid/PvP não interrompem medição da caça.
- Sem compras premium, trocas sociais ou administração de guild.

## 1. Políticas de decisão

- [x] Criar `src/pvp-policy.mjs`, `src/safari-policy.mjs`, `src/raid-policy.mjs` com funções `pvpPlan`, `safariPlan`, `raidPlan`.
- [x] Interface comum: `({player,pokemon,species,settings,history,now,bonuses,info,data})` → `{ready,code,title,reason,kind,priority,action,target,...facts}`. `data` contém cálculos oficiais do modo; `info` é cache fresco recebido do servidor. `now` usa relógio local e vencimentos do servidor são convertidos no coordenador.
- [x] Testes novos em `test/pvp-policy.test.mjs`, `test/safari-policy.test.mjs`, `test/raid-policy.test.mjs`; observar falha antes da implementação. Cobrir também estado incompleto e custos negativos/ausentes.
- [x] Comandos: `node --test test/pvp-policy.test.mjs test/safari-policy.test.mjs test/raid-policy.test.mjs`.

## 2. Estado, transporte e coordenador

- [x] Testar caches independentes e reset em welcome em `test/advanced-activities.test.mjs`.
- [x] `GameBrowser.activityData({player,pokemon,species,hunts,now})` retorna `{pvp,raid,safari}` calculados com helpers oficiais; tempo máximo4500ms, origem do jogo verificada. Formação PvP usa `gymData` para casas oficiais da lista escolhida.
- [x] Adicionar transporte somente para consultas, formação/fila PvP, inscrição/equipe de raid e entrada de um ticket de Safári; validar formações e não ampliar autorização para ações não executadas.
- [x] Criar `src/advanced-activities.mjs`: cache de regras, `refresh`, `prepare`, `consider`, `record`, `run`, retorno e captura Safári. Compartilhar `ActivityPlanner.update/finish/send` e persistência. Usar timeouts limitados e reconciliação sem repetir inscrição/entrada incerta.
- [x] Integrar `src/activities.mjs`, `src/planner.mjs`, `src/session.mjs`, `src/strategy-policy.mjs` e os guards do otimizador/captura. Proteger IDs de formações de vendas enquanto usados pela atividade.
- [x] Testes de sessão: nenhuma ação pausada; intenção antes do envio; fila e resultado correlacionados; inscrição única por edição; Safári sem clique fora de contexto; fim/saída/retorno; reinício sem gasto duplicado.

## 3. Preferências e visibilidade

- [x] Novos defaults ligados em `src/planning.mjs`; incluir limites e reservas válidos, sem depender de salvar preferências.
- [x] `web/planner.js` mostra avaliações dos cinco modos, novos estados/resultados e ajustes opcionais.
- [x] Testar no Edge defaults de snapshots antigos, gravação e preservação do draft, apresentação segura de motivos recebidos.
- [x] Atualizar `src/game-knowledge.mjs`, horizonte e `docs/estrategia.md` para refletir execução real e requisitos atuais.

## 4. Revisão e instalação

- [x] `npm ci` concluído, sem vulnerabilidades reportadas.
- [x] Executar `npm test -- --test-concurrency=1`; corrigir regressões e pedir revisão independente.
- [x] Executar `scripts/install-windows.ps1` até container saudável e QR aberto.
- [x] Verificar hashes instalados, atividades/defaults no painel, retomada da caça e HTTPS do monitor. Registrar quais ações foram verificadas em conta e quais só em testes.

## Evidência final — 13/11/2026

- Node.js 24.19.0; npm ci concluído; suíte completa serial final: 294 testes aprovados, zero falhas (230,9 s).
- Revisão independente encerrada sem achados abertos; regressões de medição da caça, prioridade Safári, chances indisponíveis e normalização de tetos corrigidas com testes.
- Smoke com os módulos oficiais e as 1.327 espécies públicas: consulta em 507 ms; Safári de referência com Bulbasaur nível 40 e Magneton nível 80, PvP mínimo 150 e raid custo 1.
- Instalador Windows final concluído com código 0, container saudável e página local do QR reaberta. Hashes dos 15 arquivos executáveis/verificados iguais ao checkout.
- Monitor HTTPS: health 204, página 200 e API autenticada 200 com quatro perfis. QR e credenciais permaneceram locais. Não houve teste físico pelo celular.
- Três contas autenticadas em controle automático, com estados/progresso recentes e autoPvp/autoSafari/autoRaids ligados. Níveis observados 80, 94 e 61; PvP bloqueado corretamente pelo nível. Safári avaliou falta de ticket nas três; duas confirmaram reserva insuficiente para raid, enquanto a primeira reconsultava dados. Quarto perfil sem sessão autenticada.
- Fila/partidas PvP, consumo e captura Safári, inscrição/equipe/resultado de raid e recuperação foram validados em testes controlados. Nenhuma batalha real destes modos foi alegada: as contas ainda aguardam requisitos/recursos.

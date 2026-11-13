# Account Strategy Implementation Plan

**Goal:** Equilibrar progressão, equipe e rendimento com decisões observáveis e confirmadas por conta.

**Architecture:** Políticas puras produzem oportunidades; um coordenador persiste intenções e confirma os efeitos. O planejador existente conserva cura, evolução, caça e atividades. O painel apresenta o plano e o mapa de conteúdo.

**Tech Stack:** Node.js 24+, JavaScript ESM, SQLite nativo, Playwright/Edge, sem novas dependências.

**Spec:** [Projeto](../specs/2026-11-13-account-strategy-design.md).

## Restrições

- Preservar alterações locais existentes, credenciais, perfis e bancos.
- Helpers e catálogos oficiais; dados desconhecidos bloqueiam a ação correspondente.
- Uma intenção persistida antes do envio; confirmação por efeito observado.
- Pausa e controle manual impedem envios, inclusive depois de awaits.
- Sem gastos premium, sacrifícios, novas vendas de Pokémon ou comunicação social.

## 1. Políticas e estado

- [x] Criar `test/strategy-policy.test.mjs` com cenários de recompensa, equipamentos, múltiplas casas, equipe, cooldown e reservas.
- [x] Executar `node --test test/strategy-policy.test.mjs` e observar a ausência das funções novas.
- [x] Criar `src/strategy-policy.mjs`: `strategyOpportunities(input)` retorna avaliações com `id`, `status`, `title`, `reason`, `command`, `expected`; `strategicReserves(state, settings)` retorna itens e quantidades protegidos; `strategyHorizon(state)` informa desbloqueios.
- [x] Criar `src/game-knowledge.mjs` com cobertura e fontes por sistema. Preservar em `src/game-state.mjs` catálogos de casas, bicicletas e XP Share e revisão de estado.
- [x] Passar os testes de política.

## 2. Transporte e execução

- [x] Criar `test/strategy-integration.test.mjs` exercitando intenção persistida, confirmação, pausa, reconexão, timeout e mudança de principal.
- [x] Implementar `GameBrowser.strategyData` com helpers oficiais do Passe e de poder/elegibilidade; ampliar allowlist apenas para comandos implementados.
- [x] Criar `src/strategy.mjs` com `AccountStrategy.refresh`, `prepare`, `run`, `record`, `snapshot` e integração em `src/planner.mjs`/`src/session.mjs`.
- [x] Impedir venda abaixo da reserva antes e depois da cotação no Mercado.
- [x] Verificar políticas, integração, transporte e regressões de progressão/atividades/mercado.

## 3. Painel e documentação

- [x] Testar controles de estratégia e apresentação de objetivos, motivos, reservas e histórico no Edge.
- [x] Acrescentar preferências em `src/planning.mjs` e `web/planner.js`; adicionar apresentação acessível sem substituir o layout local.
- [x] Documentar todos os sistemas encontrados, cobertura real e fontes em `docs/estrategia.md`; conectar README e guia do jogo.
- [x] Rodar `npm test -- --test-concurrency=1`, revisar diff e informar limites de validação real.

## Validação e instalação concluídas

- Node.js 24.19.0 e `npm ci` concluídos.
- Suíte completa: `npm test -- --test-concurrency=1`, 199/199 testes passaram. A execução serial evita concorrência excessiva entre instâncias do Edge neste computador.
- Após os dois últimos ajustes de guarda de pausa e espera de evolução/XP Share: 17/17 testes de integração e 10/10 testes de transporte passaram. A revisão independente também passou políticas e integração, 29/29.
- Revisão focal encerrada sem achados remanescentes: reconciliação, erros definitivos, promoção antes de XP Share, evolução antiga e janelas de recompensa.
- Atualização por `scripts/install-windows.ps1` concluída; container saudável, QR local gerado e aberto pelo instalador. Os hashes de estratégia, política, navegador, sessão, cobertura e painel coincidem com os arquivos instalados.
- Monitor do celular verificado por HTTPS: `/health` 204, página 200 e estado autenticado 200. QR e acesso privado permanecem somente no computador. Não houve teste em um aparelho celular.
- Perfis 1–3 retomaram a caça automática; histórico registra resgates de Passe confirmados nos perfis 2–3. Perfil 4 permanece aguardando login nativo. Ações que exigem recursos ainda ausentes ou níveis mais altos foram validadas por testes, não provocadas nas contas.

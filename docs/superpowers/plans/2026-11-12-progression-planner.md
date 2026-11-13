# Planejador de progressão

> Execução autorizada pelo usuário em 12/11/2026: implementar, atualizar o Docker e testar nas contas conectadas. Desenvolvimento com testes de comportamento e revisão independente.

**Objetivo:** sustentar a caça com suprimentos, obter a pedra da próxima evolução e aproveitar bônus temporários, com opções por perfil e motivos visíveis.

**Arquitetura:** funções puras em `src/planning.mjs` calculam suprimentos, evolução, rotas de pedra e bônus. `src/planner.mjs` coordena os objetivos e confirma compras pelo jogo; `Session` executa uma ação por vez. Preferências, compras e tentativas de busca são persistidas em SQLite. O painel configura e explica cada conta.

**Restrições:** Node 24+, nenhuma dependência nova; sem Gemas, sacrifícios ou compra de pedras nesta etapa; manter os modos Farm/Shiny; não misturar XP medido durante busca de pedras; respeitar pausa e controle manual; preservar segredos e dados locais; instalar por `scripts/install-windows.ps1`.

## Contrato

Preferências: `autoPotions`, `autoRevives`, `goldReserve`, `supplyGoldPerHour`, `stockMinutes`, `hpThreshold` (porcentagem), `autoEvolve`, `farmStones`, `stoneMinutes`, `prioritizeXpEvents`. Padrões: ambos consumíveis ligados, reserva existente, limite 10000 ouro/h, estoque 10 min, cura em 50%, evolução e busca ligadas, busca 10 min, prioridade de evento ligada.

Prioridade: cura/estoque → evolução com pedra existente → XP em evento temporário quando configurado → busca limitada da pedra necessária → estratégia habitual. Shiny conserva seu objetivo e recebe apenas manutenção de suprimentos e informação dos bônus.

Eventos desta etapa: bônus globais e fontes de XP publicadas em `estado.bonusXp`, `estado.evento` e dia sazonal. São passivos; não inventar inscrições. A comparação de hunts muda de contexto com os multiplicadores e o dia sazonal. Eventos externos, bosses e ginásios permanecem fora desta entrega.

## Tarefas

- [x] 1. Funções de decisão e testes: escolhas de cura por HP/custo, estoque por consumo, reserva/teto, evolução determinística, hunt de pedra sem exigir vantagem de tipo, eventos/expiração.
- [x] 2. Integração: preferências e compras persistidas, confirmação por evento `compra`, timeout conservador, buscas limitadas com retorno à progressão, erros sem repetição rápida, proteção de pausa, contexto do otimizador.
- [x] 3. Painel: opções por perfil, motivo atual sempre visível, estoque, evolução pendente, bônus e duração, última ação confirmada. Testes de API/Edge para salvar, rejeitar configurações inválidas e preservar edição durante atualizações.
- [x] 4. Revisão, suíte completa, documentação, instalação Docker, teste real e verificação do monitor HTTPS.

## Verificação

`npm ci`; testes focados após cada alteração; `npm test`; `git diff --check`. Na execução real observar o estado anterior, instalar, verificar saúde, confirmar decisões e ações que as contas permitem, salvar/reler opções sem alterar a estratégia escolhida pelo usuário. Nunca apresentar uma evolução ou evento não observado como testado ao vivo.

## Decisões de escopo

- Reutilizar o checkout existente em uma branch `codex/`, pois ele contém a configuração local de instalação autorizada.
- Guardar a intenção de compra antes de enviar e contar intenções pendentes/incertas no teto de ouro; somente o evento de compra ou inventário reconciliado confirma execução.
- Uma pausa já existente deve sobreviver à atualização, inclusive se for controle manual. A retomada permanece explícita no painel.

## Verificações realizadas

- `npm ci`: Node 24.19.0, dependências instaladas, zero vulnerabilidades reportadas.
- Revisão independente: exceções de pedras/níveis/ramificações corrigidas; bloqueio de desmaios separado por rota; nenhum achado medium/high aberto.
- `npm test -- --test-concurrency=2`: 87/87, exit 0. Testes de browser executados no Edge.
- `git diff --check`: exit 0.
- Backup do SQLite guardado dentro de `/data/backups` no volume local antes de atualizar a imagem.
- Contas reais: três perfis conectados (1, 2 e 3). Compras de Golden Potion confirmadas pelo jogo nos três, respeitando a reserva; o perfil 2 atingiu o teto de 10000 ouro/h e interrompeu a reposição.
- Evento real: +100% de XP do treinador e do Pokémon reconhecido; prioridade de XP apresentada nos três perfis, com multiplicador e vencimento.
- Pedras: prioridade do evento desativada temporariamente nos perfis 1 e 3, com busca limitada a 1 min de caça. Ambos entraram na hunt `charmander` para Fire Stone; o perfil 3 atingiu o limite e voltou à progressão. Não houve drop de pedra nem nova evolução durante essa janela. Preferências originais restauradas (evento prioritário, busca de 10 min).
- Painel real no Edge: preferências salvas/recarregadas nos três perfis, motivos e estoque visíveis, zero erros JavaScript. Monitor HTTPS respondeu 204 em `/health` e 200 em `/api/state`, incluindo o motivo do planejador.
- Ajuste encontrado no teste real: indisponibilidade de revive não deve esconder o encerramento da busca de pedra. Regressão reproduzida e corrigida; 34/34 testes de regras e integração aprovados após o ajuste.
- Imagem final instalada por `scripts/install-windows.ps1`, exit 0, container saudável e QR aberto localmente. Após reiniciar, os três perfis preservaram as preferências e 10000 ouro de compras confirmadas por perfil no orçamento da última hora; não duplicaram compras acima do teto. HTTPS verificado novamente: 204/200, com as decisões atuais.

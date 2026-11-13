---
name: "IdleBot — Pokédex"
description: "Painel operacional com carcaça vermelha, lente ciano e instrumentos LCD verdes."
colors:
  bg: "#f2f2e3"
  surface: "#e7edd8"
  dark: "#dae5c9"
  line: "#9ba98d"
  text: "#1b3028"
  muted: "#4d604c"
  accent: "#24633f"
  warn: "#75470c"
  casing: "#cf3442"
  casing-dark: "#941c2d"
  focus: "#007887"
  screen-border: "#354537"
  control-bg: "#f5f6e9"
  primary-button: "#bb283b"
  primary-button-hover: "#a21f32"
  on-casing: "#fff9ee"
  lens-cyan: "#18dae6"
  profile-bg: "#e8eedb"
  profile-header: "#dce7ca"
typography:
  headline:
    fontFamily: "\"Segoe UI\", system-ui, sans-serif"
    fontSize: "clamp(30px, 3.3vw, 48px)"
    fontWeight: 700
    lineHeight: 1.12
    letterSpacing: "-.035em"
  title:
    fontFamily: "\"Segoe UI\", system-ui, sans-serif"
    fontSize: "20px"
    fontWeight: 700
    letterSpacing: "-.025em"
  body:
    fontFamily: "\"Segoe UI\", system-ui, sans-serif"
    fontSize: "15px"
    fontWeight: 400
    lineHeight: 1.5
  control:
    fontFamily: "\"Segoe UI\", system-ui, sans-serif"
    fontSize: "13px"
    lineHeight: 1.5
  label:
    fontFamily: "\"Segoe UI\", system-ui, sans-serif"
    fontSize: "12px"
    fontWeight: 600
  micro:
    fontFamily: "\"Segoe UI\", system-ui, sans-serif"
    fontSize: "11px"
  metric:
    fontFamily: "\"Segoe UI\", system-ui, sans-serif"
    fontSize: "clamp(24px, 2.4vw, 36px)"
    fontWeight: 800
    lineHeight: 1.2
    letterSpacing: "-.03em"
  mono:
    fontFamily: "Consolas, \"Courier New\", monospace"
    fontSize: "11px"
    lineHeight: 1.5
rounded:
  badge: "5px"
  control: "7px"
  navigation: "8px"
  instrument: "9px"
  toolbar: "10px"
  collection: "11px"
  panel: "12px"
  dialog: "16px"
  screen: "18px"
  casing: "20px"
  lens: "50%"
spacing:
  detail: "4px"
  compact: "8px"
  control-gap: "10px"
  panel-gap: "12px"
  card-gap: "16px"
  section-inset: "20px"
  screen-inset: "24px"
  section-gap: "30px"
components:
  button-primary:
    backgroundColor: "{colors.primary-button}"
    textColor: "{colors.on-casing}"
    typography: "{typography.control}"
    rounded: "{rounded.control}"
    padding: "8px 12px"
  button-primary-hover:
    backgroundColor: "{colors.primary-button-hover}"
    textColor: "#ffffff"
  button-secondary:
    backgroundColor: "{colors.control-bg}"
    textColor: "{colors.text}"
    typography: "{typography.control}"
    rounded: "{rounded.control}"
    padding: "8px 12px"
  button-sound:
    backgroundColor: "#ab2434"
    textColor: "#fff8eb"
    rounded: "{rounded.control}"
    padding: "7px 10px"
  input-search:
    backgroundColor: "{colors.control-bg}"
    textColor: "{colors.text}"
    typography: "{typography.control}"
    rounded: "{rounded.control}"
    padding: "8px 12px"
  navigation-key:
    backgroundColor: "#b82437"
    textColor: "{colors.on-casing}"
    rounded: "{rounded.navigation}"
    padding: "10px 23px"
  navigation-key-current:
    backgroundColor: "{colors.bg}"
    textColor: "{colors.text}"
  status-ready:
    backgroundColor: "#d4edbb"
    textColor: "#28601b"
    typography: "{typography.micro}"
    rounded: "{rounded.badge}"
    padding: "5px 8px"
  type-chip:
    backgroundColor: "#dae6c5"
    textColor: "#32472d"
    typography: "{typography.micro}"
    rounded: "{rounded.badge}"
    padding: "2px 9px"
  profile-card:
    backgroundColor: "{colors.profile-bg}"
    textColor: "{colors.text}"
    rounded: "{rounded.panel}"
  collection-card:
    backgroundColor: "{colors.profile-bg}"
    textColor: "{colors.text}"
    rounded: "{rounded.collection}"
    padding: "10px"
  lcd-metric:
    textColor: "{colors.text}"
    rounded: "{rounded.instrument}"
    padding: "14px 17px"
  scanner-lens:
    rounded: "{rounded.lens}"
    width: "70px"
    height: "70px"
---

# Design System: IdleBot — Pokédex

## Overview

**Creative North Star: "Pokédex operacional"**

A interface assume a forma de uma Pokédex clássica: carcaça vermelha, lente ciano com reflexo, pequenos indicadores e uma tela clara com instrumentos verdes. A identidade vem desses materiais construídos em CSS, enquanto texto, dados e controles continuam sendo elementos reais da aplicação.

A densidade é de um painel de operação: hierarquia curta, números fáceis de comparar e cartões que agrupam identidade, estado e atividade. A mesma linguagem aparece na caça, na coleção, na ficha, no mercado e no monitor do celular. O efeito tátil é discreto; o conteúdo permanece estável durante atualizações automáticas.

**Key Characteristics:**

- Carcaça vermelha contínua e tela marfim delimitada por uma borda verde escura.
- Lente ciano, indicadores circulares e controles com relevo interno.
- Superfícies LCD verdes, texto escuro e números tabulares.
- Segoe UI para interface, com Consolas reservado a identificadores e registros.
- Bipes curtos em interações reais, com silêncio persistido localmente.

Este documento registra o tema implementado em `web/pokedex.css`, carregado depois de `web/style.css`, e o comportamento de `web/pokedex.js`. O contrato aprovado está em `docs/design/pokedex.md`; as capturas de revisão ficam no checkout local em `.impeccable/review/`. Os tokens do frontmatter descrevem a implementação; as rampas tonais do sidecar são apenas auxiliares de visualização, não novas cores de produto.

## Colors

A paleta combina vermelho de plástico, marfim de tela e verdes de LCD com tinta escura. Os nomes abaixo apontam para os tokens normativos do frontmatter.

### Primary

- **Carcaça vermelha** (`casing`): moldura externa e topo contínuo do aparelho.
- **Borda de carcaça** (`casing-dark`): contorno externo e detalhes do acabamento.
- **Tecla principal** (`primary-button`, `primary-button-hover`, `on-casing`): ação destacada e seu estado ao apontar.

### Secondary

- **Lente ciano** (`lens-cyan`): centro luminoso do scanner; o gradiente completo está no componente da lente.
- **Foco ciano escuro** (`focus`): anel de foco, deliberadamente mais escuro que o brilho da lente.
- **Verde de atividade** (`accent`): dados enfatizados e controles de progressão.

### Tertiary

- **Âmbar de atenção** (`warn`): texto de aviso e validação. Caçando/pronto usam verde; login/bloqueio/configuração usam âmbar; recuperação/reconexão usam azul claro, sempre com rótulo.
- **Tipos dos Pokémon:** chips próprios em amarelo, laranja, azul, verde ou lilás, conforme o tipo. São categorias, não severidades; conservam o nome legível dentro da borda.

### Neutral

- **Marfim da tela** (`bg`): superfície principal de leitura.
- **LCD claro e profundo** (`surface`, `dark`): áreas de informação e superfícies internas herdadas.
- **Cartão e cabeçalho** (`profile-bg`, `profile-header`): separação tonal dentro de cada perfil e exemplar.
- **Campo claro** (`control-bg`): botões secundários, busca, números e seletores.
- **Tinta e texto secundário** (`text`, `muted`): conteúdo e contexto.
- **Divisórias e moldura** (`line`, `screen-border`): organização dos dados e limite da tela.

**The Casing and Screen Rule.** Reserve o vermelho para a carcaça e as teclas de ação; mantenha a leitura dos dados sobre marfim e verdes claros. Os estados exigem texto próprio, além da cor.

## Typography

**Interface Font:** Segoe UI, com `system-ui, sans-serif` como fallback.
**Label/Mono Font:** Consolas, com `"Courier New", monospace` como fallback.

A família de interface favorece leitura operacional no Windows. O caráter de Pokédex fica na forma do aparelho, sem exigir uma fonte pixelada para textos, filtros ou números.

### Hierarchy

- **Headline:** título de página no papel `headline`; cai para 29px até 500px. A ficha usa uma variação mais contida: `clamp(29px, 3vw, 42px)`.
- **Title:** títulos de seção no papel `title`, com 18px até 500px. Perfis usam 16px; nomes da coleção usam 19px, ou 17px até 760px.
- **Body:** papel `body`; parágrafos de apoio do título têm largura máxima de 70ch.
- **Control:** papel `control` para campos e botões gerais. A ação principal usa peso 750.
- **Label / Micro:** rótulos de filtros e métricas usam 12px; contexto compacto, estados e chips usam 11px. A pequena placa “POKÉDEX” faz parte da marca, não é um padrão de subtítulo de seção.
- **Metric:** valores do resumo usam `metric`, com 25px até 500px. Valores dos cartões da coleção usam 18px; valores da ficha usam `clamp(22px, 2.2vw, 30px)`.
- **Mono:** identificadores e registros compactos. Métricas e células numéricas usam `font-variant-numeric: tabular-nums` sem trocar toda a interface para monoespaçada.

**The Readable Data Rule.** Preserve o mínimo de 11px usado pelo tema para microtexto e mantenha números tabulares em métricas e tabelas. Não transforme o estilo de uma etiqueta pequena em estilo de texto corrido.

## Layout

O aparelho ocupa pelo menos a altura da janela (`100dvh`). A área central tem largura máxima de 1720px e margens automáticas. No desktop, a tela recebe espaçamento horizontal fluido de `clamp(16px, 2.2vw, 32px)` e preenchimento vertical de 24px/30px.

O topo usa três áreas: marca, navegação e ações/estado. Até 1180px, a navegação ocupa uma segunda linha. Até 760px, o título e suas ações passam a uma coluna; até 500px, o cabeçalho reduz lente, marca e teclas sem retirar os nomes acessíveis. O texto visível do controle de som é ocultado nessa largura, mas seu rótulo acessível e estado pressionado permanecem.

- **Perfis de operação:** quatro colunas a partir de 1380px, duas abaixo desse ponto e uma até 760px. O modo mosaico mantém uma grade de duas colunas dedicada às visualizações.
- **Resumo:** quatro instrumentos no desktop e dois por linha até 620px.
- **Coleção:** grade fluida com base mínima de 220px; até 760px, duas colunas. A altura do retrato passa de 160px para 140px e depois 118px até 500px.
- **Filtros:** barra flexível com quebra de linha. Até 760px, a busca ocupa 100% da linha; os outros campos têm base de 130px e a ação principal ocupa a largura disponível.
- **Ficha:** no desktop amplo, navegador de exemplares à esquerda e ficha à direita em proporção 0,85/1,15, com intervalo de 26px. Até 1180px, o navegador lateral desaparece; até 760px, identidade e retrato dividem o topo e métricas ocupam a linha seguinte.
- **Ritmo:** intervalos recorrentes de 8–16px entre controles e módulos; seções usam separação de 30px. As tabelas mantêm seus cabeçalhos e permitem quebra de conteúdo nas larguras menores.

## Elevation & Depth

A profundidade é estrutural: contorno da carcaça, lente com reflexos e teclas com relevo interno. A tela tem uma borda escura e um aro vermelho. Cartões verdes se distinguem por borda e tom, sem sombra externa genérica.

### Shadow Vocabulary

- **Acabamento da carcaça:** `inset 0 2px 3px #ffb3b4`.
- **Tela montada:** `inset 0 2px 5px #25362922, 0 0 0 5px #a92335`.
- **Lente:** `inset 0 0 0 3px #126879, 0 3px 5px #6f1d2d80`.
- **Botão secundário:** `inset 0 -2px 0 #bcc9ae`; pressionado usa `inset 0 1px 2px #64765c44`.
- **Botão principal:** `inset 0 2px 2px #ed7d8877, inset 0 -2px 0 #8c2030`.
- **Instrumento LCD:** `inset 0 2px 0 #faffee` sobre o gradiente verde.

**The Mechanical Depth Rule.** Use sombras internas e contornos para sugerir a montagem do aparelho. Cartões de dados permanecem apoiados na tela, sem elevação animada.

## Shapes

A forma externa é arredondada e mais ampla que os componentes internos: carcaça de 20px e tela de 18px, reduzidas para 14px e 12px até 760px. Cartões ficam entre 9px e 12px; controles usam 7px; chips usam 5px. A lente e os indicadores são círculos.

Bordas de 1px organizam os módulos; a tela usa 2px e a carcaça 3px. O retrato da coleção usa um quadro LCD com cantos de scanner em CSS. A pequena dobradiça lateral e as ranhuras no rodapé são decoração sem interação.

## Components

### Buttons

Teclas compactas com resposta tátil.

- **Primary:** vermelho de ação, texto claro, borda escura, peso 750 e relevo interno.
- **Secondary:** campo claro com tinta escura e relevo inferior.
- **Size:** altura mínima de 40px e preenchimento de 8px/12px. Controles compactos dos perfis usam 36px no desktop e 40px até 500px; ações do título usam 42px até 760px.
- **States:** hover altera fundo/borda; active desloca 1px para baixo. Transições de cor e transformação duram 120ms com `ease-out`. Desabilitados usam opacidade 0,52, sem sombra nem som.
- **Focus:** contorno de 3px no token `focus`, afastado 3px. O modo de cores forçadas preserva bordas visíveis.

### Inputs / Fields

Busca, números e seletores usam o mesmo campo claro, borda verde acinzentada, canto de controle e altura mínima de 40px. Os rótulos ficam acima ou junto ao controle; placeholders não substituem rótulos. O cursor usa a cor escura da carcaça. Validação existente do planejador usa borda âmbar em `aria-invalid="true"`.

### Navigation

As três teclas “Caça”, “Meus Pokémon” e “Mercado” ficam dentro da carcaça. A tecla atual usa fundo marfim, tinta escura e `aria-current`; as demais usam vermelho mais escuro. Têm altura mínima de 48px no desktop e 42px até 500px. A navegação quebra por linha do cabeçalho, sem transformar os nomes em ícones.

### Status and Type Chips

Estados combinam bolinha, texto e superfície tonal; admitem quebra de linha. Verde representa caçando/pronto, âmbar pede atenção e azul claro indica recuperação. Os chips de tipo usam o nome da categoria e sua cor, com borda na cor do texto. Shiny usa uma variante dourada. Chips não ganham interação só por terem aparência de etiqueta.

### Cards / Containers

Perfis têm cabeçalho verde mais profundo, nome/estado, visualização quando disponível e informações agrupadas abaixo. A visualização mantém o conteúdo real do jogo; não é um fundo decorativo. Os instrumentos do resumo usam gradiente `linear-gradient(120deg, #e4edcf, #d0e0bd)`, borda e brilho interno. Tabelas seguem o mesmo LCD, com cabeçalho tonal, divisórias e linhas destacadas ao apontar.

Cartões da coleção usam retrato amplo, identidade, tipos e métricas. Hover muda borda e fundo; seleção usa contorno vermelho de 2px voltado para dentro. O quadro de retrato usa `linear-gradient(145deg, #d9e9ba, #b7d099)`; os cantos de scanner são CSS e a arte exibida vem dos dados do jogo. As prévias do sidecar deixam a área de arte vazia para não inventar um ativo.

### Scanner Lens

A lente é a assinatura do cabeçalho: 70px, reduzida para 56px até 500px, com aro claro, contorno escuro, gradiente radial ciano e dois reflexos. Os indicadores ao lado são vermelhos, amarelos e verdes. Ambos são decoração com `aria-hidden`; a conexão tem seu próprio texto de estado.

### Sound Control

O botão mostra “Som ligado” ou “Sem som”, usa `aria-pressed` e guarda a preferência em `localStorage` sob `idlebot.sound.enabled`. No celular estreito, o desenho de barras continua visível e o nome acessível permanece.

O áudio é sintetizado por Web Audio, com onda quadrada, duração total de 95ms e ganho máximo de 0,035. Um clique comum alterna 783,99Hz/1046,5Hz; confirmação alterna 1046,5Hz/1568Hz. Apenas interações reais com controles habilitados disparam som; não há autoplay nem som de atualização de dados. A ausência de Web Audio ou armazenamento não impede o funcionamento dos controles. A preferência acompanha outras abas pelo evento de armazenamento.

### Dialogs and Mobile Monitor

Diálogos seguem a tela marfim com moldura vermelha de 6px, raio de 16px e contorno escuro. O QR permanece sobre branco e é aberto no computador. O monitor do celular reutiliza os perfis e indica “Somente leitura”; os dados não são acompanhados por comandos operacionais.

O link “Ir para o conteúdo” aparece ao receber foco. Em `prefers-reduced-motion: reduce`, transições, animações e rolagem animada são desativadas. Em cores forçadas, lente/indicadores preservam a decoração, enquanto bordas e seleção dos controles usam cores de sistema.

## Do's and Don'ts

### Do:

- **Do** construir a identidade com carcaça, lente, contornos e painéis reais em CSS.
- **Do** manter foco visível ciano, nomes acessíveis e a indicação textual dos estados.
- **Do** usar algarismos tabulares em comparações, métricas e tabelas.
- **Do** reservar uma linha completa para a busca no celular e manter os filtros com rótulos.
- **Do** preservar a leitura em uma coluna dos perfis no celular e duas colunas na coleção.
- **Do** respeitar movimento reduzido e permitir silenciar os sons de interface.

### Don't:

- **Don't** colocar uma imagem de mockup por cima dos controles operacionais.
- **Don't** usar vermelho de carcaça como único indicador de erro ou urgência.
- **Don't** reduzir o microtexto do tema abaixo de 11px para acomodar mais conteúdo.
- **Don't** emitir sons em atualizações automáticas, controles desabilitados ou páginas ocultas.
- **Don't** transformar o monitor do celular em uma superfície de comandos.
- **Don't** apresentar dados demonstrativos ou imagens geradas como capturas reais do jogo.

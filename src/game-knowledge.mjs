// Coverage describes implemented behavior, never an invented command or a claim of complete automation.
export const GAME_KNOWLEDGE = {
  version: '1.420.0', reviewedAt: '2026-11-13', source: 'https://pokeidle.io/pokepedia.mjs',
  systems: [
    ['Progressão, mapa e Hunt Analyser', 'supported', 'Compara XP líquido medido e rotas liberadas; bloqueia hunts com desmaios recorrentes.'],
    ['Combate, cura e suprimentos', 'supported', 'Usa automações nativas, cura no Centro e repõe dentro da reserva de ouro.'],
    ['Equipe, atributos e tipos', 'supported', 'Reavalia o principal com poder oficial e tipos; preenche vagas sem retirar membros nem usar a Coleção.'],
    ['Evolução e pedras', 'partial', 'Executa cadeias determinísticas conhecidas; ramificações e transformações especiais permanecem preservadas.'],
    ['Captura e shiny', 'supported', 'Usa o planejador de captura, estoque de bolas e confirmações do servidor.'],
    ['Outland', 'supported', 'Compara drops observados, perdas e consumo; prepara recursos para vender ou desenvolver a conta.'],
    ['Passe de Batalha', 'supported', 'Resgata a trilha disponível no dia do servidor; não compra VIP.'],
    ['Casas e XP Share', 'supported', 'Ativa casas, preenche postos vazios com reservas e equipa XP Share sem sobrepor equipamentos.'],
    ['Bicicletas', 'supported', 'Equipa a melhor bicicleta própria após o cooldown e reinicia a comparação de XP.'],
    ['Fabricação inicial', 'supported', 'Reserva fragmentos e fabrica a primeira casa e a primeira bicicleta; excedentes continuam disponíveis para venda.'],
    ['Chocadeira e Mystery Eggs', 'supported', 'Incuba P2–P4 já obtidos em slots livres, priorizando potência. Nascimento é automático.'],
    ['Eventos, bônus e dias sazonais', 'supported', 'Reavalia as condições de XP e adia atividades que competem com um evento priorizado.'],
    ['Ginásios e bosses', 'supported', 'Verifica força, equipe, tipos, fichas e tentativas antes de disputar; confirma resultado e retorno à caça.'],
    ['Mercado, Gemas e taxas', 'supported', 'Cota vendas comparáveis, preserva reservas estratégicas e contabiliza apenas vendas confirmadas.'],
    ['Pokédex, coleção e rankings', 'observed', 'Consulta espécies e inventário; completar a Pokédex inteira não é uma rotina executável nesta versão.'],
    ['Ovo Shiny e Shiny Stone', 'observed', 'Recursos reconhecidos e preservados; transformação ainda não integrada à execução.'],
    ['Mega, refino, TMs e Z-Moves', 'observed', 'Regras mapeadas; não aplica alterações permanentes sem um avaliador específico de custo e benefício.'],
    ['Oferenda e Sacrifício', 'observed', 'Não destrói Pokémon. As regras foram mapeadas, mas a seleção para consumo não está integrada.'],
    ['Safári', 'supported', 'Avalia coleção, nível, vagas, estoque e eventos; usa ticket próprio, captura alvos úteis e confirma o retorno à caça.'],
    ['PvP ranqueado', 'supported', 'A partir do nível 150 prepara formação própria, busca partidas enquanto caça e respeita orçamento diário, cooldown e pausas por derrotas.'],
    ['Raid semanal', 'supported', 'Verifica edição e prazos, reserva ficha, inscreve uma vez e prepara a formação. Batalha e bônus são automáticos no servidor.'],
    ['Arena Mística', 'observed', 'Regras reconhecidas; tickets preservados, sem executor específico.'],
    ['PvP amistoso e treinamento', 'observed', 'Regras reconhecidas; a rotina automática participa somente do ranqueado.'],
    ['Guilds e guerras', 'observed', 'Bônus recebidos entram no contexto de caça; filiação e guerras não são alteradas.'],
    ['Campeonatos, Showdown e minigames', 'observed', 'Conteúdo identificado; ainda sem rotina autônoma específica.'],
    ['Loja, indicações, votos, Twitch e Kick', 'observed', 'Lê bônus recebidos; não compra moeda premium nem opera serviços externos.'],
    ['Chat, amigos, Comércio e cosméticos', 'observed', 'Não envia mensagens nem realiza trocas diretas ou alterações cosméticas.'],
  ].map(([title, status, reason]) => ({ title, status, reason })),
};

export function gameCoverage(state) {
  const hunts = state.hunts ?? [];
  return { version: GAME_KNOWLEDGE.version, reviewedAt: GAME_KNOWLEDGE.reviewedAt,
    hunts: { known: hunts.length, unlocked: hunts.filter((hunt) => hunt.nivel <= (state.player?.level ?? 0)).length },
    systems: GAME_KNOWLEDGE.systems };
}

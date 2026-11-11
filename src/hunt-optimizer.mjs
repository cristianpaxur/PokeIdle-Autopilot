export const HUNT_TRIAL_MS = 90_000;
const BEST_HOLD_MS = 300_000;
const FRESH_MS = 30 * 60_000;

export class HuntOptimizer {
  context = null;
  samples = [];
  trial = null;
  plan = null;
  baseline = null;
  burst = 0;
  stage = 'waiting';
  level = 0;
  now = 0;
  recovering = false;

  constructor({ load, save }) {
    this.load = load;
    this.save = save;
  }

  observe({ enabled, player, pokemon }, now = Date.now()) {
    if (!enabled || !Number.isFinite(player?.xp) || !Number.isFinite(pokemon?.xp)) {
      this.suspend();
      return;
    }
    const context = JSON.stringify([pokemon.id, pokemon.speciesId, pokemon.potencia, pokemon.quality,
      pokemon.ivs, pokemon.refino, pokemon.heldItemId, pokemon.tmElemental, pokemon.tmAoe,
      now < (player.loja?.vipAte ?? 0), now < (player.loja?.boosts?.xp ?? 0),
      now < (player.loja?.boosts?.pokexp ?? 0), player.guildBonusPct ?? 0,
      now < (player.guild?.boostAte ?? 0), player.automation?.autoPotion, player.automation?.autoRevive]);
    if (context !== this.context) {
      this.suspend();
      this.context = context;
      this.samples = this.load(context);
      this.burst = this.samples.some((sample) => sample.complete) ? 3 : 0;
    }
    this.now = now;
    this.level = pokemon.level;
    this.recovering = Boolean(player.noCentro);
    const baseline = { at: now, trainerXp: player.xp, pokemonXp: pokemon.xp };
    if (this.trial && !player.noCentro && player.huntSlug !== this.trial.slug) this.finish(false, now);
    if (!this.trial && this.plan?.slug === player.huntSlug && !player.noCentro) {
      this.trial = { slug: this.plan.slug, startedAt: now, durationMs: 0, trainerXp: 0,
        pokemonXp: 0, faints: 0, kills: 0, pokemonLevel: pokemon.level, targetMs: this.plan.targetMs };
      this.baseline = baseline;
    }
    if (this.trial && this.baseline) {
      const duration = now - this.baseline.at;
      if (duration < 0) {
        this.suspend();
        return;
      }
      this.trial.durationMs += duration;
      this.trial.trainerXp += player.xp - this.baseline.trainerXp;
      this.trial.pokemonXp += pokemon.xp - this.baseline.pokemonXp;
    }
    this.baseline = baseline;
  }

  recordBattle(events) {
    if (!this.trial) return;
    for (const event of events) {
      if (event.k !== 'morte') continue;
      if (event.quem === 'selvagem') this.trial.kills++;
      else if (event.quem) this.trial.faints++;
    }
  }

  finish(complete, now) {
    const trial = this.trial;
    if (!trial) return;
    this.trial = null;
    this.plan = null;
    this.stage = 'comparing';
    if (trial.durationMs <= 0 || (trial.durationMs < 30_000 && trial.faints < 2)) return;
    const sample = { ...trial, context: this.context, endedAt: now, complete };
    this.save(sample);
    this.samples = [...this.samples.filter((row) => now - row.endedAt <= FRESH_MS), sample];
  }

  suspend() {
    if (this.trial?.faints >= 2) this.finish(false, this.now);
    this.trial = null;
    this.plan = null;
    this.baseline = null;
    this.stage = 'waiting';
  }

  ranking(now = this.now) {
    const groups = new Map();
    for (const sample of this.samples) {
      if (!sample.complete || sample.durationMs < HUNT_TRIAL_MS || now - sample.endedAt > FRESH_MS
        || Math.abs(sample.pokemonLevel - this.level) > Math.max(5, this.level * 0.2)) continue;
      const group = groups.get(sample.slug) ?? [];
      groups.set(sample.slug, [...group, sample].slice(-3));
    }
    return [...groups].map(([slug, samples]) => {
      const sum = (key) => samples.reduce((total, row) => total + row[key], 0);
      const durationMs = sum('durationMs');
      return { slug, durationMs, trainerXpPerHour: sum('trainerXp') * 3_600_000 / durationMs,
        pokemonXpPerHour: sum('pokemonXp') * 3_600_000 / durationMs,
        faints: sum('faints'), kills: sum('kills'), observations: samples.length,
        measuredAt: samples.at(-1).endedAt };
    }).sort((a, b) => b.trainerXpPerHour - a.trainerXpPerHour
      || a.faints - b.faints || b.pokemonXpPerHour - a.pokemonXpPerHour);
  }

  blockedHunts(now = this.now) {
    const blocked = new Set(this.samples.filter((sample) => !sample.complete && sample.faints >= 2
      && now - sample.endedAt < 600_000).map(({ slug }) => slug));
    if (this.trial?.faints >= 2) blocked.add(this.trial.slug);
    return blocked;
  }

  choose(candidates, player, now = Date.now()) {
    this.now = now;
    const blocked = this.blockedHunts(now);
    candidates = candidates.filter(({ slug }) => !blocked.has(slug));
    if (!candidates.length) {
      this.finish(false, now);
      return null;
    }
    const planned = candidates.find(({ slug }) => slug === this.plan?.slug);
    if (planned && (!this.trial || this.trial.durationMs < this.trial.targetMs || this.recovering)) return planned;
    if (planned) this.finish(true, now);
    if (this.trial) this.finish(false, now);
    this.plan = null;
    const ranked = this.ranking(now);
    const best = ranked.find((row) => candidates.some(({ slug }) => slug === row.slug));
    const measured = new Set(ranked.map(({ slug }) => slug));
    const untested = candidates.filter(({ slug }) => !measured.has(slug));
    let chosen;
    if (untested.length && (this.burst < 3 || !best)) {
      chosen = untested.find(({ slug }) => slug === player.huntSlug)
        ?? [...untested].sort((a, b) => b.nivel - a.nivel)[0];
      this.stage = 'measuring';
      this.burst++;
    } else {
      chosen = candidates.find(({ slug }) => slug === best?.slug) ?? candidates[0];
      this.stage = 'best';
      this.burst = 0;
    }
    this.plan = { slug: chosen.slug, targetMs: this.stage === 'best' ? BEST_HOLD_MS : HUNT_TRIAL_MS };
    return chosen;
  }

  snapshot() {
    return { stage: this.stage, trial: this.trial && { slug: this.trial.slug,
      elapsedMs: this.trial.durationMs, targetMs: this.trial.targetMs, faints: this.trial.faints },
    chosen: this.plan?.slug ?? null, ranking: this.ranking(),
    rejected: this.samples.filter((sample) => !sample.complete && sample.faints > 0).slice(-10)
      .map((sample) => ({ slug: sample.slug, faints: sample.faints, durationMs: sample.durationMs,
        trainerXpPerHour: sample.trainerXp * 3_600_000 / sample.durationMs,
        pokemonXpPerHour: sample.pokemonXp * 3_600_000 / sample.durationMs })) };
  }
}

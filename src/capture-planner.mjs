import { pokemonAtlas } from './catalog.mjs';
import { captureEnabled, captureTargets, capturePlan } from './capture-policy.mjs';

export class CapturePlanner {
  constructor(planner) { this.planner = planner; this.reset(); }
  get session() { return this.planner.session; }
  reset() { this.epoch = (this.epoch ?? 0) + 1; this.chances = {}; this.chancesKey = null; this.nextPrepare = 0; this.lastAttempt = null; this.plan = null; }
  input() {
    const { state } = this.session;
    const safari = this.planner.activities.advanced.captureInput();
    if (safari) return safari;
    return { settings: this.planner.settings, phase: this.session.phase(), player: state.player ?? {},
      hunt: state.hunts.find(({ slug }) => slug === state.player?.huntSlug), balls: state.balls,
      shinyLooks: { ...state.shinyLooks, ...state.shinyLooksOutland } };
  }
  key(input = this.input()) {
    return JSON.stringify([this.session.state.generation, input.hunt?.slug, this.session.state.captureRules, input.balls,
      captureTargets(input).map(({ id }) => [id, this.planner.species[id]?.priceNpc, this.planner.species[id]?.tetoCaptura])]);
  }
  refresh(rate = 0) {
    const input = this.input();
    this.plan = capturePlan({ ...input, rate, chances: this.key(input) === this.chancesKey ? this.chances : {} });
    return this.plan;
  }
  async prepare() {
    const { session, planner } = this;
    const input = this.input();
    if (!session.active() || !captureEnabled(input.settings, input.phase) || !captureTargets(input).length) return;
    const key = this.key(input);
    if (key === this.chancesKey || Date.now() < this.nextPrepare) return;
    this.nextPrepare = Date.now() + 15_000;
    const browser = session.browser, account = session.account, settings = planner.settings, epoch = this.epoch, phase = session.phase();
    const valid = () => session.active() && session.browser === browser && session.account === account
      && planner.settings === settings && this.epoch === epoch && session.phase() === phase;
    if (captureTargets(input).some(({ id }) => planner.species[id]?.priceNpc == null)) {
      const atlas = await pokemonAtlas().catch(() => null);
      if (!valid()) return;
      if (atlas?.species) planner.species = atlas.species;
    }
    const fresh = this.input(), freshKey = this.key(fresh);
    const chances = await browser.captureChances?.({ species: planner.species, targets: captureTargets(fresh),
      hunts: session.state.hunts, balls: fresh.balls, rules: session.state.captureRules });
    if (!valid() || freshKey !== this.key() || !chances) return;
    this.chances = chances; this.chancesKey = freshKey;
    planner.refresh();
  }
  async run() {
    const { session, planner } = this;
    this.refresh();
    const p = session.state.player;
    const inContext = () => session.onStrategyHunt() || planner.activities.current?.kind === 'safari'
      && planner.activities.current.stage === 'capturing' && session.state.player?.safari?.dentro;
    if (!session.active() || !inContext() || !this.plan.enabled
      || p?.automation?.autoBallSemParar !== false || p?.automation?.autoBallAteCapturar !== false
      || !this.plan.targets.some(({ available }) => available)) return false;
    const browser = session.browser, account = session.account, settings = planner.settings, hunt = p.huntSlug;
    const phase = session.phase(), epoch = this.epoch, generation = session.state.generation;
    const canAct = () => session.active() && session.browser === browser && session.account === account
      && planner.settings === settings && session.state.player?.huntSlug === hunt && inContext()
      && session.phase() === phase && this.epoch === epoch && session.state.generation === generation
      && captureEnabled(this.input().settings, this.input().phase)
      && session.state.player?.automation?.autoBallSemParar === false && session.state.player?.automation?.autoBallAteCapturar === false;
    const visible = await browser.captureTargets();
    if (!canAct()) return false;
    this.refresh();
    if (this.input().phase === 'safari') {
      const order = new Map(this.plan.targets.map((target, index) => [target.name, index]));
      visible.sort((a, b) => (order.get(a.name) ?? Infinity) - (order.get(b.name) ?? Infinity));
    }
    for (const target of visible) {
      const choice = this.plan.targets.find(({ name, available }) => name === target.name && available);
      if (!choice) continue;
      const attempt = { at: Date.now(), slot: target.slot, speciesId: choice.id, name: choice.name,
        ballId: choice.available.id, ballName: choice.available.name, chance: choice.available.chance, status: 'pending' };
      this.lastAttempt = attempt;
      const canThrow = () => canAct() && (session.state.player?.balls?.[choice.available.id] ?? 0) > 0;
      const sent = await browser.capture(target, choice.available, canThrow);
      if (!sent && this.lastAttempt === attempt && attempt.status === 'pending') this.lastAttempt = null;
      return sent;
    }
    return false;
  }
  record(message, now = Date.now()) {
    const last = this.lastAttempt;
    if (!last || last.status !== 'pending' || now - last.at > 15000 || message.t !== 'batalha') return;
    const event = message.ev?.find((e) => e.k === 'bola' && Number(e.ballId) === last.ballId && String(e.slot) === last.slot);
    if (event && typeof event.sucesso === 'boolean') last.status = event.sucesso ? 'caught' : 'miss';
  }
  snapshot() {
    const plan = this.plan ?? this.refresh();
    return { enabled: plan.enabled, title: plan.title, reason: plan.reason,
      targets: plan.targets.map(({ id, name, preferred, available, reason }) => ({ id, name, preferred, available, reason })),
      balls: this.session.state.balls.map((b) => ({ id: b.id, name: b.nome ?? b.name, priceGold: b.priceGold,
        purchasable: b.compravel === true, have: this.session.state.player?.balls?.[b.id] ?? 0 })),
      lastAttempt: this.lastAttempt && { ...this.lastAttempt,
        status: this.lastAttempt.status === 'pending' && Date.now() - this.lastAttempt.at > 15000 ? 'uncertain' : this.lastAttempt.status } };
  }
}

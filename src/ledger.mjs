import { DatabaseSync } from 'node:sqlite';
import { itemQuantity, netGems } from './policy.mjs';

const nickKey = (nick) => String(nick ?? '').trim().toLowerCase();
const HOUR = 3_600_000;
const phaseNames = ['progression', 'outland', 'shiny'];
const statsSql = `sum(hunt_ms) AS huntMs, sum(kills) AS kills, sum(drops) AS drops,
  sum(encounters) AS encounters, sum(balls) AS balls, sum(supply_gold) AS supplyGold, sum(faints) AS faints`;

export class Ledger {
  constructor(file) {
    this.db = new DatabaseSync(file);
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA busy_timeout = 3000;
      CREATE TABLE IF NOT EXISTS captures (
        account TEXT NOT NULL,
        id INTEGER NOT NULL,
        data TEXT NOT NULL,
        captured_at INTEGER NOT NULL,
        quote TEXT,
        checked_at INTEGER,
        PRIMARY KEY (account, id)
      ) STRICT;
      CREATE TABLE IF NOT EXISTS operations (
        account TEXT NOT NULL,
        kind TEXT NOT NULL,
        key TEXT NOT NULL,
        state TEXT NOT NULL,
        data TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (account, kind, key)
      ) STRICT;
      CREATE UNIQUE INDEX IF NOT EXISTS one_pending_action
        ON operations(account, kind) WHERE state IN ('pending', 'uncertain');
      CREATE TABLE IF NOT EXISTS sales (
        account TEXT NOT NULL,
        id TEXT NOT NULL,
        data TEXT NOT NULL,
        PRIMARY KEY (account, id)
      ) STRICT;
      CREATE TABLE IF NOT EXISTS profiles (
        profile INTEGER PRIMARY KEY,
        account TEXT NOT NULL UNIQUE COLLATE NOCASE
      ) STRICT;
      CREATE TABLE IF NOT EXISTS preferences (
        profile INTEGER PRIMARY KEY,
        enabled INTEGER NOT NULL CHECK (enabled IN (0, 1))
      ) STRICT;
      CREATE TABLE IF NOT EXISTS farm_modes (
        profile INTEGER PRIMARY KEY,
        mode TEXT NOT NULL CHECK (mode IN ('farm', 'shiny'))
      ) STRICT;
      CREATE TABLE IF NOT EXISTS farm_stats (
        account TEXT PRIMARY KEY,
        hunt_ms INTEGER NOT NULL
      ) STRICT;
      CREATE TABLE IF NOT EXISTS training_pokemon (
        account TEXT PRIMARY KEY,
        pokemon_id INTEGER NOT NULL
      ) STRICT;
      CREATE TABLE IF NOT EXISTS farm_hours (
        account TEXT NOT NULL, hour INTEGER NOT NULL, phase TEXT NOT NULL, slug TEXT NOT NULL,
        hunt_ms INTEGER NOT NULL, kills INTEGER NOT NULL, drops INTEGER NOT NULL,
        encounters INTEGER NOT NULL, balls INTEGER NOT NULL, supply_gold INTEGER NOT NULL, faints INTEGER NOT NULL,
        PRIMARY KEY (account, hour, phase, slug)
      ) STRICT;
      CREATE TABLE IF NOT EXISTS item_quotes (
        account TEXT NOT NULL, item_id INTEGER NOT NULL, checked_at INTEGER NOT NULL, data TEXT NOT NULL,
        PRIMARY KEY (account, item_id)
      ) STRICT;
      CREATE TABLE IF NOT EXISTS hunt_samples (
        account TEXT NOT NULL,
        context TEXT NOT NULL,
        slug TEXT NOT NULL,
        started_at INTEGER NOT NULL,
        ended_at INTEGER NOT NULL,
        data TEXT NOT NULL,
        PRIMARY KEY (account, context, slug, started_at)
      ) STRICT;
    `);
  }

  bind(profile, account) {
    this.db.prepare('INSERT OR IGNORE INTO profiles VALUES (?, ?)').run(profile, account);
    return this.db.prepare('SELECT account FROM profiles WHERE profile = ?').get(profile)?.account === account;
  }

  accounts() {
    return this.db.prepare('SELECT account FROM profiles ORDER BY profile').all().map((row) => row.account);
  }

  profileAccount(profile) {
    return this.db.prepare('SELECT account FROM profiles WHERE profile = ?').get(profile)?.account ?? null;
  }

  enabled(profile) {
    const row = this.db.prepare('SELECT enabled FROM preferences WHERE profile = ?').get(profile);
    return row ? Boolean(row.enabled) : undefined;
  }

  setEnabled(profile, enabled) {
    this.db.prepare('INSERT OR REPLACE INTO preferences VALUES (?, ?)').run(profile, Number(enabled));
  }

  mode(profile) {
    return this.db.prepare('SELECT mode FROM farm_modes WHERE profile = ?').get(profile)?.mode;
  }

  setMode(profile, mode) {
    this.db.prepare('INSERT OR REPLACE INTO farm_modes VALUES (?, ?)').run(profile, mode);
  }

  trainingPokemon(account) {
    return this.db.prepare('SELECT pokemon_id FROM training_pokemon WHERE account = ?').get(account)?.pokemon_id;
  }

  setTrainingPokemon(account, id) {
    this.db.prepare('INSERT OR REPLACE INTO training_pokemon VALUES (?, ?)').run(account, id);
  }

  addFarmTime(account, milliseconds) {
    if (!Number.isSafeInteger(milliseconds) || milliseconds <= 0) return;
    this.db.prepare(`INSERT INTO farm_stats VALUES (?, ?)
      ON CONFLICT(account) DO UPDATE SET hunt_ms = hunt_ms + excluded.hunt_ms`).run(account, milliseconds);
  }

  recordFarm(account, phase, slug, stats, now = Date.now()) {
    const values = ['huntMs', 'kills', 'drops', 'encounters', 'balls', 'supplyGold', 'faints']
      .map((key) => Number.isSafeInteger(stats[key]) && stats[key] > 0 ? stats[key] : 0);
    if (!values.some(Boolean)) return;
    const hour = Math.floor(now / HOUR);
    const upsert = this.db.prepare(`INSERT INTO farm_hours VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(account, hour, phase, slug) DO UPDATE SET
      hunt_ms = hunt_ms + excluded.hunt_ms, kills = kills + excluded.kills, drops = drops + excluded.drops,
      encounters = encounters + excluded.encounters, balls = balls + excluded.balls,
      supply_gold = supply_gold + excluded.supply_gold, faints = faints + excluded.faints`);
    if (values[0]) {
      this.db.exec('BEGIN');
      try {
        upsert.run(account, hour, phase, slug, ...values);
        this.addFarmTime(account, values[0]);
        this.db.exec('COMMIT');
      } catch (error) {
        this.db.exec('ROLLBACK');
        throw error;
      }
    } else {
      upsert.run(account, hour, phase, slug, ...values);
    }
    if (this.lastFarmPrune !== hour) {
      this.db.prepare('DELETE FROM farm_hours WHERE hour < ?').run(hour - 168);
      this.lastFarmPrune = hour;
    }
  }

  farmRoutes(account, phase, now = Date.now()) {
    return this.db.prepare(`SELECT slug, ${statsSql} FROM farm_hours
      WHERE account = ? AND phase = ? AND hour >= ? GROUP BY slug`)
      .all(account, phase, Math.floor(now / HOUR) - 23);
  }

  farmPeriods(account, now = Date.now()) {
    const firstHour = Math.floor(now / HOUR);
    const read = (hours) => {
      const since = (firstHour - hours + 1) * HOUR;
      const rows = this.db.prepare(`SELECT phase, ${statsSql} FROM farm_hours
        WHERE account = ? AND hour >= ? GROUP BY phase`).all(account, since / HOUR);
      const sales = this.db.prepare(`SELECT CASE WHEN id LIKE 'item:%' THEN 'outland' ELSE 'shiny' END AS phase,
          count(*) AS sales, sum(json_extract(data, '$.net')) AS gems
        FROM sales WHERE account = ? AND json_extract(data, '$.farm') = 1 AND json_extract(data, '$.time') >= ?
        GROUP BY phase`).all(account, since);
      return Object.fromEntries(phaseNames.map((phase) => [phase, {
        huntMs: 0, kills: 0, drops: 0, encounters: 0, balls: 0, supplyGold: 0, faints: 0, sales: 0, gems: 0,
        ...rows.find((row) => row.phase === phase), ...sales.find((row) => row.phase === phase),
      }]));
    };
    return { today: read(24), week: read(168) };
  }

  saveItemQuote(account, itemId, result, now = Date.now()) {
    this.db.prepare('INSERT OR REPLACE INTO item_quotes VALUES (?, ?, ?, ?)')
      .run(account, itemId, now, JSON.stringify(result));
  }

  itemQuotes(account) {
    return new Map(this.db.prepare('SELECT * FROM item_quotes WHERE account = ?').all(account)
      .map((row) => [row.item_id, { ...JSON.parse(row.data), checkedAt: row.checked_at }]));
  }

  saveHuntSample(account, sample) {
    this.db.prepare('INSERT OR REPLACE INTO hunt_samples VALUES (?, ?, ?, ?, ?, ?)')
      .run(account, sample.context, sample.slug, sample.startedAt, sample.endedAt, JSON.stringify(sample));
    this.db.prepare('DELETE FROM hunt_samples WHERE account = ? AND ended_at < ?')
      .run(account, sample.endedAt - 86_400_000);
  }

  huntSamples(account, context, now = Date.now()) {
    return this.db.prepare(`SELECT data FROM hunt_samples WHERE account = ? AND context = ?
      AND ended_at >= ? ORDER BY ended_at DESC LIMIT 500`).all(account, context, now - 30 * 60_000)
      .reverse().map(({ data }) => JSON.parse(data));
  }

  addCapture(account, capture, time = Date.now()) {
    return Boolean(this.db.prepare('INSERT OR IGNORE INTO captures VALUES (?, ?, ?, ?, NULL, NULL)')
      .run(account, capture.id, JSON.stringify(capture), time).changes);
  }

  captures(account, limit = 100) {
    return this.db.prepare(`SELECT captures.*, operations.state AS listing_state
      FROM captures LEFT JOIN operations ON operations.account = captures.account
      AND operations.kind = 'listing' AND operations.key = CAST(captures.id AS TEXT)
      WHERE captures.account = ? ORDER BY captured_at DESC, id DESC LIMIT ?`)
      .all(account, limit).map((row) => ({
        ...JSON.parse(row.data), time: row.captured_at,
        quote: row.quote ? JSON.parse(row.quote) : null, checkedAt: row.checked_at, listing: row.listing_state,
      }));
  }

  nextCandidate(account, before, shinyOnly = false) {
    const row = this.db.prepare(`SELECT captures.data FROM captures
      WHERE account = ? AND coalesce(checked_at, 0) <= ? AND (? = 0 OR json_extract(captures.data, '$.shiny') = 1)
      AND NOT EXISTS (SELECT 1 FROM operations WHERE operations.account = captures.account
        AND kind = 'listing' AND key = CAST(captures.id AS TEXT) AND state != 'returned')
      ORDER BY coalesce(checked_at, 0), captured_at LIMIT 1`).get(account, before, Number(shinyOnly));
    return row ? JSON.parse(row.data) : null;
  }

  saveQuote(account, id, result, now = Date.now()) {
    this.db.prepare('UPDATE captures SET quote = ?, checked_at = ? WHERE account = ? AND id = ?')
      .run(JSON.stringify(result), now, account, id);
  }

  begin(account, kind, key, data) {
    const now = Date.now();
    if (kind === 'listing' && this.db.prepare(`UPDATE OR IGNORE operations
      SET state = 'pending', data = ?, created_at = ?, updated_at = ?
      WHERE account = ? AND kind = 'listing' AND key = ? AND state = 'returned'`)
      .run(JSON.stringify(data), now, now, account, key).changes) return true;
    return Boolean(this.db.prepare('INSERT OR IGNORE INTO operations VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(account, kind, key, 'pending', JSON.stringify(data), now, now).changes);
  }

  finish(account, kind, key, state, details = {}) {
    this.db.prepare(`UPDATE operations SET state = ?, updated_at = ?, data = json_patch(data, ?)
      WHERE account = ? AND kind = ? AND key = ? AND state IN ('pending', 'uncertain')`)
      .run(state, Date.now(), JSON.stringify(details), account, kind, key);
  }

  updateListing(account, kind, key, details) {
    return Boolean(this.db.prepare(`UPDATE operations SET data = json_patch(data, ?)
      WHERE account = ? AND kind = ? AND key = ? AND state = 'confirmed'`)
      .run(JSON.stringify(details), account, kind, key).changes);
  }

  operations(account, kind, limit = 20) {
    return this.db.prepare(`SELECT * FROM operations WHERE account = ? AND kind = ?
      ORDER BY created_at DESC LIMIT ?`).all(account, kind, limit).map((row) => ({
        key: row.key, state: row.state, time: row.created_at, ...JSON.parse(row.data),
      }));
  }

  pending(account, kind) {
    return Boolean(this.db.prepare(`SELECT 1 FROM operations WHERE account = ?
      AND kind = ? AND state IN ('pending', 'uncertain')`).get(account, kind));
  }

  openListings(account) {
    return this.db.prepare(`SELECT kind, key, state, data, created_at AS time FROM operations WHERE account = ?
      AND kind IN ('listing', 'item-listing') AND state IN ('pending', 'uncertain', 'confirmed')
      ORDER BY created_at`).all(account).map(({ data, ...row }) => ({ ...row, ...JSON.parse(data) }));
  }

  returnListing(account, key, kind = 'listing') {
    this.db.prepare(`UPDATE operations SET state = 'returned', updated_at = ? WHERE account = ?
      AND kind = ? AND key = ? AND state IN ('pending', 'uncertain', 'confirmed')`)
      .run(Date.now(), account, kind, key);
  }

  addSale(account, sale) {
    if (sale.moeda !== 'orb' || !['pokemon', 'item'].includes(sale.tipo)) return;
    if (sale.vendedor && nickKey(sale.vendedor) !== nickKey(account)) return;
    const buyer = nickKey(sale.comprador);
    if (buyer && this.accounts().some((nick) => nickKey(nick) === buyer)) return;
    const item = sale.tipo === 'item';
    const product = Number(item ? sale.itemId : sale.pokemonId ?? sale.ficha?.id);
    const soldAt = Number(sale.em);
    const gross = Number(sale.bruto);
    const quantity = item ? itemQuantity(sale) : 1;
    if (item && (!Number.isSafeInteger(product) || product <= 0 || !Number.isSafeInteger(quantity) || quantity <= 0)) return;
    if (!Number.isSafeInteger(soldAt) || soldAt <= 0 || !Number.isSafeInteger(gross) || gross <= 0) return;
    const id = sale.id ?? sale.anuncioId ?? (product > 0 ? JSON.stringify([soldAt, product, buyer, gross, quantity]) : null);
    if (id == null) return;
    const net = Number.isSafeInteger(sale.liquido) ? sale.liquido
      : item ? gross - Math.ceil(gross * 0.15) : netGems(gross);
    if (!Number.isSafeInteger(net) || net <= 0) return;
    const kind = item ? 'item-listing' : 'listing';
    const saleKey = item ? `item:${id}` : String(id);
    this.db.exec('BEGIN');
    try {
      const listings = this.openListings(account).filter((entry) => entry.kind === kind && entry.time <= soldAt);
      if (item && sale.anuncioId != null) {
        const returned = this.db.prepare(`SELECT key, data FROM operations WHERE account = ? AND kind = ?
          AND state = 'returned' AND created_at <= ?
          AND CAST(json_extract(data, '$.listingId') AS TEXT) = ?`)
          .get(account, kind, soldAt, String(sale.anuncioId));
        if (returned) listings.push({ key: returned.key, ...JSON.parse(returned.data) });
      }
      const candidates = item ? listings.filter((entry) => entry.itemId === product && entry.quantity === quantity
        && (sale.anuncioId != null && entry.listingId != null
          ? String(entry.listingId) === String(sale.anuncioId)
          : entry.gems === gross && (entry.state === 'confirmed' || entry.acknowledged)))
        : listings.filter((entry) => entry.key === String(product) && entry.gems === gross
          && (sale.anuncioId == null || entry.listingId == null || String(entry.listingId) === String(sale.anuncioId)));
      const exact = item && sale.anuncioId != null
        ? candidates.find((entry) => String(entry.listingId) === String(sale.anuncioId)) : null;
      const listing = exact ?? (candidates.length === 1 ? candidates[0] : null);
      const saved = this.db.prepare(`INSERT INTO sales VALUES (?, ?, ?)
        ON CONFLICT(account, id) DO UPDATE SET data = excluded.data
        WHERE json_extract(sales.data, '$.listingKey') IS NULL
          AND json_extract(excluded.data, '$.listingKey') IS NOT NULL`)
        .run(account, saleKey, JSON.stringify({ id, net, time: soldAt, name: sale.descricao,
          listingKey: listing?.key, farm: Boolean(listing && (item || listing.tracked)) })).changes;
      if (saved && listing) {
        this.db.prepare(`UPDATE operations SET state = 'sold', updated_at = ? WHERE account = ?
          AND kind = ? AND key = ?`).run(Date.now(), account, kind, listing.key);
      }
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  sales(account) {
    return this.db.prepare('SELECT data FROM sales WHERE account = ? ORDER BY rowid DESC LIMIT 50')
      .all(account).map((row) => JSON.parse(row.data));
  }

  metrics(account, now = Date.now()) {
    const captures = this.db.prepare(`SELECT count(*) AS captures,
      coalesce(sum(json_extract(data, '$.shiny')), 0) AS shinies,
      coalesce(sum(captured_at >= ?), 0) AS lastHour
      FROM captures WHERE account = ?`).get(now - 3_600_000, account);
    const stock = this.db.prepare(`SELECT coalesce(sum(json_extract(quote, '$.gems')), 0) AS stockGems
      FROM captures WHERE account = ? AND NOT EXISTS (SELECT 1 FROM operations
      WHERE operations.account = captures.account AND kind = 'listing'
      AND key = CAST(captures.id AS TEXT) AND state IN ('confirmed', 'pending', 'uncertain', 'sold'))`).get(account);
    const sold = this.db.prepare(`SELECT count(*) AS sold, coalesce(sum(json_extract(data, '$.net')), 0) AS soldGems,
      coalesce(sum(json_extract(data, '$.net')) FILTER (WHERE json_extract(data, '$.farm') = 1), 0) AS farmGems
      FROM sales WHERE account = ?`).get(account);
    const huntMs = this.db.prepare('SELECT hunt_ms FROM farm_stats WHERE account = ?').get(account)?.hunt_ms ?? 0;
    return { ...captures, ...stock, ...sold, huntMs, netGemsPerHour: huntMs ? sold.farmGems * 3_600_000 / huntMs : null };
  }

  close() {
    this.db.close();
  }
}

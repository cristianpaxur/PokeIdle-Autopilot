import { DatabaseSync } from 'node:sqlite';
import { netGems } from './policy.mjs';

export const SALES_TARGET = 20;
const nickKey = (nick) => String(nick ?? '').trim().toLowerCase();

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

  nextCandidate(account, before) {
    const row = this.db.prepare(`SELECT captures.data FROM captures
      WHERE account = ? AND coalesce(checked_at, 0) <= ?
      AND NOT EXISTS (SELECT 1 FROM operations WHERE operations.account = captures.account
        AND kind = 'listing' AND key = CAST(captures.id AS TEXT) AND state != 'returned')
      ORDER BY coalesce(checked_at, 0), captured_at LIMIT 1`).get(account, before);
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

  finish(account, kind, key, state) {
    this.db.prepare(`UPDATE operations SET state = ?, updated_at = ?
      WHERE account = ? AND kind = ? AND key = ? AND state IN ('pending', 'uncertain')`)
      .run(state, Date.now(), account, kind, key);
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
    return this.db.prepare(`SELECT key, created_at AS time FROM operations WHERE account = ?
      AND kind = 'listing' AND state IN ('pending', 'uncertain', 'confirmed') ORDER BY created_at`).all(account);
  }

  returnListing(account, key) {
    this.db.prepare(`UPDATE operations SET state = 'returned', updated_at = ? WHERE account = ?
      AND kind = 'listing' AND key = ? AND state IN ('pending', 'uncertain', 'confirmed')`)
      .run(Date.now(), account, key);
  }

  mission(account) {
    const counts = this.db.prepare(`SELECT count(*) FILTER (WHERE state = 'sold') AS sold,
      count(*) FILTER (WHERE state IN ('pending', 'uncertain', 'confirmed')) AS open
      FROM operations WHERE account = ? AND kind = 'listing'`).get(account);
    return { ...counts, target: SALES_TARGET };
  }

  addSale(account, sale) {
    if (sale.moeda !== 'orb' || sale.tipo !== 'pokemon') return;
    if (sale.vendedor && nickKey(sale.vendedor) !== nickKey(account)) return;
    const buyer = nickKey(sale.comprador);
    if (buyer && this.accounts().some((nick) => nickKey(nick) === buyer)) return;
    const id = sale.id ?? sale.anuncioId ?? (sale.em && sale.pokemonId ? `${sale.em}:${sale.pokemonId}` : null);
    if (id == null) return;
    const net = Number.isSafeInteger(sale.liquido) ? sale.liquido : netGems(Number(sale.bruto));
    if (!Number.isSafeInteger(net) || net <= 0) return;
    const pokemonId = Number(sale.pokemonId ?? sale.ficha?.id);
    const soldAt = Number(sale.em);
    this.db.exec('BEGIN');
    try {
      this.db.prepare('INSERT OR IGNORE INTO sales VALUES (?, ?, ?)')
        .run(account, String(id), JSON.stringify({ id, net, time: sale.em, name: sale.descricao }));
      if (Number.isSafeInteger(pokemonId) && pokemonId > 0 && Number.isSafeInteger(soldAt)) {
        this.db.prepare(`UPDATE operations SET state = 'sold', updated_at = ? WHERE account = ?
          AND kind = 'listing' AND key = ? AND state IN ('pending', 'uncertain', 'confirmed', 'returned')
          AND created_at <= ? AND json_extract(data, '$.gems') = ?`)
          .run(Date.now(), account, String(pokemonId), soldAt, Number(sale.bruto));
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
    const sold = this.db.prepare(`SELECT count(*) AS sold, coalesce(sum(json_extract(data, '$.net')), 0) AS soldGems
      FROM sales WHERE account = ?`).get(account);
    return { ...captures, ...stock, ...sold };
  }

  close() {
    this.db.close();
  }
}

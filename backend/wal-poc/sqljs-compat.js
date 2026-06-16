// sql.js-compatibele adapter rond better-sqlite3.
// Doel: db.js kan `new SQL.Database(buf|path)` blijven gebruiken met dezelfde
// interface (run / prepare->bind/step/getAsObject/free / export), maar dan op
// een echte on-disk WAL-database i.p.v. in-memory WASM.
//
// Mapt:
//   db.run(sql[, params])           -> bsqlite prepare().run(...)  (DDL/DML)
//   db.exec(sql)                    -> bsqlite exec (multi-statement)
//   const s = db.prepare(sql)       -> wrapper-statement
//     s.bind(params)                -> onthoudt params
//     s.step()                      -> true zolang er een volgende rij is
//     s.getAsObject()              -> huidige rij als object
//     s.get([params])              -> eerste rij (sql.js-stijl convenience)
//     s.run([params])              -> execute (DML via prepared)
//     s.free()                      -> release
//   db.export()                     -> WAL-checkpoint + bytes van het bestand
//   db.close()                      -> sluit
const Database = require('better-sqlite3');
const fs = require('fs');

// sql.js accepteert undefined/boolean; better-sqlite3 niet. Sanitize identiek
// aan db.js queryAll (undefined->null) + booleans->1/0 (sql.js coerce-gedrag).
function sanitize(params) {
  if (!params) return [];
  const arr = Array.isArray(params) ? params : [params];
  return arr.map(p => {
    if (p === undefined) return null;
    if (p === true) return 1;
    if (p === false) return 0;
    return p;
  });
}

class CompatStatement {
  constructor(bstmt) {
    this._s = bstmt;
    this._bound = [];
    this._iter = null;
    this._cur = undefined;
    this._done = false;
  }
  bind(params) {
    this._bound = sanitize(params);
    this._iter = null; this._cur = undefined; this._done = false;
    return true;
  }
  step() {
    // Alleen zinvol voor SELECT/returning statements.
    if (!this._s.reader) {
      // non-returning: voer 1x uit, geen rijen
      if (!this._done) { this._s.run(...this._bound); this._done = true; }
      return false;
    }
    if (!this._iter) this._iter = this._s.iterate(...this._bound);
    const n = this._iter.next();
    if (n.done) { this._cur = undefined; return false; }
    this._cur = n.value;
    return true;
  }
  getAsObject() { return this._cur ? { ...this._cur } : {}; }
  // sql.js convenience die db.js stmts soms gebruiken:
  get(params) {
    const p = params !== undefined ? sanitize(params) : this._bound;
    return this._s.reader ? (this._s.get(...p) || null) : this._s.run(...p);
  }
  all(params) {
    const p = params !== undefined ? sanitize(params) : this._bound;
    return this._s.all(...p);
  }
  run(params) {
    const p = params !== undefined ? sanitize(params) : this._bound;
    return this._s.run(...p);
  }
  free() {
    if (this._iter && typeof this._iter.return === 'function') { try { this._iter.return(); } catch {} }
    this._iter = null; this._cur = undefined;
    return true;
  }
  reset() { this.free(); this._done = false; return this; }
}

class CompatDatabase {
  constructor(arg) {
    // arg kan een pad (string) zijn, een Buffer/Uint8Array (sql.js-stijl),
    // of leeg (fresh). Bij Buffer schrijven we naar een tmp en openen die.
    this._path = null;
    if (typeof arg === 'string') {
      this._path = arg;
      this._db = new Database(arg);
    } else if (arg && (Buffer.isBuffer(arg) || arg instanceof Uint8Array)) {
      // sql.js gaf bytes; better-sqlite3 wil een bestand. Schrijf naar tmp.
      const tmp = '/tmp/bsq-' + process.pid + '-' + Math.floor(Date.now()) + '.db';
      fs.writeFileSync(tmp, Buffer.from(arg));
      this._path = tmp;
      this._db = new Database(tmp);
    } else {
      this._path = ':memory:';
      this._db = new Database(':memory:');
    }
    // WAL = de hele reden van de migratie. Plus nette defaults.
    try { this._db.pragma('journal_mode = WAL'); } catch {}
    try { this._db.pragma('synchronous = NORMAL'); } catch {}
    try { this._db.pragma('foreign_keys = ON'); } catch {}
  }
  run(sql, params) {
    const p = sanitize(params);
    // sql.js' db.run staat multi-statement DDL toe; better-sqlite3 prepare niet.
    // Geen params + meerdere statements -> exec(). Anders prepare().run().
    let st;
    try { st = this._db.prepare(sql); }
    catch (e) {
      if (p.length === 0 && /more than one statement/i.test(e.message)) { this._db.exec(sql); return true; }
      throw e;
    }
    if (st.reader) { st.all(...p); }
    else { st.run(...p); }
    return true;
  }
  exec(sql) { this._db.exec(sql); return true; }
  prepare(sql) { return new CompatStatement(this._db.prepare(sql)); }
  pragma(p) { return this._db.pragma(p); }
  export() {
    try { this._db.pragma('wal_checkpoint(TRUNCATE)'); } catch {}
    return fs.readFileSync(this._path);
  }
  close() { try { this._db.close(); } catch {} }
  get raw() { return this._db; }
}

// initSqlJs-vervanger: geeft een { Database: CompatDatabase } terug zodat
// db.js' `const SQL = await initSqlJs(); new SQL.Database(...)` blijft werken.
async function initCompat() { return { Database: CompatDatabase }; }

module.exports = { CompatDatabase, CompatStatement, initCompat, sanitize };

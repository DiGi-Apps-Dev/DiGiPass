// Archivio sul NAS: solo voci gia' cifrate dal telefono o dal browser. Il server non ha la chiave e non vede
// titoli, siti, utenti o password: conosce solo id, tipo (voce o sito), versione e se e' stata cancellata.
// SQLite senza WAL (journal DELETE, synchronous FULL): un riavvio di colpo del NAS non perde scritture confermate.
import { join } from 'node:path';
import Database from 'better-sqlite3';

export const ID_VOCE = /^[A-Za-z0-9_-]{8,64}$/;
const BLOB = /^[A-Za-z0-9+/=]{40,700000}$/;

export function apriArchivio(dataDir) {
  const db = new Database(join(dataDir, 'digipass.sqlite'));
  db.pragma('journal_mode = DELETE');
  db.pragma('synchronous = FULL');
  db.pragma('busy_timeout = 5000');
  db.exec(`
    CREATE TABLE IF NOT EXISTS voci (id TEXT PRIMARY KEY, tipo TEXT NOT NULL CHECK(tipo IN ('voce','sito')), versione INTEGER NOT NULL,
      rev INTEGER NOT NULL, cancellata INTEGER NOT NULL DEFAULT 0, blob TEXT NOT NULL DEFAULT '', aggiornata INTEGER NOT NULL);
    CREATE INDEX IF NOT EXISTS voci_rev ON voci(rev);
    CREATE TABLE IF NOT EXISTS impostazioni (chiave TEXT PRIMARY KEY, valore TEXT NOT NULL);
  `);
  const leggiImp = (k, d) => { const r = db.prepare('SELECT valore FROM impostazioni WHERE chiave=?').get(k); return r ? JSON.parse(r.valore) : d; };
  const scriviImp = (k, v) => db.prepare('INSERT INTO impostazioni (chiave,valore) VALUES (?,?) ON CONFLICT(chiave) DO UPDATE SET valore=excluded.valore').run(k, JSON.stringify(v));
  const revAttuale = () => db.prepare('SELECT COALESCE(MAX(rev),0) r FROM voci').get().r;

  /** Cambi dopo la revisione `da` (per la sincronizzazione). */
  function cambi(da = 0) {
    const voci = db.prepare('SELECT id,tipo,versione,rev,cancellata,blob FROM voci WHERE rev>? ORDER BY rev LIMIT 5000').all(Number(da) || 0)
      .map(v => ({ ...v, cancellata: v.cancellata === 1 }));
    return { rev: revAttuale(), voci, completo: voci.length < 5000 };
  }

  /**
   * Scrive una voce se la versione di partenza del client (`base`) e' quella attuale; altrimenti conflitto
   * e si restituisce la versione del server, che il client confronta dopo averla decifrata.
   */
  function scrivi(id, { tipo, base, blob, cancellata = false }) {
    if (!ID_VOCE.test(String(id))) throw Object.assign(new Error('Id non valido.'), { status: 400 });
    if (!['voce', 'sito'].includes(tipo)) throw Object.assign(new Error('Tipo non valido.'), { status: 400 });
    if (!Number.isInteger(base) || base < 0) throw Object.assign(new Error('Versione non valida.'), { status: 400 });
    if (!cancellata && !BLOB.test(String(blob || ''))) throw Object.assign(new Error('Dati cifrati non validi.'), { status: 400 });
    return db.transaction(() => {
      const ora = db.prepare('SELECT id,tipo,versione,rev,cancellata,blob FROM voci WHERE id=?').get(id);
      const versione = ora ? ora.versione : 0;
      if (versione !== base) return { conflitto: true, attuale: { ...ora, cancellata: ora.cancellata === 1 } };
      const rev = revAttuale() + 1;
      db.prepare(`INSERT INTO voci (id,tipo,versione,rev,cancellata,blob,aggiornata) VALUES (?,?,?,?,?,?,?)
        ON CONFLICT(id) DO UPDATE SET tipo=excluded.tipo,versione=excluded.versione,rev=excluded.rev,cancellata=excluded.cancellata,blob=excluded.blob,aggiornata=excluded.aggiornata`)
        .run(id, tipo, versione + 1, rev, cancellata ? 1 : 0, cancellata ? '' : blob, Date.now());
      return { conflitto: false, versione: versione + 1, rev };
    })();
  }

  const conteggi = () => db.prepare("SELECT SUM(tipo='voce' AND cancellata=0) voci, SUM(tipo='sito' AND cancellata=0) siti FROM voci").get();
  return { db, cambi, scrivi, conteggi, leggiImp, scriviImp, revAttuale, close: () => db.close() };
}

// Accesso a DiGiPass: copia indipendente (11.11.2026) del modulo collaudato di DiGiShare/SIEM, nessun legame con
// quelle app. Logica di blocco tentativi, sessioni su disco, dispositivi ricordati e Authenticator identica.
// Differenze di DiGiPass:
// - la "password" che arriva qui NON e' la password principale: e' la chiave di accesso ricavata sul telefono o nel
//   browser (HKDF della chiave Argon2id). Da questa il server non puo' ricavare la chiave che apre i dati;
// - il server conserva le chiavi della cassaforte gia' cifrate (tabella chiavi) e le restituisce dopo l'accesso;
// - niente "password dimenticata" via email: senza la password principale i dati si riaprono solo con la chiave di
//   recupero del foglio di emergenza (recuperaConChiave); 10 codici di riserva sostituiscono l'Authenticator.
import { createCipheriv, createDecipheriv, createHash, createHmac, hkdfSync, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import bcrypt from 'bcryptjs';
import { authenticator } from 'otplib';
import QRCode from 'qrcode';

const APP = 'DiGiPass';
const digest = value => createHash('sha256').update(value).digest('hex');
const token = () => randomBytes(32).toString('base64url');
const SESSION_MS = 30 * 86400000;
const DEVICE_MS = 90 * 86400000;
const CODE_MS = 10 * 60000;
const BLOCK_MS = 15 * 60000;
const SETUP_MS = 10 * 60000;
const RISERVA = 10;
const ALFABETO = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function keyFromEnv(value) {
  const bytes = Buffer.from(String(value || ''), 'base64url');
  if (bytes.length !== 32) throw new Error('DIGIPASS_AUTH_KEY non valida (servono 32 byte in base64url).');
  return bytes;
}
export function seal(key, text) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const body = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
  return [iv, cipher.getAuthTag(), body].map(x => x.toString('base64url')).join('.');
}
function unseal(key, text) {
  const [iv, tag, body] = text.split('.').map(x => Buffer.from(x, 'base64url'));
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(body), decipher.final()]).toString('utf8');
}
function otpStep(secret, code, lastStep = -1) {
  if (!/^\d{6}$/.test(String(code))) return null;
  const now = Date.now();
  const delta = authenticator.clone({ epoch: now, window: 1 }).checkDelta(code, secret);
  if (delta === null) return null;
  const step = Math.floor(now / 30000) + delta;
  return step > lastStep ? step : null;
}
function parseCookie(req, name) {
  return String(req.headers.cookie || '').split(';').map(x => x.trim()).find(x => x.startsWith(`${name}=`))?.slice(name.length + 1) || '';
}
function deviceName(agent = '') {
  if (/DiGiPass-Android/i.test(agent)) return 'App DiGiPass · Android';
  const os = /Android/i.test(agent) ? 'Android' : /iPad/i.test(agent) ? 'iPad' : /iPhone/i.test(agent) ? 'iPhone' : /Windows/i.test(agent) ? 'Windows' : /Macintosh/i.test(agent) ? 'Mac' : 'Dispositivo';
  const browser = /SamsungBrowser/i.test(agent) ? 'Samsung Internet' : /Edg\//i.test(agent) ? 'Edge' : /Chrome\//i.test(agent) ? 'Chrome' : /Firefox\//i.test(agent) ? 'Firefox' : /Safari\//i.test(agent) ? 'Safari' : '';
  return browser ? `${os} · ${browser}` : os;
}
const codiceRiserva = () => {
  const c = Array.from({ length: 8 }, () => ALFABETO[randomInt(0, ALFABETO.length)]).join('');
  return `${c.slice(0, 4)}-${c.slice(4)}`;
};
const normalizzaRiserva = c => String(c || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
const eRiserva = c => /^[A-Z0-9]{8}$/.test(normalizzaRiserva(c)) && !/^\d{6}$/.test(String(c));

// Chiavi della cassaforte: solo dati gia' cifrati sul dispositivo e parametri pubblici.
const B64 = /^[A-Za-z0-9+/=_-]{8,400}$/;
export function controllaChiavi(c) {
  if (!c || typeof c !== 'object') throw new Error('Chiavi della cassaforte mancanti.');
  const kdf = c.kdf || {};
  const ok = kdf.alg === 'argon2id' && Number.isInteger(kdf.m) && kdf.m >= 8192 && kdf.m <= 1048576 && Number.isInteger(kdf.t) && kdf.t >= 1 && kdf.t <= 20
    && Number.isInteger(kdf.p) && kdf.p >= 1 && kdf.p <= 8 && ['salePw', 'dekPw', 'saleRec', 'dekRec'].every(k => B64.test(String(c[k] || '')));
  if (!ok) throw new Error('Chiavi della cassaforte non valide.');
  return { v: 1, kdf: { alg: 'argon2id', m: kdf.m, t: kdf.t, p: kdf.p }, salePw: c.salePw, dekPw: c.dekPw, saleRec: c.saleRec, dekRec: c.dekRec };
}

export function createSecurity({ dataDir, secret, secure = false, allowSetup = true, mailer = null }) {
  const key = keyFromEnv(secret);
  const recoveryKey = Buffer.from(hkdfSync('sha256', key, Buffer.alloc(0), 'digipass-recovery-v1', 32));
  const fintaKey = Buffer.from(hkdfSync('sha256', key, Buffer.alloc(0), 'digipass-prelogin-finto-v1', 32));
  const db = new Database(join(dataDir, 'auth.sqlite'));
  db.pragma('journal_mode = DELETE');
  db.pragma('synchronous = FULL');
  db.pragma('busy_timeout = 5000');
  db.exec(`
    CREATE TABLE IF NOT EXISTS accounts_v2 (id INTEGER PRIMARY KEY CHECK(id=1), username TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL, totp_secret TEXT NOT NULL, last_step INTEGER NOT NULL DEFAULT -1);
    CREATE TABLE IF NOT EXISTS sessions_v2 (token_hash TEXT PRIMARY KEY, csrf TEXT NOT NULL, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS trusted_devices (token_hash TEXT PRIMARY KEY, label TEXT NOT NULL, created_at INTEGER NOT NULL, last_used INTEGER NOT NULL, expires_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS auth_attempts (scope TEXT NOT NULL, subject TEXT NOT NULL, failures INTEGER NOT NULL, window_start INTEGER NOT NULL, blocked_until INTEGER NOT NULL, PRIMARY KEY(scope,subject));
    CREATE TABLE IF NOT EXISTS email_codes (purpose TEXT PRIMARY KEY, code_hash TEXT NOT NULL, expires_at INTEGER NOT NULL, failures INTEGER NOT NULL DEFAULT 0, sent_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS pending_totp (token_hash TEXT PRIMARY KEY, secret_cipher TEXT NOT NULL, expires_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS security_events (id INTEGER PRIMARY KEY, happened_at TEXT NOT NULL, kind TEXT NOT NULL, address TEXT NOT NULL, detail TEXT NOT NULL DEFAULT '');
    CREATE TABLE IF NOT EXISTS chiavi (id INTEGER PRIMARY KEY CHECK(id=1), dati TEXT NOT NULL, recupero_hash TEXT NOT NULL, aggiornate INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS riserva (id INTEGER PRIMARY KEY, hash TEXT NOT NULL, usato INTEGER NOT NULL DEFAULT 0);
  `);
  const fakeHash = bcrypt.hashSync(`fake-${token()}`, 12);
  const names = on => ({ session: on ? `__Host-${APP}` : `${APP}-session`, device: on ? `__Host-${APP}-device` : `${APP}-device` });
  let pendingSetup = null;

  const account = () => db.prepare('SELECT * FROM accounts_v2 WHERE id=1').get() || null;
  const initialized = () => Boolean(account());
  const setupAllowed = () => allowSetup && !initialized();
  function cookie(name, value, maxAge, on = secure) {
    return `${name}=${value}; Path=/; HttpOnly; SameSite=Strict; ${on ? 'Secure; ' : ''}Max-Age=${maxAge}`;
  }
  function log(kind, address = '', detail = '') {
    db.prepare('INSERT INTO security_events (happened_at,kind,address,detail) VALUES (?,?,?,?)').run(new Date().toISOString(), kind, String(address).slice(0, 80), String(detail).slice(0, 200));
  }
  async function alert(subject, message) {
    if (!mailer?.configured) return;
    try { await mailer.send(subject, message); }
    catch { log('email_avviso_fallita'); }
  }
  function rateKey(username = '') { return String(username).trim().toLowerCase().slice(0, 64); }
  function prune() {
    const now = Date.now();
    db.prepare('DELETE FROM sessions_v2 WHERE expires_at<?').run(now);
    db.prepare('DELETE FROM trusted_devices WHERE expires_at<?').run(now);
    db.prepare('DELETE FROM pending_totp WHERE expires_at<?').run(now);
    db.prepare('DELETE FROM auth_attempts WHERE blocked_until<? AND window_start<?').run(now, now - BLOCK_MS);
  }
  try { prune(); } catch { /* la pulizia non deve fermare l'avvio */ }
  const pruneTimer = setInterval(() => { try { prune(); } catch { clearInterval(pruneTimer); } }, 6 * 3600000);
  pruneTimer.unref();
  function blocked(scope, subject) {
    const row = db.prepare('SELECT blocked_until FROM auth_attempts WHERE scope=? AND subject=?').get(scope, subject);
    return Boolean(row && row.blocked_until > Date.now());
  }
  function failures(scope, subject) {
    const now = Date.now();
    const row = db.prepare('SELECT failures,window_start FROM auth_attempts WHERE scope=? AND subject=?').get(scope, subject);
    const within = row && now - row.window_start < BLOCK_MS;
    const count = within ? row.failures + 1 : 1;
    db.prepare('INSERT INTO auth_attempts (scope,subject,failures,window_start,blocked_until) VALUES (?,?,?,?,?) ON CONFLICT(scope,subject) DO UPDATE SET failures=excluded.failures,window_start=excluded.window_start,blocked_until=excluded.blocked_until').run(scope, subject, count, within ? row.window_start : now, count >= 5 ? now + BLOCK_MS : 0);
    return count;
  }
  function clearAttempts(scope, subject) { db.prepare('DELETE FROM auth_attempts WHERE scope=? AND subject=?').run(scope, subject); }
  function checkAttempts(address, username, phase, skipUser = false) {
    if (blocked(`${phase}_ip`, address) || (!skipUser && blocked(`${phase}_user`, rateKey(username)))) throw new Error('Troppi tentativi. Riprova tra 15 minuti.');
  }
  function failAttempts(address, username, phase) {
    failures(`${phase}_ip`, address);
    failures(`${phase}_user`, rateKey(username));
  }
  function clearPair(address, username, phase) {
    clearAttempts(`${phase}_ip`, address);
    clearAttempts(`${phase}_user`, rateKey(username));
  }
  async function verifyPassword(password, row) {
    if (typeof password !== 'string') return false;
    if (!row) { await bcrypt.compare(password, fakeHash); return false; }
    return bcrypt.compare(password, row.password_hash);
  }
  function checkNewPassword(password) {
    // Chiave di accesso: 32 byte in base64url, calcolata dal dispositivo.
    if (typeof password !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(password)) throw new Error('Chiave di accesso non valida.');
  }
  function makeSession(on = secure) {
    const raw = token(), csrf = token(), now = Date.now();
    db.prepare('INSERT INTO sessions_v2 (token_hash,csrf,created_at,expires_at) VALUES (?,?,?,?)').run(digest(raw), csrf, now, now + SESSION_MS);
    return { cookie: cookie(names(on).session, raw, SESSION_MS / 1000, on), csrf, tokenHash: digest(raw) };
  }
  function current(req, on = secure) {
    const raw = parseCookie(req, names(on).session);
    if (!/^[A-Za-z0-9_-]{40,50}$/.test(raw)) return null;
    const row = db.prepare('SELECT csrf,expires_at FROM sessions_v2 WHERE token_hash=?').get(digest(raw));
    return row && row.expires_at > Date.now() ? { csrf: row.csrf, tokenHash: digest(raw) } : null;
  }
  function clearSessionCookie(on = secure) { return cookie(names(on).session, '', 0, on); }
  async function qr(secretValue, username) {
    const otpauthUrl = authenticator.keyuri(username, APP, secretValue);
    const qrDataUrl = await QRCode.toDataURL(otpauthUrl, { width: 232, margin: 2, errorCorrectionLevel: 'M' });
    return { otpauthUrl, qrDataUrl };
  }

  // ---------- chiavi della cassaforte e codici di riserva ----------
  function chiavi() {
    const r = db.prepare('SELECT dati,aggiornate FROM chiavi WHERE id=1').get();
    return r ? { ...JSON.parse(r.dati), aggiornate: r.aggiornate } : null;
  }
  // Prima dell'accesso servono i parametri per ricavare la chiave. Per un nome sbagliato si risponde con valori
  // finti ma sempre uguali, cosi' non si capisce quali nomi esistono.
  function prelogin(username) {
    const row = account(), c = chiavi(), name = rateKey(username);
    // dekRec si puo' dare prima dell'accesso: e' cifrata con la chiave di recupero (140 bit casuali), non indovinabile.
    // dekPw invece no: dipende dalla password e si potrebbe provare a indovinarla fuori linea.
    if (row && c && row.username.toLowerCase() === name) return { kdf: c.kdf, salePw: c.salePw, saleRec: c.saleRec, dekRec: c.dekRec };
    const finto = (n, l = 16) => createHmac('sha256', fintaKey).update(`${n}:${name}`).digest().subarray(0, l).toString('base64');
    return { kdf: { alg: 'argon2id', m: 19456, t: 2, p: 1 }, salePw: finto('pw'), saleRec: finto('rec'), dekRec: Buffer.concat([createHmac('sha256', fintaKey).update(`dek1:${name}`).digest(), createHmac('sha256', fintaKey).update(`dek2:${name}`).digest().subarray(0, 28)]).toString('base64') };
  }
  async function nuoviCodici() {
    const codici = Array.from({ length: RISERVA }, codiceRiserva);
    const hash = await Promise.all(codici.map(c => bcrypt.hash(normalizzaRiserva(c), 10)));
    db.transaction(() => {
      db.prepare('DELETE FROM riserva').run();
      for (const h of hash) db.prepare('INSERT INTO riserva (hash,usato) VALUES (?,0)').run(h);
    })();
    return codici;
  }
  async function usaRiserva(code) {
    const n = normalizzaRiserva(code);
    for (const r of db.prepare('SELECT id,hash FROM riserva WHERE usato=0').all()) {
      if (await bcrypt.compare(n, r.hash)) {
        const ok = db.prepare('UPDATE riserva SET usato=? WHERE id=? AND usato=0').run(Date.now(), r.id);
        return ok.changes === 1;
      }
    }
    return false;
  }
  const riserveRimaste = () => db.prepare('SELECT COUNT(*) n FROM riserva WHERE usato=0').get().n;
  // Codice: Authenticator (6 cifre) oppure codice di riserva del foglio di emergenza (XXXX-XXXX). Ritorna il passo TOTP o 'riserva'.
  async function secondoFattore(row, code) {
    if (eRiserva(code)) return (await usaRiserva(code)) ? 'riserva' : null;
    return otpStep(unseal(key, row.totp_secret), code, row.last_step);
  }
  function consumaPasso(step) {
    if (step === 'riserva' || step === null) return;
    const result = db.prepare('UPDATE accounts_v2 SET last_step=? WHERE id=1 AND last_step<?').run(step, step);
    if (result.changes !== 1) throw new Error('Codice Authenticator già usato.');
  }

  // Codice di configurazione monouso (DIGIPASS_CODICE_SETUP nel .env): confronto a tempo costante, 5 errori -> 15 minuti di blocco.
  function controllaCodiceSetup(codice, atteso, address = '') {
    checkAttempts(address, 'setup', 'setup');
    const a = createHash('sha256').update(String(codice || '').trim().toUpperCase()).digest();
    const b = createHash('sha256').update(String(atteso || '').trim().toUpperCase()).digest();
    if (!atteso || !timingSafeEqual(a, b)) {
      failAttempts(address, 'setup', 'setup');
      log('codice_configurazione_errato', address);
      throw new Error('Codice di configurazione sbagliato.');
    }
    clearPair(address, 'setup', 'setup');
  }
  async function startSetup(username = 'admin') {
    if (!setupAllowed()) throw new Error('Configurazione iniziale non disponibile.');
    const normalized = String(username).trim();
    if (!/^[A-Za-z0-9._-]{3,40}$/.test(normalized)) throw new Error('Nome utente non valido.');
    pendingSetup = { token: token(), username: normalized, secret: authenticator.generateSecret(), expiresAt: Date.now() + SETUP_MS, failures: 0 };
    return { setupToken: pendingSetup.token, secret: pendingSetup.secret, ...await qr(pendingSetup.secret, normalized) };
  }
  async function completeSetup({ setupToken, password, code, chiavi: c, accessoRecupero, remember = false }, address = '', on = secure, userAgent = '') {
    if (!setupAllowed() || !pendingSetup || setupToken !== pendingSetup.token || pendingSetup.expiresAt <= Date.now()) throw new Error('Configurazione scaduta. Ricomincia.');
    checkNewPassword(password);
    checkNewPassword(accessoRecupero);
    const dati = controllaChiavi(c);
    const step = otpStep(pendingSetup.secret, code);
    if (step === null) {
      if (++pendingSetup.failures >= 5) pendingSetup = null;
      throw new Error('Codice Authenticator non valido.');
    }
    const hash = await bcrypt.hash(password, 12), recHash = await bcrypt.hash(accessoRecupero, 12);
    db.transaction(() => {
      if (initialized()) throw new Error('Account già configurato.');
      db.prepare('INSERT INTO accounts_v2 (id,username,password_hash,totp_secret,last_step) VALUES (1,?,?,?,?)').run(pendingSetup.username, hash, seal(key, pendingSetup.secret), step);
      db.prepare('INSERT INTO chiavi (id,dati,recupero_hash,aggiornate) VALUES (1,?,?,?)').run(JSON.stringify(dati), recHash, Date.now());
      log('authenticator_attivato', address);
    })();
    pendingSetup = null;
    const codici = await nuoviCodici();
    await alert(`${APP}: Authenticator attivato`, `L'accesso a ${APP} è stato configurato.`);
    const sessione = makeSession(on);
    if (remember) sessione.deviceCookie = rememberDevice(userAgent, on);
    return { ...sessione, codiciRiserva: codici };
  }
  function deviceKnown(raw) {
    if (!/^[A-Za-z0-9_-]{40,50}$/.test(String(raw))) return false;
    const row = db.prepare('SELECT expires_at FROM trusted_devices WHERE token_hash=?').get(digest(raw));
    return Boolean(row && row.expires_at > Date.now());
  }
  function trusted(raw) {
    if (!/^[A-Za-z0-9_-]{40,50}$/.test(String(raw))) return false;
    const row = db.prepare('SELECT expires_at FROM trusted_devices WHERE token_hash=?').get(digest(raw));
    if (!row || row.expires_at <= Date.now()) return false;
    db.prepare('UPDATE trusted_devices SET last_used=? WHERE token_hash=?').run(Date.now(), digest(raw));
    return true;
  }
  function rememberDevice(userAgent, on = secure) {
    const raw = token(), now = Date.now();
    db.prepare('INSERT INTO trusted_devices (token_hash,label,created_at,last_used,expires_at) VALUES (?,?,?,?,?)').run(digest(raw), deviceName(userAgent), now, now, now + DEVICE_MS);
    return cookie(names(on).device, raw, DEVICE_MS / 1000, on);
  }
  async function login({ username = 'admin', password, code, remember = false }, address, deviceCookie = '', userAgent = '', on = secure) {
    const name = rateKey(username), row = account();
    const knownDevice = deviceKnown(deviceCookie);
    checkAttempts(address, name, 'login', knownDevice);
    const matchUser = row && row.username.toLowerCase() === name;
    const validPassword = await verifyPassword(password, matchUser ? row : null);
    if (!validPassword) {
      failAttempts(address, name, 'login');
      log('login_fallito', address);
      await alert(`${APP}: tentativo di accesso`, `Tentativo di accesso a ${APP} con password errata da ${address}.`);
      throw new Error('Credenziali non valide.');
    }
    checkAttempts(address, name, 'mfa', knownDevice);
    const deviceValid = trusted(deviceCookie);
    const step = deviceValid ? null : await secondoFattore(row, code);
    if (!deviceValid && step === null) {
      failAttempts(address, name, 'mfa');
      log('codice_errato', address);
      await alert(`${APP}: codice Authenticator errato`, `Tentativo con codice errato da ${address}.`);
      throw new Error('Credenziali non valide.');
    }
    db.transaction(() => {
      consumaPasso(step);
      clearPair(address, name, 'login');
      clearPair(address, name, 'mfa');
      log('login_riuscito', address, deviceValid ? 'dispositivo ricordato' : step === 'riserva' ? 'codice di riserva' : 'Authenticator');
    })();
    const result = makeSession(on);
    if (remember && !deviceValid) result.deviceCookie = rememberDevice(userAgent, on);
    if (step === 'riserva') {
      result.riserveRimaste = riserveRimaste();
      await alert(`${APP}: usato un codice di riserva`, `Accesso con un codice di riserva del foglio di emergenza da ${address}. Ne restano ${result.riserveRimaste}.`);
    } else await alert(`${APP}: nuovo accesso`, `Accesso riuscito da ${address} (${deviceName(userAgent)}).`);
    return result;
  }
  function logout(authSession, address = '', on = secure) {
    db.prepare('DELETE FROM sessions_v2 WHERE token_hash=?').run(authSession.tokenHash);
    log('logout', address);
    return cookie(names(on).session, '', 0, on);
  }
  function logoutAll(authSession, address = '') {
    db.prepare('DELETE FROM sessions_v2 WHERE token_hash<>?').run(authSession.tokenHash);
    log('sessioni_chiuse', address);
    void alert(`${APP}: sessioni chiuse`, `Le altre sessioni di ${APP} sono state chiuse.`);
  }
  function listDevices() { return db.prepare('SELECT token_hash AS id,label,created_at,last_used,expires_at FROM trusted_devices ORDER BY last_used DESC').all(); }
  function forgetDevices(address = '', on = secure) {
    db.prepare('DELETE FROM trusted_devices').run();
    log('dispositivi_revocati', address);
    void alert(`${APP}: dispositivi revocati`, `I dispositivi ricordati di ${APP} sono stati revocati.`);
    return cookie(names(on).device, '', 0, on);
  }
  // Cambio password principale: chiave di accesso attuale + codice; arrivano anche le chiavi della cassaforte cifrate di nuovo.
  async function changePassword({ currentPassword, code, newPassword, chiavi: c }, authSession, address = '') {
    checkNewPassword(newPassword);
    const dati = controllaChiavi(c);
    const row = account();
    checkAttempts(address, row.username, 'change');
    const step = await verifyPassword(currentPassword, row) ? await secondoFattore(row, code) : null;
    if (step === null) {
      failAttempts(address, row.username, 'change');
      log('cambio_password_fallito', address);
      await alert(`${APP}: tentativo cambio password`, 'È stato tentato un cambio password non riuscito.');
      throw new Error('Credenziali non valide.');
    }
    const hash = await bcrypt.hash(newPassword, 12);
    db.transaction(() => {
      consumaPasso(step);
      db.prepare('UPDATE accounts_v2 SET password_hash=? WHERE id=1').run(hash);
      db.prepare('UPDATE chiavi SET dati=?,aggiornate=? WHERE id=1').run(JSON.stringify({ ...dati, saleRec: chiavi().saleRec, dekRec: chiavi().dekRec }), Date.now());
      db.prepare('DELETE FROM sessions_v2 WHERE token_hash<>?').run(authSession.tokenHash);
      db.prepare('DELETE FROM trusted_devices').run();
      clearPair(address, row.username, 'change');
      log('password_cambiata', address);
    })();
    await alert(`${APP}: password cambiata`, `La password principale di ${APP} è stata cambiata. Tutte le altre sessioni sono state chiuse.`);
  }
  // Password dimenticata: chiave di recupero (prova = chiave di accesso ricavata da quella) + codice, poi password nuova.
  async function recuperaConChiave({ username, accessoRecupero, code, newPassword, nuovoAccessoRecupero, chiavi: c }, address = '', on = secure) {
    checkNewPassword(newPassword);
    checkNewPassword(nuovoAccessoRecupero);
    const dati = controllaChiavi(c);
    const name = rateKey(username), row = account(), r = db.prepare('SELECT recupero_hash FROM chiavi WHERE id=1').get();
    checkAttempts(address, name, 'recovery');
    const match = row && r && row.username.toLowerCase() === name;
    const valida = typeof accessoRecupero === 'string' && await bcrypt.compare(accessoRecupero, match ? r.recupero_hash : fakeHash);
    const step = valida && match ? await secondoFattore(row, code) : null;
    if (step === null) {
      failAttempts(address, name, 'recovery');
      log('recupero_fallito', address);
      await alert(`${APP}: tentativo di recupero`, `Tentativo di recupero della password non riuscito da ${address}.`);
      throw new Error('Chiave di recupero o codice non validi.');
    }
    const hash = await bcrypt.hash(newPassword, 12), recHash = await bcrypt.hash(nuovoAccessoRecupero, 12);
    db.transaction(() => {
      consumaPasso(step);
      db.prepare('UPDATE accounts_v2 SET password_hash=? WHERE id=1').run(hash);
      db.prepare('UPDATE chiavi SET dati=?,recupero_hash=?,aggiornate=? WHERE id=1').run(JSON.stringify(dati), recHash, Date.now());
      db.prepare('DELETE FROM sessions_v2').run();
      db.prepare('DELETE FROM trusted_devices').run();
      clearPair(address, name, 'recovery');
      log('password_recuperata', address);
    })();
    await alert(`${APP}: password recuperata`, 'La password principale è stata cambiata con la chiave di recupero. Stampa il foglio di emergenza nuovo.');
    return makeSession(on);
  }
  // Nuovo foglio di emergenza: nuova chiave di recupero e nuovi codici di riserva (password + codice gia' controllati).
  async function nuovoFoglio({ chiavi: c, accessoRecupero }, address = '') {
    checkNewPassword(accessoRecupero);
    const dati = controllaChiavi(c);
    const recHash = await bcrypt.hash(accessoRecupero, 12);
    db.prepare('UPDATE chiavi SET dati=?,recupero_hash=?,aggiornate=? WHERE id=1').run(JSON.stringify(dati), recHash, Date.now());
    const codici = await nuoviCodici();
    log('foglio_emergenza_nuovo', address);
    await alert(`${APP}: nuovo foglio di emergenza`, 'Sono stati creati una chiave di recupero e 10 codici di riserva nuovi: quelli vecchi non valgono più.');
    return codici;
  }
  function recoveryHash(purpose, code) { return createHash('sha256').update(recoveryKey).update(`${purpose}:${code}`).digest('hex'); }
  // Telefono perso via email (resta come nello standard; in alternativa c'e' il codice di riserva al login).
  async function requestRecovery({ username, purpose = 'telefono' }, address = '') {
    if (purpose !== 'telefono') throw new Error('In DiGiPass la password si recupera solo con la chiave del foglio di emergenza.');
    if (!mailer?.configured) throw new Error('Email di recupero non configurata.');
    const name = rateKey(username), row = account();
    checkAttempts(address, name, 'recovery');
    if (blocked('recovery_request_ip', address) || blocked('recovery_request_user', name)) throw new Error('Troppi tentativi. Riprova tra 15 minuti.');
    failAttempts(address, name, 'recovery_request');
    const response = { message: 'Se il nome utente è corretto, riceverai un codice via email.' };
    if (!row || row.username.toLowerCase() !== name) return response;
    const previous = db.prepare('SELECT sent_at FROM email_codes WHERE purpose=?').get(purpose);
    if (previous && Date.now() - previous.sent_at < 60000) return response;
    const code = String(randomInt(0, 100000000)).padStart(8, '0');
    const now = Date.now();
    db.prepare('INSERT INTO email_codes (purpose,code_hash,expires_at,failures,sent_at) VALUES (?,?,?,?,?) ON CONFLICT(purpose) DO UPDATE SET code_hash=excluded.code_hash,expires_at=excluded.expires_at,failures=0,sent_at=excluded.sent_at').run(purpose, recoveryHash(purpose, code), now + CODE_MS, 0, now);
    try { await mailer.send(`${APP}: codice telefono perso`, `Il tuo codice ${APP} è ${code}. Scade tra 10 minuti. Se non l'hai richiesto, ignora questa email.`); }
    catch { db.prepare('DELETE FROM email_codes WHERE purpose=? AND sent_at=?').run(purpose, now); throw new Error('Invio email non riuscito. Riprova.'); }
    log('codice_recupero_inviato', address, purpose);
    return response;
  }
  function consumeRecovery({ username, code, purpose = 'telefono' }, address) {
    const row = account(), name = rateKey(username);
    checkAttempts(address, name, 'recovery');
    const codeRow = db.prepare('SELECT * FROM email_codes WHERE purpose=?').get(purpose);
    const expected = recoveryHash(purpose, String(code));
    const valid = row && row.username.toLowerCase() === name && codeRow && codeRow.expires_at > Date.now() && /^\d{8}$/.test(String(code)) && timingSafeEqual(Buffer.from(codeRow.code_hash), Buffer.from(expected));
    if (!valid) {
      failAttempts(address, name, 'recovery');
      log('codice_recupero_errato', address, purpose);
      throw new Error('Codice non valido o scaduto.');
    }
    db.prepare('DELETE FROM email_codes WHERE purpose=?').run(purpose);
    clearPair(address, name, 'recovery');
    return row;
  }
  async function startPhoneReset(input, address = '') {
    const row = consumeRecovery({ ...input, purpose: 'telefono' }, address);
    const raw = token(), secret = authenticator.generateSecret();
    db.prepare('DELETE FROM pending_totp').run();
    db.prepare('INSERT INTO pending_totp (token_hash,secret_cipher,expires_at) VALUES (?,?,?)').run(digest(raw), seal(key, secret), Date.now() + CODE_MS);
    log('telefono_recupero_avviato', address);
    return { resetToken: raw, secret, ...await qr(secret, row.username) };
  }
  // Telefono nuovo, da dentro la webapp (password + codice di riserva gia' controllati da confirmSensitive).
  async function startNuovoAuthenticator(address = '') {
    const row = account();
    const raw = token(), secret = authenticator.generateSecret();
    db.prepare('DELETE FROM pending_totp').run();
    db.prepare('INSERT INTO pending_totp (token_hash,secret_cipher,expires_at) VALUES (?,?,?)').run(digest(raw), seal(key, secret), Date.now() + CODE_MS);
    log('authenticator_nuovo_avviato', address);
    return { resetToken: raw, secret, ...await qr(secret, row.username) };
  }
  async function completePhoneReset({ resetToken, code }, address = '') {
    const row = account();
    checkAttempts(address, row?.username || '', 'phone');
    const pending = db.prepare('SELECT * FROM pending_totp WHERE token_hash=?').get(digest(String(resetToken || '')));
    if (!pending || pending.expires_at <= Date.now()) { failAttempts(address, row?.username || '', 'phone'); throw new Error('Configurazione scaduta. Richiedi un nuovo codice email.'); }
    const secret = unseal(key, pending.secret_cipher);
    const step = otpStep(secret, code);
    if (step === null) { failAttempts(address, row?.username || '', 'phone'); throw new Error('Codice Authenticator non valido.'); }
    db.transaction(() => {
      db.prepare('UPDATE accounts_v2 SET totp_secret=?,last_step=? WHERE id=1').run(seal(key, secret), step);
      db.prepare('DELETE FROM pending_totp').run();
      db.prepare('DELETE FROM sessions_v2').run();
      db.prepare('DELETE FROM trusted_devices').run();
      log('authenticator_reimpostato', address);
    })();
    clearPair(address, row.username, 'phone');
    await alert(`${APP}: Authenticator reimpostato`, `Google Authenticator per ${APP} è stato reimpostato. Tutte le sessioni sono state chiuse.`);
  }
  async function confirmSensitive({ password, code }, address = '') {
    const row = account();
    if (!row) throw new Error('Account non configurato.');
    checkAttempts(address, row.username, 'sensitive');
    const step = await verifyPassword(password, row) ? await secondoFattore(row, code) : null;
    if (step === null) {
      failAttempts(address, row.username, 'sensitive');
      log('operazione_sensibile_rifiutata', address);
      throw new Error('Password o codice Authenticator non validi.');
    }
    consumaPasso(step);
    clearPair(address, row.username, 'sensitive');
  }
  function events(limit = 100) { return db.prepare('SELECT id,happened_at,kind,address,detail FROM security_events ORDER BY id DESC LIMIT ?').all(Math.min(Math.max(Number(limit) || 100, 1), 500)); }
  function profile() { return { username: account()?.username || '', emailConfigured: Boolean(mailer?.configured), riserveRimaste: riserveRimaste() }; }
  function close() { db.close(); }
  return {
    initialized, setupAllowed, controllaCodiceSetup, startSetup, completeSetup, login, current, clearSessionCookie, logout, logoutAll, listDevices, forgetDevices, deviceKnown,
    changePassword, recuperaConChiave, startNuovoAuthenticator, nuovoFoglio, requestRecovery, startPhoneReset, completePhoneReset, confirmSensitive, prelogin, chiavi,
    events, log, profile, cookieNames: names, close,
  };
}

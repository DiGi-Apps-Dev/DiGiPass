// Prove del server su una cartella temporanea: accesso con chiave di accesso + Authenticator, limite tentativi,
// sincronizzazione con conflitti, recupero con chiave del foglio di emergenza, codici di riserva, backup.
// Il server non deve mai poter leggere i dati: nel database ci sono solo blob cifrati.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { authenticator } from 'otplib';
import { argon2id } from 'hash-wasm';
import * as C from '../public/risorse/cripto.js';
import { importaCsvChrome, importaProton, leggiCsv } from '../public/risorse/importa.js';
import { creaApp } from '../src/app.js';

C.usaArgon2(argon2id);
const KDF = { alg: 'argon2id', m: 8192, t: 1, p: 1 };
const dir = mkdtempSync(join(tmpdir(), 'digipass-prova-'));
const env = { POSTA_FINTA: join(dir, 'posta') };
const config = { porta: 0, indirizzo: '127.0.0.1', cartellaDati: join(dir, 'dati'), cartellaBackup: join(dir, 'backup'), chiave: randomBytes(32).toString('base64url'), configurazioneOvunque: false, proxyFidato: '' };
let server, base, srv;
const cookie = { v: '' };
async function chiama(metodo, url, corpo, { csrf = '', jar = cookie, headers = {} } = {}) {
  const r = await fetch(base + url, { method: metodo, headers: { ...(corpo ? { 'Content-Type': 'application/json' } : {}), ...(csrf ? { 'X-CSRF-Token': csrf } : {}), ...(jar.v ? { Cookie: jar.v } : {}), ...headers }, body: corpo ? JSON.stringify(corpo) : undefined });
  const set = r.headers.getSetCookie?.() || [];
  for (const c of set) {
    const [kv] = c.split(';'); const [k] = kv.split('=');
    jar.v = [...jar.v.split('; ').filter((x) => x && !x.startsWith(`${k}=`)), kv].filter((x) => !x.endsWith('=')).join('; ');
  }
  return { stato: r.status, j: await r.json().catch(() => ({})) };
}
const passo = (segreto) => authenticator.generate(segreto);
const aspettaPasso = async () => { const s = 30 - (Math.floor(Date.now() / 1000) % 30); await new Promise((r) => setTimeout(r, (s + 1) * 1000)); };

// Dati della cassaforte come li prepara l'app.
const PASSWORD = 'Password principale di prova!';
const dek = C.casuali(32);
const recupero = C.nuovaRecupero();
let pacco, segreto, csrf, riserva;

test.before(async () => {
  srv = await creaApp(config, env);
  server = srv.app.listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
  pacco = await C.avvolgi(dek, PASSWORD, recupero, KDF);
});
test.after(() => { server?.close(); srv?.chiudi(); rmSync(dir, { recursive: true, force: true }); });

test('prima configurazione (solo da questo PC) con Authenticator e 10 codici di riserva', async () => {
  const st = await chiama('GET', '/api/auth/status');
  assert.equal(st.j.initialized, false);
  assert.equal(st.j.setupAllowed, true);
  const s = await chiama('POST', '/api/auth/setup/start', { username: 'admin' });
  segreto = s.j.secret;
  const errato = await chiama('POST', '/api/auth/setup/complete', { setupToken: s.j.setupToken, password: pacco.accesso, code: '000000', chiavi: pacco.chiavi, accessoRecupero: pacco.accessoRec });
  assert.equal(errato.stato, 400);
  const ok = await chiama('POST', '/api/auth/setup/complete', { setupToken: s.j.setupToken, password: pacco.accesso, code: passo(segreto), chiavi: pacco.chiavi, accessoRecupero: pacco.accessoRec });
  assert.equal(ok.stato, 200, JSON.stringify(ok.j));
  assert.equal(ok.j.codiciRiserva.length, 10);
  riserva = ok.j.codiciRiserva;
  csrf = ok.j.csrf;
  const ancora = await chiama('POST', '/api/auth/setup/start', { username: 'altro' });
  assert.equal(ancora.stato, 403);
});

test('prelogin: per un nome sbagliato valori finti ma stabili', async () => {
  const a = await chiama('POST', '/api/auth/prelogin', { username: 'sconosciuto' });
  const b = await chiama('POST', '/api/auth/prelogin', { username: 'sconosciuto' });
  assert.deepEqual(a.j, b.j);
  assert.equal(a.j.dekPw, undefined);
  const vero = await chiama('POST', '/api/auth/prelogin', { username: 'Admin' });
  assert.equal(vero.j.salePw, pacco.chiavi.salePw);
  assert.equal(vero.j.dekPw, undefined, 'la DEK cifrata con la password non si dà prima dell\'accesso');
});

test('sincronizzazione: il server conserva solo dati cifrati, conflitti riconosciuti', async () => {
  const voce = { id: 'voce00000001', tipo: 'login', titolo: 'Banca segreta', campi: { utente: 'nome@esempio.ch', password: 'Sup3r-segreta' }, modificata: 1 };
  const blob = await C.cifraVoce(dek, voce.id, voce);
  const senzaCsrf = await chiama('PUT', `/api/sync/${voce.id}`, { tipo: 'voce', base: 0, blob });
  assert.equal(senzaCsrf.stato, 403);
  const w = await chiama('PUT', `/api/sync/${voce.id}`, { tipo: 'voce', base: 0, blob }, { csrf });
  assert.equal(w.stato, 200);
  assert.equal(w.j.versione, 1);
  const conflitto = await chiama('PUT', `/api/sync/${voce.id}`, { tipo: 'voce', base: 0, blob }, { csrf });
  assert.equal(conflitto.stato, 409);
  assert.equal(conflitto.j.attuale.versione, 1);
  const g = await chiama('GET', '/api/sync?da=0');
  assert.equal(g.j.voci.length, 1);
  assert.deepEqual(await C.decifraVoce(dek, voce.id, g.j.voci[0].blob), voce);
  const dopo = await chiama('GET', `/api/sync?da=${g.j.rev}`);
  assert.equal(dopo.j.voci.length, 0);
  const cancella = await chiama('PUT', `/api/sync/${voce.id}`, { tipo: 'voce', base: 1, cancellata: true }, { csrf });
  assert.equal(cancella.j.versione, 2);
  // Nel database del NAS non c'è niente in chiaro.
  const grezzo = readFileSync(join(config.cartellaDati, 'digipass.sqlite')).toString('latin1');
  for (const parola of ['Banca segreta', 'Sup3r-segreta', 'nome@esempio.ch', PASSWORD]) assert.ok(!grezzo.includes(parola), parola);
  const auth = readFileSync(join(config.cartellaDati, 'auth.sqlite')).toString('latin1');
  assert.ok(!auth.includes(PASSWORD));
});

test('accesso: chiave sbagliata, poi blocco dopo 5 tentativi per 15 minuti', async () => {
  await aspettaPasso();
  const jar = { v: '' };
  const giusto = await chiama('POST', '/api/auth/login', { username: 'admin', password: pacco.accesso, code: passo(segreto) }, { jar });
  assert.equal(giusto.stato, 200, JSON.stringify(giusto.j));
  const ch = await chiama('GET', '/api/chiavi', null, { jar });
  const kek = await C.chiaveDaPassword(PASSWORD, C.deB64(ch.j.salePw), ch.j.kdf);
  assert.equal(C.b64(await C.decifra(kek, C.deB64(ch.j.dekPw))), C.b64(dek));
  const altro = { v: '' };
  const sbagliata = C.b64url(C.casuali(32));
  for (let i = 0; i < 5; i++) assert.equal((await chiama('POST', '/api/auth/login', { username: 'admin', password: sbagliata, code: '123456' }, { jar: altro })).stato, 400);
  const bloccato = await chiama('POST', '/api/auth/login', { username: 'admin', password: pacco.accesso, code: passo(segreto) }, { jar: altro });
  assert.equal(bloccato.stato, 429);
  assert.match(bloccato.j.error, /Troppi tentativi/);
});

test('codice di riserva al posto di Authenticator, valido una volta sola', async () => {
  // Il blocco di prima riguarda nome utente e IP: si sblocca a mano per questa prova.
  srv.sicurezza.log('prova', '', 'pulizia tentativi');
  const db = (await import('better-sqlite3')).default;
  const d = new db(join(config.cartellaDati, 'auth.sqlite')); d.prepare('DELETE FROM auth_attempts').run(); d.close();
  const jar = { v: '' };
  const r = await chiama('POST', '/api/auth/login', { username: 'admin', password: pacco.accesso, code: riserva[0].toLowerCase() }, { jar });
  assert.equal(r.stato, 200, JSON.stringify(r.j));
  assert.equal(r.j.riserveRimaste, 9);
  const di_nuovo = await chiama('POST', '/api/auth/login', { username: 'admin', password: pacco.accesso, code: riserva[0] }, { jar: { v: '' } });
  assert.equal(di_nuovo.stato, 400);
});

test('password dimenticata: chiave di recupero + codice, chiavi nuove', async () => {
  const pre = await chiama('POST', '/api/auth/prelogin', { username: 'admin' });
  const recKey = await C.chiaveDaRecupero(recupero, C.deB64(pre.j.saleRec));
  const dek2 = await C.decifra(recKey, C.deB64(pre.j.dekRec));
  assert.equal(C.b64(dek2), C.b64(dek));
  const nuovaRec = C.nuovaRecupero();
  const nuove = await C.avvolgi(dek2, 'Password nuova dopo il recupero', nuovaRec, KDF);
  const jar = { v: '' };
  const sbagliata = await chiama('POST', '/api/auth/recupero', { username: 'admin', accessoRecupero: C.b64url(C.casuali(32)), code: riserva[1], newPassword: nuove.accesso, nuovoAccessoRecupero: nuove.accessoRec, chiavi: nuove.chiavi }, { jar });
  assert.equal(sbagliata.stato, 400);
  const r = await chiama('POST', '/api/auth/recupero', { username: 'admin', accessoRecupero: await C.accessoRecupero(recKey, C.deB64(pre.j.saleRec)), code: riserva[2], newPassword: nuove.accesso, nuovoAccessoRecupero: nuove.accessoRec, chiavi: nuove.chiavi }, { jar });
  assert.equal(r.stato, 200, JSON.stringify(r.j));
  const vecchia = await chiama('POST', '/api/auth/login', { username: 'admin', password: pacco.accesso, code: riserva[3] }, { jar: { v: '' } });
  assert.equal(vecchia.stato, 400, 'la password vecchia non vale più');
  pacco = nuove;
});

test('backup cifrato: si crea e non contiene niente in chiaro', async () => {
  const jar = { v: '' };
  const l = await chiama('POST', '/api/auth/login', { username: 'admin', password: pacco.accesso, code: riserva[4] }, { jar });
  assert.equal(l.stato, 200, JSON.stringify(l.j));
  const b = await chiama('POST', '/api/backup/ora', {}, { jar, csrf: l.j.csrf });
  assert.equal(b.stato, 200, JSON.stringify(b.j));
  const file = readdirSync(config.cartellaBackup).filter((f) => f.endsWith('.enc'));
  assert.equal(file.length, 1);
  assert.ok(readFileSync(join(config.cartellaBackup, file[0])).subarray(0, 8).toString() === 'DGPSBK01');
  const imp = await chiama('PUT', '/api/backup', { enabled: true, frequency: 'weekly', dayOfWeek: 0, dayOfMonth: 1, hour: 3, minute: 0 }, { jar, csrf: l.j.csrf });
  assert.equal(imp.stato, 200);
});

test('importazioni: CSV di Chrome e export di Proton Pass', async () => {
  const csv = 'name,url,username,password,note\nesempio.ch,https://www.esempio.ch/login,nome@esempio.ch,"pa,ss""w",\nvuoto,https://x.ch,,,\n';
  assert.equal(leggiCsv(csv)[1][3], 'pa,ss"w');
  const siti = importaCsvChrome(csv, []);
  // L'indirizzo resta esattamente come nel file (12.11.2026).
  assert.deepEqual(siti, [{ sito: 'https://www.esempio.ch/login', utente: 'nome@esempio.ch', password: 'pa,ss"w', nome: 'esempio.ch' }]);
  assert.equal(importaCsvChrome(csv, siti).length, 0, 'niente doppioni');
  const pp = { version: '1.0', vaults: { a: { name: 'Personale', items: [
    { itemId: '1', state: 1, pinned: true, data: { type: 'login', metadata: { name: 'Norton', note: '' }, content: { itemEmail: 'nome@esempio.ch', itemUsername: '', password: 'pw', urls: ['https://www.norton.com/'], totpUri: '' }, extraFields: [] } },
    { itemId: '2', state: 1, data: { type: 'creditCard', metadata: { name: 'Carta' }, content: { cardholderName: 'Nome', number: '4111111111111111', expirationDate: '2028-04', verificationNumber: '123', pin: '' }, extraFields: [] } },
  ] } } };
  const v = await importaProton(new TextEncoder().encode(JSON.stringify(pp)), 'data.json');
  assert.equal(v.length, 2);
  assert.equal(v[0].campi.utente, 'nome@esempio.ch');
  assert.deepEqual(v[0].siti, ['https://www.norton.com/']);
  assert.equal(v[0].origine, 'proton');
  assert.equal(v[0].fissata, true);
  assert.equal(v[1].campi.scadenza, '04/28');
});

test('allegati: solo byte cifrati, al massimo 25 MB per file, si leggono e si cancellano', async () => {
  const jar = { v: '' };
  const l = await chiama('POST', '/api/auth/login', { username: 'admin', password: pacco.accesso, code: riserva[5] }, { jar });
  assert.equal(l.stato, 200, JSON.stringify(l.j));
  const csrf = l.j.csrf, cookie = jar;
  const id = 'allegato0001';
  const chiaro = C.byte('contenuto segreto del documento di prova');
  const cifrato = await C.cifra(dek, chiaro, `digipass-allegato:${id}`);
  const binario = async (metodo, url, corpo) => {
    const r = await fetch(base + url, { method: metodo, headers: { 'Content-Type': 'application/octet-stream', 'X-CSRF-Token': csrf, Cookie: cookie.v }, body: corpo });
    return { stato: r.status, corpo: new Uint8Array(await r.arrayBuffer()) };
  };
  const senzaCsrf = await fetch(base + `/api/allegati/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/octet-stream', Cookie: cookie.v }, body: cifrato });
  assert.equal(senzaCsrf.status, 403);
  const w = await binario('PUT', `/api/allegati/${id}`, cifrato);
  assert.equal(w.stato, 200);
  const r = await binario('GET', `/api/allegati/${id}`);
  assert.equal(r.stato, 200);
  assert.deepEqual(C.testo(await C.decifra(dek, r.corpo, `digipass-allegato:${id}`)), 'contenuto segreto del documento di prova');
  const grezzo = readFileSync(join(config.cartellaDati, 'allegati', id)).toString('latin1');
  assert.ok(!grezzo.includes('contenuto segreto'));
  const grande = await binario('PUT', '/api/allegati/allegato0002', new Uint8Array(25 * 1024 * 1024 + 2000));
  assert.equal(grande.stato, 413);
  const info = await chiama('GET', '/api/allegati', null, { jar });
  assert.equal(info.j.massimo, 2 * 1024 * 1024 * 1024);
  assert.equal(info.j.usato, cifrato.length);
  const via = await binario('DELETE', `/api/allegati/${id}`);
  assert.equal(via.stato, 200);
  assert.equal((await binario('GET', `/api/allegati/${id}`)).stato, 404);
});

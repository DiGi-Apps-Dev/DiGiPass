// Server di DiGiPass per il NAS. Conserva solo dati cifrati dal telefono o dal browser e serve la webapp.
// Struttura di accesso, backup e avvisi copiata (11.11.2026) da DiGiShare: copia indipendente, nessun legame.
import fs from 'node:fs';
import { createWriteStream } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isIP } from 'node:net';
import { randomBytes } from 'node:crypto';
import express from 'express';
import { apriArchivio, ID_VOCE } from './archivio.js';
import { createSecurity } from './sicurezza.js';
import { createMailer } from './posta.js';
import { createProxyTrust } from './proxy.js';
import { creaAllegati, MAX_FILE, MAX_TOTALE, MAX_CIFRATO } from './allegati.js';
import { creaIcone, dominioDi } from './icone.js';
import { createBackup, stageRestore, applyPendingRestore, newestBackupTime, listBackups, backupOverdue, startBackupScheduler, normalizeBackupSettings, BACKUP_DEFAULTS } from './backup.js';

const RADICE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PUBBLICA = path.join(RADICE, 'public');
const ARGON2 = path.join(RADICE, 'node_modules', 'hash-wasm', 'dist', 'argon2.umd.min.js');
const MINUTO = 60 * 1000;
const ORA = 60 * MINUTO;
const normalizzaIp = (v) => String(v || '').replace(/^::ffff:/, '');

/** L'indirizzo IPv4 sta nella rete indicata (es. 192.168.1.0/24)? */
export function inRete(ip, cidr) {
  const [rete, bit] = String(cidr).split('/');
  const n = (s) => { const p = String(s).split('.').map(Number); return p.length === 4 && p.every((x) => Number.isInteger(x) && x >= 0 && x <= 255) ? ((p[0] << 24) >>> 0) + (p[1] << 16) + (p[2] << 8) + p[3] : null; };
  const a = n(normalizzaIp(ip)), b = n(rete), m = Number(bit);
  if (a === null || b === null || !Number.isInteger(m) || m < 8 || m > 32) return false;
  const maschera = m === 32 ? 0xffffffff : (0xffffffff << (32 - m)) >>> 0;
  return ((a & maschera) >>> 0) === ((b & maschera) >>> 0);
}

const INTESTAZIONI_SICUREZZA = {
  // 'wasm-unsafe-eval': serve solo ad Argon2id (WebAssembly) per ricavare la chiave nel browser.
  'Content-Security-Policy': "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self' 'wasm-unsafe-eval'; connect-src 'self'; manifest-src 'self'; worker-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
};

export function leggiConfigurazione(env = process.env) {
  return {
    porta: Number(env.PORTA ?? 8797),
    indirizzo: env.INDIRIZZO ?? '127.0.0.1',
    cartellaDati: path.resolve(env.CARTELLA_DATI ?? path.join(RADICE, 'dati')),
    cartellaBackup: path.resolve(env.CARTELLA_BACKUP ?? path.join(RADICE, 'backups')),
    chiave: env.DIGIPASS_AUTH_KEY ?? '',
    // 1 solo per la prima configurazione dal telefono; dopo si toglie dal .env.
    configurazioneOvunque: env.DIGIPASS_ALLOW_SETUP === '1',
    // Codice monouso per la prima configurazione dal telefono (si legge solo dal .env del NAS).
    codiceSetup: (env.DIGIPASS_CODICE_SETUP ?? '').trim(),
    proxyFidato: (env.PROXY_FIDATO ?? '').trim(),
  };
}

export async function creaApp(config, env = process.env) {
  fs.mkdirSync(config.cartellaDati, { recursive: true });
  const ripristinato = applyPendingRestore(config.cartellaDati);
  const archivio = apriArchivio(config.cartellaDati);
  const posta = createMailer(env);
  const sicurezza = createSecurity({ dataDir: config.cartellaDati, secret: config.chiave, secure: false, allowSetup: true, mailer: posta });
  const proxy = config.proxyFidato ? createProxyTrust({ hostname: config.proxyFidato, onWarning: (m) => console.warn(m) }) : null;
  if (ripristinato) sicurezza.log('backup_ripristinato', '', "installato all'avvio");

  const dalProxy = (req) => Boolean(proxy?.has(normalizzaIp(req.socket.remoteAddress)));
  function indirizzoClient(req) {
    const remoto = normalizzaIp(req.socket.remoteAddress);
    if (dalProxy(req)) {
      const vero = normalizzaIp(req.headers['x-real-ip']);
      if (isIP(vero)) return vero;
    }
    return remoto;
  }
  const richiestaSicura = (req) => dalProxy(req) && req.headers['x-forwarded-proto'] === 'https';
  const daQuestoPc = (req) => ['127.0.0.1', '::1'].includes(normalizzaIp(req.socket.remoteAddress)) && !dalProxy(req);
  const cookieDi = (req, nome) => String(req.headers.cookie || '').split(';').map((x) => x.trim()).find((x) => x.startsWith(`${nome}=`))?.slice(nome.length + 1) || '';
  const aggiungiCookie = (res, valori) => res.append('Set-Cookie', (Array.isArray(valori) ? valori : [valori]).filter(Boolean));

  // ---- backup automatici cifrati con impostazioni + «Backup ora» (standard app, punti 9-11 e 14) ----
  const impostazioniBackup = () => { try { return normalizeBackupSettings(archivio.leggiImp('backup', {})); } catch { return { ...BACKUP_DEFAULTS }; } };
  const avvisa = (oggetto, testo) => { if (posta.configured) posta.send(oggetto, testo).catch(() => {}); };
  let backupInCorso = false;
  async function backupAdesso() {
    if (backupInCorso) throw new Error('Un backup è già in corso.');
    backupInCorso = true;
    try {
      return await createBackup({ dataDir: config.cartellaDati, backupDir: config.cartellaBackup, secret: config.chiave });
    } catch (err) {
      sicurezza.log('backup_fallito', '', err.message);
      avvisa('DiGiPass: backup fallito', `Backup non riuscito: ${err.message}`);
      throw err;
    } finally {
      backupInCorso = false;
    }
  }
  const avviatoIl = Date.now();
  let ultimoAvvisoRitardo = 0;
  function controllaRitardoBackup() {
    const inRitardo = backupOverdue({ settings: impostazioniBackup(), newestMs: newestBackupTime(config.cartellaBackup), sinceMs: avviatoIl, now: Date.now() });
    if (!inRitardo || Date.now() - ultimoAvvisoRitardo < 24 * ORA) return;
    ultimoAvvisoRitardo = Date.now();
    sicurezza.log('backup_in_ritardo');
    avvisa('DiGiPass: backup non eseguito', 'Il backup automatico di DiGiPass non risulta eseguito nei tempi previsti.');
  }
  const permessiRipristino = new Map();

  // ---- l'app smette di funzionare (punto 15): dopo alcuni intoppi di fila ----
  let scrittureFallite = 0, ultimoAvvisoFermo = 0;
  function controllaSalute() {
    try { archivio.scriviImp('battito', Date.now()); scrittureFallite = 0; } catch { scrittureFallite++; }
    if (scrittureFallite < 3 || Date.now() - ultimoAvvisoFermo < 6 * ORA) return;
    ultimoAvvisoFermo = Date.now();
    sicurezza.log('app_ferma', '', 'il database non accetta più scritture');
    avvisa('DiGiPass: l\'app ha un problema', 'Il database di DiGiPass non accetta più scritture: la sincronizzazione è ferma.');
  }
  const programmatore = startBackupScheduler({ getSettings: impostazioniBackup, run: async () => { await backupAdesso(); sicurezza.log('backup_creato', '', 'automatico'); }, lastBackupMs: () => newestBackupTime(config.cartellaBackup) });
  const timer = [setInterval(controllaRitardoBackup, ORA), setInterval(controllaSalute, 5 * MINUTO)];
  timer.forEach((t) => t.unref());

  const app = express();
  app.disable('x-powered-by');
  app.set('etag', false);
  app.use((req, res, next) => {
    res.set(INTESTAZIONI_SICUREZZA);
    res.set('Cache-Control', 'no-store');
    next();
  });
  // Anti-CSRF: origine della richiesta (dietro il proxy l'Host puo' arrivare con o senza :8446).
  app.use((req, res, next) => {
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
    const origine = req.headers.origin;
    // L'estensione Chrome di DiGiPass: un sito web non può dichiararsi chrome-extension://, quindi non è un rischio CSRF.
    if (/^chrome-extension:\/\/[a-p]{32}$/.test(String(origine || ''))) return next();
    if (req.headers['sec-fetch-site'] === 'cross-site') return res.status(403).json({ error: 'Origine non consentita.' });
    if (!origine) return next();
    try {
      if (new URL(origine).hostname === new URL(`http://${req.headers.host}`).hostname) return next();
    } catch { /* origine non valida */ }
    res.status(403).json({ error: 'Origine non consentita.' });
  });
  const json = express.json({ limit: '64kb' });

  app.get('/stato', (req, res) => res.json({ ok: true, app: 'digipass' }));

  // ---- accesso: rotte pubbliche ----
  // Prima configurazione: nessun account ancora, e richiesta da questo PC oppure (con DIGIPASS_ALLOW_SETUP=1) con il codice
  // monouso del .env. Appena esiste l'account si chiude da sola.
  const conCodice = () => config.configurazioneOvunque && config.codiceSetup.length >= 8;
  const statoAccesso = (req) => ({
    initialized: sicurezza.initialized(),
    setupAllowed: sicurezza.setupAllowed() && (daQuestoPc(req) || conCodice()),
    // Niente codice se il browser manda un «dispositivo ricordato» ancora valido. Solo un'indicazione per la
    // pagina: il controllo vero resta nel login, che senza dispositivo valido rifiuta l'accesso senza codice.
    serveCodice: !sicurezza.deviceKnown(cookieDi(req, sicurezza.cookieNames(richiestaSicura(req)).device)),
    emailConfigured: posta.configured,
  });
  app.get('/api/auth/status', (req, res) => res.json(statoAccesso(req)));
  app.post('/api/auth/prelogin', json, (req, res) => res.json(sicurezza.prelogin(req.body?.username)));
  app.post('/api/auth/setup/start', json, async (req, res, next) => {
    try {
      if (!statoAccesso(req).setupAllowed) return res.status(403).json({ error: 'Prima configurazione non disponibile su questo NAS.' });
      if (!daQuestoPc(req)) sicurezza.controllaCodiceSetup(req.body?.codiceSetup, config.codiceSetup, indirizzoClient(req));
      res.json(await sicurezza.startSetup(req.body?.username || 'admin'));
    } catch (err) { next(err); }
  });
  app.post('/api/auth/setup/complete', json, async (req, res, next) => {
    try {
      if (!statoAccesso(req).setupAllowed) return res.status(403).json({ error: 'Configurazione iniziale non disponibile.' });
      const r = await sicurezza.completeSetup(req.body, indirizzoClient(req), richiestaSicura(req), String(req.headers['user-agent'] || ''));
      aggiungiCookie(res, r.deviceCookie ? [r.cookie, r.deviceCookie] : r.cookie);
      res.json({ csrf: r.csrf, codiciRiserva: r.codiciRiserva });
    } catch (err) { next(err); }
  });
  app.post('/api/auth/login', json, async (req, res, next) => {
    try {
      const on = richiestaSicura(req);
      const r = await sicurezza.login(req.body, indirizzoClient(req), cookieDi(req, sicurezza.cookieNames(on).device), String(req.headers['user-agent'] || ''), on);
      aggiungiCookie(res, r.deviceCookie ? [r.cookie, r.deviceCookie] : r.cookie);
      res.json({ csrf: r.csrf, riserveRimaste: r.riserveRimaste });
    } catch (err) { next(err); }
  });
  app.post('/api/auth/recupero', json, async (req, res, next) => {
    try {
      const r = await sicurezza.recuperaConChiave(req.body, indirizzoClient(req), richiestaSicura(req));
      aggiungiCookie(res, r.cookie);
      res.json({ csrf: r.csrf });
    } catch (err) { next(err); }
  });
  app.post('/api/auth/recovery/request', json, async (req, res, next) => {
    try { res.json(await sicurezza.requestRecovery(req.body, indirizzoClient(req))); } catch (err) { next(err); }
  });
  app.post('/api/auth/recovery/phone/start', json, async (req, res, next) => {
    try { res.json(await sicurezza.startPhoneReset(req.body, indirizzoClient(req))); } catch (err) { next(err); }
  });
  app.post('/api/auth/recovery/phone/complete', json, async (req, res, next) => {
    try { await sicurezza.completePhoneReset(req.body, indirizzoClient(req)); res.json({ ok: true }); } catch (err) { next(err); }
  });

  // ---- da qui serve la sessione, e per scrivere anche il token anti-CSRF ----
  function serveSessione(req, res, next) {
    req.sessione = sicurezza.current(req, richiestaSicura(req));
    if (!req.sessione) return res.status(401).json({ error: 'Accedi per continuare.' });
    if (!['GET', 'HEAD'].includes(req.method) && req.headers['x-csrf-token'] !== req.sessione.csrf) {
      return res.status(403).json({ error: 'Sessione non valida. Ricarica la pagina.' });
    }
    next();
  }
  app.use('/api', serveSessione);

  // Logo di un sito, preso dal sito stesso e tenuto in cache sul NAS. 404 = nessun logo, resta l'iniziale.
  const icone = creaIcone(config.cartellaDati);
  app.get('/api/icona/:dominio', async (req, res) => {
    const d = dominioDi(req.params.dominio);
    if (!d || d !== req.params.dominio) return res.status(400).json({ error: 'Dominio non valido.' });
    try {
      const r = await icone.icona(d);
      if (!r) return res.status(404).json({ error: 'Nessun logo.' });
      res.set('Cache-Control', 'private, max-age=86400').type(r.tipo).send(r.corpo);
    } catch { res.status(404).json({ error: 'Nessun logo.' }); }
  });

  app.get('/api/auth/me', (req, res) => res.json({ csrf: req.sessione.csrf, ...sicurezza.profile() }));
  app.post('/api/auth/logout', (req, res) => {
    aggiungiCookie(res, sicurezza.logout(req.sessione, indirizzoClient(req), richiestaSicura(req)));
    res.json({ ok: true });
  });
  app.post('/api/auth/logout-all', (req, res) => { sicurezza.logoutAll(req.sessione, indirizzoClient(req)); res.json({ ok: true }); });
  app.get('/api/auth/devices', (req, res) => res.json({ devices: sicurezza.listDevices() }));
  app.post('/api/auth/devices/forget', (req, res) => {
    aggiungiCookie(res, sicurezza.forgetDevices(indirizzoClient(req), richiestaSicura(req)));
    res.json({ ok: true });
  });
  app.post('/api/auth/password', json, async (req, res, next) => {
    try { await sicurezza.changePassword(req.body, req.sessione, indirizzoClient(req)); res.json({ ok: true }); } catch (err) { next(err); }
  });
  app.post('/api/auth/foglio', json, async (req, res, next) => {
    try {
      await sicurezza.confirmSensitive({ password: req.body?.password, code: req.body?.code }, indirizzoClient(req));
      res.json({ codiciRiserva: await sicurezza.nuovoFoglio(req.body, indirizzoClient(req)) });
    } catch (err) { next(err); }
  });
  app.post('/api/auth/authenticator/nuovo', json, async (req, res, next) => {
    try {
      await sicurezza.confirmSensitive({ password: req.body?.password, code: req.body?.code }, indirizzoClient(req));
      res.json(await sicurezza.startNuovoAuthenticator(indirizzoClient(req)));
    } catch (err) { next(err); }
  });
  app.post('/api/auth/authenticator/conferma', json, async (req, res, next) => {
    try { await sicurezza.completePhoneReset(req.body, indirizzoClient(req)); res.json({ ok: true }); } catch (err) { next(err); }
  });
  app.get('/api/registro', (req, res) => res.json({ eventi: sicurezza.events(200) }));

  // ---- chiavi cifrate della cassaforte e sincronizzazione ----
  app.get('/api/chiavi', (req, res) => res.json(sicurezza.chiavi()));
  app.get('/api/sync', (req, res) => res.json(archivio.cambi(Number(req.query.da) || 0)));
  app.put('/api/sync/:id', express.json({ limit: '700kb' }), (req, res, next) => {
    try {
      if (!ID_VOCE.test(req.params.id)) return res.status(400).json({ error: 'Id non valido.' });
      const r = archivio.scrivi(req.params.id, req.body || {});
      if (r.conflitto) return res.status(409).json({ error: 'La voce è cambiata da un altro dispositivo.', attuale: r.attuale });
      res.json(r);
    } catch (err) { next(err); }
  });

  // ---- allegati: solo byte già cifrati (CHECKLIST 1.11; 25 MB per file, 2 GB in tutto) ----
  const allegati = creaAllegati(config.cartellaDati);
  app.get('/api/allegati', (req, res) => res.json({ usato: allegati.usato(), massimo: MAX_TOTALE, massimoFile: MAX_FILE }));
  app.get('/api/allegati/:id', (req, res) => {
    const f = allegati.percorso(req.params.id);
    if (!f) return res.status(404).json({ error: 'Allegato non trovato.' });
    res.set('Cache-Control', 'no-store').type('application/octet-stream').sendFile(f);
  });
  app.put('/api/allegati/:id', express.raw({ type: 'application/octet-stream', limit: MAX_CIFRATO + 1024 }), (req, res, next) => {
    try { res.json(allegati.scrivi(req.params.id, req.body)); } catch (err) { next(err); }
  });
  app.delete('/api/allegati/:id', (req, res, next) => {
    try { res.json(allegati.cancella(req.params.id)); } catch (err) { next(err); }
  });

  // ---- backup ----
  app.get('/api/backup', (req, res) => res.json({
    impostazioni: impostazioniBackup(), ultimo: newestBackupTime(config.cartellaBackup) || null,
    copie: listBackups(config.cartellaBackup).length, inCorso: backupInCorso,
  }));
  app.put('/api/backup', json, (req, res, next) => {
    try {
      archivio.scriviImp('backup', normalizeBackupSettings(req.body));
      sicurezza.log('backup_programmazione_modificata', indirizzoClient(req));
      res.json({ ok: true, impostazioni: impostazioniBackup() });
    } catch (err) { next(err); }
  });
  app.post('/api/backup/ora', async (req, res, next) => {
    try {
      const file = await backupAdesso();
      sicurezza.log('backup_creato', indirizzoClient(req));
      res.json({ ok: true, nome: path.basename(file), ultimo: newestBackupTime(config.cartellaBackup) });
    } catch (err) { next(err); }
  });
  app.post('/api/backup/ripristino/autorizza', json, async (req, res, next) => {
    try {
      await sicurezza.confirmSensitive(req.body, indirizzoClient(req));
      const permesso = randomBytes(32).toString('base64url');
      permessiRipristino.set(permesso, { tokenHash: req.sessione.tokenHash, indirizzo: indirizzoClient(req), scade: Date.now() + 2 * MINUTO });
      res.json({ grant: permesso });
    } catch (err) { next(err); }
  });
  app.post('/api/backup/ripristino', async (req, res, next) => {
    const chiavePermesso = String(req.headers['x-restore-grant'] || '');
    const permesso = permessiRipristino.get(chiavePermesso);
    permessiRipristino.delete(chiavePermesso);
    if (!permesso || permesso.tokenHash !== req.sessione.tokenHash || permesso.indirizzo !== indirizzoClient(req) || permesso.scade < Date.now()) {
      return res.status(403).json({ error: 'Conferma di ripristino scaduta.' });
    }
    const temporaneo = path.join(config.cartellaDati, `.upload-${randomBytes(6).toString('hex')}`);
    try {
      const uscita = createWriteStream(temporaneo, { mode: 0o600 });
      let byte = 0;
      for await (const pezzo of req) {
        byte += pezzo.length;
        if (byte > 256 * 1024 * 1024) throw Object.assign(new Error('Backup troppo grande.'), { status: 413 });
        if (!uscita.write(pezzo)) await new Promise((r) => uscita.once('drain', r));
      }
      await new Promise((r, j) => uscita.end((e) => (e ? j(e) : r())));
      if (!byte) throw new Error('Seleziona un file di backup.');
      stageRestore({ filePath: temporaneo, dataDir: config.cartellaDati, secret: config.chiave });
      sicurezza.log('backup_ripristinato', indirizzoClient(req), 'preparato: si installa al riavvio');
      avvisa('DiGiPass: backup ripristinato', `I dati di DiGiPass vengono ripristinati da un backup (richiesta da ${indirizzoClient(req)}).`);
      res.json({ ok: true, riavvio: true });
      setTimeout(() => process.exit(0), 700);
    } catch (err) {
      next(err);
    } finally {
      fs.rmSync(temporaneo, { force: true });
    }
  });

  // ---- webapp: una pagina sola; i dati si aprono nel browser ----
  app.get('/', (req, res) => res.sendFile(path.join(PUBBLICA, 'index.html')));
  // PWA: icona sul telefono e favicon (logo approvato l'11.11.2026).
  app.get('/manifest.json', (req, res) => {
    res.type('application/manifest+json').send(JSON.stringify({
      name: 'DiGiPass', short_name: 'DiGiPass', description: 'Le tue password, cifrate', start_url: '/', scope: '/', display: 'standalone',
      background_color: '#141317', theme_color: '#141317',
      icons: [
        { src: '/risorse/icona-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
        { src: '/risorse/icona-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
        { src: '/risorse/icona-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
      ],
    }));
  });
  app.get('/favicon.ico', (req, res) => { res.set('Cache-Control', 'public, max-age=86400'); res.type('image/png').sendFile(path.join(PUBBLICA, 'risorse', 'favicon-32.png')); });
  app.get('/vendor/argon2.js', (req, res) => { res.set('Cache-Control', 'public, max-age=86400'); res.sendFile(ARGON2); });
  app.use('/risorse', express.static(path.join(PUBBLICA, 'risorse'), { cacheControl: false, setHeaders: (res) => res.set('Cache-Control', 'no-cache') }));

  app.use((err, req, res, next) => {
    if (res.headersSent) return next(err);
    if (err.type === 'entity.too.large') return res.status(413).json({ error: 'Troppo grande: un allegato può essere al massimo di 25 MB.' });
    const stato = err.status ?? err.status_code ?? (/Troppi tentativi/.test(err.message) ? 429 : err.expose === false ? 500 : 400);
    if (stato >= 500) console.error(err);
    res.status(stato).json({ error: stato >= 500 ? 'Qualcosa è andato storto sul server.' : (err.message || 'Errore.') });
  });

  function chiudi() {
    timer.forEach(clearInterval);
    programmatore.stop();
    proxy?.close();
    sicurezza.close();
    posta.close();
    archivio.close();
  }
  return { app, archivio, sicurezza, chiudi, backupAdesso };
}

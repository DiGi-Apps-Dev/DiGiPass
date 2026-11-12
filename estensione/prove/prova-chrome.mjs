// Prova dell'estensione in un Chrome di PROVA (profilo temporaneo, mai quello vero), con un server DiGiPass di
// prova e un sito finto in locale. Comanda Chrome con il protocollo DevTools (WebSocket di Node, nessuna libreria).
//
//   node estensione/prove/prova-chrome.mjs
//
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const QUI = resolve(fileURLToPath(import.meta.url), '..');
const ESTENSIONE = resolve(QUI, '..');
const SERVER = resolve(QUI, '..', '..', 'server');
const CHROME = process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const dir = mkdtempSync(join(tmpdir(), 'digipass-estensione-'));
const PS = 18799, PSITO = 18800, PDT = 9333;
const esiti = [];
const ok = (cond, testo) => { esiti.push([Boolean(cond), testo]); console.log(`${cond ? 'OK  ' : 'NO  '} ${testo}`); };
const attesa = (ms) => new Promise((r) => setTimeout(r, ms));
const figli = [];
const finisci = (code) => { for (const f of figli) try { f.kill(); } catch { /* gia' chiuso */ } setTimeout(() => { try { rmSync(dir, { recursive: true, force: true }); } catch { /* file ancora aperti */ } process.exit(code); }, 1500); };

// ---------- server DiGiPass di prova ----------
const srv = spawn(process.execPath, [join(SERVER, 'src', 'server.js')], { env: { ...process.env, PORTA: String(PS), INDIRIZZO: '127.0.0.1', CARTELLA_DATI: join(dir, 'dati'), CARTELLA_BACKUP: join(dir, 'bk'), DIGIPASS_AUTH_KEY: randomBytes(32).toString('base64url') }, stdio: 'ignore' });
figli.push(srv);
for (let i = 0; i < 150; i++) { try { if ((await fetch(`http://127.0.0.1:${PS}/stato`)).ok) break; } catch { /* non ancora (su Y: il server parte in circa 10 secondi) */ } await attesa(300); }
const cred = join(dir, 'credenziali.json');
await new Promise((r, j) => spawn(process.execPath, [join(SERVER, 'tools', 'dati-di-prova.mjs'), `http://127.0.0.1:${PS}`, cred], { stdio: 'inherit', cwd: SERVER }).on('exit', (c) => (c ? j(new Error('dati di prova')) : r())));
const { password, riserva } = JSON.parse(readFileSync(cred, 'utf8'));

// ---------- sito finto: accesso, iscrizione ----------
const pagine = {
  '/login': '<form id=f action="/fatto" method=post><input id=u name=u type=email autocomplete=username><input id=p name=p type=password><button id=b>Entra</button></form>',
  '/iscriviti': '<form id=f action="/fatto" method=post><input id=u name=u type=email><input id=p1 type=password autocomplete=new-password><input id=p2 type=password autocomplete=new-password><button>Iscriviti</button></form>',
  '/fatto': '<p>Benvenuto</p>',
};
const sito = createServer((req, res) => { res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.end(`<!doctype html><title>Sito di prova</title><body>${pagine[req.url.split('?')[0]] || 'ok'}</body>`); }).listen(PSITO, '127.0.0.1');
figli.push({ kill: () => sito.close() });

// ---------- Chrome di prova ----------
// Chrome ufficiale non accetta piu' --load-extension: l'estensione si carica col comando DevTools Extensions.loadUnpacked.
const ch = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${PDT}`, '--enable-unsafe-extension-debugging', `--user-data-dir=${join(dir, 'profilo')}`, '--no-first-run', '--no-default-browser-check', 'about:blank'], { stdio: 'ignore' });
figli.push(ch);
let versione;
for (let i = 0; i < 60 && !versione; i++) { try { versione = await (await fetch(`http://127.0.0.1:${PDT}/json/version`)).json(); } catch { await attesa(250); } }
{
  const ws = new WebSocket(versione.webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener('open', r, { once: true }));
  const r = await new Promise((ris) => { ws.addEventListener('message', (e) => ris(JSON.parse(e.data))); ws.send(JSON.stringify({ id: 1, method: 'Extensions.loadUnpacked', params: { path: ESTENSIONE } })); });
  ws.close();
  if (!r.result?.id) { console.log('caricamento non riuscito', JSON.stringify(r)); }
}
let bersagli = [];
for (let i = 0; i < 60; i++) { try { bersagli = await (await fetch(`http://127.0.0.1:${PDT}/json`)).json(); if (bersagli.some((t) => t.url.startsWith('chrome-extension://'))) break; } catch { /* Chrome parte */ } await attesa(250); }
const sw = bersagli.find((t) => t.type === 'service_worker' && t.url.endsWith('/sw.js'));
ok(sw, 'estensione caricata nel Chrome di prova');
if (!sw) finisci(1);
const ID = new URL(sw.url).host;

let nId = 0;
async function collega(wsUrl) {
  const ws = new WebSocket(wsUrl);
  await new Promise((r) => ws.addEventListener('open', r, { once: true }));
  const attesi = new Map(), contesti = [];
  ws.addEventListener('message', (e) => {
    const m = JSON.parse(e.data);
    if (m.id && attesi.has(m.id)) { attesi.get(m.id)(m); attesi.delete(m.id); }
    if (m.method === 'Runtime.executionContextCreated') contesti.push(m.params.context);
  });
  const cmd = (method, params = {}) => new Promise((r) => { const id = ++nId; attesi.set(id, r); ws.send(JSON.stringify({ id, method, params })); });
  const valuta = async (expression, contextId) => {
    const r = await cmd('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, ...(contextId ? { contextId } : {}) });
    if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description || 'errore');
    return r.result?.result?.value;
  };
  return { ws, cmd, valuta, contesti };
}
async function apriScheda(url) {
  const t = await (await fetch(`http://127.0.0.1:${PDT}/json/new?${encodeURIComponent(url)}`, { method: 'PUT' })).json();
  const c = await collega(t.webSocketDebuggerUrl);
  await c.cmd('Runtime.enable');
  await c.cmd('Page.enable');
  await attesa(1200);
  return c;
}

try {
  // 1) finestra dell'estensione: indirizzo del server di prova, sblocco con password + codice di riserva
  const pop = await apriScheda(`chrome-extension://${ID}/popup.html?grande=1`);
  await pop.valuta(`chrome.runtime.sendMessage({a:'conf',conf:{url:'http://127.0.0.1:${PS}',utente:'admin'}})`);
  await pop.valuta('location.reload()');
  await attesa(1200);
  const conCodice = await pop.valuta("Boolean(document.querySelector('#codice'))");
  ok(conCodice, 'senza sessione chiede il codice di Authenticator');
  await pop.valuta(`(() => { document.querySelector('#pw').value=${JSON.stringify(password)}; document.querySelector('#codice').value=${JSON.stringify(riserva[0])}; document.querySelector('form').requestSubmit(); })()`);
  let righe = 0;
  for (let i = 0; i < 40 && !righe; i++) { await attesa(250); righe = await pop.valuta("document.querySelectorAll('.riga').length"); }
  ok(righe >= 5, `cassaforte aperta nella finestra dell'estensione (${righe} voci)`);
  const elenco = await pop.valuta("chrome.runtime.sendMessage({a:'elenco'})");
  ok(elenco.voci?.some((v) => v.titolo === 'Norton'), 'voci decifrate nell\'estensione uguali a quelle del server');

  // 2) pagina del sito: l'elenco completo non è raggiungibile, solo i login del sito
  const pag = await apriScheda(`http://127.0.0.1:${PSITO}/login`);
  ok(await pag.valuta("Boolean(document.querySelector('digipass-livello'))"), 'icona di DiGiPass aggiunta ai campi del sito');
  const isolato = pag.contesti.find((c) => c.auxData?.type === 'isolated' && c.origin?.includes(ID) || c.name === 'DiGiPass');
  ok(isolato, 'script di contenuto attivo nella pagina');
  const negato = await pag.valuta("new Promise(r => chrome.runtime.sendMessage({a:'elenco'}, r))", isolato.id);
  ok(negato?.errore, 'dalla pagina l\'elenco completo è rifiutato');
  const perSito = await pag.valuta("new Promise(r => chrome.runtime.sendMessage({a:'perSito'}, r))", isolato.id);
  ok(Array.isArray(perSito.voci) && perSito.voci.length === 0, 'il sito di prova non riceve login di altri siti');

  // 3) login nuovo: salvato da solo in Memoria siti, poi «Metti in cassaforte»
  await pag.valuta("(() => { document.querySelector('#u').value='nuovo@esempio.ch'; document.querySelector('#p').value='Password-Nuova-1!'; document.querySelector('#f').requestSubmit(); })()");
  await attesa(2500);
  const dopo = await pop.valuta("chrome.runtime.sendMessage({a:'elenco'})");
  const salvato = dopo.siti.find((s) => s.sito === '127.0.0.1' && s.utente === 'nuovo@esempio.ch');
  ok(salvato?.password === 'Password-Nuova-1!', 'login nuovo salvato da solo in Memoria siti');
  const pag2 = await apriScheda(`http://127.0.0.1:${PSITO}/login`);
  const iso2 = pag2.contesti.find((c) => c.auxData?.type === 'isolated');
  const ps = await pag2.valuta("new Promise(r => chrome.runtime.sendMessage({a:'perSito'}, r))", iso2.id);
  ok(ps.voci?.length === 1 && ps.voci[0].fonte === 'Memoria siti', 'tornando sul sito il login viene proposto');
  const comp = await pag2.valuta(`new Promise(r => chrome.runtime.sendMessage({a:'compila', id:${JSON.stringify(ps.voci[0].id)}}, r))`, iso2.id);
  ok(comp.password === 'Password-Nuova-1!', 'compilazione con la password giusta');
  await pag2.valuta(`new Promise(r => chrome.runtime.sendMessage({a:'mettiInCassaforte', id:${JSON.stringify(ps.voci[0].id)}, nome:'Sito di prova'}, r))`, iso2.id);
  const fine = await pop.valuta("chrome.runtime.sendMessage({a:'elenco'})");
  ok(fine.voci.some((v) => v.titolo === 'Sito di prova' && v.siti.includes('127.0.0.1')), '«Metti in cassaforte» crea la voce nella Cassaforte');
  // sul server ci sono solo blob cifrati
  const grezzo = readFileSync(join(dir, 'dati', 'digipass.sqlite')).toString('latin1');
  ok(!grezzo.includes('Password-Nuova-1!') && !grezzo.includes('nuovo@esempio.ch'), 'sul server niente in chiaro');

  // 4) iscrizione: password forte proposta
  const isc = await apriScheda(`http://127.0.0.1:${PSITO}/iscriviti`);
  const iso3 = isc.contesti.find((c) => c.auxData?.type === 'isolated');
  const g = await isc.valuta("new Promise(r => chrome.runtime.sendMessage({a:'genera'}, r))", iso3.id);
  ok(/^.{20}$/.test(g.password), 'password forte generata per l\'iscrizione');

  // 4b) immagini per controllare a occhio menu nel campo e riquadro «Metti in cassaforte» (in DIGIPASS_FOTO, se c'e')
  if (process.env.DIGIPASS_FOTO) {
    const { writeFileSync } = await import('node:fs');
    const foto = async (c, nome) => { const r = await c.cmd('Page.captureScreenshot', { format: 'png' }); writeFileSync(join(process.env.DIGIPASS_FOTO, nome), Buffer.from(r.result.data, 'base64')); };
    await pag2.cmd('Emulation.setDeviceMetricsOverride', { width: 900, height: 600, deviceScaleFactor: 1, mobile: false });
    const rc = await pag2.valuta("(() => { const r = document.querySelector('#u').getBoundingClientRect(); return { x: r.right - 17, y: r.top + r.height / 2 }; })()");
    for (const type of ['mousePressed', 'mouseReleased']) await pag2.cmd('Input.dispatchMouseEvent', { type, x: rc.x, y: rc.y, button: 'left', clickCount: 1 });
    await attesa(800);
    await foto(pag2, 'menu-nel-campo.png');
    const nuova = await apriScheda(`http://127.0.0.1:${PSITO}/login`);
    await nuova.cmd('Emulation.setDeviceMetricsOverride', { width: 900, height: 600, deviceScaleFactor: 1, mobile: false });
    await nuova.valuta("(() => { document.querySelector('#u').value='altro@esempio.ch'; document.querySelector('#p').value='Altra-Password-2!'; document.querySelector('#f').requestSubmit(); })()");
    await attesa(3500);
    await foto(nuova, 'riquadro-salvato.png');
  }

  // 5) blocco: dopo il blocco le pagine non ricevono più niente
  await pop.valuta("chrome.runtime.sendMessage({a:'blocca'})");
  const bloccato = await pag2.valuta("new Promise(r => chrome.runtime.sendMessage({a:'perSito'}, r))", iso2.id);
  ok(bloccato.bloccato, 'a estensione bloccata il sito non riceve login');
} catch (e) {
  ok(false, `errore: ${e.message}`);
}
const falliti = esiti.filter(([v]) => !v).length;
console.log(`\n${esiti.length - falliti}/${esiti.length} prove passate`);
finisci(falliti ? 1 : 0);

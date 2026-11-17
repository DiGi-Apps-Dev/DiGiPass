// Prova dei login in DUE PAGINE (email in una pagina, password nella successiva, come AWS: 13.11.2026).
// Stessa base di prova-chrome.mjs; il sito finto sta su «localhost», perché su 127.0.0.1 l'estensione lo prenderebbe per DiGiPass stesso.   node estensione/prove/prova-due-pagine.mjs
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
// DIGIPASS_SERVER: una copia del server con le sue librerie.
const SERVER = process.env.DIGIPASS_SERVER || resolve(QUI, '..', '..', 'server');
const CHROME = process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const dir = mkdtempSync(join(tmpdir(), 'digipass-estensione-'));
const PS = 18809, PSITO = 18810, PDT = 9343;
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
  '/passo1': '<form id=f action="/passo2" method=get><label>Email address <input id=u name=email type=email></label><button id=b>Next</button></form>',
  '/passo2': '<p>Enter the password for you</p><form id=f action="/fatto" method=post><input id=p name=p type=password><button id=b>Sign in</button></form>',
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
  // sblocco nella finestra dell'estensione, col server di prova
  const pop = await apriScheda(`chrome-extension://${ID}/popup.html?grande=1`);
  await pop.valuta(`chrome.runtime.sendMessage({a:'conf',conf:{url:'http://127.0.0.1:${PS}',utente:'admin'}})`);
  await pop.valuta('location.reload()');
  await attesa(1200);
  await pop.valuta(`(() => { document.querySelector('#pw').value=${JSON.stringify(password)}; document.querySelector('#codice').value=${JSON.stringify(riserva[0])}; document.querySelector('form').requestSubmit(); })()`);
  let righe = 0;
  for (let i = 0; i < 40 && !righe; i++) { await attesa(250); righe = await pop.valuta("document.querySelectorAll('.riga').length"); }
  ok(righe >= 1, 'DiGiPass di prova sbloccato');
  const sitiDi = async () => (await pop.valuta("chrome.runtime.sendMessage({a:'elenco'})")).siti.filter((s) => s.sito.startsWith('localhost'));
  const iso = (c) => c.contesti.find((x) => x.auxData?.type === 'isolated');
  const manda = (c, m) => c.valuta(`new Promise(r => chrome.runtime.sendMessage(${JSON.stringify(m)}, r))`, iso(c).id);
  const schedaCon = async (pezzo) => { for (let i = 0; i < 30; i++) { const t = (await (await fetch(`http://127.0.0.1:${PDT}/json`)).json()).find((x) => x.type === 'page' && x.url.includes(pezzo)); if (t) { const c = await collega(t.webSocketDebuggerUrl); await c.cmd('Runtime.enable'); await attesa(900); return c; } await attesa(250); } throw new Error(`scheda ${pezzo} non trovata`); };

  // A) come prima della correzione: si arriva dritti alla pagina della password, nessun nome utente noto
  const soloPw = await apriScheda(`http://localhost:${PSITO}/passo2`);
  await soloPw.valuta("(() => { document.querySelector('#p').value='Password-AWS-1!'; document.querySelector('#f').requestSubmit(); })()");
  const a2 = await schedaCon('/fatto');
  let prop = await manda(a2, { a: 'inSospeso' });
  ok(prop?.proposta && prop.proposta.utente === '', 'senza prima pagina la proposta resta «senza nome utente» (caso di partenza)');
  await manda(a2, { a: 'conferma', scelta: 'memoria' });
  let siti = await sitiDi();
  ok(siti.length === 1 && siti[0].utente === '' && siti[0].password === 'Password-AWS-1!', 'voce salvata senza nome utente, come quella di AWS dell'utente');
  await a2.cmd('Page.close').catch(() => {});

  // B) la voce senza nome utente NON svuota il campo dell'email quando la si sceglie dalla tendina
  const p1 = await apriScheda(`http://localhost:${PSITO}/passo1`);
  await p1.valuta("(() => { const u = document.querySelector('#u'); u.focus(); u.value='utente@esempio.ch'; u.dispatchEvent(new Event('input',{bubbles:true})); })()");
  const r = await p1.valuta("(() => { const r = document.querySelector('#u').getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; })()");
  const clic = async (x, y) => { for (const type of ['mousePressed', 'mouseReleased']) await p1.cmd('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: 1 }); };
  await clic(r.x + 30, r.y + r.h / 2); // clic nel campo: si apre la tendina
  await attesa(1500);
  await clic(r.x + 60, r.y + r.h + 24); // prima riga della tendina: la voce «senza nome utente»
  await attesa(1000);
  ok(await p1.valuta("document.querySelector('#u').value") === 'utente@esempio.ch', 'scegliendo la voce senza nome utente l\'email scritta resta nel campo');

  // C) due pagine: l'email della prima pagina arriva nella proposta della pagina della password
  await p1.valuta("document.querySelector('#f').requestSubmit()");
  const p2 = await schedaCon('/passo2?email=utente');
  await p2.valuta("(() => { document.querySelector('#p').value='Password-AWS-1!'; document.querySelector('#f').requestSubmit(); })()");
  const p3 = await schedaCon('/fatto');
  prop = await manda(p3, { a: 'inSospeso' });
  ok(prop?.proposta?.utente === 'utente@esempio.ch', `la proposta ha il nome utente della prima pagina (${prop?.proposta ? prop.proposta.utente || 'vuoto' : 'nessuna proposta'})`);
  ok(prop?.proposta?.tipo === 'memoria', 'propone di completare la voce che c\'era, non di farne una seconda');
  await manda(p3, { a: 'conferma', scelta: 'memoria' });
  siti = await sitiDi();
  ok(siti.length === 1 && siti[0].utente === 'utente@esempio.ch' && siti[0].password === 'Password-AWS-1!', `resta una voce sola, ora col nome utente (${siti.length} voci)`);
  await p3.cmd('Page.close').catch(() => {});

  // D) altro utente dello stesso sito, in due pagine: voce nuova col suo nome utente
  const q1 = await apriScheda(`http://localhost:${PSITO}/passo1`);
  await q1.valuta("(() => { document.querySelector('#u').value='altro@esempio.ch'; document.querySelector('#f').requestSubmit(); })()");
  const q2 = await schedaCon('/passo2?email=altro');
  await q2.valuta("(() => { document.querySelector('#p').value='Altra-Password-2!'; document.querySelector('#f').requestSubmit(); })()");
  const q3 = await schedaCon('/fatto');
  prop = await manda(q3, { a: 'inSospeso' });
  ok(prop?.proposta?.utente === 'altro@esempio.ch' && prop.proposta.tipo === 'nuovo', `un secondo utente dello stesso sito diventa una voce nuova col suo nome (${JSON.stringify(prop?.proposta || null)})`);
  await manda(q3, { a: 'conferma', scelta: 'memoria' });
  siti = await sitiDi();
  ok(siti.length === 2 && siti.some((s) => s.utente === 'altro@esempio.ch' && s.password === 'Altra-Password-2!'), `due voci, ognuna col suo nome utente e la sua password (${siti.length} voci)`);
} catch (e) { console.log('ERRORE', e.message); esiti.push([false, e.message]); }
const no = esiti.filter(([c]) => !c).length;
console.log(`\n${esiti.length - no} riuscite, ${no} fallite`);
finisci(no ? 1 : 0);

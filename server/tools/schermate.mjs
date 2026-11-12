// Schermate della webapp per il README: server di PROVA con dati inventati e Chrome senza finestra (profilo temporaneo).
// Uso: node tools/schermate.mjs <cartella-di-uscita>
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { authenticator } from 'otplib';

const SERVER = resolve(fileURLToPath(import.meta.url), '..', '..');
const USCITA = resolve(process.argv[2] || 'schermate');
const CHROME = process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const dir = mkdtempSync(join(tmpdir(), 'digipass-schermate-'));
const PS = 18811, PDT = 9344;
const attesa = (ms) => new Promise((r) => setTimeout(r, ms));
const figli = [];
const finisci = (c) => { for (const f of figli) try { f.kill(); } catch { /* già chiuso */ } setTimeout(() => { try { rmSync(dir, { recursive: true, force: true }); } catch { /* file aperti */ } process.exit(c); }, 1500); };
mkdirSync(USCITA, { recursive: true });

figli.push(spawn(process.execPath, [join(SERVER, 'src', 'server.js')], { env: { ...process.env, PORTA: String(PS), INDIRIZZO: '127.0.0.1', CARTELLA_DATI: join(dir, 'dati'), CARTELLA_BACKUP: join(dir, 'bk'), DIGIPASS_AUTH_KEY: randomBytes(32).toString('base64url') }, stdio: 'ignore' }));
for (let i = 0; i < 150; i++) { try { if ((await fetch(`http://127.0.0.1:${PS}/stato`)).ok) break; } catch { /* parte */ } await attesa(300); }
const cred = join(dir, 'cred.json');
await new Promise((r, j) => spawn(process.execPath, [join(SERVER, 'tools', 'dati-di-prova.mjs'), `http://127.0.0.1:${PS}`, cred], { stdio: 'inherit', cwd: SERVER }).on('exit', (c) => (c ? j(new Error('dati di prova')) : r())));
const { password, segreto, riserva } = JSON.parse(readFileSync(cred, 'utf8'));

figli.push(spawn(CHROME, ['--headless=new', `--remote-debugging-port=${PDT}`, `--user-data-dir=${join(dir, 'profilo')}`, '--no-first-run', '--hide-scrollbars', '--window-size=1360,860', 'about:blank'], { stdio: 'ignore' }));
let pagine;
for (let i = 0; i < 80 && !pagine; i++) { try { pagine = await (await fetch(`http://127.0.0.1:${PDT}/json`)).json(); } catch { await attesa(250); } }
const ws = new WebSocket(pagine.find((p) => p.type === 'page').webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener('open', r, { once: true }));
let n = 0; const attese = new Map();
ws.addEventListener('message', (e) => { const m = JSON.parse(e.data); if (m.id && attese.has(m.id)) { attese.get(m.id)(m); attese.delete(m.id); } });
const cdp = (method, params = {}) => new Promise((r) => { const id = ++n; attese.set(id, r); ws.send(JSON.stringify({ id, method, params })); });
const valuta = async (expr) => (await cdp('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true })).result?.result?.value;
const foto = async (nome) => { const r = await cdp('Page.captureScreenshot', { format: 'png' }); writeFileSync(join(USCITA, nome), Buffer.from(r.result.data, 'base64')); console.log('schermata', nome); };
const scrivi = (id, v) => valuta(`(() => { const e = document.getElementById(${JSON.stringify(id)}); e.value = ${JSON.stringify(v)}; e.dispatchEvent(new Event('input', { bubbles: true })); })()`);
const finche = async (expr, t = 20000) => { for (let i = 0; i < t / 250; i++) { if (await valuta(expr)) return true; await attesa(250); } return false; };

await cdp('Page.enable');
await cdp('Emulation.setDeviceMetricsOverride', { width: 1360, height: 860, deviceScaleFactor: 2, mobile: false });
await cdp('Page.navigate', { url: `http://127.0.0.1:${PS}/` });
if (!await finche(`!!document.getElementById('password')`)) { console.log('pagina di accesso non comparsa'); finisci(1); }
await attesa(600);
await foto('accesso.png');
await scrivi('password', password);
await scrivi('codice', riserva[0]); // il codice a tempo è appena stato usato dalla configurazione
await valuta(`document.querySelector('form.scheda button[type=submit]').click()`);
if (!await finche(`document.querySelectorAll('.riga.voce').length > 0`, 40000)) { console.log('cassaforte non aperta:', await valuta(`document.querySelector('.errore')?.textContent`)); finisci(1); }
await attesa(1500);
await valuta(`[...document.querySelectorAll('.riga.voce')].find((b) => b.textContent.includes('Email lavoro'))?.click()`);
await attesa(4500); // l'avviso «codice di riserva» sparisce dopo 3,5 secondi
await foto('cassaforte.png');
for (const [testo, nome] of [['Memoria siti', 'memoria-siti.png'], ['Sicurezza', 'sicurezza.png'], ['Impostazioni', 'impostazioni.png']]) {
  await valuta(`[...document.querySelectorAll('.voceMenu')].find((b) => b.textContent.trim() === ${JSON.stringify(testo)})?.click()`);
  await attesa(1800);
  await foto(nome);
}
finisci(0);

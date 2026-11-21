// Webapp di DiGiPass. La cassaforte si apre qui nel browser: il server riceve e restituisce solo dati cifrati.
import * as C from './cripto.js';
import { importaProton, importaCsvChrome, csvDaEsportare, dominio as dominioVecchio, nomeSito, leggiCsvGenerico, csvInCassaforte, csvInMemoria } from './importa.js';

const $ = (s, el = document) => el.querySelector(s);
const vista = $('#vista');
const S = { csrf: '', utente: '', dek: null, kek: null, chiavi: null, voci: new Map(), siti: new Map(), rev: 0, sezione: 'cassaforte', sel: null, filtro: '', tipo: '', cerca: '', cartella: '' };
const TIPI = {
  login: { nome: 'Login', campi: [['email', 'Email', 0], ['utente', 'Nome utente o email', 0], ['password', 'Password', 1]] },
  nota: { nome: 'Nota', campi: [] },
  carta: { nome: 'Carta', campi: [['titolare', 'Titolare', 0], ['numero', 'Numero', 1], ['scadenza', 'Scadenza (MM/AA)', 0], ['cvv', 'CVV', 1], ['pin', 'PIN', 1]] },
  identita: { nome: 'Identità', sezioni: { nome: 'Dati personali', indirizzo: 'Indirizzo', telefono2: 'Contatti', azienda: 'Lavoro' }, campi: [
    ['nome', 'Nome', 0], ['secondoNome', 'Secondo nome', 0], ['cognome', 'Cognome', 0], ['nomeCompleto', 'Nome completo', 0], ['nascita', 'Data di nascita', 0], ['sesso', 'Sesso', 0], ['email', 'Email', 0], ['telefono', 'Telefono', 0],
    ['indirizzo', 'Via e numero', 0], ['piano', 'Piano', 0], ['cap', 'CAP', 0], ['citta', 'Città', 0], ['provincia', 'Provincia o stato', 0], ['contea', 'Contea', 0], ['paese', 'Paese', 0], ['organizzazione', 'Organizzazione', 0],
    ['telefono2', 'Secondo telefono', 0], ['sito', 'Sito', 0], ['patente', 'N° patente', 0], ['documento', 'Documento (n° passaporto o carta d\'identità)', 1], ['previdenza', 'N° previdenza sociale (AVS)', 1],
    ['linkedin', 'LinkedIn', 0], ['x', 'X', 0], ['facebook', 'Facebook', 0], ['instagram', 'Instagram', 0], ['reddit', 'Reddit', 0], ['yahoo', 'Yahoo', 0],
    ['azienda', 'Azienda', 0], ['ruolo', 'Ruolo', 0], ['emailLavoro', 'Email di lavoro', 0], ['telefonoLavoro', 'Telefono di lavoro', 0], ['sitoPersonale', 'Sito personale', 0]] },
  wifi: { nome: 'Wi-Fi', campi: [['ssid', 'Nome rete', 0], ['password', 'Password', 1], ['sicurezza', 'Sicurezza (WPA, WEP…)', 0]] },
};
const ICONE = {
  cassaforte: '<rect x="4" y="10" width="16" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/>',
  memoria: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/>',
  sicurezza: '<path d="M12 3 4 6v6c0 5 3.5 8 8 9 4.5-1 8-4 8-9V6z"/>',
  cestino: '<path d="M4 7h16l-1.5 13h-13zM9 7V4h6v3"/>',
  impostazioni: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M5 19l2-2M17 7l2-2"/>',
  copia: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3"/>',
  occhio: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
};

// ---------- piccoli aiuti ----------
function el(tag, attr = {}, ...figli) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attr)) {
    if (v === undefined || v === null || v === false) continue;
    if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else if (k === 'html') e.innerHTML = v; // solo per le icone, mai per i dati
    else if (k === 'style') e.style.cssText = v; // via CSSOM: la CSP blocca gli attributi style scritti nella pagina
    else e.setAttribute(k, v === true ? '' : v);
  }
  for (const f of figli.flat(4)) if (f !== null && f !== undefined && f !== false) e.append(f instanceof Node ? f : document.createTextNode(String(f)));
  return e;
}
// append non appiattisce gli elenchi: questo si'.
const aggiungi = (dove, ...figli) => dove.append(...figli.flat(4).filter((x) => x !== null && x !== undefined && x !== false));
const icona = (n) => el('span', { html: `<svg viewBox="0 0 24 24">${ICONE[n]}</svg>`, style: 'display:inline-flex' });
let timerAvviso;
function avviso(t) { const a = $('#avviso'); a.textContent = t; a.hidden = false; clearTimeout(timerAvviso); timerAvviso = setTimeout(() => { a.hidden = true; }, 3500); }
const COLORI = ['#2B6FD6', '#C7A008', '#1F8F5A', '#8A2BA8', '#D2453A', '#2E9E8F', '#E07A30', '#7A4FD0', '#C2417A'];
// Dominio di un sito salvato per il logo («https://www.norton.com/x» → «norton.com»); le app android:// no.
function dominio(s) {
  const t = String(s || '').trim().toLowerCase();
  if (!t || t.startsWith('android://')) return null;
  try { const u = new URL(/^[a-z][a-z0-9+.-]*:/.test(t) ? t : `https://${t}`); const d = u.hostname.replace(/^www\./, ''); return ['http:', 'https:'].includes(u.protocol) && d.includes('.') && !/^[\d.]+$/.test(d) && !d.includes(':') ? d : null; } catch { return null; }
}
const preferenza = (k, base) => { try { const x = localStorage.getItem(`digipass-${k}`); return x === null ? base : x === '1'; } catch { return base; } };
const imposta = (k, si) => { try { localStorage.setItem(`digipass-${k}`, si ? '1' : '0'); } catch { /* resta per questa volta */ } };
/** Tipo della carta dal numero (CHECKLIST 1.3), solo da mostrare. */
function tipoCarta(numero) {
  const n = String(numero || '').replace(/\D/g, ''); if (!n) return '';
  const p2 = +n.slice(0, 2), p3 = +n.slice(0, 3), p4 = +n.slice(0, 4);
  if (n[0] === '4') return 'Visa';
  if ((p2 >= 51 && p2 <= 55) || (p4 >= 2221 && p4 <= 2720)) return 'Mastercard';
  if (p2 === 34 || p2 === 37) return 'American Express';
  if (p4 === 6011 || p2 === 65 || (p3 >= 644 && p3 <= 649)) return 'Discover';
  if (p4 >= 3528 && p4 <= 3589) return 'JCB';
  if (p2 === 36 || p2 === 38 || (p3 >= 300 && p3 <= 305)) return 'Diners Club';
  if (p2 === 62) return 'UnionPay';
  if (p2 === 50 || (p2 >= 56 && p2 <= 69)) return 'Maestro';
  return '';
}
const senzaLogo = new Set();
// Iniziale colorata; se il sito ha un logo (preso dal NAS, mai da servizi esterni) compare sopra appena caricato.
function avatar(nome, lato = 38, sito = null) {
  let h = 0; for (const c of nome) h = (h * 31 + c.charCodeAt(0)) & 0x7fffffff;
  const av = el('span', { class: 'av', style: `background:${COLORI[h % COLORI.length]};width:${lato}px;height:${lato}px;font-size:${Math.round(lato * .42)}px` }, (nome[0] || '?').toUpperCase());
  const d = preferenza('icone', true) ? dominio(sito) : null;
  if (d && !senzaLogo.has(d)) {
    const img = el('img', { class: 'logosito', alt: '', src: `/api/icona/${encodeURIComponent(d)}` });
    img.hidden = true;
    img.onload = () => { img.hidden = false; };
    img.onerror = () => { senzaLogo.add(d); img.remove(); };
    av.append(img);
  }
  return av;
}
const nuovoId = () => C.b64url(C.casuali(12));
async function api(metodo, url, corpo, opzioni = {}) {
  const r = await fetch(url, {
    method: metodo, credentials: 'same-origin',
    headers: { ...(corpo !== undefined && !(corpo instanceof Blob) ? { 'Content-Type': 'application/json' } : {}), ...(S.csrf ? { 'X-CSRF-Token': S.csrf } : {}), ...(opzioni.headers || {}) },
    body: corpo === undefined ? undefined : corpo instanceof Blob ? corpo : JSON.stringify(corpo),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(j.error || `Errore ${r.status}`), { status: r.status, dati: j });
  return j;
}
function copia(testo, segreto = true) {
  navigator.clipboard.writeText(testo).then(() => {
    avviso(segreto ? 'Copiato: gli appunti si svuotano fra 60 secondi' : 'Copiato');
    if (segreto) setTimeout(() => { navigator.clipboard.readText?.().then((t) => { if (t === testo) navigator.clipboard.writeText(''); }).catch(() => navigator.clipboard.writeText('').catch(() => {})); }, 60000);
  }).catch(() => avviso('Copia non riuscita'));
}

// ---------- 2FA (RFC 6238) ----------
function base32(s) {
  const a = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = 0, val = 0; const out = [];
  for (const c of String(s).toUpperCase().replace(/[\s=-]/g, '')) {
    const i = a.indexOf(c); if (i < 0) throw new Error('segreto non valido');
    val = (val << 5) | i; bits += 5;
    if (bits >= 8) { out.push((val >>> (bits - 8)) & 255); bits -= 8; }
  }
  return new Uint8Array(out);
}
function leggiTotp(t) {
  t = String(t || '').trim(); if (!t) return null;
  try {
    if (/^otpauth:\/\//i.test(t)) {
      const u = new URL(t); const p = u.searchParams;
      return { segreto: base32(p.get('secret')), cifre: Number(p.get('digits')) || 6, periodo: Number(p.get('period')) || 30, alg: (p.get('algorithm') || 'SHA1').toUpperCase() };
    }
    const s = base32(t); return s.length ? { segreto: s, cifre: 6, periodo: 30, alg: 'SHA1' } : null;
  } catch { return null; }
}
async function codiceTotp(o) {
  const passo = Math.floor(Date.now() / 1000 / o.periodo);
  const msg = new Uint8Array(8); new DataView(msg.buffer).setUint32(4, passo);
  new DataView(msg.buffer).setUint32(0, Math.floor(passo / 2 ** 32));
  const k = await crypto.subtle.importKey('raw', o.segreto, { name: 'HMAC', hash: { SHA256: 'SHA-256', SHA512: 'SHA-512' }[o.alg] || 'SHA-1' }, false, ['sign']);
  const d = new Uint8Array(await crypto.subtle.sign('HMAC', k, msg));
  const off = d[d.length - 1] & 15;
  const n = ((d[off] & 127) << 24) | (d[off + 1] << 16) | (d[off + 2] << 8) | d[off + 3];
  return String(n % 10 ** o.cifre).padStart(o.cifre, '0');
}

// ---------- generatore ----------
const MIN = 'abcdefghijkmnopqrstuvwxyz', MAI = 'ABCDEFGHJKLMNPQRSTUVWXYZ', NUM = '23456789', SIM = '!@#$%&*+-=?_.:';
const PAROLE = 'albero amico anello angolo arancia argento aria barca bosco bottone brodo burro cactus caffe calma camino campo candela cane canto capra carta casa castello cavallo cena cielo ciliegia cipolla colle colore coniglio corda corsa cuore cuscino delfino dente disco divano domani drago erba estate falco farina faro festa fiamma fiore fiume foglia fontana forno fragola freccia fulmine fumo gatto gelato giardino giraffa gomma grano grotta guanto isola lago lampada lana legno leone limone luna lupo mare matita mela melone miele monte muro nave neve nido noce nuvola oca olivo ombra onda orso orto pane panda pepe pera pesca piano pietra pigna pino pioggia piuma ponte porta prato quadro radice ragno rana ramo riccio riso roccia rosa ruota sabbia sale salmone sasso scala scoglio seme sedia sentiero sole sorriso spiga stella strada tamburo tavolo tenda terra tetto tigre topo torre treno trota tulipano uccello uva vaso vela vento verde vetro vigna viola volpe zaino zucca'.split(' ');
const rnd = (n) => { const lim = 2 ** 32 - (2 ** 32 % n); let x; do { x = C.casuali(4); x = new DataView(x.buffer).getUint32(0); } while (x >= lim); return x % n; };
function genCasuale(l = 20, mai = true, num = true, sim = true) {
  const g = [MIN, mai && MAI, num && NUM, sim && SIM].filter(Boolean), tutti = g.join('');
  for (;;) { const p = Array.from({ length: l }, () => tutti[rnd(tutti.length)]).join(''); if (g.every((x) => [...p].some((c) => x.includes(c)))) return p; }
}
function genParole(n = 4, sep = '-', num = true, maiuscola = true) {
  const p = Array.from({ length: n }, () => { const w = PAROLE[rnd(PAROLE.length)]; return maiuscola ? w[0].toUpperCase() + w.slice(1) : w; });
  if (num) { const i = rnd(n); p[i] += rnd(10); }
  if (sep !== 'numeri' && sep !== 'numerisimboli') return p.join(sep);
  const scelta = sep === 'numeri' ? NUM : NUM + SIM;
  return p.reduce((a, w) => a + scelta[rnd(scelta.length)] + w);
}
function forza(p) {
  if (!p) return [0, 'Vuota'];
  let a = 0; if (/[a-z]/.test(p)) a += 26; if (/[A-Z]/.test(p)) a += 26; if (/\d/.test(p)) a += 10; if (/[^a-zA-Z0-9]/.test(p)) a += 20;
  const bit = Math.round(Math.min(p.length, new Set(p).size * 2) * Math.log2(Math.max(a, 2)));
  return [bit, bit < 40 ? 'Debole' : bit < 60 ? 'Media' : bit < 80 ? 'Forte' : 'Molto forte'];
}
function apriGeneratore(usa) {
  let parole = false, l = 20, mai = true, num = true, sim = true, n = 4, sep = '-', p = '', iniziale = true;
  const velo = el('div', { class: 'velo', onclick: (e) => { if (e.target === velo) velo.remove(); } });
  const disegna = () => {
    p = parole ? genParole(n, sep, num, iniziale) : genCasuale(l, mai, num, sim);
    const chip = (t, on, f) => el('button', { class: `chip${on ? ' on' : ''}`, onclick: () => { f(); disegna(); } }, t);
    velo.replaceChildren(el('div', { class: 'finestra' },
      el('div', { class: 'etichetta' }, 'Genera una password'),
      el('div', { class: 'chips' }, chip('Casuale', !parole, () => { parole = false; }), chip('Di parole', parole, () => { parole = true; })),
      el('div', { class: 'gen' }, p), el('div', {}, el('b', {}, `Forza: ${forza(p)[1]}`)),
      parole
        ? [el('label', { class: 'campo' }, el('b', {}, `Parole: ${n}`), el('input', { type: 'range', min: 3, max: 8, value: n, oninput: (e) => { n = +e.target.value; disegna(); } })),
          el('div', { class: 'chips' }, ...[['-', 'Trattino'], [' ', 'Spazio'], ['.', 'Punto'], ['_', 'Trattino basso'], [',', 'Virgola'], ['numeri', 'Numeri'], ['numerisimboli', 'Numeri e simboli']].map(([s, t]) => chip(t, sep === s, () => { sep = s; })),
            chip('Iniziale maiuscola', iniziale, () => { iniziale = !iniziale; }), chip('Con un numero', num, () => { num = !num; }))]
        : [el('label', { class: 'campo' }, el('b', {}, `Lunghezza: ${l}`), el('input', { type: 'range', min: 8, max: 64, value: l, oninput: (e) => { l = +e.target.value; disegna(); } })),
          el('div', { class: 'chips' }, chip('Maiuscole', mai, () => { mai = !mai; }), chip('Numeri', num, () => { num = !num; }), chip('Simboli', sim, () => { sim = !sim; }))],
      el('div', { class: 'azioni' }, el('button', { class: 'btn2', onclick: disegna }, 'Un\'altra'),
        usa ? el('button', { class: 'btn', onclick: () => { usa(p); velo.remove(); } }, 'Usa questa') : el('button', { class: 'btn', onclick: () => copia(p) }, 'Copia'),
        el('button', { class: 'btn2', onclick: () => velo.remove() }, 'Chiudi'))));
  };
  disegna(); document.body.append(velo);
}

// ---------- accesso ----------
async function avvio() {
  let stato;
  try { stato = await api('GET', '/api/auth/status'); } catch { vista.replaceChildren(el('div', { class: 'vuoto' }, 'Il server di DiGiPass non risponde.')); return; }
  if (!stato.initialized) {
    vista.replaceChildren(el('div', { class: 'accesso' }, el('div', { class: 'scheda' }, el('h1', {}, 'DiGiPass non è ancora collegato'),
      el('p', {}, 'La cassaforte si collega al NAS dall\'app del telefono: Impostazioni › Collega al NAS. Poi da qui entri con la stessa password principale.'))));
    return;
  }
  try { const me = await api('GET', '/api/auth/me'); S.csrf = me.csrf; S.utente = me.username; return schermataSblocco(); } catch { /* nessuna sessione */ }
  schermataAccesso(stato);
}

function schermataAccesso(stato, messaggio = '') {
  const err = el('p', { class: 'errore' }, messaggio);
  const u = el('input', { id: 'utente', autocomplete: 'username', value: localStorage.getItem('digipass-utente') || 'admin' });
  const pw = el('input', { id: 'password', type: 'password', autocomplete: 'current-password' });
  const cod = el('input', { id: 'codice', inputmode: 'text', autocomplete: 'one-time-code', maxlength: 9 });
  const ric = el('input', { type: 'checkbox', id: 'ricorda', checked: true });
  const vai = el('button', { class: 'btn', type: 'submit' }, 'Entra');
  const form = el('form', { class: 'scheda', onsubmit: async (e) => {
    e.preventDefault(); err.textContent = ''; vai.disabled = true; vai.textContent = 'Apro la cassaforte…';
    try {
      const pre = await api('POST', '/api/auth/prelogin', { username: u.value.trim() });
      const kek = await C.chiaveDaPassword(pw.value, C.deB64(pre.salePw), pre.kdf);
      const r = await api('POST', '/api/auth/login', { username: u.value.trim(), password: await C.chiaveAccesso(kek, C.deB64(pre.salePw)), code: cod.value.trim(), remember: ric.checked });
      S.csrf = r.csrf; S.utente = u.value.trim();
      try { localStorage.setItem('digipass-utente', S.utente); } catch { /* non indispensabile */ }
      await apri(kek);
      if (r.riserveRimaste !== undefined) avviso(`Hai usato un codice di riserva: ne restano ${r.riserveRimaste}`);
    } catch (x) { err.textContent = x.message; vai.disabled = false; vai.textContent = 'Entra'; }
  } },
    // Stessa forma della pagina di accesso di DiGiShare: logo grande, titolo e link centrati.
    el('img', { class: 'logo-grande', src: '/risorse/logo.svg', alt: 'DiGiPass', width: 104, height: 104 }),
    el('h1', {}, 'Entra'),
    el('p', { class: 'spiegazione' }, stato?.serveCodice === false ? 'Questo dispositivo è ricordato: basta la password principale.' : 'Serve anche il codice di Google Authenticator.'),
    el('label', { class: 'campo' }, el('span', { class: 'piccola' }, 'Nome utente'), u),
    el('label', { class: 'campo' }, el('span', { class: 'piccola' }, 'Password principale'), pw),
    stato?.serveCodice === false ? null : el('label', { class: 'campo' }, el('span', { class: 'piccola' }, 'Codice Authenticator'), cod),
    stato?.serveCodice === false ? null : el('label', { class: 'spunta' }, ric, 'Ricorda questo dispositivo per 90 giorni'),
    vai, err,
    el('button', { class: 'link', type: 'button', onclick: () => schermataRecupero() }, 'Password dimenticata'),
    el('button', { class: 'link', type: 'button', onclick: () => {
      cod.placeholder = 'Codice di riserva, es. ABCD-EFGH'; cod.value = ''; cod.focus();
      avviso('Scrivi uno dei 10 codici di riserva del foglio di emergenza al posto del codice di Authenticator. Dopo, in Impostazioni › Telefono nuovo, colleghi Authenticator al telefono nuovo.');
    } }, 'Ho perso il telefono'));
  vista.replaceChildren(el('div', { class: 'accesso' }, form));
  (u.value ? pw : u).focus();
}

function schermataSblocco() {
  const err = el('p', { class: 'errore' });
  // Nome utente come nella pagina Entra, già compilato e modificabile.
  const u = el('input', { id: 'utente', autocomplete: 'username', value: S.utente || 'admin' });
  const pw = el('input', { id: 'password', type: 'password', autocomplete: 'current-password' });
  const vai = el('button', { class: 'btn', type: 'submit' }, 'Sblocca');
  vista.replaceChildren(el('div', { class: 'accesso' }, el('form', { class: 'scheda', onsubmit: async (e) => {
    e.preventDefault(); err.textContent = ''; vai.disabled = true;
    try {
      const nome = u.value.trim() || 'admin';
      const pre = await api('POST', '/api/auth/prelogin', { username: nome });
      const kek = await C.chiaveDaPassword(pw.value, C.deB64(pre.salePw), pre.kdf);
      await apri(kek);
      S.utente = nome;
    } catch (x) { err.textContent = x.message; vai.disabled = false; }
  } },
  el('img', { class: 'logo-grande', src: '/risorse/logo.svg', alt: 'DiGiPass', width: 104, height: 104 }),
  el('h1', {}, 'Cassaforte bloccata'),
  el('p', { class: 'spiegazione' }, 'Scrivi la password principale per aprirla.'),
  el('label', { class: 'campo' }, el('span', { class: 'piccola' }, 'Nome utente'), u),
  el('label', { class: 'campo' }, el('span', { class: 'piccola' }, 'Password principale'), pw), vai, err,
  el('button', { class: 'link', type: 'button', onclick: () => schermataRecupero() }, 'Password dimenticata'),
  el('button', { class: 'link', type: 'button', onclick: () => avviso('Su questo browser entri con la sola password. Dopo lo sblocco vai in Impostazioni › Telefono nuovo per collegare Google Authenticator al telefono nuovo (ti serve un codice di riserva del foglio di emergenza).') }, 'Ho perso il telefono'))));
  pw.focus();
}

function schermataRecupero() {
  const err = el('p', { class: 'errore' });
  const u = el('input', { autocomplete: 'username', value: localStorage.getItem('digipass-utente') || 'admin' });
  const rec = el('input', { placeholder: 'XXXX-XXXX-…', autocomplete: 'off' });
  const cod = el('input', { placeholder: '6 cifre o codice di riserva', autocomplete: 'one-time-code' });
  const p1 = el('input', { type: 'password', autocomplete: 'new-password' }), p2 = el('input', { type: 'password', autocomplete: 'new-password' });
  const vai = el('button', { class: 'btn', type: 'submit' }, 'Cambia la password');
  vista.replaceChildren(el('div', { class: 'accesso' }, el('form', { class: 'scheda', onsubmit: async (e) => {
    e.preventDefault(); err.textContent = '';
    if (p1.value.length < 10) { err.textContent = 'La password nuova deve avere almeno 10 caratteri.'; return; }
    if (p1.value !== p2.value) { err.textContent = 'Le due password non sono uguali.'; return; }
    vai.disabled = true; vai.textContent = 'Lavoro…';
    try {
      // La chiave dei dati cifrata con la chiave di recupero arriva gia' prima dell'accesso: si apre qui nel browser,
      // si cifra di nuovo con la password nuova e con una chiave di recupero nuova, e al server va tutto insieme.
      const pre = await api('POST', '/api/auth/prelogin', { username: u.value.trim() });
      const recKey = await C.chiaveDaRecupero(rec.value, C.deB64(pre.saleRec));
      let dek;
      try { dek = await C.decifra(recKey, C.deB64(pre.dekRec)); } catch { throw new Error('Nome utente o chiave di recupero sbagliati.'); }
      const nuovaRec = C.nuovaRecupero();
      const nuove = await C.avvolgi(dek, p1.value, nuovaRec, pre.kdf);
      const r = await api('POST', '/api/auth/recupero', { username: u.value.trim(), accessoRecupero: await C.accessoRecupero(recKey, C.deB64(pre.saleRec)), code: cod.value.trim(), newPassword: nuove.accesso, nuovoAccessoRecupero: nuove.accessoRec, chiavi: nuove.chiavi });
      S.csrf = r.csrf; S.utente = u.value.trim();
      mostraFoglio(nuovaRec, null, async () => { const kek = await C.chiaveDaPassword(p1.value, C.deB64(nuove.chiavi.salePw), nuove.chiavi.kdf); await apri(kek); });
    } catch (x) { err.textContent = x.message; vai.disabled = false; vai.textContent = 'Cambia la password'; }
  } },
  el('h1', {}, 'Password dimenticata'),
  el('p', {}, 'Ti servono la chiave di recupero del foglio di emergenza e il codice di Authenticator (o un codice di riserva).'),
  el('label', { class: 'campo' }, el('span', { class: 'piccola' }, 'Nome utente'), u),
  el('label', { class: 'campo' }, el('span', { class: 'piccola' }, 'Chiave di recupero'), rec),
  el('label', { class: 'campo' }, el('span', { class: 'piccola' }, 'Codice'), cod),
  el('label', { class: 'campo' }, el('span', { class: 'piccola' }, 'Nuova password principale'), p1),
  el('label', { class: 'campo' }, el('span', { class: 'piccola' }, 'Ripeti la password'), p2),
  vai, err, el('button', { class: 'link', type: 'button', onclick: () => schermataAccesso({}) }, 'Torna all\'accesso'))));
}

async function apri(kek) {
  const ch = await api('GET', '/api/chiavi');
  let dek;
  try { dek = await C.decifra(kek, C.deB64(ch.dekPw)); } catch { throw new Error('Password principale sbagliata.'); }
  S.kek = kek; S.dek = dek; S.chiavi = ch;
  await sincronizza(true);
  comandiBarra(true);
  disegnaApp();
}
// Comandi della barra (come DiGiShare): visibili solo a cassaforte aperta.
function comandiBarra(si) { for (const id of ['blocca', 'esciBarra', 'cercaBarra']) $(`#${id}`).hidden = !si; if (!si) { $('#cerca').value = ''; S.cerca = ''; $('#cercaX').hidden = true; } }
function blocca() { S.dek = null; S.kek = null; S.voci.clear(); S.siti.clear(); S.rev = 0; comandiBarra(false); schermataSblocco(); }
async function esci() { try { await api('POST', '/api/auth/logout'); } catch { /* gia' uscito */ } S.csrf = ''; blocca(); location.reload(); }
$('#blocca').addEventListener('click', blocca);
$('#esciBarra').addEventListener('click', esci);
// Cerca nella barra: scrivendo si aggiorna solo l'elenco, il campo non si ridisegna (cursore e focus restano).
// La X del campo (type=search) svuota e rimette l'elenco completo.
// X sempre visibile quando c'è del testo: svuota e rimette l'elenco completo.
$('#cercaX').addEventListener('click', () => { const c = $('#cerca'); c.value = ''; c.dispatchEvent(new Event('input')); c.focus(); });
$('#cerca').addEventListener('input', (e) => {
  S.cerca = e.target.value;
  $('#cercaX').hidden = !S.cerca;
  if (!['cassaforte', 'memoria'].includes(S.sezione)) { S.sezione = 'cassaforte'; S.sel = null; disegnaApp(); return; }
  if (S.aggiornaElenco) S.aggiornaElenco(); else disegnaApp();
});
// Blocco automatico: 5 minuti senza usare la pagina.
let ultimoUso = Date.now();
for (const ev of ['click', 'keydown', 'pointermove']) addEventListener(ev, () => { ultimoUso = Date.now(); }, { passive: true });
setInterval(() => { if (S.dek && Date.now() - ultimoUso > 5 * 60000) { blocca(); avviso('Cassaforte bloccata dopo 5 minuti'); } }, 15000);

// ---------- sincronizzazione ----------
async function sincronizza(tutto = false) {
  if (tutto) { S.voci.clear(); S.siti.clear(); S.rev = 0; }
  for (;;) {
    const r = await api('GET', `/api/sync?da=${S.rev}`);
    for (const v of r.voci) {
      const mappa = v.tipo === 'voce' ? S.voci : S.siti;
      if (v.cancellata) { mappa.delete(v.id); continue; }
      try { mappa.set(v.id, { versione: v.versione, dati: await C.decifraVoce(S.dek, v.id, v.blob) }); } catch { console.warn('Voce non leggibile', v.id); }
    }
    S.rev = Math.max(S.rev, r.rev);
    if (r.completo) break;
  }
}
async function salva(tipo, dati, cancellata = false) {
  const mappa = tipo === 'voce' ? S.voci : S.siti;
  dati.modificata = Date.now(); dati.creata ??= dati.modificata;
  const base = mappa.get(dati.id)?.versione ?? 0;
  try {
    const r = await api('PUT', `/api/sync/${dati.id}`, { tipo, base, cancellata, blob: cancellata ? '' : await C.cifraVoce(S.dek, dati.id, dati) });
    if (cancellata) mappa.delete(dati.id); else mappa.set(dati.id, { versione: r.versione, dati });
  } catch (x) {
    if (x.status !== 409) throw x;
    // Cambiata da un altro dispositivo: vince la modifica più recente.
    const a = x.dati.attuale;
    const loro = a.cancellata ? null : await C.decifraVoce(S.dek, a.id, a.blob);
    if (loro && (loro.modificata || 0) > dati.modificata) { mappa.set(a.id, { versione: a.versione, dati: loro }); avviso('Questa voce era stata cambiata altrove: tengo la versione più recente'); return; }
    mappa.set(dati.id, { versione: a.versione, dati: loro || dati });
    return salva(tipo, dati, cancellata);
  }
}

// ---------- app ----------
const MENU = [['cassaforte', 'Cassaforte'], ['memoria', 'Memoria siti'], ['sicurezza', 'Sicurezza'], ['cestino', 'Cestino'], ['impostazioni', 'Impostazioni']];
function disegnaApp() {
  const lato = el('nav', { class: 'lato' }, MENU.map(([k, t]) => el('button', { class: `voceMenu${S.sezione === k ? ' on' : ''}`, onclick: () => { S.sezione = k; S.sel = null; disegnaApp(); } }, icona(k), t)));
  const lista = el('section', { class: 'lista' }), dett = el('section', { class: 'dett' });
  const app = el('div', { class: `app sez-${S.sezione}${S.sel ? ' conDettaglio' : ''}` }, lato, lista, dett);
  // Il ridisegno crea un elenco nuovo: si rimette dov'era, così cliccando una voce in basso l'elenco resta fermo.
  const prima = $('.lista'), stessa = disegnaApp.sezione === S.sezione;
  const scorri = stessa && prima ? prima.scrollTop : 0, scorriLato = $('.lato')?.scrollLeft || 0;
  const scorriDett = stessa ? $('.dett')?.scrollTop || 0 : 0, scorriPagina = stessa ? window.scrollY : 0;
  disegnaApp.sezione = S.sezione;
  S.aggiornaElenco = null;
  $('#cerca').placeholder = 'Cerca…';
  vista.replaceChildren(app);
  ({ cassaforte: listaCassaforte, memoria: listaMemoria, sicurezza: listaSicurezza, cestino: listaCestino, impostazioni: impostazioni })[S.sezione](lista, dett);
  lista.scrollTop = scorri; lato.scrollLeft = scorriLato;
  if (S.sezione === 'sicurezza') { dett.scrollTop = scorriDett; window.scrollTo(0, scorriPagina); }
}
const voci = () => [...S.voci.values()].map((v) => v.dati);
function sotto(v) {
  const c = v.campi || {};
  if (v.tipo === 'login') return [c.utente || c.email, v.totp ? '2FA' : ''].filter(Boolean).join(' · ') || 'Login';
  if (v.tipo === 'carta') { const n = String(c.numero || '').replace(/\s/g, ''); return n.length >= 4 ? `Carta ·· ${n.slice(-4)}` : 'Carta'; }
  if (v.tipo === 'wifi') return `Rete Wi-Fi ${c.ssid || ''}`;
  if (v.tipo === 'identita') return 'Identità';
  return String(v.note || '').split('\n')[0] || 'Nota';
}
function rigaVoce(v, onclick, coda) {
  return el('button', { class: `riga voce${S.sel === v.id ? ' sel' : ''}`, onclick }, avatar(v.titolo || '?', 38, (v.siti || [])[0]), el('span', { class: 't' }, el('b', {}, v.titolo || '(senza titolo)'), el('span', {}, sotto(v))), coda || null, v.fissata ? el('span', { class: 'pin' }) : null);
}
// Ordinamento (CHECKLIST 2.6): più recenti (ultima modifica), dal più nuovo e dal più vecchio (creazione), titolo A-Z e Z-A;
// la scelta resta ricordata in questo browser.
const ORDINI = [['recenti', 'Più recenti'], ['nuovi', 'Dal più nuovo'], ['vecchi', 'Dal più vecchio'], ['az', 'Titolo A-Z'], ['za', 'Titolo Z-A']];
function ordine() { try { return localStorage.getItem('digipass-ordine') || 'az'; } catch { return 'az'; } }
function ordina(arr, nome) {
  const o = ordine(), data = (x) => x.modificata || x.creata || 0, nascita = (x) => x.creata || x.modificata || 0, alfa = (a, b) => String(nome(a) || '').localeCompare(String(nome(b) || ''), 'it');
  return arr.sort(o === 'za' ? (a, b) => alfa(b, a) : o === 'recenti' ? (a, b) => data(b) - data(a) || alfa(a, b)
    : o === 'nuovi' ? (a, b) => nascita(b) - nascita(a) || alfa(a, b) : o === 'vecchi' ? (a, b) => nascita(a) - nascita(b) || alfa(a, b) : alfa);
}
function sceltaOrdine(aggiorna) {
  return el('select', { class: 'ordina', 'aria-label': 'Ordina', onchange: (e) => { try { localStorage.setItem('digipass-ordine', e.target.value); } catch { /* resta per questa volta */ } aggiorna(); } },
    ORDINI.map(([k, t]) => el('option', { value: k, selected: ordine() === k }, `Ordina: ${t}`)));
}
function listaCassaforte(lista, dett) {
  const tutte = voci().filter((v) => !v.cestino);
  const conta = (t) => tutte.filter((v) => v.tipo === t).length;
  S.aggiornaElenco = () => disegnaElenco();
  $('#cerca').placeholder = 'Cerca nella cassaforte…';
  const elenco = el('div');
  function disegnaElenco() {
    const q2 = S.cerca.toLowerCase();
    const t = tutte.filter((v) => (!S.tipo || v.tipo === S.tipo)
      && (!q2 || `${v.titolo} ${v.note} ${(v.siti || []).join(' ')} ${Object.values(v.campi || {}).join(' ')}`.toLowerCase().includes(q2)));
    ordina(t, (v) => v.titolo);
    const fiss = t.filter((v) => v.fissata), altre = t.filter((v) => !v.fissata);
    elenco.replaceChildren(...[
      fiss.length ? [el('div', { class: 'etichetta' }, 'Fissate'), el('div', { class: 'elenco' }, fiss.map((v) => rigaVoce(v, () => apriVoce(v.id))))] : null,
      altre.length ? [el('div', { class: 'etichetta', style: 'margin-top:12px' }, `Tutte · ${ORDINI.find(([k]) => k === ordine())[1]}`), el('div', { class: 'elenco' }, altre.map((v) => rigaVoce(v, () => apriVoce(v.id))))] : null,
      !t.length ? el('div', { class: 'vuoto' }, tutte.length ? 'Nessuna voce trovata' : 'La cassaforte è vuota') : null].flat().filter(Boolean));
  }
  aggiungi(lista,
    el('div', { class: 'chips' }, el('button', { class: `chip${!S.tipo ? ' on' : ''}`, onclick: () => { S.tipo = ''; disegnaApp(); } }, `Tutto ${tutte.length}`),
      Object.entries(TIPI).filter(([k]) => conta(k)).map(([k, t]) => el('button', { class: `chip${S.tipo === k ? ' on' : ''}`, onclick: () => { S.tipo = S.tipo === k ? '' : k; disegnaApp(); } }, `${t.nome} ${conta(k)}`))),
    el('div', { class: 'rigaordina' }, el('button', { class: 'btn', onclick: () => modificaVoce(null) }, '+ Nuova voce'), sceltaOrdine(() => disegnaElenco())),
    elenco);
  disegnaElenco();
  if (S.sel && S.voci.has(S.sel)) schedaVoce(dett, S.voci.get(S.sel).dati);
  else aggiungi(dett, el('div', { class: 'vuoto' }, 'Scegli una voce a sinistra'));
}
// Finestra di conferma nello stile DiGi Apps al posto di quella del browser.
/** Finestra con più scelte: ritorna la chiave scelta o null. */
function sceltaDiGi(testo, scelte) {
  return new Promise((ok) => {
    const velo = el('div', { class: 'velo' }, el('div', { class: 'finestra' }, el('p', {}, testo),
      el('div', { class: 'azioni', style: 'flex-direction:column;align-items:stretch' },
        scelte.map(([k, t]) => el('button', { class: 'btn2', onclick: () => { velo.remove(); ok(k); } }, t)),
        el('button', { class: 'btn2', onclick: () => { velo.remove(); ok(null); } }, 'Annulla'))));
    document.body.append(velo);
  });
}
function confermaDiGi(testo, si = 'Conferma') {
  return new Promise((ok) => {
    const fine = (x) => { velo.remove(); ok(x); };
    const velo = el('div', { class: 'velo', onclick: (e) => { if (e.target === velo) fine(false); } },
      el('div', { class: 'finestra', role: 'alertdialog' },
        el('div', { class: 'etichetta' }, 'Conferma'),
        el('p', { style: 'font-size:16px;line-height:1.45' }, testo),
        el('div', { class: 'azioni' }, el('button', { class: 'btn', type: 'button', onclick: () => fine(true) }, si), el('button', { class: 'btn2', type: 'button', onclick: () => fine(false) }, 'Annulla'))));
    document.body.append(velo);
    $('.btn2', velo).focus();
  });
}
function apriVoce(id) { S.sel = id; disegnaApp(); }

// Indirizzo apribile di un sito salvato: solo http/https (mai javascript: o altro), https:// se manca.
function urlSito(s) {
  const t = String(s || '').trim();
  if (!t || /^android:\/\//i.test(t)) return null;
  try { const u = new URL(/^[a-z][a-z0-9+.-]*:/i.test(t) ? t : `https://${t}`); return ['http:', 'https:'].includes(u.protocol) ? u.href : null; } catch { return null; }
}
function dato(etichetta, valore, segreto = false, link = null) {
  let vedi = !segreto;
  const val = el('div', { class: 'val' });
  const mostra = () => { val.replaceChildren(link ? el('a', { href: link, target: '_blank', rel: 'noopener noreferrer', class: 'sitolink' }, valore) : (vedi ? valore : '•'.repeat(12))); };
  mostra();
  return el('div', { class: 'dato' }, el('div', { class: 'v' }, el('div', { class: 'piccola' }, etichetta), val),
    segreto ? el('button', { class: 'iconabtn', title: 'Mostra', onclick: () => { vedi = !vedi; mostra(); } }, icona('occhio')) : null,
    el('button', { class: 'iconabtn', title: 'Copia', onclick: () => copia(valore, segreto) }, icona('copia')));
}
// Campi della scheda; nell'identità il titolo della sezione compare prima del primo campo compilato della sezione.
function campiScheda(id, tipo, c) {
  const out = []; let sezione = null, scritta = null;
  for (const [k, et, seg] of tipo.campi) {
    if (tipo.sezioni?.[k]) sezione = tipo.sezioni[k];
    if (!c[k]) continue;
    if (sezione && scritta !== sezione) { out.push(el('div', { class: 'etichetta', style: 'margin-top:8px' }, sezione)); scritta = sezione; }
    out.push(dato(id === 'login' && k === 'utente' && c.email ? 'Nome utente' : et, String(c[k]), Boolean(seg)));
  }
  return out;
}
// Campo personalizzato di tipo 2FA: si mostra il codice che cambia, mai il segreto (CHECKLIST 1.10).
const timerExtra = [];
function datoTotp(nome, t) {
  const val = el('div', { class: 'totp' }, '…');
  const agg = async () => { const k = await codiceTotp(t); val.textContent = `${k.slice(0, 3)} ${k.slice(3)}  · ${t.periodo - Math.floor(Date.now() / 1000) % t.periodo}s`; };
  agg(); timerExtra.push(setInterval(agg, 1000));
  return el('div', { class: 'dato' }, el('div', { class: 'v' }, el('div', { class: 'piccola' }, nome), val), el('button', { class: 'iconabtn', title: 'Copia', onclick: async () => copia(await codiceTotp(t)) }, icona('copia')));
}
// ---------- allegati (CHECKLIST 1.11; 25 MB per file, 2 GB in tutto) ----------
// Il file si cifra qui nel browser con la chiave dei dati; al NAS arrivano solo byte cifrati. Nella voce restano nome,
// tipo e grandezza (cifrati con la voce).
const MAX_ALLEGATO = 25 * 1024 * 1024;
const misura = (n) => (n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : n > 0 ? `${Math.max(1, Math.round(n / 1024))} KB` : '0 KB');
async function caricaAllegati(v, files) {
  const troppo = [...files].filter((f) => f.size > MAX_ALLEGATO);
  if (troppo.length) return avviso(`Troppo grande: ${troppo.map((f) => f.name).join(', ')}. Un allegato può essere al massimo di 25 MB.`);
  v.allegati = v.allegati || [];
  for (const f of files) {
    const id = nuovoId();
    const cifrato = await C.cifra(S.dek, new Uint8Array(await f.arrayBuffer()), `digipass-allegato:${id}`);
    try { await api('PUT', `/api/allegati/${id}`, new Blob([cifrato]), { headers: { 'Content-Type': 'application/octet-stream' } }); } catch (x) { avviso(x.message); break; }
    v.allegati.push({ id, nome: f.name, tipo: f.type || 'application/octet-stream', dimensione: f.size, creato: Date.now() });
  }
  await salva('voce', v); disegnaApp();
}
async function apriAllegato(a) {
  const r = await fetch(`/api/allegati/${encodeURIComponent(a.id)}`, { credentials: 'same-origin' });
  if (!r.ok) return avviso(r.status === 404 ? 'Allegato non trovato sul NAS' : `Errore ${r.status}`);
  const chiaro = await C.decifra(S.dek, new Uint8Array(await r.arrayBuffer()), `digipass-allegato:${a.id}`);
  scarica(a.nome || 'allegato', new Blob([chiaro], { type: a.tipo || 'application/octet-stream' }));
}
async function togliAllegati(lista) { for (const a of lista || []) { try { await api('DELETE', `/api/allegati/${encodeURIComponent(a.id)}`); } catch { /* già tolto */ } } }
function sezioneAllegati(v) {
  const lista = v.allegati || [];
  const spazio = el('div', { class: 'piccola' });
  api('GET', '/api/allegati').then((s) => { spazio.textContent = `Spazio usato: ${misura(s.usato)} di 2 GB${s.usato > s.massimo * 0.9 ? ' · quasi pieno' : ''}`; }).catch(() => {});
  return [el('div', { class: 'etichetta', style: 'margin-top:12px' }, `Allegati · ${lista.length}`),
    lista.map((a) => el('div', { class: 'dato' }, el('div', { class: 'v' }, el('div', { class: 'piccola' }, misura(a.dimensione || 0)), el('div', { class: 'val' }, a.nome)),
      el('button', { class: 'btn2', onclick: () => apriAllegato(a) }, 'Scarica'),
      v.cestino ? null : el('button', { class: 'btn2', onclick: async () => { const r = await chiedi('Rinomina allegato', [['Nome', 'text', a.nome]], 'Rinomina'); if (r && r[0].trim()) { a.nome = r[0].trim(); await salva('voce', v); disegnaApp(); } } }, 'Rinomina'),
      v.cestino ? null : el('button', { class: 'btn2', onclick: async () => { if (!await confermaDiGi(`Eliminare l'allegato «${a.nome}»? Non si può recuperare.`)) return; await togliAllegati([a]); v.allegati = lista.filter((x) => x !== a); await salva('voce', v); disegnaApp(); } }, 'Elimina'))),
    v.cestino ? null : el('div', { class: 'azioni' },
      el('label', { class: 'btn2' }, 'Aggiungi allegati', el('input', { type: 'file', multiple: true, hidden: true, onchange: (e) => caricaAllegati(v, e.target.files) })),
      lista.length ? el('button', { class: 'btn2', onclick: async () => { if (!await confermaDiGi(`Eliminare tutti i ${lista.length} allegati? Non si possono recuperare.`)) return; await togliAllegati(lista); v.allegati = []; await salva('voce', v); disegnaApp(); } }, 'Elimina tutti') : null),
    spazio];
}

let timerTotp;
function schedaVoce(dett, v) {
  while (timerExtra.length) clearInterval(timerExtra.pop());
  const tipo = TIPI[v.tipo] || TIPI.nota, c = v.campi || {};
  const totp = leggiTotp(v.totp);
  const boxTotp = totp ? el('div', { class: 'dato' }, el('div', { class: 'v' }, el('div', { class: 'piccola' }, 'Codice 2FA'), el('div', { class: 'totp' }, '…')), el('button', { class: 'iconabtn', title: 'Copia', onclick: async () => copia(await codiceTotp(totp)) }, icona('copia'))) : null;
  clearInterval(timerTotp);
  if (totp) { const agg = async () => { const k = await codiceTotp(totp); $('.totp', boxTotp).textContent = `${k.slice(0, 3)} ${k.slice(3)}  · ${totp.periodo - Math.floor(Date.now() / 1000) % totp.periodo}s`; }; agg(); timerTotp = setInterval(agg, 1000); }
  aggiungi(dett, 
    el('div', { class: 'testata' }, el('button', { class: 'btn2 solotel', onclick: () => { S.sel = null; disegnaApp(); } }, '‹'), avatar(v.titolo || '?', 52, (v.siti || [])[0]), el('div', {}, el('h2', {}, v.titolo), el('div', { class: 'piccola' }, [tipo.nome, v.cestino && 'nel cestino'].filter(Boolean).join(' · ')))),
    v.tipo === 'carta' && tipoCarta(c.numero) ? dato('Tipo di carta', tipoCarta(c.numero)) : null,
    campiScheda(v.tipo, tipo, c),
    boxTotp,
    (v.siti || []).filter((s) => !/^android:\/\//i.test(s)).map((s) => dato('Sito', s, false, urlSito(s))),
    (v.siti || []).filter((s) => /^android:\/\//i.test(s)).map((s) => dato('App collegata', s.slice(10))),
    (v.extra || []).filter((e) => e.valore).map((e) => (e.tipo === 'totp' && leggiTotp(e.valore) ? datoTotp(e.nome || 'Codice 2FA', leggiTotp(e.valore)) : dato(e.nome || 'Campo', e.valore, e.tipo === 'nascosto'))),
    v.note ? dato('Note', v.note) : null,
    sezioneAllegati(v),
    el('div', { class: 'azioni' },
      v.cestino
        ? [el('button', { class: 'btn', onclick: async () => { delete v.cestino; await salva('voce', v); disegnaApp(); } }, 'Ripristina'),
          el('button', { class: 'btn2', onclick: async () => { if (await confermaDiGi(`Eliminare per sempre?${(v.allegati || []).length ? ` Anche i suoi ${v.allegati.length} allegati.` : ''} Non si può recuperare.`)) { await togliAllegati(v.allegati); await salva('voce', v, true); S.sel = null; disegnaApp(); } } }, 'Elimina per sempre')]
        : [el('button', { class: 'btn', onclick: () => modificaVoce(v) }, 'Modifica'),
          el('button', { class: 'btn2', onclick: async () => { v.fissata = !v.fissata; await salva('voce', v); disegnaApp(); } }, v.fissata ? 'Togli da Fissate' : 'Fissa in alto'),
          el('button', { class: 'btn2', onclick: async () => { v.cestino = Date.now(); await salva('voce', v); S.sel = null; disegnaApp(); avviso('Eliminata: la trovi nel Cestino, da cui puoi recuperarla'); } }, 'Elimina')]));
}

function modificaVoce(orig, nuova = !orig) {
  const v = orig ? structuredClone(orig) : { id: nuovoId(), tipo: 'login', titolo: '', cartella: '', fissata: false, campi: {}, siti: [], note: '', totp: '', cestino: null, extra: [] };
  const velo = el('div', { class: 'velo' });
  v.extra = (v.extra || []).map((e) => ({ ...e }));
  let siti = (v.siti || []).filter((s) => !/^android:\/\//i.test(s)), app = (v.siti || []).filter((s) => /^android:\/\//i.test(s)).map((s) => s.slice(10));
  const disegna = () => {
    const tipo = TIPI[v.tipo];
    const separato = preferenza('utente-separato', false) || Boolean(v.campi.email);
    const inp = (k, et, seg, valore, set) => {
      // Chrome non deve riempire la voce con l'accesso di DiGiPass: nomi propri dei campi e «new-password».
      const i = el('input', { type: seg ? 'password' : 'text', name: `voce-${k}`, id: `voce-${k}`, value: valore || '', oninput: (e) => set(e.target.value), autocomplete: seg ? 'new-password' : 'off', 'data-lpignore': 'true', 'data-1p-ignore': 'true' });
      return el('label', { class: 'campo' }, el('span', { class: 'piccola' }, et),
        el('div', { style: 'display:flex;gap:6px' }, i, seg ? el('button', { type: 'button', class: 'btn2', onclick: () => { i.type = i.type === 'password' ? 'text' : 'password'; } }, 'Mostra') : null,
          k === 'password' ? el('button', { type: 'button', class: 'btn2', onclick: () => apriGeneratore((p) => { v.campi.password = p; i.value = p; }) }, 'Genera') : null));
    };
    velo.replaceChildren(el('form', { class: 'finestra', autocomplete: 'off', 'data-digipass-ignore': '', onsubmit: async (e) => {
      e.preventDefault();
      if (!v.titolo.trim()) return avviso('Scrivi un titolo');
      if (v.tipo === 'login' && v.totp && !leggiTotp(v.totp)) return avviso('Il segreto 2FA non è valido');
      // I campi che questa pagina non mostra (scritti da un'altra parte di DiGiPass) restano com'erano.
      v.campi = { ...(orig?.campi || {}), ...Object.fromEntries(tipo.campi.map(([k]) => [k, v.campi[k] || ''])) };
      v.siti = [...siti, ...app.map((a) => (/^android:\/\//i.test(a) ? a : `android://${a}`))];
      v.extra = (v.extra || []).filter((e) => (e.nome || '').trim() || (e.valore || '').trim()).map((e) => ({ nome: (e.nome || '').trim(), tipo: e.tipo || 'testo', valore: (e.valore || '').trim() }));
      if (v.extra.some((e) => e.tipo === 'totp' && !leggiTotp(e.valore))) return avviso('Un campo 2FA personalizzato non è valido');
      if (v.tipo !== 'login') { v.siti = []; v.totp = ''; }
      try { await salva('voce', v); if (S.sezione !== 'sicurezza') S.sel = v.id; velo.remove(); disegnaApp(); avviso('Salvata'); } catch (x) { avviso(x.message); }
    } },
    el('div', { class: 'etichetta' }, nuova ? 'Nuova voce' : 'Modifica'),
    nuova ? el('div', { class: 'chips' }, Object.entries(TIPI).map(([k, t]) => el('button', { type: 'button', class: `chip${v.tipo === k ? ' on' : ''}`, onclick: () => { v.tipo = k; disegna(); } }, t.nome))) : null,
    inp('titolo', 'Titolo', 0, v.titolo, (x) => { v.titolo = x; }),
    tipo.campi.map(([k, et, seg]) => (v.tipo === 'login' && k === 'email' && !separato ? null : [
      tipo.sezioni?.[k] ? el('div', { class: 'etichetta', style: 'margin-top:8px' }, tipo.sezioni[k]) : null,
      inp(k, v.tipo === 'login' && k === 'utente' && separato ? 'Nome utente' : et, seg, v.campi[k], (x) => { v.campi[k] = x; }),
      v.tipo === 'carta' && k === 'numero' && tipoCarta(v.campi.numero) ? el('div', { class: 'piccola' }, el('b', {}, tipoCarta(v.campi.numero))) : null])),
    v.tipo === 'login' ? [
      el('label', { class: 'campo' }, el('span', { class: 'piccola' }, 'Siti (uno per riga)'), el('textarea', { oninput: (e) => { siti = e.target.value.split(/[\n,]/).map((s) => s.trim()).filter(Boolean); } }, siti.join('\n'))),
      el('label', { class: 'campo' }, el('span', { class: 'piccola' }, 'App collegate (una per riga, es. com.amazon.mShop.android.shopping)'), el('textarea', { oninput: (e) => { app = e.target.value.split(/[\n,]/).map((s) => s.trim()).filter(Boolean); } }, app.join('\n'))),
      inp('totp', 'Segreto 2FA (facoltativo)', 0, v.totp, (x) => { v.totp = x.trim(); })] : null,
    el('label', { class: 'campo' }, el('span', { class: 'piccola' }, 'Note'), el('textarea', { oninput: (e) => { v.note = e.target.value; } }, v.note || '')),
    // Campi personalizzati (CHECKLIST 1.10): testo, nascosto, data, codice 2FA.
    el('div', { class: 'etichetta', style: 'margin-top:8px' }, 'Campi personalizzati'),
    v.extra.map((e, i) => el('div', { class: 'riquadro' },
      el('div', { style: 'display:flex;gap:6px' },
        el('input', { type: 'text', placeholder: 'Nome del campo', value: e.nome || '', autocomplete: 'off', oninput: (x) => { e.nome = x.target.value; } }),
        el('button', { type: 'button', class: 'btn2', onclick: () => { v.extra.splice(i, 1); disegna(); } }, 'Togli')),
      el('div', { class: 'chips' }, [['testo', 'Testo'], ['nascosto', 'Nascosto'], ['data', 'Data'], ['totp', '2FA']].map(([t, n]) =>
        el('button', { type: 'button', class: `chip${(e.tipo || 'testo') === t ? ' on' : ''}`, onclick: () => { e.tipo = t; disegna(); } }, n))),
      el('input', { type: e.tipo === 'nascosto' ? 'password' : 'text', autocomplete: e.tipo === 'nascosto' ? 'new-password' : 'off', value: e.valore || '',
        placeholder: e.tipo === 'data' ? 'Data (GG.MM.AAAA)' : e.tipo === 'totp' ? 'Segreto 2FA' : 'Valore', oninput: (x) => { e.valore = x.target.value; } }))),
    el('button', { type: 'button', class: 'btn2', onclick: () => { v.extra.push({ nome: '', tipo: 'testo', valore: '' }); disegna(); } }, 'Aggiungi un campo'),
    el('div', { class: 'azioni' }, el('button', { class: 'btn', type: 'submit' }, 'Salva'), el('button', { class: 'btn2', type: 'button', onclick: () => velo.remove() }, 'Annulla'))));
  };
  disegna(); document.body.append(velo);
}

// ---------- Memoria siti ----------
function listaMemoria(lista, dett) {
  const nome = (s) => nomeSito(s);
  // Scrivendo nel Cerca si ridisegna solo l'elenco: il campo resta lo stesso, con cursore e focus (
  // prima si ridisegnava tutta la pagina e il testo usciva al contrario).
  const elenco = el('div');
  S.aggiornaElenco = () => disegnaElenco();
  $('#cerca').placeholder = 'Cerca un sito…';
  function disegnaElenco() {
    const q = S.cerca.toLowerCase();
    const siti = [...S.siti.values()].map((x) => x.dati).filter((s) => !q || `${s.sito} ${nome(s)} ${s.utente}`.toLowerCase().includes(q));
    ordina(siti, (x) => nome(x));
    elenco.replaceChildren(siti.length ? el('div', { class: 'elenco' }, siti.map((s) => el('button', { class: `riga${S.sel === s.id ? ' sel' : ''}`, onclick: () => { S.sel = s.id; disegnaApp(); } },
      avatar(nome(s), 34, s.sito), el('span', { class: 't' }, el('b', {}, nome(s)), el('span', {}, s.utente || 'senza nome utente'))))) : el('div', { class: 'vuoto' }, 'Nessun sito'));
  }
  aggiungi(lista, 
    el('div', { class: 'rigaordina' }, el('div', { class: 'etichetta' }, `${S.siti.size} siti`), sceltaOrdine(() => disegnaElenco())),
    elenco);
  disegnaElenco();
  const s = S.sel && S.siti.get(S.sel)?.dati;
  if (!s) { aggiungi(dett, el('div', { class: 'vuoto' }, 'Scegli un sito a sinistra')); return; }
  aggiungi(dett, el('div', { class: 'testata' }, el('button', { class: 'btn2 solotel', onclick: () => { S.sel = null; disegnaApp(); } }, '‹'), avatar(nome(s), 52), el('h2', {}, nome(s))),
    dato('Nome utente', s.utente || ''), dato('Password', s.password || '', true),
    el('div', { class: 'azioni' },
      el('button', { class: 'btn', onclick: () => mettiInCassaforte(s) }, 'Metti in cassaforte'),
      el('button', { class: 'btn2', onclick: () => modificaSito(s) }, 'Modifica'),
      el('button', { class: 'btn2', onclick: async () => { if (await confermaDiGi(`Eliminare «${nome(s)} – ${s.utente || 'senza nome utente'}» da Memoria siti? Si cancella solo questa voce.`, 'Elimina')) { await salva('sito', s, true); S.sel = null; disegnaApp(); } } }, 'Elimina')));
}
// Modifica di una voce di Memoria siti («non mi fa cambiare l'indirizzo»): indirizzo, nome utente, password.
function modificaSito(orig) {
  const v = { ...orig };
  const velo = el('div', { class: 'velo' });
  const inp = (k, et, seg) => {
    const i = el('input', { type: seg ? 'password' : 'text', name: `sito-${k}`, id: `sito-${k}`, value: v[k] || '', oninput: (e) => { v[k] = e.target.value; }, autocomplete: seg ? 'new-password' : 'off', 'data-lpignore': 'true', 'data-1p-ignore': 'true' });
    return el('label', { class: 'campo' }, el('span', { class: 'piccola' }, et),
      el('div', { style: 'display:flex;gap:6px' }, i, seg ? el('button', { type: 'button', class: 'btn2', onclick: () => { i.type = i.type === 'password' ? 'text' : 'password'; } }, 'Mostra') : null));
  };
  velo.append(el('form', { class: 'finestra', autocomplete: 'off', 'data-digipass-ignore': '', onsubmit: async (e) => {
    e.preventDefault();
    v.sito = String(v.sito || '').trim(); v.utente = String(v.utente || '').trim();
    if (!v.sito) return avviso('Scrivi l’indirizzo');
    if (!v.password) return avviso('Scrivi la password');
    try { await salva('sito', v); S.sel = v.id; velo.remove(); disegnaApp(); avviso('Salvata'); } catch (x) { avviso(x.message); }
  } },
  el('div', { class: 'etichetta' }, 'Modifica'),
  inp('sito', 'Indirizzo', 0), inp('utente', 'Nome utente', 0), inp('password', 'Password', 1),
  el('div', { class: 'azioni' }, el('button', { class: 'btn', type: 'submit' }, 'Salva'), el('button', { class: 'btn2', type: 'button', onclick: () => velo.remove() }, 'Annulla'))));
  document.body.append(velo);
}
// Apre la scheda di una voce nuova già compilata con il sito: nome e note a scelta, poi Salva.
function mettiInCassaforte(s) {
  const base = String(s.sito).replace('android://', '').split('.')[0] || 'Sito';
  modificaVoce({ id: nuovoId(), tipo: 'login', titolo: base[0].toUpperCase() + base.slice(1), cartella: '', fissata: false, campi: { utente: s.utente || '', password: s.password || '' }, siti: [s.sito], note: '', totp: '', cestino: null, extra: [] }, true);
}

// ---------- Sicurezza e Cestino ----------
// Sicurezza: i due riquadri si cliccano e scelgono l'elenco a destra; una voce si apre e si modifica
// qui dentro (finestra MODIFICA), e dopo Salva si resta su questo elenco, alla stessa posizione, coi conteggi aggiornati.
function listaSicurezza(lista, dett) {
  const login = voci().filter((v) => !v.cestino && v.tipo === 'login');
  const pw = (v) => v.campi?.password || '';
  const deboli = login.filter((v) => pw(v) && forza(pw(v))[0] < 50);
  const gruppi = {}; for (const v of login) if (pw(v)) (gruppi[pw(v)] ||= []).push(v);
  const ripetute = Object.values(gruppi).filter((g) => g.length > 1);
  const nRip = ripetute.reduce((a, g) => a + g.length, 0);
  if (!['deboli', 'ripetute'].includes(S.sicVista)) S.sicVista = 'deboli';
  const st = (k, t, n) => el('button', { type: 'button', class: `riquadro sceglibile${S.sicVista === k ? ' on' : ''}`, 'aria-pressed': String(S.sicVista === k), onclick: () => { S.sicVista = k; disegnaApp(); } },
    el('div', { class: 'stato' }, el('span', { class: 'segno', style: `color:${n ? 'var(--giallo)' : 'var(--verde)'}` }, n ? '⚠' : '✓'), t, el('b', {}, n)));
  aggiungi(lista, st('deboli', 'Password deboli', deboli.length), st('ripetute', 'Password usate in più voci', nRip),
    el('p', { style: 'font-size:13px' }, `Controllate ${login.length} voci di tipo Login, qui nel browser.`));
  const apri = (v) => modificaVoce(v);
  aggiungi(dett, S.sicVista === 'deboli'
    ? (deboli.length ? [el('div', { class: 'etichetta' }, `Deboli · ${deboli.length}`), el('div', { class: 'elenco' }, deboli.map((v) => rigaVoce(v, () => apri(v))))] : el('div', { class: 'vuoto' }, 'Nessuna password debole'))
    : (ripetute.length ? ripetute.map((g, i) => [el('div', { class: 'etichetta', style: i ? 'margin-top:12px' : '' }, `Stessa password · gruppo ${i + 1}`), el('div', { class: 'elenco' }, g.map((v) => rigaVoce(v, () => apri(v))))]) : el('div', { class: 'vuoto' }, 'Nessuna password usata in più voci')));
}
function listaCestino(lista, dett) {
  const c = voci().filter((v) => v.cestino);
  aggiungi(lista, el('div', { class: 'etichetta' }, `Cestino · ${c.length}`),
    c.length ? el('div', { class: 'elenco' }, c.map((v) => rigaVoce(v, () => { S.sel = v.id; disegnaApp(); }))) : el('div', { class: 'vuoto' }, 'Il cestino è vuoto'),
    c.length ? el('button', { class: 'btn2', onclick: async () => { if (await confermaDiGi(`${c.length} voci spariscono per sempre e non si possono recuperare. Svuotare?`)) { for (const v of c) { await togliAllegati(v.allegati); await salva('voce', v, true); } disegnaApp(); } } }, 'Svuota il cestino') : null);
  if (S.sel && S.voci.has(S.sel)) schedaVoce(dett, S.voci.get(S.sel).dati); else aggiungi(dett, el('div', { class: 'vuoto' }, 'Scegli una voce'));
}

// ---------- Impostazioni ----------
function chiedi(titolo, campi, conferma = 'Conferma') {
  return new Promise((ok) => {
    const inputs = campi.map(([et, tipo = 'text', valore = '']) => el('input', { type: tipo, value: valore, autocomplete: tipo === 'password' ? 'current-password' : 'off' }));
    const velo = el('div', { class: 'velo' }, el('form', { class: 'finestra', onsubmit: (e) => { e.preventDefault(); velo.remove(); ok(inputs.map((i) => i.value)); } },
      el('div', { class: 'etichetta' }, titolo), campi.map(([et], i) => el('label', { class: 'campo' }, el('span', { class: 'piccola' }, et), inputs[i])),
      el('div', { class: 'azioni' }, el('button', { class: 'btn', type: 'submit' }, conferma), el('button', { class: 'btn2', type: 'button', onclick: () => { velo.remove(); ok(null); } }, 'Annulla'))));
    document.body.append(velo); inputs[0]?.focus();
  });
}
async function accessoDa(password) {
  const pre = await api('POST', '/api/auth/prelogin', { username: S.utente });
  const kek = await C.chiaveDaPassword(password, C.deB64(pre.salePw), pre.kdf);
  return { kek, accesso: await C.chiaveAccesso(kek, C.deB64(pre.salePw)) };
}
function mostraFoglio(recupero, codici, dopo) {
  const velo = el('div', { class: 'velo' }, el('div', { class: 'finestra' },
    el('div', { class: 'etichetta' }, 'Foglio di emergenza nuovo'),
    el('p', {}, 'Stampalo o scrivilo adesso: quello vecchio non vale più. La password principale scrivila a mano sul foglio.'),
    el('div', { class: 'piccola' }, 'Chiave di recupero'), el('div', { class: 'gen' }, recupero),
    codici ? [el('div', { class: 'piccola' }, 'Codici di riserva (uno per accesso, se perdi il telefono)'), el('div', { class: 'codici' }, codici.map((c) => el('span', {}, c)))] : null,
    el('div', { class: 'azioni' }, el('button', { class: 'btn2', onclick: () => print() }, 'Stampa'), el('button', { class: 'btn', onclick: () => { velo.remove(); dopo?.(); } }, 'L\'ho stampato'))));
  document.body.append(velo);
}
// ---------- doppioni (CHECKLIST 2.11; solo in Impostazioni), come nell'app (lib/doppioni.dart) ----------
// Login doppi: stesso nome utente (o email) e stessa password, con un sito in comune o lo stesso titolo; le altre voci:
// stesso tipo e stessi campi. «Unisci»: resta la voce modificata per ultima con i siti e le note delle altre; le altre nel Cestino.
const dd = (s) => String(s ?? '').trim().toLowerCase();
const sitoD = (s) => dd(s).replace(/^[a-z][a-z0-9+.-]*:\/\//, '').replace(/^www\./, '').split(/[/?#]/)[0];
function voceUguale(a, b) {
  if (a.tipo !== b.tipo) return false;
  const ca = a.campi || {}, cb = b.campi || {};
  if (a.tipo === 'login') {
    const ua = dd(ca.utente) || dd(ca.email), ub = dd(cb.utente) || dd(cb.email);
    if (ua !== ub || (ca.password || '') !== (cb.password || '') || !ca.password) return false;
    const sb = new Set((b.siti || []).map(sitoD));
    return (a.siti || []).map(sitoD).some((s) => sb.has(s)) || (dd(a.titolo) !== '' && dd(a.titolo) === dd(b.titolo));
  }
  const chiavi = new Set([...Object.keys(ca), ...Object.keys(cb)]);
  if ([...chiavi].every((k) => !dd(ca[k]) && !dd(cb[k]))) return a.tipo === 'nota' && dd(a.titolo) === dd(b.titolo) && dd(a.note) === dd(b.note) && dd(a.note) !== '';
  return [...chiavi].every((k) => String(ca[k] ?? '').trim() === String(cb[k] ?? '').trim());
}
function gruppiDoppioni() {
  const v = voci().filter((x) => !x.cestino), presi = new Set(), out = [];
  for (let i = 0; i < v.length; i++) {
    if (presi.has(v[i].id)) continue;
    const g = [v[i]];
    for (let j = i + 1; j < v.length; j++) if (!presi.has(v[j].id) && g.some((x) => voceUguale(x, v[j]))) g.push(v[j]);
    if (g.length > 1) { out.push(g); g.forEach((x) => presi.add(x.id)); }
  }
  return out;
}
async function unisciDoppioni(gruppo) {
  const g = [...gruppo].sort((a, b) => (b.modificata || 0) - (a.modificata || 0));
  const resta = structuredClone(g[0]);
  const siti = [...(resta.siti || [])], note = resta.note?.trim() ? [resta.note.trim()] : [];
  for (const v of g.slice(1)) {
    for (const s of v.siti || []) if (!siti.some((x) => x.trim() === String(s).trim())) siti.push(s); // indirizzi interi: si toglie solo l'identico
    const n = String(v.note || '').trim();
    if (n && !note.some((x) => x.includes(n))) note.push(n);
  }
  resta.siti = siti; resta.note = note.join('\n\n');
  await salva('voce', resta);
  for (const v of g.slice(1)) await salva('voce', { ...structuredClone(v), cestino: Date.now() });
}
function sezioneDoppioni() {
  const gruppi = gruppiDoppioni();
  const unisci = async (lista) => {
    const n = lista.reduce((t, g) => t + g.length - 1, 0);
    if (!await confermaDiGi(`Resta la voce modificata per ultima, con i siti e le note delle altre. ${n === 1 ? "L'altra va" : `Le altre ${n} vanno`} nel Cestino, da cui si ${n === 1 ? 'può' : 'possono'} recuperare.`, 'Unisci')) return;
    for (const g of lista) await unisciDoppioni(g);
    avviso(lista.length === 1 ? 'Unite' : `Uniti ${lista.length} gruppi`); disegnaApp();
  };
  return [el('div', { class: 'etichetta' }, `Doppioni · ${gruppi.length}`),
    el('div', { class: 'riquadro' },
      gruppi.length ? null : el('p', {}, 'Nessun doppione in Cassaforte'),
      gruppi.map((g) => [el('div', { class: 'elenco' }, g.map((v) => rigaVoce(v, () => { S.sezione = 'cassaforte'; apriVoce(v.id); }))),
        el('button', { class: 'btn2', onclick: () => unisci([g]) }, `Unisci queste ${g.length}`)]),
      gruppi.length > 1 ? el('button', { class: 'btn', onclick: () => unisci(gruppi) }, 'Unisci tutti') : null)];
}

async function impostazioni(lista, dett) {
  const me = await api('GET', '/api/auth/me');
  aggiungi(lista, 
    el('div', { class: 'etichetta' }, 'Dati'),
    el('div', { class: 'riquadro' },
      el('b', {}, 'Importa'),
      el('label', { class: 'btn2' }, 'Password di Chrome (CSV) → Memoria siti', el('input', { type: 'file', accept: '.csv,text/csv', hidden: true, onchange: (e) => importa(e, 'chrome') })),
      el('label', { class: 'btn2' }, 'Password di Chrome (CSV) → sostituisci quelle importate', el('input', { type: 'file', accept: '.csv,text/csv', hidden: true, onchange: (e) => importa(e, 'chrome-sostituisci') })),
      el('label', { class: 'btn2' }, 'Export di Proton Pass (JSON o ZIP) → Cassaforte', el('input', { type: 'file', accept: '.json,.zip', hidden: true, onchange: (e) => importa(e, 'proton') })),
      el('label', { class: 'btn2' }, 'Export di Proton Pass → sostituisci le voci importate', el('input', { type: 'file', accept: '.json,.zip', hidden: true, onchange: (e) => importa(e, 'proton-sostituisci') })),
      el('label', { class: 'btn2' }, 'CSV di un altro programma → scegli Cassaforte o Memoria siti', el('input', { type: 'file', accept: '.csv,text/csv', hidden: true, onchange: (e) => importa(e, 'csv') })),
      el('b', {}, 'Esporta'),
      el('button', { class: 'btn2', onclick: esportaCifrato }, 'File cifrato con una passphrase'),
      el('button', { class: 'btn2', onclick: esportaCsv }, 'CSV in chiaro (attenzione)')),
    sezioneDoppioni(),
    el('div', { class: 'etichetta' }, 'Questo browser'),
    el('div', { class: 'riquadro' },
      el('label', { class: 'spunta' }, el('input', { type: 'checkbox', checked: preferenza('utente-separato', false), onchange: (e) => imposta('utente-separato', e.target.checked) }), 'Nome utente separato: nei login Email e Nome utente in due campi'),
      el('label', { class: 'spunta' }, el('input', { type: 'checkbox', checked: preferenza('icone', true), onchange: (e) => { imposta('icone', e.target.checked); disegnaApp(); } }), 'Icone dei siti (prese dal NAS)')),
    el('div', { class: 'etichetta' }, 'Accesso'),
    el('div', { class: 'riquadro' },
      el('p', {}, `Utente ${me.username} · codici di riserva rimasti: ${me.riserveRimaste}`),
      el('button', { class: 'btn2', onclick: cambiaPassword }, 'Cambia la password principale'),
      el('button', { class: 'btn2', onclick: nuovoFoglio }, 'Nuovo foglio di emergenza'),
      el('button', { class: 'btn2', onclick: telefonoNuovo }, 'Telefono nuovo: collega Google Authenticator'),
      el('button', { class: 'btn2', onclick: async () => { await api('POST', '/api/auth/logout-all'); avviso('Chiuse le sessioni degli altri dispositivi'); } }, 'Esci da tutti gli altri dispositivi'),
      el('button', { class: 'btn2', onclick: async () => { if (await confermaDiGi('Revocare tutti i dispositivi ricordati? Al prossimo accesso servirà di nuovo il codice.')) { await api('POST', '/api/auth/devices/forget'); disegnaApp(); } } }, 'Dimentica i dispositivi ricordati'),
      el('button', { class: 'btn2', onclick: esci }, 'Esci da questo dispositivo')));
  const [dev, reg, bk] = await Promise.all([api('GET', '/api/auth/devices'), api('GET', '/api/registro'), api('GET', '/api/backup')]);
  const data = (t) => new Date(t).toLocaleString('it-CH');
  const imp = bk.impostazioni;
  const sel = (id, opzioni, val) => el('select', { id }, opzioni.map(([v, t]) => el('option', { value: v, selected: String(v) === String(val) }, t)));
  const fr = sel('bkFreq', [['daily', 'Ogni giorno'], ['weekly', 'Ogni settimana'], ['monthly', 'Ogni mese']], imp.frequency);
  const gs = sel('bkGiorno', ['Domenica', 'Lunedì', 'Martedì', 'Mercoledì', 'Giovedì', 'Venerdì', 'Sabato'].map((t, i) => [i, t]), imp.dayOfWeek);
  const ora = el('input', { id: 'bkOra', type: 'time', value: `${String(imp.hour).padStart(2, '0')}:${String(imp.minute).padStart(2, '0')}` });
  const att = el('input', { type: 'checkbox', id: 'bkOn', checked: imp.enabled });
  aggiungi(dett, 
    el('div', { class: 'etichetta' }, 'Backup'),
    el('div', { class: 'riquadro' },
      el('p', {}, `Ultimo backup: ${bk.ultimo ? data(bk.ultimo) : 'nessuno'} · copie tenute: ${bk.copie} (le ultime 10). I backup sono cifrati.`),
      el('label', { class: 'spunta' }, att, 'Backup automatico'),
      el('label', { class: 'campo' }, el('span', { class: 'piccola' }, 'Frequenza'), fr),
      el('label', { class: 'campo' }, el('span', { class: 'piccola' }, 'Giorno (se settimanale)'), gs),
      el('label', { class: 'campo' }, el('span', { class: 'piccola' }, 'Ora'), ora),
      el('div', { class: 'azioni' },
        el('button', { class: 'btn', onclick: async () => {
          const [h, m] = ora.value.split(':').map(Number);
          try { await api('PUT', '/api/backup', { enabled: att.checked, frequency: fr.value, dayOfWeek: +gs.value, dayOfMonth: imp.dayOfMonth, hour: h, minute: m }); avviso('Impostazioni del backup salvate'); } catch (x) { avviso(x.message); }
        } }, 'Salva'),
        el('button', { class: 'btn2', onclick: async () => { try { await api('POST', '/api/backup/ora'); avviso('Backup fatto'); disegnaApp(); } catch (x) { avviso(x.message); } } }, 'Backup ora'),
        el('label', { class: 'btn2' }, 'Importa (ripristino)', el('input', { type: 'file', accept: '.enc', hidden: true, onchange: ripristina })))),
    el('div', { class: 'etichetta' }, 'Dispositivi ricordati'),
    el('div', { class: 'scorre' }, el('table', { class: 'tabella' }, el('tr', {}, el('th', {}, 'Dispositivo'), el('th', {}, 'Ultimo uso'), el('th', {}, 'Scade')),
      dev.devices.map((d) => el('tr', {}, el('td', {}, d.label), el('td', {}, data(d.last_used)), el('td', {}, data(d.expires_at)))))),
    el('div', { class: 'etichetta' }, 'Registro'),
    el('div', { class: 'scorre' }, el('table', { class: 'tabella' }, el('tr', {}, el('th', {}, 'Quando'), el('th', {}, 'Cosa'), el('th', {}, 'Da')),
      reg.eventi.slice(0, 10).map((e) => el('tr', {}, el('td', {}, data(e.happened_at)), el('td', {}, e.kind.replace(/_/g, ' ') + (e.detail ? ` (${e.detail})` : '')), el('td', {}, e.address))))));
}
async function cambiaPassword() {
  const r = await chiedi('Cambia la password principale', [['Password attuale', 'password'], ['Codice Authenticator o di riserva'], ['Nuova password (almeno 10 caratteri)', 'password'], ['Ripeti la nuova password', 'password']], 'Cambia');
  if (!r) return;
  const [vecchia, code, n1, n2] = r;
  if (n1.length < 10 || n1 !== n2) return avviso('La password nuova deve avere almeno 10 caratteri ed essere uguale nei due campi');
  try {
    const { accesso } = await accessoDa(vecchia);
    const salePw = C.casuali(16), kek = await C.chiaveDaPassword(n1, salePw, S.chiavi.kdf);
    const chiavi = { ...S.chiavi, salePw: C.b64(salePw), dekPw: C.b64(await C.cifra(kek, S.dek)) };
    delete chiavi.aggiornate;
    await api('POST', '/api/auth/password', { currentPassword: accesso, code, newPassword: await C.chiaveAccesso(kek, salePw), chiavi });
    S.chiavi = await api('GET', '/api/chiavi'); S.kek = kek;
    avviso('Password principale cambiata. Sull\'app del telefono usa quella nuova.');
  } catch (x) { avviso(x.message); }
}
async function telefonoNuovo() {
  const r = await chiedi('Telefono nuovo', [['Password principale', 'password'], ['Codice di riserva (o di Authenticator)']], 'Avanti');
  if (!r) return;
  try {
    const { accesso } = await accessoDa(r[0]);
    const n = await api('POST', '/api/auth/authenticator/nuovo', { password: accesso, code: r[1] });
    const codice = el('input', { inputmode: 'numeric', autocomplete: 'one-time-code' });
    const velo = el('div', { class: 'velo' }, el('form', { class: 'finestra', onsubmit: async (e) => {
      e.preventDefault();
      try {
        await api('POST', '/api/auth/authenticator/conferma', { resetToken: n.resetToken, code: codice.value.trim() });
        velo.remove(); avviso('Authenticator collegato al telefono nuovo. Rientra con il codice nuovo.'); setTimeout(() => location.reload(), 2500);
      } catch (x) { avviso(x.message); }
    } },
    el('div', { class: 'etichetta' }, 'Collega Google Authenticator'),
    el('p', {}, 'Sul telefono nuovo apri Google Authenticator, tocca + e inquadra il QR (oppure scrivi la chiave).'),
    el('img', { src: n.qrDataUrl, alt: 'QR per Authenticator', width: 232, height: 232, style: 'background:#fff;border-radius:8px;align-self:center' }),
    el('div', { class: 'gen' }, n.secret),
    el('label', { class: 'campo' }, el('span', { class: 'piccola' }, 'Codice di 6 cifre mostrato da Authenticator'), codice),
    el('div', { class: 'azioni' }, el('button', { class: 'btn', type: 'submit' }, 'Conferma'), el('button', { class: 'btn2', type: 'button', onclick: () => velo.remove() }, 'Annulla'))));
    document.body.append(velo); codice.focus();
  } catch (x) { avviso(x.message); }
}
async function nuovoFoglio() {
  const r = await chiedi('Nuovo foglio di emergenza', [['Password principale', 'password'], ['Codice Authenticator o di riserva']], 'Crea');
  if (!r) return;
  try {
    const { accesso } = await accessoDa(r[0]);
    const recupero = C.nuovaRecupero(), saleRec = C.casuali(16), rec = await C.chiaveDaRecupero(recupero, saleRec);
    const chiavi = { ...S.chiavi, saleRec: C.b64(saleRec), dekRec: C.b64(await C.cifra(rec, S.dek)) };
    delete chiavi.aggiornate;
    const out = await api('POST', '/api/auth/foglio', { password: accesso, code: r[1], chiavi, accessoRecupero: await C.accessoRecupero(rec, saleRec) });
    S.chiavi = await api('GET', '/api/chiavi');
    mostraFoglio(recupero, out.codiciRiserva);
  } catch (x) { avviso(x.message); }
}
async function importa(e, da) {
  const f = e.target.files[0]; e.target.value = '';
  if (!f) return;
  try {
    const dati = new Uint8Array(await f.arrayBuffer());
    if (da === 'csv') {
      const righe = leggiCsvGenerico(C.testo(dati));
      const scelta = await sceltaDiGi(`Nel file ci sono ${righe.length} righe. Dove le metto?`, [
        ['cassaforte-aggiungi', 'Cassaforte · Aggiungi'], ['cassaforte-sostituisci', 'Cassaforte · Sostituisci'],
        ['memoria-aggiungi', 'Memoria siti · Aggiungi'], ['memoria-sostituisci', 'Memoria siti · Sostituisci']]);
      if (!scelta) return;
      if (scelta.startsWith('cassaforte')) {
        const nuove = csvInCassaforte(righe);
        const chiave = (v) => `${v.tipo}\n${String(v.titolo || '').trim().toLowerCase()}\n${String(v.campi?.utente || '').trim().toLowerCase()}`;
        const daFile = new Set(nuove.map(chiave));
        const vecchie = scelta.endsWith('sostituisci') ? voci().filter((v) => daFile.has(chiave(v))) : [];
        if (vecchie.length && !await confermaDiGi(`In Cassaforte tolgo ${vecchie.length} voci con lo stesso titolo e nome utente e metto le ${nuove.length} del file, esattamente come sono.`, 'Sostituisci')) return;
        for (const v of vecchie) { await togliAllegati(v.allegati); await salva('voce', v, true); }
        for (const v of nuove) await salva('voce', { id: nuovoId(), ...v });
        avviso(`Cassaforte: ${vecchie.length ? `tolte ${vecchie.length}, ` : ''}importate ${nuove.length}. Cancella il file CSV: contiene le password in chiaro.`);
      } else {
        const nuovi = csvInMemoria(righe);
        const chiave = (s) => `${s.sito}\n${String(s.utente || '').toLowerCase()}`;
        const daFile = new Set(nuovi.map(chiave));
        const tutti = [...S.siti.values()].map((x) => x.dati);
        const vecchi = scelta.endsWith('sostituisci') ? tutti.filter((s) => daFile.has(chiave(s))) : [];
        const gia = new Set(tutti.map((s) => `${s.sito}\n${s.utente}\n${s.password}`));
        const daMettere = scelta.endsWith('sostituisci') ? nuovi : nuovi.filter((s) => !gia.has(`${s.sito}\n${s.utente}\n${s.password}`));
        if (vecchi.length && !await confermaDiGi(`In Memoria siti tolgo ${vecchi.length} siti con lo stesso indirizzo e nome utente e metto i ${nuovi.length} del file, esattamente come sono.`, 'Sostituisci')) return;
        for (const s of vecchi) await salva('sito', s, true);
        for (const s of daMettere) await salva('sito', { id: nuovoId(), ...s });
        avviso(`Memoria siti: ${vecchi.length ? `tolti ${vecchi.length}, ` : ''}importati ${daMettere.length} (${nuovi.length - daMettere.length} già presenti, ${righe.length - nuovi.length} senza indirizzo o password). Cancella il file CSV: contiene le password in chiaro.`);
      }
    } else if (da === 'chrome') {
      const nuovi = importaCsvChrome(C.testo(dati), [...S.siti.values()].map((x) => x.dati));
      for (const s of nuovi) await salva('sito', { id: nuovoId(), ...s });
      avviso(`${nuovi.length} siti aggiunti a Memoria siti. Cancella il file CSV: contiene le password in chiaro.`);
    } else if (da === 'chrome-sostituisci') {
      // Memoria siti: le voci importate prima da Chrome avevano il sito tagliato (es. «192.168.1.10» al posto di
      // «http://192.168.1.10:3000/login»). Si tolgono quelle con lo stesso sito tagliato e nome utente di una riga del file
      // e si rimettono come nel file. Le altre restano.
      const nuovi = importaCsvChrome(C.testo(dati), []);
      const chiave = (sito, ut) => `${dominioVecchio(sito)}
${String(ut || '').toLowerCase()}`;
      const daFile = new Set(nuovi.map((n) => chiave(n.sito, n.utente)));
      const vecchi = [...S.siti.values()].map((x) => x.dati).filter((s) => daFile.has(chiave(s.sito, s.utente)));
      if (!await confermaDiGi(`Nel file ci sono ${nuovi.length} password. In Memoria siti ne tolgo ${vecchi.length} con lo stesso sito e nome utente e metto quelle del file, con l'indirizzo completo. Le altre ${S.siti.size - vecchi.length} restano.`, 'Sostituisci')) return;
      for (const s of vecchi) await salva('sito', s, true);
      for (const s of nuovi) await salva('sito', { id: nuovoId(), ...s });
      avviso(`Memoria siti: tolte ${vecchi.length}, importate ${nuovi.length}. Cancella il file CSV: contiene le password in chiaro.`);
    } else if (da === 'proton-sostituisci') {
      // Sostituisce le voci della Cassaforte che vengono da questo file (stesso tipo, titolo e nome utente), compresi
      // i cambi fatti dopo; le altre voci (create a mano) restano.
      const nuove = await importaProton(dati, f.name);
      const chiave = (v) => `${v.tipo}
${String(v.titolo || '').trim().toLowerCase()}
${String(v.campi?.utente || '').trim().toLowerCase()}`;
      const daFile = new Set(nuove.map(chiave));
      const vecchie = voci().filter((v) => daFile.has(chiave(v)));
      if (!await confermaDiGi(`Nel file ci sono ${nuove.length} voci. In Cassaforte ne tolgo ${vecchie.length} con lo stesso titolo e nome utente (anche se le hai cambiate dopo) e metto quelle del file, esattamente come sono. Le altre ${voci().length - vecchie.length} voci restano.`, 'Sostituisci')) return;
      for (const v of vecchie) { await togliAllegati(v.allegati); await salva('voce', v, true); }
      for (const v of nuove) await salva('voce', { id: nuovoId(), ...v });
      avviso(`Sostituite: tolte ${vecchie.length}, importate ${nuove.length}. Cancella il file di Proton: contiene le password in chiaro.`);
    } else {
      const nuove = await importaProton(dati, f.name);
      for (const v of nuove) await salva('voce', { id: nuovoId(), ...v });
      avviso(`${nuove.length} voci importate in Cassaforte. Cancella il file di Proton: contiene le password in chiaro.`);
    }
    disegnaApp();
  } catch (x) { avviso(x.message); }
}
function scarica(nome, blob) { const a = el('a', { href: URL.createObjectURL(blob), download: nome }); document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 5000); }
async function esportaCifrato() {
  const r = await chiedi('Esporta in un file cifrato', [['Passphrase per il file (almeno 12 caratteri)', 'password'], ['Ripeti la passphrase', 'password']], 'Esporta');
  if (!r) return;
  if (r[0].length < 12 || r[0] !== r[1]) return avviso('La passphrase deve avere almeno 12 caratteri ed essere uguale nei due campi');
  const sale = C.casuali(16), k = await C.chiaveDaPassword(r[0], sale, { m: 19456, t: 2, p: 1 });
  const dati = C.byte(JSON.stringify({ v: 1, voci: voci(), memoria: [...S.siti.values()].map((x) => x.dati) }));
  const file = { formato: 'digipass-export', v: 1, kdf: { alg: 'argon2id', m: 19456, t: 2, p: 1 }, sale: C.b64(sale), dati: C.b64(await C.cifra(k, dati, 'digipass-export')) };
  scarica(`DiGiPass-${new Date().toISOString().slice(0, 10)}.dpx`, new Blob([JSON.stringify(file)], { type: 'application/json' }));
}
async function esportaCsv() {
  if (!await confermaDiGi('Il CSV contiene tutte le password in chiaro. Chi apre il file le legge tutte. Continuare?')) return;
  scarica(`DiGiPass-${new Date().toISOString().slice(0, 10)}.csv`, new Blob([csvDaEsportare(voci().filter((v) => !v.cestino), [...S.siti.values()].map((x) => x.dati))], { type: 'text/csv' }));
}
async function ripristina(e) {
  const f = e.target.files[0]; e.target.value = '';
  if (!f) return;
  const r = await chiedi('Ripristinare il backup?', [['Password principale', 'password'], ['Codice Authenticator o di riserva']], 'Ripristina');
  if (!r) return;
  try {
    const { accesso } = await accessoDa(r[0]);
    const { grant } = await api('POST', '/api/backup/ripristino/autorizza', { password: accesso, code: r[1] });
    await api('POST', '/api/backup/ripristino', f, { headers: { 'X-Restore-Grant': grant, 'Content-Type': 'application/octet-stream' } });
    avviso('Backup ripristinato: il server si riavvia, poi rientra');
    setTimeout(() => location.reload(), 4000);
  } catch (x) { avviso(x.message); }
}

avvio();

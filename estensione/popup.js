// Finestra dell'estensione: apre la cassaforte con la password principale (Argon2id qui, la chiave dei dati al
// service worker) e mostra Cassaforte e Memoria siti. Niente viene mostrato alle pagine web.
import * as C from './cripto.js';

const $ = (s) => document.querySelector(s);
const vista = $('#vista');
const chiedi = (m) => chrome.runtime.sendMessage(m);
if (new URLSearchParams(location.search).has('grande')) document.body.classList.add('grande');
const COLORI = ['#2B6FD6', '#C7A008', '#1F8F5A', '#8A2BA8', '#D2453A', '#2E9E8F', '#E07A30', '#7A4FD0', '#C2417A'];

function el(tag, attr = {}, ...figli) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attr)) {
    if (v === undefined || v === null || v === false) continue;
    if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else if (k === 'style') e.style.cssText = v;
    else e.setAttribute(k, v === true ? '' : v);
  }
  for (const f of figli.flat(4)) if (f !== null && f !== undefined && f !== false) e.append(f instanceof Node ? f : document.createTextNode(String(f)));
  return e;
}
let tAvviso;
function avviso(t) { const a = $('#avviso'); a.textContent = t; a.hidden = false; clearTimeout(tAvviso); tAvviso = setTimeout(() => { a.hidden = true; }, 3000); }
// Iniziale colorata; se il sito ha un logo (preso dal proprio server, mai da servizi esterni) compare sopra appena arriva.
const loghi = new Map();
let iconeAccese = true;
chiedi({ a: 'stato' }).then((st) => { iconeAccese = st?.conf?.icone !== false; }).catch(() => {});
function dominio(s) {
  const t = String(s || '').trim().toLowerCase();
  if (!t || t.startsWith('android://')) return null;
  try { const u = new URL(/^[a-z][a-z0-9+.-]*:/.test(t) ? t : `https://${t}`); const d = u.hostname.replace(/^www\./, ''); return ['http:', 'https:'].includes(u.protocol) && d.includes('.') && !/^[\d.]+$/.test(d) && !d.includes(':') ? d : null; } catch { return null; }
}
function avatar(n, sito = null) {
  let h = 0; for (const c of n) h = (h * 31 + c.charCodeAt(0)) & 0x7fffffff;
  const av = el('span', { class: 'av', style: `background:${COLORI[h % COLORI.length]}` }, (n[0] || '?').toUpperCase());
  const d = iconeAccese ? dominio(sito) : null;
  if (d) {
    if (!loghi.has(d)) loghi.set(d, chiedi({ a: 'icona', dominio: d }).then((r) => r?.dati || null).catch(() => null));
    loghi.get(d).then((dati) => { if (dati) av.append(el('img', { class: 'logosito', alt: '', src: dati })); });
  }
  return av;
}
const copia = async (testo, segreto = true) => { await chiedi({ a: 'copia', testo, segreto }); avviso(segreto ? 'Copiato: si cancella fra 60 secondi' : 'Copiato'); };

async function avvio() {
  const st = await chiedi({ a: 'stato' });
  if (st.sbloccato) return principale();
  schermataSblocco(st);
}

function schermataSblocco(st) {
  const err = el('p', { class: 'errore' });
  // Nome utente come nella web app, già compilato e modificabile.
  const ut = el('input', { type: 'text', id: 'utente', autocomplete: 'username', value: st.conf.utente || 'admin' });
  const pw = el('input', { type: 'password', id: 'pw', autocomplete: 'current-password' });
  const cod = el('input', { type: 'text', id: 'codice', placeholder: '6 cifre o codice di riserva', autocomplete: 'one-time-code' });
  const ric = el('input', { type: 'checkbox', id: 'ricorda', checked: true });
  const vai = el('button', { class: 'btn', type: 'submit' }, 'Sblocca');
  const serveCodice = !st.sessione && st.codice !== false && !(!navigator.onLine && st.chiavi);
  vista.replaceChildren(el('form', { onsubmit: async (e) => {
    e.preventDefault(); err.textContent = ''; vai.disabled = true; vai.textContent = 'Apro…';
    try {
      // Online: parametri dal NAS; offline: quelli salvati sul PC (la chiave dei dati resta cifrata).
      const nome = ut.value.trim() || 'admin';
      if (nome !== st.conf.utente) { await chiedi({ a: 'conf', conf: { utente: nome } }); st.conf.utente = nome; }
      let pre = null;
      try { pre = await chiedi({ a: 'prelogin' }); if (pre.errore) throw new Error(pre.errore); } catch { pre = await chiedi({ a: 'chiaviSalvate' }); }
      if (!pre?.salePw) throw new Error('Il NAS non risponde e su questo PC non c\'è ancora una copia: collegati a internet.');
      const kek = await C.chiaveDaPassword(pw.value, C.deB64(pre.salePw), pre.kdf);
      if (serveCodice) {
        const r = await chiedi({ a: 'accedi', accesso: await C.chiaveAccesso(kek, C.deB64(pre.salePw)), codice: cod.value.trim(), ricorda: ric.checked });
        if (r.errore) throw new Error(r.errore);
      }
      const ch = await chiedi({ a: 'chiavi' });
      if (ch.errore) throw new Error(ch.stato === 401 ? 'Serve il codice di Authenticator' : ch.errore);
      let dek;
      try { dek = await C.decifra(kek, C.deB64(ch.dekPw)); } catch { throw new Error('Password principale sbagliata'); }
      const r = await chiedi({ a: 'apri', dek: C.b64(dek), accesso: await C.chiaveAccesso(kek, C.deB64(pre.salePw)) });
      if (r.sync && !r.sync.ok) avviso(r.sync.errore);
      principale();
    } catch (x) { err.textContent = x.message; vai.disabled = false; vai.textContent = 'Sblocca'; }
  } },
  el('div', { class: 'etichetta' }, 'Cassaforte bloccata'),
  el('label', { class: 'campo' }, el('span', { class: 'piccola' }, 'Nome utente'), ut),
  el('label', { class: 'campo' }, el('span', { class: 'piccola' }, 'Password principale'), pw),
  serveCodice ? [el('label', { class: 'campo' }, el('span', { class: 'piccola' }, 'Codice Google Authenticator'), cod),
    el('label', { class: 'spunta' }, ric, 'Ricorda questo browser per 90 giorni')] : null,
  vai, err,
  el('button', { class: 'btn2', type: 'button', onclick: impostazioni }, `NAS: ${st.conf.url.replace('https://', '')} · ${st.conf.utente}`)));
  vista.firstChild.style.cssText = 'display:flex;flex-direction:column;gap:10px';
  pw.focus();
}

function impostazioni() {
  chiedi({ a: 'stato' }).then((st) => {
    const c = st.conf, g = { l: 20, mai: true, num: true, sim: true, ...(c.gen || {}) }, k = { login: true, identita: true, carte: true, totp: true, ...(c.compila || {}) };
    const url = el('input', { type: 'url', value: c.url }), ut = el('input', { type: 'text', value: c.utente });
    // Appunti (CHECKLIST 10.15): mai, 60 o 180 secondi, oppure minuti scelti a mano.
    const sec = Number(c.appuntiSecondi ?? 60);
    const app = el('select', {}, [['0', 'Mai'], ['60', 'Dopo 60 secondi'], ['180', 'Dopo 180 secondi'], ['min', 'Dopo un numero di minuti']].map(([v, t]) =>
      el('option', { value: v, selected: v === (['0', '60', '180'].includes(String(sec)) ? String(sec) : 'min') }, t)));
    const minuti = el('input', { type: 'number', min: 1, max: 600, value: ['0', '60', '180'].includes(String(sec)) ? 5 : Math.round(sec / 60) });
    const zonaMin = el('label', { class: 'campo' }, el('span', { class: 'piccola' }, 'Minuti'), minuti);
    zonaMin.hidden = app.value !== 'min';
    app.addEventListener('change', () => { zonaMin.hidden = app.value !== 'min'; });
    const spunta = (testo, si) => { const i = el('input', { type: 'checkbox' }); i.checked = si; return [i, el('label', { class: 'spunta' }, i, testo)]; };
    const lung = el('input', { type: 'number', min: 8, max: 64, value: g.l });
    const [gMai, lMai] = spunta('Maiuscole', g.mai), [gNum, lNum] = spunta('Numeri', g.num), [gSim, lSim] = spunta('Simboli', g.sim);
    const [kLog, lLog] = spunta('Login', k.login), [kId, lId] = spunta('Identità', k.identita), [kCar, lCar] = spunta('Carte', k.carte), [kTot, lTot] = spunta('Codici 2FA', k.totp);
    const [cTot, lCTot] = spunta('Copia il codice 2FA dopo aver compilato un login', c.copiaTotp !== false);
    const [ico, lIco] = spunta('Icone dei siti', c.icone !== false);
    vista.replaceChildren(el('div', { class: 'etichetta' }, 'Impostazioni'),
      el('label', { class: 'campo' }, el('span', { class: 'piccola' }, 'Indirizzo del server (https://…)'), url),
      el('label', { class: 'campo' }, el('span', { class: 'piccola' }, 'Nome utente'), ut),
      el('label', { class: 'campo' }, el('span', { class: 'piccola' }, 'Svuota gli appunti dopo una copia di password o codici'), app), zonaMin,
      el('div', { class: 'piccola' }, 'Compila nelle pagine'), lLog, lId, lCar, lTot, lCTot,
      el('label', { class: 'campo' }, el('span', { class: 'piccola' }, 'Password generate: lunghezza'), lung), lMai, lNum, lSim,
      lIco,
      el('button', { class: 'btn', onclick: async () => {
        await chiedi({ a: 'conf', conf: {
          url: url.value.trim().replace(/\/+$/, ''), utente: ut.value.trim(),
          appuntiSecondi: app.value === 'min' ? Math.max(1, +minuti.value || 5) * 60 : +app.value,
          gen: { l: Math.min(64, Math.max(8, +lung.value || 20)), mai: gMai.checked, num: gNum.checked, sim: gSim.checked },
          compila: { login: kLog.checked, identita: kId.checked, carte: kCar.checked, totp: kTot.checked },
          copiaTotp: cTot.checked, icone: ico.checked,
        } });
        avviso('Salvato'); avvio();
      } }, 'Salva'),
      el('button', { class: 'btn2', onclick: avvio }, 'Indietro'),
      el('button', { class: 'btn2', onclick: async () => { await chiedi({ a: 'esci' }); avviso('Uscito: dati tolti da questo PC'); avvio(); } }, 'Esci da questo browser'));
  });
}

let scheda = 'cassaforte', cerca = '';
// Ordinamento: A-Z, Z-A, più recenti, più vecchi; ricordato. Le voci del sito aperto restano in cima.
const ORDINI = [['recenti', 'Più recenti'], ['nuovi', 'Dal più nuovo'], ['vecchi', 'Dal più vecchio'], ['az', 'Titolo A-Z'], ['za', 'Titolo Z-A']];
function ordine() { try { return localStorage.getItem('digipass-ordine') || 'az'; } catch { return 'az'; } }
function confronta(nome) {
  const o = ordine(), data = (x) => x.modificata || x.creata || 0, nascita = (x) => x.creata || x.modificata || 0, alfa = (a, b) => String(nome(a) || '').localeCompare(String(nome(b) || ''), 'it');
  return o === 'za' ? (a, b) => alfa(b, a) : o === 'recenti' ? (a, b) => data(b) - data(a) || alfa(a, b)
    : o === 'nuovi' ? (a, b) => nascita(b) - nascita(a) || alfa(a, b) : o === 'vecchi' ? (a, b) => nascita(a) - nascita(b) || alfa(a, b) : alfa;
}
async function principale() {
  const el_ = await chiedi({ a: 'elenco' });
  if (el_.bloccato) return avvio();
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  let host = '';
  try { host = new URL(tab?.url || '').hostname.replace(/^www\./, ''); } catch { /* scheda senza sito */ }
  const voci = el_.voci.filter((v) => !v.cestino), siti = el_.siti;
  const corr = (s) => { const d = String(s).toLowerCase().replace(/^[a-z]+:\/\//, '').split('/')[0].replace(/^www\./, ''); return host && (d === host || host.endsWith(`.${d}`)); };
  // Scrivendo nel Cerca si ridisegna solo l'elenco: il campo resta lo stesso, con cursore e focus.
  const zona = el('div');
  function disegnaElenco() {
    const q = cerca.toLowerCase();
    const lista = el('div', { class: 'elenco' });
    const righe = scheda === 'cassaforte'
      ? voci.filter((v) => !q || `${v.titolo} ${(v.siti || []).join(' ')} ${v.campi?.utente || ''}`.toLowerCase().includes(q))
        .sort(confronta((v) => v.titolo)) /* l'ordine scelto vale su tutto l'elenco */
        .map((v) => el('button', { class: 'riga voce', onclick: () => dettaglio('voce', v) }, avatar(v.titolo || '?', (v.siti || [])[0]), el('span', { class: 't' }, el('b', {}, v.titolo), el('span', {}, [(v.siti || []).some(corr) ? 'Questo sito' : '', v.campi?.utente || v.tipo].filter(Boolean).join(' · ')))))
      : siti.filter((s) => !q || `${s.sito} ${s.utente}`.toLowerCase().includes(q))
        .sort(confronta((x) => nomeSito(x))) /* come la web app: sul nome mostrato */
        .map((s) => el('button', { class: 'riga', onclick: () => dettaglio('sito', s) }, avatar(nomeSito(s), s.sito), el('span', { class: 't' }, el('b', {}, nomeSito(s)), el('span', {}, [corr(s.sito) ? 'Questo sito' : '', s.utente || 'senza nome utente'].filter(Boolean).join(' · ')))));
    lista.append(...righe);
    zona.replaceChildren(righe.length ? lista : el('div', { class: 'vuoto' }, 'Niente da mostrare'));
  }
  // X dentro il campo, visibile solo con del testo: svuota e rimette l'elenco completo.
  const inp = el('input', { class: 'cerca', placeholder: 'Cerca', value: cerca });
  const x = el('button', { type: 'button', class: 'cercax', title: 'Cancella' }, '×');
  const mostraX = () => { x.hidden = !inp.value; };
  inp.addEventListener('input', () => { cerca = inp.value; mostraX(); disegnaElenco(); });
  x.addEventListener('click', () => { inp.value = ''; cerca = ''; mostraX(); disegnaElenco(); inp.focus(); });
  mostraX(); disegnaElenco();
  const ord = el('select', { class: 'ordina', 'aria-label': 'Ordina', onchange: (e) => { try { localStorage.setItem('digipass-ordine', e.target.value); } catch { /* solo per ora */ } disegnaElenco(); } },
    ORDINI.map(([k, t]) => el('option', { value: k, selected: ordine() === k }, t)));
  const ricerca = el('div', { class: 'rigaricerca' }, el('div', { class: 'cercabox' }, inp, x), ord);
  vista.replaceChildren(
    el('div', { class: 'seg' }, el('button', { class: scheda === 'cassaforte' ? 'on' : '', onclick: () => { scheda = 'cassaforte'; principale(); } }, 'Cassaforte'), el('button', { class: scheda === 'memoria' ? 'on' : '', onclick: () => { scheda = 'memoria'; principale(); } }, 'Memoria siti')),
    ricerca,
    zona,
    el('div', { style: 'display:flex;gap:8px' },
      el('button', { class: 'btn2', style: 'flex:1', onclick: generatore }, 'Genera password'),
      el('button', { class: 'btn2', style: 'flex:1', onclick: async () => { const r = await chiedi({ a: 'sincronizza' }); avviso(r.ok ? 'Sincronizzato' : r.errore); principale(); } }, 'Sincronizza')),
    el('button', { class: 'btn2', onclick: impostazioni }, 'Impostazioni'));
}

// Nome mostrato in Memoria siti: per le app Android il nome del CSV o il pacchetto, mai l'hash (12.11.2026).
function nomeSito(s) {
  const sito = String(s?.sito || '');
  if (!sito.toLowerCase().startsWith('android://')) return sito;
  return String(s?.nome || '').trim() || `app: ${sito.slice(10).split('@').pop().split('/')[0]}`;
}
function urlSito(s) {
  const t = String(s || '').trim();
  if (!t || /^android:\/\//i.test(t)) return null;
  try { const u = new URL(/^[a-z][a-z0-9+.-]*:/i.test(t) ? t : `https://${t}`); return ['http:', 'https:'].includes(u.protocol) ? u.href : null; } catch { return null; }
}
function dato(et, val, segreto, link = null) {
  let vedi = !segreto;
  const v = el('div', { class: 'val' }, link ? el('a', { href: link, style: 'color:inherit;text-decoration:underline', onclick: (e) => { e.preventDefault(); chrome.tabs.create({ url: link }); } }, val) : (vedi ? val : '•'.repeat(12)));
  return el('div', { class: 'dato' }, el('div', { class: 'v' }, el('div', { class: 'piccola' }, et), v),
    segreto ? el('button', { class: 'btn2', onclick: () => { vedi = !vedi; v.textContent = vedi ? val : '•'.repeat(12); } }, 'Mostra') : null,
    el('button', { class: 'btn2', onclick: () => copia(val, segreto) }, 'Copia'));
}
// Etichette dei campi come nell'app e nella web app; i segreti restano nascosti finché non si preme Mostra.
const ETICHETTE = {
  login: [['email', 'Email'], ['utente', 'Nome utente o email'], ['password', 'Password', 1]],
  carta: [['titolare', 'Titolare'], ['numero', 'Numero', 1], ['scadenza', 'Scadenza'], ['cvv', 'CVV', 1], ['pin', 'PIN', 1]],
  wifi: [['ssid', 'Nome rete'], ['password', 'Password', 1], ['sicurezza', 'Sicurezza']],
  identita: [['nome', 'Nome'], ['secondoNome', 'Secondo nome'], ['cognome', 'Cognome'], ['nomeCompleto', 'Nome completo'], ['nascita', 'Data di nascita'], ['sesso', 'Sesso'], ['email', 'Email'], ['telefono', 'Telefono'],
    ['indirizzo', 'Via e numero'], ['piano', 'Piano'], ['cap', 'CAP'], ['citta', 'Città'], ['provincia', 'Provincia o stato'], ['contea', 'Contea'], ['paese', 'Paese'], ['organizzazione', 'Organizzazione'],
    ['telefono2', 'Secondo telefono'], ['sito', 'Sito'], ['patente', 'N° patente'], ['documento', 'Documento', 1], ['previdenza', 'N° previdenza sociale (AVS)', 1],
    ['linkedin', 'LinkedIn'], ['x', 'X'], ['facebook', 'Facebook'], ['instagram', 'Instagram'], ['reddit', 'Reddit'], ['yahoo', 'Yahoo'],
    ['azienda', 'Azienda'], ['ruolo', 'Ruolo'], ['emailLavoro', 'Email di lavoro'], ['telefonoLavoro', 'Telefono di lavoro'], ['sitoPersonale', 'Sito personale']],
};
function campiVoce(v) {
  const c = v.campi || {};
  return (ETICHETTE[v.tipo] || []).filter(([k]) => c[k]).map(([k, et, seg]) => dato(v.tipo === 'login' && k === 'utente' && c.email ? 'Nome utente' : et, String(c[k]), Boolean(seg)));
}
const tExtra = [];
function totpExtra(e) {
  const val = el('div', { class: 'val', style: 'font-size:22px;font-weight:800;letter-spacing:2px' }, '…');
  const agg = async () => { const r = await chiedi({ a: 'totp', segreto: e.valore }); if (r.codice) val.textContent = r.codice; };
  agg(); tExtra.push(setInterval(agg, 5000));
  return el('div', { class: 'dato' }, el('div', { class: 'v' }, el('div', { class: 'piccola' }, e.nome || 'Codice 2FA'), val),
    el('button', { class: 'btn2', onclick: async () => copia((await chiedi({ a: 'totp', segreto: e.valore })).codice) }, 'Copia'));
}
let tTotp;
// Posizione dell'elenco: tornando indietro dalla scheda l'elenco resta dov'era.
let posElenco = 0;
function dettaglio(tipo, x) {
  clearInterval(tTotp);
  while (tExtra.length) clearInterval(tExtra.pop());
  posElenco = window.scrollY; window.scrollTo(0, 0);
  const c = x.campi || {};
  const tot = tipo === 'voce' && x.totp ? el('div', { class: 'dato' }, el('div', { class: 'v' }, el('div', { class: 'piccola' }, 'Codice 2FA'), el('div', { class: 'val', style: 'font-size:22px;font-weight:800;letter-spacing:2px' }, '…')),
    el('button', { class: 'btn2', onclick: async () => copia((await chiedi({ a: 'totp', segreto: x.totp })).codice) }, 'Copia')) : null;
  if (tot) { const agg = async () => { const r = await chiedi({ a: 'totp', segreto: x.totp }); if (r.codice) tot.querySelector('.val').textContent = r.codice; }; agg(); tTotp = setInterval(agg, 5000); }
  vista.replaceChildren(
    el('button', { class: 'btn2', onclick: async () => { clearInterval(tTotp); while (tExtra.length) clearInterval(tExtra.pop()); await principale(); window.scrollTo(0, posElenco); } }, '‹ Indietro'),
    el('div', { class: 'etichetta titolovoce' }, tipo === 'voce' ? x.titolo : nomeSito(x)),
    // Gli elenchi vanno sparsi: replaceChildren non accetta array (mostrava «[object HTMLDivElement],…»).
    ...(tipo === 'voce' ? [...campiVoce(x), tot,
      ...(x.siti || []).filter((s) => !/^android:\/\//i.test(s)).map((s) => dato('Sito', s, false, urlSito(s))),
      ...(x.siti || []).filter((s) => /^android:\/\//i.test(s)).map((s) => dato('App collegata', s.slice(10), false)),
      ...(x.extra || []).filter((e) => e.valore).map((e) => (e.tipo === 'totp' ? totpExtra(e) : dato(e.nome || 'Campo', e.valore, e.tipo === 'nascosto'))),
      x.note ? dato('Note', x.note, false) : null, ...allegati(x)]
      : [dato('Nome utente', x.utente || '', false), dato('Password', x.password || '', true),
        el('button', { class: 'btn', onclick: async () => { await chiedi({ a: 'mettiInCassaforte', id: x.id }); avviso('Messo in cassaforte'); scheda = 'cassaforte'; principale(); } }, 'Metti in cassaforte')]).filter(Boolean));
}

// Allegati della voce (CHECKLIST 1.11): elenco e «Scarica»; si aggiungono dall'app o dalla web app.
const misura = (n) => (n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : n > 0 ? `${Math.max(1, Math.round(n / 1024))} KB` : '0 KB');
function allegati(x) {
  const lista = x.allegati || [];
  if (!lista.length) return [];
  return [el('div', { class: 'piccola', style: 'margin-top:8px' }, `Allegati · ${lista.length}`),
    ...lista.map((a) => el('div', { class: 'dato' }, el('div', { class: 'v' }, el('div', { class: 'piccola' }, misura(a.dimensione || 0)), el('div', { class: 'val' }, a.nome || 'allegato')),
      el('button', { class: 'btn2', onclick: async (e) => {
        const b = e.currentTarget; b.disabled = true; b.textContent = '…';
        try {
          const r = await chiedi({ a: 'allegato', id: a.id });
          if (!r || r.errore) throw new Error(r?.errore || 'Allegato non scaricato');
          const byte = Uint8Array.from(atob(r.b64), (ch) => ch.charCodeAt(0));
          const link = el('a', { href: URL.createObjectURL(new Blob([byte], { type: a.tipo || 'application/octet-stream' })), download: a.nome || 'allegato' });
          document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(link.href), 5000);
        } catch (err) { avviso(err.message); }
        b.disabled = false; b.textContent = 'Scarica';
      } }, 'Scarica')))];
}

function generatore() {
  const out = el('div', { class: 'gen' });
  const nuova = async () => { out.textContent = (await chiedi({ a: 'genera' })).password; };
  vista.replaceChildren(el('div', { class: 'etichetta' }, 'Genera password'), out,
    el('div', { style: 'display:flex;gap:8px' }, el('button', { class: 'btn2', style: 'flex:1', onclick: nuova }, 'Un\'altra'), el('button', { class: 'btn', style: 'flex:1', onclick: () => copia(out.textContent) }, 'Copia')),
    el('button', { class: 'btn2', onclick: principale }, '‹ Indietro'));
  nuova();
}

avvio();

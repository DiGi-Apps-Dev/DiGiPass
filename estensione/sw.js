// Cuore dell'estensione DiGiPass (service worker, Manifest V3).
// Tiene la chiave dei dati solo in chrome.storage.session (in memoria, mai su disco) e le voci decifrate solo qui.
// Le pagine web non ricevono mai l'elenco: chiedono i login del LORO sito e la password di UNA voce del loro sito.
import * as C from './cripto.js';

// appuntiSecondi: CHECKLIST 10.15 (0 = mai). gen: generatore (3.1). compila: autocompilazione per tipo (10.4). copiaTotp: 10.5.
const PREDEFINITO = { url: '', utente: 'admin', bloccoMinuti: 15, appuntiSecondi: 60,
  gen: { l: 20, mai: true, num: true, sim: true }, compila: { login: true, identita: true, carte: true, totp: true }, copiaTotp: true, icone: true };
const S = { dek: null, voci: new Map(), siti: new Map(), caricato: false };
// Login appena salvati, per mostrare «Metti in cassaforte» anche dopo che la pagina è cambiata (per scheda, 2 minuti).
const inSospeso = {
  async get(tab) { const { sospesi = {} } = await chrome.storage.session.get('sospesi'); return sospesi[tab]; },
  async set(tab, p) { const { sospesi = {} } = await chrome.storage.session.get('sospesi'); sospesi[tab] = p; await chrome.storage.session.set({ sospesi }); },
  async delete(tab) { const { sospesi = {} } = await chrome.storage.session.get('sospesi'); delete sospesi[tab]; await chrome.storage.session.set({ sospesi }); },
};
// Login in due pagine (AWS, Google…): il nome utente scritto nella prima pagina, per scheda, 10 minuti (13.11.2026).
const passo1 = {
  async get(tab) { const { passi1 = {} } = await chrome.storage.session.get('passi1'); return passi1[tab]; },
  async set(tab, p) { const { passi1 = {} } = await chrome.storage.session.get('passi1'); passi1[tab] = p; await chrome.storage.session.set({ passi1 }); },
};
// Salvataggi chiesti mentre DiGiPass era bloccato o il NAS non rispondeva: restano qui finché non riescono.
async function eseguiConferma(p, scelta, nome) {
  const base = p.sito.replace(/^[a-z]+:\/\//i, '').split('.')[0] || 'Sito';
  const titolo = (nome || '').trim() || base[0].toUpperCase() + base.slice(1);
  if (scelta === 'cassaforte') {
    if (p.tipo === 'cassaforte' && S.voci.get(p.idEsistente)) {
      const v = S.voci.get(p.idEsistente).dati;
      await scrivi('voce', { ...v, campi: { ...(v.campi || {}), password: p.password } });
    } else {
      await scrivi('voce', { id: nuovoId(), tipo: 'login', titolo, cartella: '', fissata: false, campi: { utente: p.utente, password: p.password }, siti: [p.sito], note: '', totp: '', cestino: null, extra: [] });
    }
    return 'Cassaforte';
  }
  if (p.tipo === 'memoria' && S.siti.get(p.idEsistente)) {
    const x = S.siti.get(p.idEsistente).dati;
    // una voce salvata «senza nome utente» prende il nome utente appena lo si conosce
    await scrivi('sito', { ...x, utente: x.utente || p.utente || '', password: p.password });
  } else {
    await scrivi('sito', { id: nuovoId(), sito: p.sito, utente: p.utente, password: p.password });
  }
  return 'Memoria siti';
}
async function salvaInAttesa() {
  const { attesa = [] } = await chrome.storage.local.get('attesa');
  const resto = [];
  for (const x of attesa) { try { await eseguiConferma(x.p, x.scelta, x.nome); } catch { resto.push(x); } }
  await chrome.storage.local.set({ attesa: resto });
}

// ---------- impostazioni e cache cifrata ----------
async function conf() {
  const c = { ...PREDEFINITO, ...(await chrome.storage.local.get('conf')).conf };
  return { ...c, gen: { ...PREDEFINITO.gen, ...c.gen }, compila: { ...PREDEFINITO.compila, ...c.compila } };
}
async function cache() { return (await chrome.storage.local.get('cache')).cache || { rev: 0, voci: {}, chiavi: null }; }
async function salvaCache(c) { await chrome.storage.local.set({ cache: c }); }

// Blocco automatico MAI: l'estensione resta sbloccata anche chiudendo Chrome e riavviando il PC,
// e non si blocca mai: niente pulsante «Blocca» (tolto nella 0.3.21: «l'estensione deve andare sempre»);
// si ferma solo con «Esci» o disattivandola. La chiave dei dati si conserva sul PC in chrome.storage.local, cifrata con una
// chiave AES-GCM NON estraibile tenuta in IndexedDB (lo script non la può leggere né esportare). Protezione: pari al
// profilo Chrome dell'utente Windows; chi usa quell'utente può aprire la cassaforte (scelta voluta).
function dbLocale() {
  return new Promise((ok, ko) => { const r = indexedDB.open('digipass', 1); r.onupgradeneeded = () => r.result.createObjectStore('chiavi'); r.onsuccess = () => ok(r.result); r.onerror = () => ko(r.error); });
}
async function chiaveLocale() {
  const db = await dbLocale();
  const leggi = () => new Promise((ok) => { const q = db.transaction('chiavi').objectStore('chiavi').get('locale'); q.onsuccess = () => ok(q.result); q.onerror = () => ok(null); });
  let k = await leggi();
  if (!k) {
    k = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
    await new Promise((ok, ko) => { const t = db.transaction('chiavi', 'readwrite'); t.objectStore('chiavi').put(k, 'locale'); t.oncomplete = ok; t.onerror = () => ko(t.error); });
  }
  return k;
}
async function conservaChiave(dek) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await chiaveLocale(), dek));
  await chrome.storage.local.set({ dekLocale: { iv: C.b64(iv), ct: C.b64(ct) } });
}
async function conservaAccesso(accesso) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await chiaveLocale(), new TextEncoder().encode(accesso)));
  await chrome.storage.local.set({ accessoLocale: { iv: C.b64(iv), ct: C.b64(ct) } });
}
async function accessoConservato() {
  const { accessoLocale } = await chrome.storage.local.get('accessoLocale');
  if (!accessoLocale) return null;
  try { return new TextDecoder().decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: C.deB64(accessoLocale.iv) }, await chiaveLocale(), C.deB64(accessoLocale.ct))); } catch { return null; }
}
async function chiaveConservata() {
  const { dekLocale } = await chrome.storage.local.get('dekLocale');
  if (!dekLocale) return null;
  try { return new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: C.deB64(dekLocale.iv) }, await chiaveLocale(), C.deB64(dekLocale.ct))); } catch { return null; }
}
async function chiave() {
  if (S.dek) return S.dek;
  const { dek } = await chrome.storage.session.get('dek');
  if (dek) { S.dek = C.deB64(dek); return S.dek; }
  const conservata = await chiaveConservata();
  if (!conservata) return null;
  S.dek = conservata;
  await chrome.storage.session.set({ dek: C.b64(conservata) });
  return S.dek;
}
async function apriCon(dek) {
  S.dek = dek;
  await chrome.storage.session.set({ dek: C.b64(dek) });
  await conservaChiave(dek);
  await decifraCache();
}
async function blocca() {
  S.dek = null; S.voci.clear(); S.siti.clear(); S.caricato = false;
  await chrome.storage.session.remove('dek');
  await chrome.storage.local.remove(['dekLocale', 'accessoLocale']);
  await chrome.alarms.clear('blocco');
}
async function rinnovaBlocco() { /* blocco automatico tolto: non si blocca mai */ }

async function decifraCache() {
  const dek = await chiave();
  if (!dek) return false;
  const c = await cache();
  S.voci.clear(); S.siti.clear();
  for (const [id, v] of Object.entries(c.voci)) {
    if (v.cancellata) continue;
    try { (v.tipo === 'voce' ? S.voci : S.siti).set(id, { versione: v.versione, dati: await C.decifraVoce(dek, id, v.blob) }); } catch { /* voce di un'altra chiave */ }
  }
  S.caricato = true;
  return true;
}
async function pronto() {
  if (!(await chiave())) return false;
  if (!S.caricato) await decifraCache();
  return true;
}

// ---------- server ----------
// Se la sessione col NAS è scaduta (es. dopo la chiusura di Chrome) si rientra da soli con la chiave di accesso conservata:
// il browser è un dispositivo ricordato, quindi il codice Authenticator non serve.
async function api(metodo, percorso, corpo, giaRiprovato = false) {
  try { return await apiUnaVolta(metodo, percorso, corpo); } catch (e) {
    // 403 = sessione valida ma codice anti-CSRF vecchio (la sessione è cambiata, es. accesso dalla web app o riavvio di
    // Chrome): si riprende il codice dal NAS e si riprova una volta («Non salvato… Sessione non valida»).
    if (e.status === 403 && !giaRiprovato) {
      const me = await apiUnaVolta('GET', '/api/auth/me').catch(() => null);
      if (me?.csrf) { await chrome.storage.session.set({ csrf: me.csrf }); return api(metodo, percorso, corpo, true); }
    }
    if (e.status !== 401 || giaRiprovato || percorso.startsWith('/api/auth/')) throw e;
    const accesso = await accessoConservato();
    if (!accesso) throw e;
    const r = await apiUnaVolta('POST', '/api/auth/login', { username: (await conf()).utente, password: accesso, code: '', remember: false });
    await chrome.storage.session.set({ csrf: r.csrf });
    return api(metodo, percorso, corpo, true);
  }
}
async function apiUnaVolta(metodo, percorso, corpo) {
  const { url } = await conf();
  const { csrf } = await chrome.storage.session.get('csrf');
  const r = await fetch(url + percorso, {
    method: metodo, credentials: 'include',
    headers: { ...(corpo ? { 'Content-Type': 'application/json' } : {}), ...(csrf ? { 'X-CSRF-Token': csrf } : {}) },
    body: corpo ? JSON.stringify(corpo) : undefined,
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(j.error || `Errore ${r.status}`), { status: r.status, dati: j });
  return j;
}
async function sessione() {
  try { const me = await api('GET', '/api/auth/me'); await chrome.storage.session.set({ csrf: me.csrf }); return true; } catch { return false; }
}

// Prima di mostrare l'elenco si riallinea col NAS se l'ultima volta è di più di 15 secondi fa (
// le voci eliminate dalla web app restavano nella tendina fino al prossimo sblocco).
let ultimaSync = 0;
async function aggiornaSeVecchio() { if (Date.now() - ultimaSync > 15000) { try { await sincronizza(); } catch { /* resta la copia */ } } }
async function sincronizza() {
  const dek = await chiave();
  if (!dek) return { ok: false };
  const c = await cache();
  try {
    for (;;) {
      const r = await api('GET', `/api/sync?da=${c.rev}`);
      for (const v of r.voci) c.voci[v.id] = { tipo: v.tipo, versione: v.versione, cancellata: v.cancellata, blob: v.blob };
      c.rev = Math.max(c.rev, r.rev);
      if (r.completo) break;
    }
    try { const ch = await api('GET', '/api/chiavi'); c.chiavi = ch; } catch { /* resta quella in cache */ }
    await salvaCache(c);
    await decifraCache();
    ultimaSync = Date.now();
    return { ok: true };
  } catch (e) {
    return { ok: false, errore: e.status === 401 ? 'Accedi di nuovo' : e.status ? `Il NAS ha risposto: ${e.message}. Lavoro con la copia salvata` : 'NAS non raggiungibile: lavoro con la copia salvata' };
  }
}

async function scrivi(tipo, dati, cancellata = false) {
  const dek = await chiave();
  const mappa = tipo === 'voce' ? S.voci : S.siti;
  dati.modificata = Date.now(); dati.creata ??= dati.modificata;
  const base = mappa.get(dati.id)?.versione ?? 0;
  const blob = cancellata ? '' : await C.cifraVoce(dek, dati.id, dati);
  try {
    const r = await api('PUT', `/api/sync/${dati.id}`, { tipo, base, blob, cancellata });
    const c = await cache();
    c.voci[dati.id] = { tipo, versione: r.versione, cancellata, blob };
    await salvaCache(c);
    if (cancellata) mappa.delete(dati.id); else mappa.set(dati.id, { versione: r.versione, dati });
  } catch (e) {
    if (e.status !== 409) throw e;
    const a = e.dati.attuale;
    const loro = a.cancellata ? null : await C.decifraVoce(dek, a.id, a.blob);
    if (loro && (loro.modificata || 0) > dati.modificata) { mappa.set(a.id, { versione: a.versione, dati: loro }); return; }
    mappa.set(dati.id, { versione: a.versione, dati: loro || dati });
    return scrivi(tipo, dati, cancellata);
  }
}

// ---------- confronto dei siti ----------
export function dominio(url) {
  try {
    const u = new URL(url);
    return u.hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return String(url || '').toLowerCase().replace(/^[a-z]+:\/\//, '').split('/')[0].split(':')[0].replace(/^www\./, '');
  }
}
// Porta di un indirizzo (solo per gli indirizzi numerici e localhost, dove ogni porta è un'app diversa).
const conIp = (h) => /^\d{1,3}(\.\d{1,3}){3}$/.test(h) || h === 'localhost';
function porta(url) { try { const u = new URL(url.includes('://') ? url : `http://${url}`); return u.port || ''; } catch { return ''; } }
let portaPagina = '';
// Pagina di accesso di DiGiPass stesso («l'ho salvato nella cassaforte, devi farmela vedere»): la voce della
// chiave master va proposta anche se il suo indirizzo è un altro (dominio cambiato). Vale solo sull'indirizzo della web app,
// e solo per voci con «DiGiPass» nel nome o nell'indirizzo (0.3.36 prendeva anche Masterclass e Mastercard:).
let hostProprio = '';
const vaPerDiGiPass = (v, host) => Boolean(host) && host === hostProprio
  && (/digipass/i.test(v.titolo || '') || (v.siti || []).some((s) => /digipass/i.test(s)));
const voceDelLuogo = (v, host) => (v.siti || []).some((s) => corrisponde(s, host)) || vaPerDiGiPass(v, host);
export function corrisponde(salvato, host) {
  const s = String(salvato || '').toLowerCase().trim();
  if (!s || s.startsWith('android://') || !host) return false;
  const d = dominio(s.includes('://') ? s : `https://${s}`);
  // App sul NAS (192.168.1.10:3000, :8095…): come Chrome conta anche la porta, esatta (altrimenti
  // comparivano i login di tutte le app dello stesso server). Una voce senza porta vale solo per l'indirizzo senza porta.
  if (conIp(host)) return d === host && porta(s) === portaPagina;
  return d === host || host.endsWith(`.${d}`) || d.endsWith(`.${host}`);
}
function suggerimenti(host) {
  const out = [];
  for (const { dati: v } of S.voci.values()) {
    if (v.tipo !== 'login' || v.cestino) continue;
    if (voceDelLuogo(v, host)) out.push({ id: v.id, fonte: 'Cassaforte', titolo: v.titolo, utente: v.campi?.utente || v.campi?.email || '' });
  }
  for (const { dati: s } of S.siti.values()) {
    if (!corrisponde(s.sito, host)) continue;
    if (out.some((o) => o.utente === s.utente)) continue;
    out.push({ id: s.id, fonte: 'Memoria siti', titolo: s.sito, utente: s.utente || '' });
  }
  return out.slice(0, 10);
}
/** Tipo della carta dal numero, solo per mostrarlo nella tendina. */
function tipoCarta(n) {
  const p2 = +n.slice(0, 2), p3 = +n.slice(0, 3), p4 = +n.slice(0, 4);
  if (n[0] === '4') return 'Visa';
  if ((p2 >= 51 && p2 <= 55) || (p4 >= 2221 && p4 <= 2720)) return 'Mastercard';
  if (p2 === 34 || p2 === 37) return 'Amex';
  if (p4 === 6011 || p2 === 65 || (p3 >= 644 && p3 <= 649)) return 'Discover';
  if (p4 >= 3528 && p4 <= 3589) return 'JCB';
  if (p2 === 36 || p2 === 38 || (p3 >= 300 && p3 <= 305)) return 'Diners';
  if (p2 === 62) return 'UnionPay';
  if (p2 === 50 || (p2 >= 56 && p2 <= 69)) return 'Maestro';
  return 'Carta';
}
function voceDelSito(id, host) {
  const v = S.voci.get(id)?.dati;
  if (v && v.tipo === 'login' && voceDelLuogo(v, host)) return { utente: v.campi?.utente || v.campi?.email || '', password: v.campi?.password || '', totp: v.totp || '' };
  const s = S.siti.get(id)?.dati;
  if (s && corrisponde(s.sito, host)) return { utente: s.utente || '', password: s.password || '', totp: '' };
  return null;
}

// ---------- appunti (documento fuori schermo) ----------
async function copia(testo, segreto = true) {
  if (!(await chrome.offscreen.hasDocument?.())) {
    await chrome.offscreen.createDocument({ url: 'offscreen.html', reasons: ['CLIPBOARD'], justification: 'Copiare e svuotare gli appunti' });
  }
  const s = Number((await conf()).appuntiSecondi ?? 60);
  await chrome.runtime.sendMessage({ a: 'appunti', testo, ms: segreto && s > 0 ? s * 1000 : 0 });
}

// ---------- codice 2FA ----------
function base32(s) {
  const a = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'; let bits = 0, val = 0; const out = [];
  for (const ch of String(s).toUpperCase().replace(/[\s=-]/g, '')) { const i = a.indexOf(ch); if (i < 0) throw new Error('2FA'); val = (val << 5) | i; bits += 5; if (bits >= 8) { out.push((val >>> (bits - 8)) & 255); bits -= 8; } }
  return new Uint8Array(out);
}
export async function codiceTotp(t) {
  let segreto, cifre = 6, periodo = 30, alg = 'SHA-1';
  if (/^otpauth:/i.test(t)) { const p = new URL(t).searchParams; segreto = base32(p.get('secret')); cifre = +p.get('digits') || 6; periodo = +p.get('period') || 30; alg = { SHA256: 'SHA-256', SHA512: 'SHA-512' }[(p.get('algorithm') || '').toUpperCase()] || 'SHA-1'; } else segreto = base32(t);
  const passo = Math.floor(Date.now() / 1000 / periodo);
  const msg = new Uint8Array(8); const dv = new DataView(msg.buffer); dv.setUint32(0, Math.floor(passo / 2 ** 32)); dv.setUint32(4, passo);
  const k = await crypto.subtle.importKey('raw', segreto, { name: 'HMAC', hash: alg }, false, ['sign']);
  const d = new Uint8Array(await crypto.subtle.sign('HMAC', k, msg)); const o = d[d.length - 1] & 15;
  const n = ((d[o] & 127) << 24) | (d[o + 1] << 16) | (d[o + 2] << 8) | d[o + 3];
  return String(n % 10 ** cifre).padStart(cifre, '0');
}

// ---------- generatore (password suggerita nelle iscrizioni) ----------
export function genera(l = 20, o = { mai: true, num: true, sim: true }) {
  const g = ['abcdefghijkmnopqrstuvwxyz', o.mai !== false && 'ABCDEFGHJKLMNPQRSTUVWXYZ', o.num !== false && '23456789', o.sim !== false && '!@#$%&*+-=?_.'].filter(Boolean);
  const tutti = g.join('');
  for (;;) {
    const r = crypto.getRandomValues(new Uint32Array(l));
    const p = Array.from(r, (x) => tutti[x % tutti.length]).join('');
    if (g.every((x) => [...p].some((ch) => x.includes(ch)))) return p;
  }
}

// ---------- messaggi ----------
const nuovoId = () => C.b64url(crypto.getRandomValues(new Uint8Array(12)));
async function gestisci(m, mittente) {
  const daPagina = Boolean(mittente.tab) && !String(mittente.url || '').startsWith(chrome.runtime.getURL(''));
  const host = daPagina ? dominio(mittente.url) : '';
  portaPagina = daPagina ? porta(mittente.url) : '';
  { const u = (await conf()).url; hostProprio = daPagina && host === dominio(u) && porta(mittente.url) === porta(u) ? host : ''; }
  if (await chiave()) rinnovaBlocco();
  switch (m.a) {
    // --- dalle pagine web: solo il loro sito ---
    case 'escluso': return { escluso: host === dominio((await conf()).url) };
    // La tendina risponde subito dalla copia sul PC; il riallineamento col NAS va in sottofondo («tarda 1 secondo»).
    case 'perSito': if (!(await conf()).compila.login) return { voci: [], spento: true }; if (!(await pronto())) return { bloccato: true }; aggiornaSeVecchio(); return { voci: suggerimenti(host) };
    // Password suggerita in un'iscrizione: copiata da sola (CHECKLIST 10.8). Solo testo creato da DiGiPass in quel momento.
    case 'copiaSuggerita': if (typeof m.testo === 'string' && m.testo.length <= 64) await copia(m.testo, true); return { ok: true };
    // Codice 2FA del sito nei campi «codice monouso» (CHECKLIST 10.4).
    case 'totpDelSito': {
      if (!(await conf()).compila.totp) return { spento: true };
      if (!(await pronto())) return { bloccato: true };
      const out = [];
      for (const { dati: v } of S.voci.values()) {
        if (v.tipo !== 'login' || v.cestino || !v.totp || !(v.siti || []).some((s) => corrisponde(s, host))) continue;
        try { out.push({ titolo: v.titolo || 'Login', codice: await codiceTotp(v.totp) }); } catch { /* 2FA non valido */ }
      }
      return { codici: out };
    }
    // Identità della Cassaforte per i moduli di dati personali (CHECKLIST 10.4), su qualunque sito.
    case 'identita': {
      if (!(await conf()).compila.identita) return { spento: true };
      if (!(await pronto())) return { bloccato: true };
      const out = [];
      for (const { dati: v } of S.voci.values()) {
        if (v.tipo !== 'identita' || v.cestino) continue;
        const c = v.campi || {};
        out.push({ id: v.id, titolo: v.titolo || 'Identità', sotto: c.nomeCompleto || [c.nome, c.cognome].filter(Boolean).join(' ') || c.email || '' });
      }
      return { identita: out };
    }
    case 'compilaIdentita': {
      if (!(await pronto())) return { bloccato: true };
      const v = S.voci.get(m.id)?.dati;
      if (!v || v.tipo !== 'identita' || v.cestino) return { errore: 'Identità non trovata' };
      return { campi: v.campi || {} };
    }
    // Carte di credito della Cassaforte, su qualunque sito, come i Pagamenti di Chrome.
    case 'carte': {
      if (!(await conf()).compila.carte) return { spento: true };
      if (!(await pronto())) return { bloccato: true };
      aggiornaSeVecchio();
      const carte = [];
      for (const { dati: v } of S.voci.values()) {
        if (v.tipo !== 'carta' || v.cestino) continue;
        const n = String(v.campi?.numero || '').replace(/\D/g, '');
        if (n.length < 4) continue;
        carte.push({ id: v.id, titolo: v.titolo || 'Carta', tipo: tipoCarta(n), ultime: n.slice(-4) });
      }
      return { carte };
    }
    case 'compilaCarta': {
      if (!(await pronto())) return { bloccato: true };
      const v = S.voci.get(m.id)?.dati;
      if (!v || v.tipo !== 'carta' || v.cestino) return { errore: 'Carta non trovata' };
      return { numero: v.campi?.numero || '', titolare: v.campi?.titolare || '', scadenza: v.campi?.scadenza || '', cvv: v.campi?.cvv || '' };
    }
    case 'compila': {
      if (!(await pronto())) return { bloccato: true };
      const d = voceDelSito(m.id, host);
      if (!d) return { errore: 'Voce non di questo sito' };
      if (d.totp && (await conf()).copiaTotp) { try { await copia(await codiceTotp(d.totp)); d.totpCopiato = true; } catch { /* 2FA non valido */ } }
      delete d.totp;
      return d;
    }
    case 'anteprima': {
      // Riquadro aperto dall'icona della tendina («così mi piace»): niente password, solo per questo sito.
      if (!(await pronto())) return { bloccato: true };
      const v = S.voci.get(m.id)?.dati;
      if (v && v.tipo === 'login' && voceDelLuogo(v, host)) {
        return { titolo: v.titolo || '', sito: (v.siti || []).find((s) => corrisponde(s, host)) || '', utente: v.campi?.utente || v.campi?.email || '', note: v.note || '' };
      }
      const s = S.siti.get(m.id)?.dati;
      if (s && corrisponde(s.sito, host)) return { titolo: s.sito, sito: s.sito, utente: s.utente || '', note: '' };
      return { errore: 'Voce non di questo sito' };
    }
    case 'genera': { const g = (await conf()).gen; return { password: genera(Math.min(64, Math.max(8, +g.l || 20)), g) }; }
    case 'gestisci': chrome.tabs.create({ url: (await conf()).url }); return { ok: true };
    case 'apriFinestra': chrome.tabs.create({ url: chrome.runtime.getURL('popup.html?grande=1') }); return { ok: true };
    case 'icona': {
      // Logo del sito dal NAS (che lo prende dal sito stesso), come immagine data: per il popup.
      if (!/^[a-z0-9.-]+$/.test(String(m.dominio || ''))) return { dati: null };
      const { url } = await conf();
      const r = await fetch(`${url}/api/icona/${encodeURIComponent(m.dominio)}`, { credentials: 'include' });
      if (!r.ok || !/^image\//.test(r.headers.get('content-type') || '')) return { dati: null };
      const b = new Uint8Array(await r.arrayBuffer());
      let bin = ''; for (let i = 0; i < b.length; i += 8192) bin += String.fromCharCode(...b.subarray(i, i + 8192));
      return { dati: `data:${r.headers.get('content-type').split(';')[0]};base64,${btoa(bin)}` };
    }
    // Login nuovo o password cambiata: niente salvataggio automatico. Si tiene la proposta in memoria per
    // la scheda (2 minuti) e la pagina chiede «Salvare nella Memoria siti?» (Salva / No / Metti in cassaforte).
    case 'inSospeso': {
      const p = mittente.tab ? await inSospeso.get(mittente.tab.id) : null;
      if (!p || Date.now() - p.quando > 120000 || !corrisponde(p.sito, host)) return {};
      return { proposta: { sito: p.sito, utente: p.utente, tipo: p.tipo } };
    }
    case 'utentePasso1': {
      if (mittente.tab?.id !== undefined && host && typeof m.utente === 'string' && m.utente.trim()) await passo1.set(mittente.tab.id, { host, utente: m.utente.trim().slice(0, 200), quando: Date.now() });
      return { ok: true };
    }
    case 'salvaLogin': {
      if (!(await pronto()) || !m.password || !host) return { bloccato: true };
      // Dentro DiGiPass stesso si salva solo dalla pagina di accesso (la pagina manda solo i campi in .accesso, mai le schede
      // della Cassaforte): la password principale, se non c'è già («devi farmela vedere se no a cosa serve»).
      if (host === dominio((await conf()).url) && host !== hostProprio) return { niente: true };
      // Senza campo del nome utente nella pagina: quello scritto nella prima pagina (stessa scheda, stesso sito, 10 minuti),
      // altrimenti quello che la pagina tiene in un campo nascosto.
      let utente = typeof m.utente === 'string' ? m.utente : '';
      if (!utente) {
        const u = mittente.tab?.id !== undefined ? await passo1.get(mittente.tab.id) : null;
        if (u && Date.now() - u.quando < 600000 && (u.host === host || corrisponde(u.host, host))) utente = u.utente;
        else if (typeof m.nascosto === 'string') utente = m.nascosto.trim().slice(0, 200);
      }
      let gia = suggerimenti(host).find((x) => x.utente === utente);
      // In Memoria siti c'è già la voce di questo sito «senza nome utente»: si completa quella, invece di farne una seconda.
      const vuota = !gia && utente ? suggerimenti(host).find((x) => !x.utente && x.fonte === 'Memoria siti') : null;
      let tipo = 'nuovo';
      if (vuota) { gia = vuota; tipo = 'memoria'; }
      else if (gia) {
        const d = voceDelSito(gia.id, host);
        if (d?.password === m.password) return { niente: true };
        tipo = gia.fonte === 'Cassaforte' ? 'cassaforte' : 'memoria';
      }
      const p = { tipo, idEsistente: gia?.id || null, sito: conIp(host) && portaPagina ? `${host}:${portaPagina}` : host, utente, password: m.password, quando: Date.now() };
      if (mittente.tab?.id !== undefined) await inSospeso.set(mittente.tab.id, p);
      return { proposta: { sito: p.sito, utente: p.utente, tipo } };
    }
    case 'conferma': {
      const p = mittente.tab ? await inSospeso.get(mittente.tab.id) : null;
      if (!p || m.scelta === 'no') { if (mittente.tab) await inSospeso.delete(mittente.tab.id); return { ok: true }; }
      if (!(await pronto())) {
        // Bloccata: il login non si perde, si salva appena DiGiPass viene sbloccato.
        const { attesa = [] } = await chrome.storage.local.get('attesa');
        attesa.push({ p, scelta: m.scelta, nome: m.nome || '' });
        await chrome.storage.local.set({ attesa });
        await inSospeso.delete(mittente.tab.id);
        chrome.tabs.create({ url: chrome.runtime.getURL('popup.html?grande=1') });
        return { ok: true, inAttesa: true };
      }
      try {
        const dove = await eseguiConferma(p, m.scelta, m.nome);
        await inSospeso.delete(mittente.tab.id);
        return { ok: true, dove };
      } catch (e) {
        return { errore: e.status === 401 ? 'Il NAS chiede di accedere di nuovo: apri DiGiPass dall’icona in alto' : e.status ? `Il NAS ha risposto: ${e.message}` : 'NAS non raggiungibile: controlla la connessione e riprova' };
      }
    }
    case 'mettiInCassaforte': {
      if (!(await pronto())) return { bloccato: true };
      const s = S.siti.get(m.id)?.dati;
      if (!s || (daPagina && !corrisponde(s.sito, host))) return { errore: 'Sito non trovato' };
      const base = s.sito.split('.')[0] || 'Sito';
      await scrivi('voce', { id: nuovoId(), tipo: 'login', titolo: (m.nome || '').trim() || base[0].toUpperCase() + base.slice(1), cartella: '', fissata: false, campi: { utente: s.utente, password: s.password }, siti: [s.sito], note: (m.note || '').trim(), totp: '', cestino: null, extra: [] });
      return { ok: true };
    }
  }
  if (daPagina) return { errore: 'Non consentito' };
  // --- solo dalla finestra dell'estensione ---
  switch (m.a) {
    // Modifica di una voce di Memoria siti: indirizzo, nome utente, password.
    case 'modificaSito': {
      if (!(await pronto())) return { bloccato: true };
      // Senza id: voce nuova («Aggiungi»).
      const s = m.id ? S.siti.get(m.id)?.dati : { id: nuovoId() };
      if (!s) return { errore: 'Sito non trovato' };
      const sito = String(m.sito || '').trim(), utente = String(m.utente || '').trim(), password = String(m.password || '');
      if (!sito || !password) return { errore: 'Indirizzo e password non possono essere vuoti' };
      const nuovo = { ...s, sito, utente, password };
      await scrivi('sito', nuovo);
      return { ok: true, sito: nuovo };
    }
    case 'stato': {
      const c = await conf();
      // Codice solo se il NAS non riconosce questo browser come dispositivo ricordato (90 giorni).
      let codice = true;
      try { const r = await fetch(`${c.url}/api/auth/status`, { credentials: 'include' }); const j = await r.json(); codice = j.serveCodice !== false; } catch { /* NAS non raggiungibile: si mostra */ }
      return { conf: c, sbloccato: Boolean(await chiave()), sessione: await sessione(), chiavi: Boolean((await cache()).chiavi), codice };
    }
    case 'allegato': {
      // Allegato di una voce (CHECKLIST 1.11): dal NAS arrivano byte cifrati, si aprono qui con la chiave dei dati.
      const dek = await chiave();
      if (!dek) return { errore: 'DiGiPass è bloccato' };
      const { url } = await conf();
      const prendi = () => fetch(`${url}/api/allegati/${encodeURIComponent(m.id)}`, { credentials: 'include' });
      let r = await prendi();
      if (r.status === 401 && await sessione()) r = await prendi();
      if (!r.ok) return { errore: r.status === 404 ? 'Allegato non trovato sul NAS' : r.status === 401 ? 'Il NAS chiede di accedere di nuovo' : `Il NAS ha risposto: errore ${r.status}` };
      const chiaro = await C.decifra(dek, new Uint8Array(await r.arrayBuffer()), `digipass-allegato:${m.id}`);
      let s = ''; for (let i = 0; i < chiaro.length; i += 32768) s += String.fromCharCode(...chiaro.subarray(i, i + 32768));
      return { b64: btoa(s) };
    }
    case 'conf': await chrome.storage.local.set({ conf: { ...(await conf()), ...m.conf } }); return { ok: true };
    case 'prelogin': return api('POST', '/api/auth/prelogin', { username: (await conf()).utente });
    case 'chiaviSalvate': return (await cache()).chiavi;
    case 'chiavi': {
      // Online: dal NAS (e si salvano per lavorare offline); offline: quelle salvate.
      try { const ch = await api('GET', '/api/chiavi'); const c = await cache(); c.chiavi = ch; await salvaCache(c); return ch; } catch (e) { const ch = (await cache()).chiavi; if (ch) return { ...ch, offline: true }; throw e; }
    }
    case 'accedi': {
      const r = await api('POST', '/api/auth/login', { username: (await conf()).utente, password: m.accesso, code: m.codice || '', remember: Boolean(m.ricorda) });
      await chrome.storage.session.set({ csrf: r.csrf });
      return { ok: true, riserveRimaste: r.riserveRimaste };
    }
    case 'apri': {
      // m.dek arriva dalla finestra dell'estensione, che l'ha aperta con la password principale.
      await apriCon(C.deB64(m.dek));
      if (m.accesso) await conservaAccesso(m.accesso);
      const s = await sincronizza();
      // Login rimasti da salvare mentre era bloccata: si salvano adesso.
      await salvaInAttesa();
      return { ok: true, sync: s };
    }
    case 'salvaChiavi': { const c = await cache(); c.chiavi = m.chiavi; await salvaCache(c); return { ok: true }; }
    case 'elenco': {
      if (!(await pronto())) return { bloccato: true };
      await aggiornaSeVecchio();
      return { voci: [...S.voci.values()].map((x) => x.dati), siti: [...S.siti.values()].map((x) => x.dati) };
    }
    case 'sincronizza': return sincronizza();
    case 'salva': await scrivi(m.tipo, m.dati, Boolean(m.cancellata)); return { ok: true };
    case 'copia': await copia(m.testo, m.segreto !== false); return { ok: true };
    case 'totp': return { codice: await codiceTotp(m.segreto) };
    case 'esci': try { await api('POST', '/api/auth/logout'); } catch { /* gia' fuori */ } await blocca(); await chrome.storage.local.remove('cache'); return { ok: true };
  }
  return { errore: 'Messaggio sconosciuto' };
}
chrome.runtime.onMessage.addListener((m, mittente, rispondi) => {
  if (m?.a === 'appunti') return false; // per il documento fuori schermo
  gestisci(m, mittente).then(rispondi, (e) => rispondi({ errore: e.message, stato: e.status }));
  return true;
});

// ---------- finestra di login del browser (Basic Auth) ----------
chrome.webRequest.onAuthRequired.addListener((d, fatto) => {
  (async () => {
    if (!(await pronto()) || d.isProxy) return fatto({});
    const host = dominio(d.url);
    const s = suggerimenti(host)[0];
    const v = s && voceDelSito(s.id, host);
    fatto(v ? { authCredentials: { username: v.utente, password: v.password } } : {});
  })();
}, { urls: ['<all_urls>'] }, ['asyncBlocking']);

// ---------- scorciatoia Ctrl+Shift+L: finestra grande ----------
chrome.commands.onCommand.addListener((c) => {
  if (c === 'finestra-grande') chrome.tabs.create({ url: chrome.runtime.getURL('popup.html?grande=1') });
});

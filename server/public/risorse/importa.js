// Importazione ed esportazione della webapp, tutto nel browser: i file in chiaro non arrivano mai al server.

/** CSV (RFC 4180): virgolette, virgole e a capo dentro i campi. */
export function leggiCsv(testo) {
  const righe = []; let riga = [], campo = '', dentro = false;
  for (let i = 0; i < testo.length; i++) {
    const c = testo[i];
    if (dentro) {
      if (c === '"') { if (testo[i + 1] === '"') { campo += '"'; i++; } else dentro = false; } else campo += c;
    } else if (c === '"') dentro = true;
    else if (c === ',') { riga.push(campo); campo = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && testo[i + 1] === '\n') i++;
      riga.push(campo); campo = '';
      if (riga.some((x) => x !== '')) righe.push(riga);
      riga = [];
    } else campo += c;
  }
  if (campo !== '' || riga.length) { riga.push(campo); if (riga.some((x) => x !== '')) righe.push(riga); }
  return righe;
}

/** Nome da mostrare per un sito di Memoria siti: per le app Android (android://hash@pacchetto/) il nome del CSV o il
 * pacchetto, mai l'hash. Il dato salvato non cambia. */
export function nomeSito(s) {
  const sito = String(s?.sito || '');
  if (!sito.toLowerCase().startsWith('android://')) return sito;
  return String(s?.nome || '').trim() || `app: ${sito.slice(10).split('@').pop().split('/')[0]}`;
}
export function dominio(url) {
  let s = String(url || '').trim().toLowerCase();
  if (s.startsWith('android://')) return `android://${s.slice(10).split('@').pop().split('/')[0]}`;
  s = s.replace(/^[a-z]+:\/\//, '').split('/')[0].split(':')[0];
  return s.startsWith('www.') ? s.slice(4) : s;
}

// Indirizzo esattamente come nel file: schema, porta e percorso restano; prima si teneva solo il nome
// del server e le app del NAS (192.168.1.10:3000, :8095…) diventavano tutte uguali.
const urlIntero = (u) => String(u ?? ''); // identico al file, carattere per carattere (nessun trim)

/** Export delle password di Chrome (name,url,username,password,note) -> siti nuovi per Memoria siti. */
export function importaCsvChrome(testo, esistenti = []) {
  const righe = leggiCsv(testo.replace(/^﻿/, ''));
  if (!righe.length) return [];
  const testa = righe[0].map((x) => x.trim().toLowerCase());
  const cu = testa.indexOf('url'), cn = testa.indexOf('username'), cp = testa.indexOf('password'), cnome = testa.indexOf('name');
  if (cu < 0 || cp < 0) throw new Error('Il file non è un export delle password di Chrome.');
  const visti = new Set(esistenti.map((s) => `${s.sito}\n${s.utente}\n${s.password}`));
  const out = [];
  for (const r of righe.slice(1)) {
    const sito = urlIntero(r[cu]), utente = cn >= 0 ? r[cn] || '' : '', password = r[cp] || '';
    const k = `${sito}\n${utente}\n${password}`;
    if (!sito || !password || visti.has(k)) continue;
    visti.add(k);
    out.push({ sito, utente, password, nome: cnome >= 0 ? r[cnome] || '' : '' }); // «name» del CSV: serve a mostrare le app Android
  }
  return out;
}

// ---------- CSV di un altro programma (CHECKLIST 10.11) ----------
// login e password vanno in Cassaforte, le sole memorie dei siti in Memoria siti; dal file non si capisce,
// quindi la destinazione la sceglie l'utente. Le colonne si riconoscono dal nome nella prima riga; i valori si copiano esattamente
// come sono nel file (nessun trim, indirizzi interi).
const COLONNE = {
  url: ['url', 'uri', 'website', 'web site', 'sito', 'indirizzo', 'login_uri', 'login url', 'address'],
  utente: ['username', 'user', 'user name', 'utente', 'nome utente', 'login', 'login_username', 'email', 'e-mail'],
  password: ['password', 'pass', 'pwd', 'login_password'],
  nome: ['name', 'title', 'titolo', 'nome'],
  note: ['note', 'notes', 'nota', 'commento', 'comments'],
  totp: ['totp', 'otp', '2fa', 'otpauth', 'login_totp'],
};
export function leggiCsvGenerico(testo) {
  const righe = leggiCsv(String(testo).replace(/^\uFEFF/, ''));
  if (righe.length < 2) throw new Error('Il file CSV è vuoto.');
  const testa = righe[0].map((x) => x.trim().toLowerCase());
  const col = Object.fromEntries(Object.entries(COLONNE).map(([k, nomi]) => [k, testa.findIndex((h) => nomi.includes(h))]));
  if (col.password < 0) throw new Error('Nel CSV non c\'è una colonna «password».');
  const val = (r, k) => (col[k] >= 0 ? r[col[k]] ?? '' : '');
  return righe.slice(1).map((r) => ({ nome: val(r, 'nome'), url: val(r, 'url'), utente: val(r, 'utente'), password: val(r, 'password'), note: val(r, 'note'), totp: val(r, 'totp') }))
    .filter((x) => x.password !== '' || x.utente !== '' || x.url !== '');
}
/** Righe del CSV -> login della Cassaforte (titolo: la colonna «nome», altrimenti l'indirizzo). */
export const csvInCassaforte = (righe) => righe.map((r) => ({ origine: 'csv', tipo: 'login', titolo: r.nome || r.url || 'Senza titolo', cartella: '', fissata: false,
  campi: { utente: r.utente, password: r.password }, siti: r.url ? [r.url] : [], note: r.note, totp: r.totp, cestino: null, extra: [] }));
/** Righe del CSV -> Memoria siti (servono indirizzo e password, come per il CSV di Chrome). */
export const csvInMemoria = (righe) => righe.filter((r) => r.url && r.password).map((r) => ({ sito: r.url, utente: r.utente, password: r.password, nome: r.nome }));

// ---------- ZIP (solo lettura: stored e deflate) ----------
async function inflate(dati) {
  const s = new Blob([dati]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(s).arrayBuffer());
}
export async function leggiZip(buf) {
  const v = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  let fine = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) if (v.getUint32(i, true) === 0x06054b50) { fine = i; break; }
  if (fine < 0) throw new Error('File ZIP non valido.');
  const n = v.getUint16(fine + 10, true);
  let p = v.getUint32(fine + 16, true);
  const file = {};
  for (let k = 0; k < n; k++) {
    if (v.getUint32(p, true) !== 0x02014b50) throw new Error('File ZIP non valido.');
    const metodo = v.getUint16(p + 10, true), comp = v.getUint32(p + 20, true);
    const ln = v.getUint16(p + 28, true), le = v.getUint16(p + 30, true), lc = v.getUint16(p + 32, true), loc = v.getUint32(p + 42, true);
    const nome = new TextDecoder().decode(buf.subarray(p + 46, p + 46 + ln));
    const inizio = loc + 30 + v.getUint16(loc + 26, true) + v.getUint16(loc + 28, true);
    const dati = buf.subarray(inizio, inizio + comp);
    file[nome] = () => (metodo === 0 ? Promise.resolve(dati) : metodo === 8 ? inflate(dati) : Promise.reject(new Error('Compressione ZIP non supportata.')));
    p += 46 + ln + le + lc;
  }
  return file;
}

// ---------- Proton Pass ----------
const testo = (x) => (x === undefined || x === null ? '' : String(x));
const dataGg = (s) => { const d = new Date(s * 1000); return `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}.${d.getFullYear()}`; };
function vocePp(it, nomeCassaforte) {
  const d = it.data || {}, c = d.content || {}, m = d.metadata || {};
  const extra = (d.extraFields || []).map((e) => ({
    nome: testo(e.fieldName), tipo: { hidden: 'nascosto', totp: 'totp', timestamp: 'data' }[e.type] || 'testo',
    valore: testo(e.data?.content ?? (e.data?.timestamp ? dataGg(Number(e.data.timestamp)) : '')),
  })).filter((e) => e.valore);
  const base = { origine: 'proton', titolo: testo(m.name) || 'Senza titolo', cartella: '' /* il nome della cassaforte di Proton (es. «Personal») non diventa una cartella */, fissata: Boolean(it.pinned), note: testo(m.note), siti: [], totp: '', cestino: it.state === 2 ? Date.now() : null, extra };
  switch (d.type) {
    case 'login':
      // Con nome utente ed email tutti e due: l'email va nel suo campo (CHECKLIST 1.1), come nell'app.
      return { ...base, tipo: 'login', campi: { utente: testo(c.itemUsername || c.itemEmail), password: testo(c.password), ...(c.itemUsername && c.itemEmail ? { email: testo(c.itemEmail) } : {}) },
        siti: (c.urls || []).map(urlIntero).filter(Boolean), totp: testo(c.totpUri) };
    case 'creditCard': {
      const s = testo(c.expirationDate); const scad = /^\d{4}-\d{2}$/.test(s) ? `${s.slice(5)}/${s.slice(2, 4)}` : s;
      return { ...base, tipo: 'carta', campi: { titolare: testo(c.cardholderName), numero: testo(c.number), scadenza: scad, cvv: testo(c.verificationNumber), pin: testo(c.pin) } };
    }
    case 'identity':
      return { ...base, tipo: 'identita', campi: {
        nome: testo(c.firstName || c.fullName), secondoNome: testo(c.middleName), cognome: testo(c.lastName), nomeCompleto: testo(c.fullName), nascita: testo(c.birthdate), sesso: testo(c.gender),
        email: testo(c.email), telefono: testo(c.phoneNumber), indirizzo: testo(c.streetAddress), piano: testo(c.floor), cap: testo(c.zipOrPostalCode), citta: testo(c.city),
        provincia: testo(c.stateOrProvince), contea: testo(c.county), paese: testo(c.countryOrRegion), organizzazione: testo(c.organization), telefono2: testo(c.secondPhoneNumber),
        sito: testo(c.website), patente: testo(c.licenseNumber), documento: testo(c.passportNumber || c.licenseNumber), previdenza: testo(c.socialSecurityNumber),
        linkedin: testo(c.linkedin), x: testo(c.xHandle), facebook: testo(c.facebook), instagram: testo(c.instagram), reddit: testo(c.reddit), yahoo: testo(c.yahoo),
        azienda: testo(c.company), ruolo: testo(c.jobTitle), emailLavoro: testo(c.workEmail), telefonoLavoro: testo(c.workPhoneNumber), sitoPersonale: testo(c.personalWebsite) } };
    case 'wifi':
      return { ...base, tipo: 'wifi', campi: { ssid: testo(c.ssid), password: testo(c.password), sicurezza: ['', 'WPA', 'WPA2', 'WPA3', 'WEP'][Number(c.security)] || testo(c.security) } };
    case 'note':
      return { ...base, tipo: 'nota', campi: {} };
    default:
      // Alias, chiavi SSH, voci personalizzate: si tengono come nota con i campi, per non perdere niente.
      return { ...base, tipo: 'nota', campi: {}, note: [base.note, ...Object.entries(c).filter(([, x]) => typeof x === 'string' && x).map(([k, x]) => `${k}: ${x}`)].filter(Boolean).join('\n') };
  }
}
/** Export di Proton Pass (data.json, anche dentro lo ZIP) -> voci della Cassaforte. Gli export cifrati (PGP) non si leggono. */
export async function importaProton(buf, nomeFile = '') {
  let json;
  if (/\.zip$/i.test(nomeFile) || (buf[0] === 0x50 && buf[1] === 0x4b)) {
    const z = await leggiZip(buf);
    const nome = Object.keys(z).find((k) => /data\.json$/i.test(k));
    if (!nome) throw new Error('Nello ZIP non c\'è data.json: serve l\'export di Proton Pass non cifrato.');
    json = JSON.parse(new TextDecoder().decode(await z[nome]()));
  } else json = JSON.parse(new TextDecoder().decode(buf));
  if (json.encrypted) throw new Error('Questo export di Proton Pass è cifrato (PGP): esportalo di nuovo senza cifratura.');
  if (!json.vaults) throw new Error('Il file non è un export di Proton Pass.');
  const out = [];
  for (const cassa of Object.values(json.vaults)) for (const it of cassa.items || []) out.push(vocePp(it, cassa.name));
  return out;
}

const csvCampo = (x) => (/[",\n\r]/.test(String(x ?? '')) ? `"${String(x).replace(/"/g, '""')}"` : String(x ?? ''));
/** CSV in chiaro: Cassaforte (login, note, carte, identità, Wi-Fi) e Memoria siti. */
export function csvDaEsportare(voci, siti) {
  const righe = [['dove', 'tipo', 'titolo', 'url', 'utente', 'password', 'totp', 'note', 'cartella', 'altri campi']];
  for (const v of voci) {
    const c = v.campi || {};
    const altri = Object.entries(c).filter(([k]) => !['utente', 'password'].includes(k) && c[k]).map(([k, x]) => `${k}: ${x}`)
      .concat((v.extra || []).map((e) => `${e.nome}: ${e.valore}`)).join('; ');
    righe.push(['cassaforte', v.tipo, v.titolo, (v.siti || []).join(' '), c.utente || '', c.password || '', v.totp || '', v.note || '', v.cartella || '', altri]);
  }
  for (const s of siti) righe.push(['memoria siti', 'login', s.sito, s.sito, s.utente || '', s.password || '', '', '', '', '']);
  return `﻿${righe.map((r) => r.map(csvCampo).join(',')).join('\r\n')}\r\n`;
}

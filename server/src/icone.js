// Loghi dei siti: il server sul NAS li prende direttamente dal sito (icone dichiarate nella pagina,
// apple-touch-icon, favicon), senza servizi esterni tipo Google o DuckDuckGo, e li tiene in cache nella cartella dati.
// Riceve solo il nome del dominio, mai password o voci. Protezioni: solo domini pubblici (niente IP, niente rete di casa,
// controllo dell'indirizzo risolto a ogni connessione), tempo massimo, grandezza massima, pochi reindirizzamenti.
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import https from 'node:https';
import dns from 'node:dns';
import { isIP } from 'node:net';
import { createHash } from 'node:crypto';

const MAX_PAGINA = 512 * 1024;
const MAX_ICONA = 300 * 1024;
const TEMPO = 6000;
const GIORNO = 24 * 60 * 60 * 1000;
const VALIDA = 30 * GIORNO;
const ASSENTE = 7 * GIORNO;
const DOMINIO = /^(?=.{4,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z][a-z0-9-]{0,62}[a-z0-9]$/;

/** Il dominio di un sito salvato (es. «https://www.norton.com/login» → «norton.com»), o null. */
export function dominioDi(s) {
  const t = String(s || '').trim().toLowerCase();
  if (!t || t.startsWith('android://')) return null;
  try {
    const u = new URL(/^[a-z][a-z0-9+.-]*:/.test(t) ? t : `https://${t}`);
    if (!['http:', 'https:'].includes(u.protocol)) return null;
    const d = u.hostname.replace(/^www\./, '');
    return DOMINIO.test(d) && !isIP(d) ? d : null;
  } catch { return null; }
}

/** Indirizzo pubblico? Blocca rete di casa, loopback, link-local, multicast e simili. */
export function indirizzoPubblico(ip) {
  const v = isIP(ip);
  if (v === 4) {
    const [a, b] = ip.split('.').map(Number);
    return !(a === 0 || a === 10 || a === 127 || a >= 224 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254)
      || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 192 && b === 0) || (a === 198 && (b === 18 || b === 19)));
  }
  if (v === 6) {
    const x = ip.toLowerCase();
    if (x.startsWith('::ffff:')) return indirizzoPubblico(x.slice(7));
    return !(x === '::' || x === '::1' || /^f[cd]/.test(x) || /^fe[89ab]/.test(x) || x.startsWith('ff') || x.startsWith('64:ff9b') || x.startsWith('2001:db8'));
  }
  return false;
}

// La risoluzione del nome passa da qui a ogni connessione: un dominio che punta (anche dopo) a un indirizzo interno è rifiutato.
function cercaSicuro(host, opzioni, cb) {
  dns.lookup(host, { all: true }, (err, indirizzi) => {
    if (err) return cb(err);
    const buoni = indirizzi.filter((a) => indirizzoPubblico(a.address));
    if (!buoni.length || buoni.length !== indirizzi.length) return cb(Object.assign(new Error('indirizzo non pubblico'), { code: 'ENOTPUBLIC' }));
    if (opzioni?.all) return cb(null, buoni);
    cb(null, buoni[0].address, buoni[0].family);
  });
}

function scarica(indirizzo, limite, salti = 3) {
  return new Promise((ok, ko) => {
    let u;
    try { u = new URL(indirizzo); } catch { return ko(new Error('indirizzo non valido')); }
    if (!['http:', 'https:'].includes(u.protocol) || isIP(u.hostname) || (u.port && !['80', '443'].includes(u.port))) return ko(new Error('indirizzo non ammesso'));
    const modulo = u.protocol === 'https:' ? https : http;
    const req = modulo.get(u, {
      lookup: cercaSicuro, timeout: TEMPO,
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; DiGiPass)', Accept: 'text/html,image/*;q=0.9,*/*;q=0.5' },
    }, (res) => {
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
        res.resume();
        if (salti <= 0) return ko(new Error('troppi reindirizzamenti'));
        return scarica(new URL(res.headers.location, u).href, limite, salti - 1).then(ok, ko);
      }
      if (res.statusCode !== 200) { res.resume(); return ko(new Error(`risposta ${res.statusCode}`)); }
      const pezzi = []; let tot = 0;
      res.on('data', (p) => { tot += p.length; if (tot > limite) { req.destroy(); ko(new Error('troppo grande')); } else pezzi.push(p); });
      res.on('end', () => ok({ corpo: Buffer.concat(pezzi), tipo: String(res.headers['content-type'] || '').toLowerCase(), url: u.href }));
      res.on('error', ko);
    });
    req.on('timeout', () => req.destroy(new Error('tempo scaduto')));
    req.on('error', ko);
  });
}

/** Tipo dell'immagine dai primi byte (non ci si fida dell'intestazione del sito). SVG escluso: l'app non lo disegna. */
export function tipoImmagine(b) {
  if (b.length < 8) return null;
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'image/png';
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b.subarray(0, 4).toString('latin1') === 'GIF8') return 'image/gif';
  if (b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP') return 'image/webp';
  if (b[0] === 0 && b[1] === 0 && b[2] === 1 && b[3] === 0) return 'image/x-icon';
  return null;
}

/** Icone dichiarate nella pagina, dalla migliore: apple-touch-icon, poi icon con la grandezza più alta. */
export function iconeDellaPagina(html, base) {
  const trovate = [];
  for (const tag of String(html).match(/<link\b[^>]*>/gi) || []) {
    const attr = (n) => (tag.match(new RegExp(`\\b${n}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i')) || []).slice(1).find((x) => x !== undefined) || '';
    const rel = attr('rel').toLowerCase().split(/\s+/);
    const href = attr('href').trim();
    if (!href || href.startsWith('data:') || /\.svg(\?|$)/i.test(href)) continue;
    const apple = rel.includes('apple-touch-icon') || rel.includes('apple-touch-icon-precomposed');
    if (!apple && !rel.includes('icon')) continue;
    const lato = Math.max(0, ...(attr('sizes').match(/\d+/g) || ['0']).map(Number));
    try { trovate.push({ url: new URL(href.replace(/&amp;/g, '&'), base).href, punti: (apple ? 1000 : 0) + Math.min(lato, 512) }); } catch { /* indirizzo rotto */ }
  }
  return trovate.sort((a, b) => b.punti - a.punti).map((x) => x.url);
}

export function creaIcone(cartellaDati) {
  const cartella = path.join(cartellaDati, 'icone');
  fs.mkdirSync(cartella, { recursive: true });
  const inCorso = new Map();
  const file = (d) => path.join(cartella, 'v2-' + createHash('sha256').update(d).digest('hex')); // v2: la piu' grande prima

  async function cerca(d) {
    const candidati = [];
    for (const radice of [`https://${d}/`, `https://www.${d}/`]) {
      try {
        const p = await scarica(radice, MAX_PAGINA);
        // Prima la più grande: apple-touch-icon dichiarata (180 px), poi quella al posto standard, poi le altre per grandezza, poi la favicon.
        const dichiarate = iconeDellaPagina(p.corpo.toString('utf8'), p.url);
        const apple = dichiarate.filter((u) => /apple-touch/i.test(u));
        candidati.push(...apple, new URL('/apple-touch-icon.png', p.url).href, ...dichiarate.filter((u) => !apple.includes(u)), new URL('/favicon.ico', p.url).href);
        break;
      } catch { /* si prova con www. */ }
    }
    candidati.push(`https://${d}/apple-touch-icon.png`, `https://${d}/favicon.ico`);
    for (const c of [...new Set(candidati)].slice(0, 8)) {
      try {
        const r = await scarica(c, MAX_ICONA);
        const tipo = tipoImmagine(r.corpo);
        if (tipo) return { tipo, corpo: r.corpo };
      } catch { /* candidato successivo */ }
    }
    return null;
  }

  /** L'icona del dominio ({tipo, corpo}) o null se il sito non ne ha. */
  async function icona(d) {
    const f = file(d);
    try {
      const meta = JSON.parse(fs.readFileSync(`${f}.json`, 'utf8'));
      if (Date.now() - meta.quando < (meta.tipo ? VALIDA : ASSENTE)) return meta.tipo ? { tipo: meta.tipo, corpo: fs.readFileSync(`${f}.img`) } : null;
    } catch { /* non in cache */ }
    if (!inCorso.has(d)) {
      inCorso.set(d, cerca(d).then((r) => {
        if (r) fs.writeFileSync(`${f}.img`, r.corpo);
        fs.writeFileSync(`${f}.json`, JSON.stringify({ tipo: r?.tipo || null, quando: Date.now() }));
        return r;
      }).finally(() => inCorso.delete(d)));
    }
    return inCorso.get(d);
  }
  return { icona };
}

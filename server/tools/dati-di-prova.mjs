// Prepara un server di PROVA (mai quello vero): configura l'account e mette voci inventate, per guardare la webapp.
// Uso: node tools/dati-di-prova.mjs http://127.0.0.1:18798 <file-dove-scrivere-segreto-e-password>
import { writeFileSync } from 'node:fs';
import { authenticator } from 'otplib';
import { argon2id } from 'hash-wasm';
import * as C from '../public/risorse/cripto.js';

C.usaArgon2(argon2id);
const [base, uscita] = process.argv.slice(2);
let cookie = '', csrf = '';
async function api(metodo, url, corpo) {
  const r = await fetch(base + url, { method: metodo, headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}), ...(csrf ? { 'X-CSRF-Token': csrf } : {}) }, body: corpo ? JSON.stringify(corpo) : undefined });
  for (const c of r.headers.getSetCookie()) cookie = [...cookie.split('; ').filter(Boolean), c.split(';')[0]].join('; ');
  const j = await r.json();
  if (!r.ok) throw new Error(j.error);
  return j;
}
const password = `Prova-${C.b64url(C.casuali(9))}`;
const dek = C.casuali(32);
const pacco = await C.avvolgi(dek, password, C.nuovaRecupero());
const s = await api('POST', '/api/auth/setup/start', { username: 'admin' });
const fine = await api('POST', '/api/auth/setup/complete', { setupToken: s.setupToken, password: pacco.accesso, code: authenticator.generate(s.secret), chiavi: pacco.chiavi, accessoRecupero: pacco.accessoRec });
csrf = fine.csrf;
const ora = Date.now();
const voci = [
  { tipo: 'login', titolo: 'Norton', cartella: 'Lavoro', fissata: true, campi: { utente: 'nome@esempio.ch', password: 'Nort0n-esempio!' }, siti: ['norton.com'], totp: 'JBSWY3DPEHPK3PXP', note: 'Licenza rinnovo a marzo' },
  { tipo: 'login', titolo: 'Email lavoro', cartella: 'Lavoro', fissata: true, campi: { utente: 'nome@esempio.ch', password: '123456' }, siti: ['posta.esempio.ch'], totp: '', note: '' },
  { tipo: 'login', titolo: 'Fornitore gestionale', cartella: '', fissata: false, campi: { utente: 'utente.prova', password: '123456' }, siti: ['gestionale.esempio'], totp: '', note: '' },
  { tipo: 'carta', titolo: 'Banca', cartella: '', fissata: false, campi: { titolare: 'Nome Esempio', numero: '4111 1111 1111 4821', scadenza: '04/28', cvv: '123', pin: '' }, siti: [], totp: '', note: '' },
  { tipo: 'wifi', titolo: 'Casa – Wi-Fi', cartella: '', fissata: false, campi: { ssid: 'Rete-esempio', password: 'wifi-di-prova', sicurezza: 'WPA2' }, siti: [], totp: '', note: '' },
  { tipo: 'nota', titolo: 'Codici allarme', cartella: '', fissata: false, campi: {}, siti: [], totp: '', note: 'Esempio di nota sicura' },
];
for (const v of voci) { const id = C.b64url(C.casuali(12)); await api('PUT', `/api/sync/${id}`, { tipo: 'voce', base: 0, blob: await C.cifraVoce(dek, id, { id, ...v, cestino: null, creata: ora, modificata: ora }) }); }
for (const [sito, utente] of [['foto-gratis.esempio', 'utente.prova'], ['meteo.esempio', 'nome@esempio.ch'], ['negozio.esempio', 'nome@esempio.ch']]) {
  const id = C.b64url(C.casuali(12));
  await api('PUT', `/api/sync/${id}`, { tipo: 'sito', base: 0, blob: await C.cifraVoce(dek, id, { id, sito, utente, password: 'pw-di-prova', creata: ora, modificata: ora }) });
}
writeFileSync(uscita, JSON.stringify({ password, segreto: s.secret, riserva: fine.codiciRiserva }));
console.log('Server di prova pronto');

// Cifratura di DiGiPass nel browser: stessa di lib/cripto.dart (app) e di Cassaforte.kt (autocompilazione).
// La password principale e la chiave dei dati non lasciano mai il browser: al server va solo la chiave di
// accesso (HKDF), da cui non si ricava niente che apra i dati.
// Funziona anche in Node (prove automatiche): argon2id arriva da hash-wasm (window.hashwasm o import).

const enc = new TextEncoder();
const dec = new TextDecoder();
const subtle = globalThis.crypto.subtle;
let argon2 = globalThis.hashwasm?.argon2id;
export function usaArgon2(f) { argon2 = f; }

export const b64 = (u8) => { let s = ''; for (const b of u8) s += String.fromCharCode(b); return btoa(s); };
export const deB64 = (s) => Uint8Array.from(atob(String(s).replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(String(s).length / 4) * 4, '=')), (c) => c.charCodeAt(0));
export const b64url = (u8) => b64(u8).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
export const casuali = (n) => globalThis.crypto.getRandomValues(new Uint8Array(n));
export const testo = (u8) => dec.decode(u8);
export const byte = (s) => enc.encode(s);

export async function chiaveDaPassword(password, sale, { m = 19456, t = 2, p = 1 } = {}) {
  if (!argon2) throw new Error('Argon2 non caricato');
  return argon2({ password, salt: sale, parallelism: p, iterations: t, memorySize: m, hashLength: 32, outputType: 'binary' });
}

async function hkdf(ikm, sale, info) {
  const k = await subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  return new Uint8Array(await subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt: sale, info: enc.encode(info) }, k, 256));
}
export const normalizzaRecupero = (s) => String(s).toUpperCase().replace(/[^A-Z0-9]/g, '');
export const chiaveDaRecupero = (codice, sale) => hkdf(enc.encode(normalizzaRecupero(codice)), sale, 'digipass-recupero');
/** Prova di identità per il server: non apre i dati. */
export const chiaveAccesso = async (kek, sale) => b64url(await hkdf(kek, sale, 'digipass-accesso'));
export const accessoRecupero = async (recKey, sale) => b64url(await hkdf(recKey, sale, 'digipass-accesso-recupero'));

export async function cifra(chiave, dati, aad = 'digipass-v1') {
  const k = await subtle.importKey('raw', chiave, 'AES-GCM', false, ['encrypt']);
  const nonce = casuali(12);
  const ct = new Uint8Array(await subtle.encrypt({ name: 'AES-GCM', iv: nonce, additionalData: enc.encode(aad) }, k, dati));
  const out = new Uint8Array(12 + ct.length);
  out.set(nonce); out.set(ct, 12);
  return out;
}
export async function decifra(chiave, blob, aad = 'digipass-v1') {
  const k = await subtle.importKey('raw', chiave, 'AES-GCM', false, ['decrypt']);
  return new Uint8Array(await subtle.decrypt({ name: 'AES-GCM', iv: blob.subarray(0, 12), additionalData: enc.encode(aad) }, k, blob.subarray(12)));
}
/** Voce o sito per il server: JSON cifrato con la chiave dei dati, legato al suo id. */
export const cifraVoce = async (dek, id, oggetto) => b64(await cifra(dek, enc.encode(JSON.stringify(oggetto)), `digipass-voce:${id}`));
export const decifraVoce = async (dek, id, blob) => JSON.parse(dec.decode(await decifra(dek, deB64(blob), `digipass-voce:${id}`)));

export function nuovaRecupero() {
  const a = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const r = casuali(28);
  const c = Array.from(r, (x) => a[x % 32]).join('');
  return c.match(/.{4}/g).join('-');
}

/** Chiavi della cassaforte per una password (e una chiave di recupero) nuove, con la stessa chiave dei dati. */
export async function avvolgi(dek, password, recupero, kdf = { alg: 'argon2id', m: 19456, t: 2, p: 1 }) {
  const salePw = casuali(16), saleRec = casuali(16);
  const kek = await chiaveDaPassword(password, salePw, kdf);
  const rec = await chiaveDaRecupero(recupero, saleRec);
  return {
    chiavi: { v: 1, kdf, salePw: b64(salePw), dekPw: b64(await cifra(kek, dek)), saleRec: b64(saleRec), dekRec: b64(await cifra(rec, dek)) },
    accesso: await chiaveAccesso(kek, salePw),
    accessoRec: await accessoRecupero(rec, saleRec),
  };
}

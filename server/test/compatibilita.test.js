// Prova incrociata: i dati cifrati dall'app (fixture scritta da test/compatibilita_test.dart) si aprono con la
// cifratura del browser (public/risorse/cripto.js), e viceversa la webapp scrive voci che hanno lo stesso formato.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { argon2id } from 'hash-wasm';
import * as C from '../public/risorse/cripto.js';

C.usaArgon2(argon2id);
const f = JSON.parse(readFileSync(new URL('./fixture-dart.json', import.meta.url), 'utf8'));

test('la webapp apre la cassaforte creata dall\'app con la password principale', async () => {
  const c = f.chiavi;
  const kek = await C.chiaveDaPassword(f.password, C.deB64(c.salePw), c.kdf);
  const dek = await C.decifra(kek, C.deB64(c.dekPw));
  assert.equal(C.b64(dek), f.dek);
  assert.equal(await C.chiaveAccesso(kek, C.deB64(c.salePw)), f.accesso);
});

test('la webapp apre con la chiave di recupero del foglio di emergenza', async () => {
  const c = f.chiavi;
  const rec = await C.chiaveDaRecupero(f.recupero.toLowerCase(), C.deB64(c.saleRec));
  assert.equal(C.b64(await C.decifra(rec, C.deB64(c.dekRec))), f.dek);
  assert.equal(await C.accessoRecupero(rec, C.deB64(c.saleRec)), f.accessoRec);
});

test('voce cifrata dall\'app letta dalla webapp; legata al suo id', async () => {
  const dek = C.deB64(f.dek);
  assert.deepEqual(await C.decifraVoce(dek, f.voce.id, f.voce.blob), f.voce.testo);
  await assert.rejects(C.decifraVoce(dek, 'altroid0001', f.voce.blob));
});

test('password sbagliata: la chiave non apre', async () => {
  const c = f.chiavi;
  const kek = await C.chiaveDaPassword('password sbagliata', C.deB64(c.salePw), c.kdf);
  await assert.rejects(C.decifra(kek, C.deB64(c.dekPw)));
});

// La prima configurazione da fuori dal PC si accetta solo con DIGIPASS_ALLOW_SETUP=1 e il codice monouso del .env;
// 5 codici sbagliati -> blocco; appena esiste l'account si chiude da sola.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { creaApp } from '../src/app.js';

const dir = mkdtempSync(join(tmpdir(), 'digipass-setup-'));
const chiave = randomBytes(32).toString('base64url');
const aperti = [];
// "localhost" fa da proxy fidato: le richieste arrivano come da nginx, quindi NON valgono come «questo PC».
async function avvia(nome, extra) {
  const srv = await creaApp({ porta: 0, indirizzo: '127.0.0.1', cartellaDati: join(dir, nome), cartellaBackup: join(dir, `${nome}-bk`), chiave, configurazioneOvunque: true, codiceSetup: 'CODICE-DI-PROVA-1', proxyFidato: 'localhost', ...extra }, {});
  const server = srv.app.listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  await new Promise((r) => setTimeout(r, 300));
  aperti.push(() => { server.close(); srv.chiudi(); });
  return `http://127.0.0.1:${server.address().port}`;
}
const inizia = (base, codiceSetup, ip = '203.0.113.9') => fetch(`${base}/api/auth/setup/start`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Real-IP': ip }, body: JSON.stringify({ username: 'admin', codiceSetup }) });
test.after(() => { aperti.forEach((f) => f()); rmSync(dir, { recursive: true, force: true }); });

test('senza codice o con codice sbagliato: rifiutata; col codice giusto: aperta', async () => {
  const base = await avvia('codice');
  assert.equal((await inizia(base, '')).status, 400);
  assert.equal((await inizia(base, 'SBAGLIATO')).status, 400);
  const ok = await inizia(base, 'codice-di-prova-1');
  assert.equal(ok.status, 200);
  assert.ok((await ok.json()).secret);
});

test('5 codici sbagliati: blocco per 15 minuti anche col codice giusto', async () => {
  const base = await avvia('blocco');
  for (let i = 0; i < 5; i++) assert.equal((await inizia(base, `errato-${i}`, '198.51.100.7')).status, 400);
  const r = await inizia(base, 'CODICE-DI-PROVA-1', '198.51.100.7');
  assert.equal(r.status, 429);
});

test('senza DIGIPASS_ALLOW_SETUP o senza codice nel .env: chiusa', async () => {
  const a = await avvia('chiusa1', { configurazioneOvunque: false });
  assert.equal((await inizia(a, 'CODICE-DI-PROVA-1')).status, 403);
  const b = await avvia('chiusa2', { codiceSetup: '' });
  assert.equal((await inizia(b, '')).status, 403);
});

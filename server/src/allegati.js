// Allegati delle voci (CHECKLIST 1.11; 25 MB per file, 2 GB in tutto).
// Il server riceve e restituisce solo byte già cifrati dal telefono o dal browser (AES-256-GCM con la chiave dei dati,
// dati aggiuntivi «digipass-allegato:<id>»): non li può leggere. Stanno in dati/allegati, un file per allegato.
// Non entrano nei backup .enc (solo i database): li coprono Hybrid Backup (Container/digipass) e le copie in W:.
import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';

export const MAX_FILE = 25 * 1024 * 1024;
export const MAX_TOTALE = 2 * 1024 * 1024 * 1024;
// 12 byte di nonce + 16 di tag di AES-GCM: un file da 25 MB cifrato pesa 28 byte in più.
export const MAX_CIFRATO = MAX_FILE + 28;
export const ID_ALLEGATO = /^[A-Za-z0-9_-]{8,64}$/;

export function creaAllegati(cartellaDati) {
  const cartella = path.join(cartellaDati, 'allegati');
  fs.mkdirSync(cartella, { recursive: true });
  const file = (id) => path.join(cartella, id);

  function usato() {
    let tot = 0;
    for (const f of fs.readdirSync(cartella)) {
      if (!ID_ALLEGATO.test(f)) continue;
      try { tot += fs.statSync(file(f)).size; } catch { /* appena cancellato */ }
    }
    return tot;
  }

  function scrivi(id, corpo) {
    if (!ID_ALLEGATO.test(id)) throw Object.assign(new Error('Id non valido.'), { status: 400 });
    if (!Buffer.isBuffer(corpo) || corpo.length < 29) throw Object.assign(new Error('Allegato vuoto o non cifrato.'), { status: 400 });
    if (corpo.length > MAX_CIFRATO) throw Object.assign(new Error('Allegato troppo grande: al massimo 25 MB.'), { status: 413 });
    let prima = 0;
    try { prima = fs.statSync(file(id)).size; } catch { /* nuovo */ }
    if (usato() - prima + corpo.length > MAX_TOTALE) throw Object.assign(new Error('Spazio degli allegati pieno: al massimo 2 GB in tutto.'), { status: 507 });
    const tmp = path.join(cartella, `.tmp-${randomBytes(6).toString('hex')}`);
    fs.writeFileSync(tmp, corpo);
    fs.renameSync(tmp, file(id));
    return { dimensione: corpo.length, usato: usato() };
  }

  function percorso(id) {
    if (!ID_ALLEGATO.test(id)) return null;
    return fs.existsSync(file(id)) ? file(id) : null;
  }

  function cancella(id) {
    if (!ID_ALLEGATO.test(id)) throw Object.assign(new Error('Id non valido.'), { status: 400 });
    fs.rmSync(file(id), { force: true });
    return { usato: usato() };
  }

  return { usato, scrivi, percorso, cancella };
}

// DiGiPass nelle pagine: icona nei campi di accesso, menu coi login di QUESTO sito, password suggerita nelle iscrizioni,
// salvataggio dei login nuovi in Memoria siti con «Metti in cassaforte». Tutto il disegno sta in uno shadow DOM chiuso.
(() => {
  if (window.__digipass) return;
  window.__digipass = true;
  // Sul sito di DiGiPass (web app sul NAS) l'estensione lavora SOLO nella pagina di accesso (Entra / Cassaforte bloccata),
  // per suggerire la password principale; mai nella finestra MODIFICA o nelle altre schede.
  // Ovunque, un campo dentro un elemento con data-digipass-ignore viene ignorato.
  const ammesso = (el) => el && !el.closest('[data-digipass-ignore]') && (!escluso || Boolean(el.closest('.accesso')));
  let escluso = null;
  const eEscluso = async () => { if (escluso === null) { const r = await new Promise((ok) => { try { chrome.runtime.sendMessage({ a: 'escluso' }, (x) => ok(chrome.runtime.lastError ? {} : x || {})); } catch { ok({}); } }); escluso = Boolean(r.escluso); } return escluso; };
  const chiedi = (m) => new Promise((ok) => { try { chrome.runtime.sendMessage(m, (r) => ok(chrome.runtime.lastError ? { errore: 'estensione' } : r)); } catch { ok({ errore: 'estensione' }); } });

  const ospite = document.createElement('digipass-livello');
  ospite.style.cssText = 'position:absolute;top:0;left:0;width:0;height:0;z-index:2147483647';
  const ombra = ospite.attachShadow({ mode: 'closed' });
  ombra.innerHTML = `<style>
    :host{all:initial}
    .ic{position:absolute;width:22px;height:22px;border-radius:6px;border:1.5px solid #14001A;background:linear-gradient(135deg,#FF284B,#7624C4);cursor:pointer;display:grid;place-items:center;padding:0}
    .ic svg{width:13px;height:13px;stroke:#fff;fill:none;stroke-width:2.6}
    .menu,.box{position:absolute;width:260px;background:#1C1B20;color:#F6F4F8;border:1px solid rgba(255,255,255,.14);border-radius:10px;box-shadow:0 10px 30px rgba(0,0,0,.45);font:14px/1.35 Roboto,"Segoe UI",system-ui,sans-serif;overflow:hidden}
    .hd{display:flex;align-items:center;gap:8px;padding:9px 12px;border-bottom:1px solid rgba(255,255,255,.08);font-weight:700}
    .gr{font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.03em;padding:8px 12px 2px}
    .r{display:block;width:100%;text-align:left;border:0;background:none;color:inherit;padding:8px 12px;cursor:pointer;font:inherit}
    .r:hover{background:#302F37} .r b{display:block;font-size:14px} .r span{font-size:13px}
    .vuoto{padding:10px 12px}
    .menu.chrome{width:280px;background:#fff;color:#1f1f1f;border:1px solid #dadce0;border-radius:8px;box-shadow:0 2px 10px rgba(0,0,0,.2);padding:4px 0}
    .chrome .r{display:flex;align-items:center;gap:12px;padding:8px 14px}
    .chrome .r:hover{background:#f1f3f4}
    .chrome .lg{width:24px;height:24px;border-radius:6px;flex:none;object-fit:cover;background:linear-gradient(135deg,#FF284B,#7624C4);color:#fff;display:grid;place-items:center;font:700 12px sans-serif}
    .chrome .tx b{display:block;font-size:14px;font-weight:500;color:#1f1f1f}
    .chrome .tx span{display:block;font-size:13px;color:#1f1f1f;letter-spacing:2px}
    .chrome .tx{flex:1;min-width:0}
    .chrome .fonte{flex:none;display:inline-flex;width:18px;height:18px;color:#1f1f1f}
    .chrome .fonte svg{width:18px;height:18px;stroke:currentColor;fill:none;stroke-width:2}
    .chrome .fonte{cursor:pointer;width:30px;height:30px;border-radius:6px;display:grid;place-items:center;margin-right:-6px}
    .chrome .fonte:hover{background:#e3e3e3}
    .chrome .tx .nome{letter-spacing:0;font-size:13px;color:#1f1f1f;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    .ant{position:absolute;width:260px;background:#fff;color:#1f1f1f;border:1px solid #dadce0;border-radius:8px;box-shadow:0 2px 10px rgba(0,0,0,.2);font:14px/1.35 Roboto,"Segoe UI",system-ui,sans-serif;padding:12px 14px;display:flex;flex-direction:column;gap:8px}
    .ant .tit{display:flex;align-items:center;gap:8px;font-size:15px;font-weight:700}
    .ant .tit svg{width:16px;height:16px;stroke:#1f1f1f;fill:none;stroke-width:2}
    .ant .et{font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.03em;color:#C2185B}
    .ant .va{font-size:14px;color:#1f1f1f;word-break:break-all}
    .chrome .sep{height:1px;background:#dadce0;margin:4px 0}
    .chrome .gest{font-size:14px;color:#1f1f1f}
    .box{padding:12px;display:flex;flex-direction:column;gap:9px}
    .box input{background:#25242B;border:1px solid rgba(255,255,255,.14);border-radius:8px;color:#F6F4F8;padding:8px 10px;font:inherit}
    .pieno{height:40px;border:0;border-radius:8px;background:linear-gradient(90deg,#E0306A,#B52E8C,#8A2BA8);color:#fff;font:600 15px Roboto,"Segoe UI",sans-serif;cursor:pointer}
    .vuotob{height:36px;border:1px solid rgba(255,255,255,.14);border-radius:8px;background:#25242B;color:#F6F4F8;font:inherit;cursor:pointer}
    .box input::placeholder{color:#F6F4F8;opacity:.85}
    .ok{color:#47C97E;font-weight:700}
  </style>`;
  const lucchetto = '<svg viewBox="0 0 24 24"><rect x="5" y="10" width="14" height="10" rx="2"/><path d="M8.5 10V7.5a3.5 3.5 0 0 1 7 0V10"/></svg>';
  const attacca = () => { if (!ospite.isConnected) document.documentElement.appendChild(ospite); };

  const visibile = (i) => { const r = i.getBoundingClientRect(); return r.width > 30 && r.height > 12 && getComputedStyle(i).visibility !== 'hidden'; };
  // Destinatari, ricerche e simili non sono mai un campo di accesso (campo «Destinatario»). Si guardano nome,
  // id, scritte, etichetta e anche la scritta accanto al campo (spesso in una cella o in un elemento prima, non in un <label>).
  const NON_LOGIN = /destinatar|recipient|empf[aä]nger|destinataire|beneficiar|search|cerca|ricerca|suche|recherche|newsletter|coupon/i;
  const NON_LOGIN_NOME = /^(to|cc|bcc|a|q|query)$/i;
  function testoVicino(u) {
    let t = '';
    // Solo una scritta corta subito prima del campo o della sua cella, come un'etichetta: non i titoli o i menu della pagina.
    for (let el = u, k = 0; el && el !== document.body && k < 2; el = el.parentElement, k++) {
      if (k === 1 && (el.tagName === 'FORM' || el.querySelectorAll('input, select, textarea').length > 1)) break;
      let testo = '';
      for (let n = el.previousSibling; n && testo.length <= 40; n = n.previousSibling) {
        if (n.nodeType === 1 && n.querySelector?.('input, select, textarea')) break;
        testo = `${(n.textContent || '').trim()} ${testo}`.trim();
        if (testo) break;
      }
      if (testo && testo.length <= 40) t += ` ${testo}`;
    }
    return t;
  }
  const eNonLogin = (u) => NON_LOGIN_NOME.test(u.name || '') || NON_LOGIN_NOME.test(u.id || '')
    || NON_LOGIN.test(`${u.name} ${u.id} ${u.placeholder} ${u.getAttribute('aria-label') || ''} ${(u.labels && u.labels[0]?.textContent) || ''} ${u.autocomplete} ${testoVicino(u)}`);
  function campiUtente(pw) {
    const ambito = pw.form || document;
    const tutti = [...ambito.querySelectorAll('input')].filter((i) => visibile(i));
    const k = tutti.indexOf(pw);
    for (let j = k - 1; j >= 0; j--) {
      const i = tutti[j];
      if (['text', 'email', 'tel', ''].includes((i.type || '').toLowerCase())) return eNonLogin(i) ? null : i;
    }
    return null;
  }
  // Un campo password resta tale anche quando l'occhio del sito lo rende visibile (type=text): prima ci scrivevamo l'email (Helsana, 13.11.2026).
  const erePassword = new WeakSet();
  const ePassword = (i) => Boolean(i) && (i.type === 'password' || erePassword.has(i));
  const passwordDelForm = (pw) => [...(pw.form || document).querySelectorAll('input[type=password]')].filter(visibile);
  const eIscrizione = (pw) => (pw.autocomplete || '').includes('new-password') || passwordDelForm(pw).length >= 2;

  let compilando = false; // mentre DiGiPass scrive nei campi il menu non si riapre da solo
  function scrivi(campo, valore) {
    if (!campo) return;
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    compilando = true;
    campo.focus();
    setTimeout(() => { compilando = false; }, 300);
    set.call(campo, valore);
    campo.dispatchEvent(new Event('input', { bubbles: true }));
    campo.dispatchEvent(new Event('change', { bubbles: true }));
  }

  // ---------- icona e menu ----------
  let menu = null;
  const chiudiMenu = () => { menu?.remove(); menu = null; ombra.querySelector('.ant')?.remove(); };
  document.addEventListener('mousedown', (e) => { if (menu && !e.composedPath().includes(ospite)) chiudiMenu(); }, true);

  // Tendina come quella di Chrome: chiara e piccola sotto il campo, una riga per login
  // (logo del sito, nome utente, password a puntini), in fondo «Gestisci password…» che apre la web app.
  async function apriMenu(campo) {
    chiudiMenu();
    attacca();
    const pw = ePassword(campo) ? campo : passwordDelForm(campo)[0] || [...document.querySelectorAll('input[type=password]')].find(visibile);
    const r = campo.getBoundingClientRect();
    menu = document.createElement('div');
    menu.className = 'menu chrome';
    menu.style.left = `${r.left + scrollX}px`;
    menu.style.top = `${r.bottom + scrollY + 2}px`;
    ombra.appendChild(menu);
    const mio = menu;
    const risposta = await chiedi({ a: 'perSito' });
    if (menu !== mio) return;
    const riga = (sinistra, titolo, sotto, azione) => {
      const b = document.createElement('button'); b.className = 'r';
      const t = document.createElement('span'); t.className = 'tx';
      const tb = document.createElement('b'); tb.textContent = titolo; t.append(tb);
      if (sotto) { const ts = document.createElement('span'); ts.textContent = sotto; if (sotto !== '••••••••') ts.className = 'nome'; t.append(ts); }
      b.append(sinistra, t); b.addEventListener('click', azione); return b;
    };
    // Cassaforte o Memoria siti (12.11.2026): icona piccola a destra, le stesse del menu dell'app.
    const FONTE = {
      'Cassaforte': '<svg viewBox="0 0 24 24"><rect x="4" y="10" width="16" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/></svg>',
      'Memoria siti': '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/></svg>',
    };
    const fonte = (nome) => { const f = document.createElement('span'); f.className = 'fonte'; f.title = nome; f.setAttribute('aria-label', nome); f.innerHTML = FONTE[nome] || ''; return f; };
    const iniziale = (testo) => { const d = document.createElement('span'); d.className = 'lg'; d.textContent = (testo || '?')[0].toUpperCase(); return d; };
    const logo = (testo) => {
      const d = iniziale(testo);
      chiedi({ a: 'icona', dominio: location.hostname.replace(/^www\./, '') }).then((x) => {
        if (!x?.dati) return; const im = document.createElement('img'); im.className = 'lg'; im.src = x.dati; d.replaceWith(im);
      });
      return d;
    };
    // Pagina scollegata dall'estensione (aperta prima di un aggiornamento): non è bloccata.
    if (risposta?.errore === 'estensione') {
      menu.append(riga(iniziale('D'), 'Ricarica la pagina', '', () => chiudiMenu()));
      return;
    }
    if (risposta?.errore) {
      menu.append(riga(iniziale('D'), 'DiGiPass', String(risposta.errore), () => chiudiMenu()));
      return;
    }
    if (risposta?.bloccato) {
      menu.append(riga(iniziale('D'), 'Sblocca DiGiPass', 'DiGiPass è bloccato', () => { chiedi({ a: 'apriFinestra' }); chiudiMenu(); }));
      return;
    }
    if (pw && eIscrizione(pw)) {
      menu.append(riga(iniziale('+'), 'Usa una password forte', 'creata adesso da DiGiPass', async () => {
        const { password } = await chiedi({ a: 'genera' });
        for (const p of passwordDelForm(pw)) scrivi(p, password);
        await chiedi({ a: 'copiaSuggerita', testo: password });
        chiudiMenu();
      }));
    }
    for (const x of risposta.voci || []) {
      const r = riga(logo(x.titolo), x.utente || 'senza nome utente', x.titolo || '••••••••', async () => {
        const d = await chiedi({ a: 'compila', id: x.id });
        if (d?.password !== undefined) {
          // Una voce «senza nome utente» non svuota il campo dell'email (AWS, 13.11.2026): si scrive solo quello che c'è.
          if (d.utente) scrivi(pw ? campiUtente(pw) : campo, d.utente);
          if (pw) scrivi(pw, d.password);
        }
        chiudiMenu();
      });
      if (FONTE[x.fonte]) {
        const f = fonte(x.fonte);
        f.addEventListener('click', async (e) => {
          e.stopPropagation();
          ombra.querySelector('.ant')?.remove();
          const d = await chiedi({ a: 'anteprima', id: x.id });
          if (!d || d.errore || d.bloccato || menu !== mio) return;
          const box = document.createElement('div'); box.className = 'ant';
          const rr = r.getBoundingClientRect(), mr = menu.getBoundingClientRect();
          box.style.left = `${mr.right + scrollX + 6}px`; box.style.top = `${rr.top + scrollY}px`;
          const tit = document.createElement('div'); tit.className = 'tit'; tit.innerHTML = FONTE[x.fonte]; tit.append(d.titolo || x.titolo || ''); box.append(tit);
          for (const [et, va] of [['Dove', x.fonte], ['Sito', d.sito], ['Nome utente', d.utente], ['Password', '••••••••'], ['Note', d.note]]) {
            if (!va) continue;
            const e1 = document.createElement('div'); e1.className = 'et'; e1.textContent = et;
            const e2 = document.createElement('div'); e2.className = 'va'; e2.textContent = va;
            box.append(e1, e2);
          }
          ombra.appendChild(box);
        });
        r.append(f);
      }
      menu.append(r);
    }
    const sep = document.createElement('div'); sep.className = 'sep';
    if (menu.children.length) menu.append(sep);
    const g = riga(iniziale('D'), 'Gestisci password…', '', () => { chiedi({ a: 'gestisci' }); chiudiMenu(); });
    g.querySelector('.lg').style.cssText = 'background:linear-gradient(135deg,#FF284B,#7624C4)';
    menu.append(g);
  }

  // Come in Chrome: cliccando nel campo l'elenco si apre da solo, se per il sito ci sono login salvati
  // (o è un'iscrizione). Se DiGiPass è bloccato lo dice una volta per pagina, con «Sblocca DiGiPass».
  let bloccoMostrato = false;
  const campiId = new WeakMap(); let prossimoId = 1;
  let aprendo = false;
  async function apriDaSolo(campo) {
    if (aprendo || compilando || (menu && menu.dataset.campo === String(campiId.get(campo)))) return;
    aprendo = true;
    try {
    const r = await chiedi({ a: 'perSito' });
    if (r?.errore) return;
    const pw = ePassword(campo) ? campo : passwordDelForm(campo)[0];
    if (r?.bloccato) { if (bloccoMostrato) return; bloccoMostrato = true; }
    else if (!(r?.voci || []).length && !(pw && eIscrizione(pw))) return;
    if (document.activeElement !== campo) return;
    await apriMenu(campo);
    if (menu) menu.dataset.campo = String(campiId.get(campo));
    } finally { aprendo = false; }
  }
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') chiudiMenu(); }, true);

  const icone = new Map();
  function posiziona() {
    for (const [campo, ic] of icone) {
      if (!campo.isConnected || !visibile(campo)) { ic.remove(); icone.delete(campo); continue; }
      const r = campo.getBoundingClientRect();
      // Se sul bordo destro c'è già un pulsante del sito (l'occhio della password), il lucchetto va alla sua sinistra.
      let x = r.right - 28;
      for (const el of document.elementsFromPoint(x + 11, r.top + r.height / 2)) {
        if (el === ospite) continue;
        const re = el.getBoundingClientRect();
        if (el !== campo && !el.contains(campo) && re.left > r.left + r.width / 2) x = re.left - 26;
        break;
      }
      ic.style.left = `${x + scrollX}px`;
      ic.style.top = `${r.top + scrollY + (r.height - 22) / 2}px`;
    }
  }
  // Login in due passi (Amazon, Google, Microsoft…): prima pagina col solo campo email/utente, senza password.
  const SOLO_UTENTE = 'input[autocomplete~="username"],input[autocomplete~="email"],input[name*="email" i],input[id*="email" i],input[name*="user" i],input[id*="user" i],input[name*="login" i],input[id*="login" i]';
  function cerca() {
    if (escluso === null) { eEscluso().then(() => cerca()); return; }
    const campi = [];
    for (const pw of document.querySelectorAll('input[type=password]')) {
      if (visibile(pw)) { erePassword.add(pw); campi.push(pw, campiUtente(pw)); }
    }
    if (![...document.querySelectorAll('input[type=password]')].some(visibile)) {
      // Oltre a nome e id si guardano tipo, segnaposto, etichetta e aria-label: molti siti chiamano il campo in modo libero.
      const parole = /e-?mail|utente|username|user|login|account|accedi|log ?in|sign ?in|telefono|phone|identifier/i;
      // Solo i veri login a due passi: un modulo (o la pagina, se non c'è un modulo) con al massimo 2 campi visibili.
      // Nelle anagrafiche e nei moduli indirizzo il campo email non è un login.
      const NON_CAMPI = ['hidden', 'submit', 'button', 'reset', 'checkbox', 'radio', 'image', 'file'];
      const campiVisibili = (ambito) => [...ambito.querySelectorAll('input, select, textarea')]
        .filter((x) => !NON_CAMPI.includes((x.type || '').toLowerCase()) && visibile(x)).length;
      for (const u of document.querySelectorAll('input')) {
        if (!visibile(u) || !['text', 'email', 'tel', ''].includes((u.type || '').toLowerCase())) continue;
        if (campiVisibili(u.form || document) > 2) continue;
        if (tipoCampoCarta(u)) continue;
        if (identitaViste.has(u)) continue;
        const etichetta = (u.labels && u.labels[0]?.textContent) || '';
        // Destinatari, ricerche e simili non sono mai un login, e il solo tipo email non basta (campo «Destinatario»).
        if (eNonLogin(u)) continue;
        if (u.matches(SOLO_UTENTE) || parole.test(`${u.placeholder} ${u.getAttribute('aria-label') || ''} ${etichetta} ${u.autocomplete}`)) campi.push(u);
      }
    }
    {
      for (const campo of campi) {
        if (!campo || icone.has(campo) || !ammesso(campo) || carteViste.has(campo)) continue;
        attacca();
        const ic = document.createElement('button');
        ic.className = 'ic'; ic.title = 'DiGiPass'; ic.innerHTML = lucchetto;
        ic.addEventListener('mousedown', (e) => e.preventDefault());
        ic.addEventListener('click', () => apriMenu(campo));
        campiId.set(campo, prossimoId++);
        // Niente tendina della cronologia moduli di Chrome sotto la nostra: sui campi utente/email
        // Chrome la rispetta con autocomplete="off". Sulle password non serve (Chrome lì mostra il suo gestore password).
        if (campo.type !== 'password') campo.setAttribute('autocomplete', 'off');
        // La tendina si apre solo col clic vero nel campo, come Chrome: non quando il sito rimette il cursore
        // nel campo (l'occhio di Helsana la riapriva, 13.11.2026).
        campo.addEventListener('click', () => { if (!menu) apriDaSolo(campo); });
        ombra.appendChild(ic);
        icone.set(campo, ic);
      }
    }
    posiziona();
  }
  // ---------- carte di credito: tendina sui campi della carta con le carte della Cassaforte ----------
  function tipoCampoCarta(el) {
    const ac = (el.getAttribute('autocomplete') || '').toLowerCase();
    if (/\bcc-number\b/.test(ac)) return 'numero';
    if (/\bcc-exp-month\b/.test(ac)) return 'mese';
    if (/\bcc-exp-year\b/.test(ac)) return 'anno';
    if (/\bcc-exp\b/.test(ac)) return 'scadenza';
    if (/\bcc-csc\b/.test(ac)) return 'cvv';
    if (/\bcc-name\b/.test(ac)) return 'titolare';
    const t = `${el.name || ''} ${el.id || ''} ${el.getAttribute('placeholder') || ''} ${el.getAttribute('aria-label') || ''}`.toLowerCase().replace(/[_-]/g, '');
    if (!t.trim()) return null;
    if (/cardnumber|ccnumber|ccnum|numerocarta|numero carta|numero della carta|kartennummer/.test(t)) return 'numero';
    if (/cvv|cvc|csc|securitycode|codice di sicurezza|codicesicurezza/.test(t)) return 'cvv';
    if (/cardholder|nameoncard|holdername|ccname|titolare|intestatario|karteninhaber/.test(t)) return 'titolare';
    if (/expmonth|expirymonth|expirationmonth|mesescadenza|ccmonth/.test(t)) return 'mese';
    if (/expyear|expiryyear|expirationyear|annoscadenza|ccyear/.test(t)) return 'anno';
    if (/expiry|expiration|expdate|scadenza|ablaufdatum|ccexp|mm\s*\/\s*(aa|yy)/.test(t)) return 'scadenza';
    return null;
  }
  function scegli(sel, varianti) {
    const opz = [...sel.options];
    const o = opz.find((x) => varianti.some((v) => v && (x.value === v || x.text.trim() === v)))
      || opz.find((x) => varianti.some((v) => v && v.length > 1 && (x.value.endsWith(v) || x.text.trim().endsWith(v))));
    if (!o) return;
    sel.value = o.value;
    sel.dispatchEvent(new Event('input', { bubbles: true }));
    sel.dispatchEvent(new Event('change', { bubbles: true }));
  }
  async function compilaCarta(campo, id) {
    const d = await chiedi({ a: 'compilaCarta', id });
    if (!d || d.errore || d.bloccato) return;
    const numero = String(d.numero || '').replace(/\D/g, '');
    const [m0, a0] = String(d.scadenza || '').split('/');
    const mm = (m0 || '').replace(/\D/g, '').padStart(2, '0').slice(-2);
    const aa = (a0 || '').replace(/\D/g, '');
    const a4 = aa.length === 2 ? `20${aa}` : aa;
    const a2 = a4.slice(-2);
    for (const el of (campo.form || document).querySelectorAll('input, select')) {
      if (!visibile(el) || !ammesso(el)) continue;
      const t = tipoCampoCarta(el);
      if (!t) continue;
      if (el.tagName === 'SELECT') {
        if (t === 'mese' && aa) scegli(el, [mm, String(+mm)]);
        else if (t === 'anno' && aa) scegli(el, [a4, a2]);
        continue;
      }
      const lungo = /aaaa|yyyy/i.test(el.getAttribute('placeholder') || '') || el.maxLength === 7;
      const v = {
        numero,
        titolare: d.titolare || '',
        cvv: d.cvv || '',
        mese: aa ? mm : '',
        anno: aa ? (el.maxLength === 2 || /^(aa|yy)$/i.test(el.getAttribute('placeholder') || '') ? a2 : a4) : '',
        scadenza: aa ? (lungo ? `${mm}/${a4}` : `${mm}/${a2}`) : '',
      }[t];
      if (v) scrivi(el, v);
    }
  }
  const rigaMenu = (sinistra, titolo, sotto, azione) => {
    const b = document.createElement('button'); b.className = 'r';
    const t = document.createElement('span'); t.className = 'tx';
    const tb = document.createElement('b'); tb.textContent = titolo; t.append(tb);
    if (sotto) { const ts = document.createElement('span'); ts.textContent = sotto; t.append(ts); }
    b.append(sinistra, t); b.addEventListener('click', azione); return b;
  };
  const inizialeMenu = (testo) => { const d = document.createElement('span'); d.className = 'lg'; d.textContent = (testo || '?')[0].toUpperCase(); return d; };
  async function apriCarte(campo, risposta) {
    chiudiMenu();
    attacca();
    const r = campo.getBoundingClientRect();
    menu = document.createElement('div');
    menu.className = 'menu chrome';
    menu.style.left = `${r.left + scrollX}px`;
    menu.style.top = `${r.bottom + scrollY + 2}px`;
    menu.dataset.campo = String(campiId.get(campo));
    ombra.appendChild(menu);
    const mio = menu;
    const x = risposta || await chiedi({ a: 'carte' });
    if (menu !== mio) return;
    if (x?.errore === 'estensione') { menu.append(rigaMenu(inizialeMenu('D'), 'Ricarica la pagina', '', () => chiudiMenu())); return; }
    if (x?.errore) { menu.append(rigaMenu(inizialeMenu('D'), 'DiGiPass', String(x.errore), () => chiudiMenu())); return; }
    if (x?.bloccato) { menu.append(rigaMenu(inizialeMenu('D'), 'Sblocca DiGiPass', 'DiGiPass è bloccato', () => { chiedi({ a: 'apriFinestra' }); chiudiMenu(); })); return; }
    for (const c of x.carte || []) {
      menu.append(rigaMenu(inizialeMenu(c.tipo), c.titolo, `${c.tipo} •••• ${c.ultime}`, async () => { await compilaCarta(campo, c.id); chiudiMenu(); }));
    }
    if (menu.children.length) { const sep = document.createElement('div'); sep.className = 'sep'; menu.append(sep); }
    const g = rigaMenu(inizialeMenu('D'), 'Gestisci carte…', '', () => { chiedi({ a: 'gestisci' }); chiudiMenu(); });
    g.querySelector('.lg').style.cssText = 'background:linear-gradient(135deg,#FF284B,#7624C4)';
    menu.append(g);
  }
  async function apriCarteDaSolo(campo) {
    if (aprendo || compilando || (menu && menu.dataset.campo === String(campiId.get(campo)))) return;
    aprendo = true;
    try {
      const x = await chiedi({ a: 'carte' });
      if (x?.errore) return;
      if (x?.bloccato) { if (bloccoMostrato) return; bloccoMostrato = true; } else if (!(x?.carte || []).length) return;
      if (document.activeElement !== campo) return;
      await apriCarte(campo, x);
    } finally { aprendo = false; }
  }
  const carteViste = new WeakSet();
  function cercaCarte() {
    // icone carta solo se nella pagina c'è un campo «numero carta» (le date di un contratto non sono una carta)
    const riconosciuti = [];
    let haNumero = false;
    for (const el of document.querySelectorAll('input')) {
      if (!visibile(el) || !ammesso(el)) continue;
      if (['hidden', 'submit', 'button', 'checkbox', 'radio', 'password'].includes((el.type || '').toLowerCase()) && !(el.type === 'password' && tipoCampoCarta(el) === 'cvv')) continue;
      const t = tipoCampoCarta(el);
      if (!t) continue;
      if (t === 'numero') haNumero = true;
      if (!carteViste.has(el) && !icone.has(el)) riconosciuti.push(el);
    }
    if (!haNumero) riconosciuti.length = 0;
    for (const el of riconosciuti) {
      carteViste.add(el);
      attacca();
      const ic = document.createElement('button');
      ic.className = 'ic'; ic.title = 'DiGiPass'; ic.innerHTML = lucchetto;
      ic.addEventListener('mousedown', (e) => e.preventDefault());
      ic.addEventListener('click', () => apriCarte(el));
      campiId.set(el, prossimoId++);
      el.addEventListener('focus', () => apriCarteDaSolo(el));
      el.addEventListener('click', () => { if (!menu) apriCarteDaSolo(el); });
      ombra.appendChild(ic);
      icone.set(el, ic);
    }
    posiziona();
  }
  new MutationObserver(() => requestAnimationFrame(cercaCarte)).observe(document.documentElement, { childList: true, subtree: true });
  cercaCarte();

  // ---------- identità (CHECKLIST 10.4): moduli di dati personali senza password, con almeno 2 campi d'identità ----------
  const AC_IDENTITA = { 'given-name': 'nome', 'family-name': 'cognome', 'additional-name': 'secondoNome', name: 'nomeCompleto', email: 'email', tel: 'telefono', 'tel-national': 'telefono',
    'street-address': 'indirizzo', 'address-line1': 'indirizzo', 'postal-code': 'cap', 'address-level2': 'citta', 'address-level1': 'provincia', country: 'paese', 'country-name': 'paese',
    organization: 'organizzazione', bday: 'nascita' };
  function tipoCampoIdentita(el) {
    for (const t of (el.getAttribute('autocomplete') || '').toLowerCase().split(/\s+/)) if (AC_IDENTITA[t]) return AC_IDENTITA[t];
    const t = `${el.name || ''} ${el.id || ''}`.toLowerCase().replace(/[_-]/g, '');
    if (!t.trim()) return null;
    if (/firstname|givenname|vorname|prenom|^nome$|\bnome\b/.test(t)) return 'nome';
    if (/lastname|surname|familyname|cognome|nachname/.test(t)) return 'cognome';
    if (/fullname|nomecompleto/.test(t)) return 'nomeCompleto';
    if (/postcode|postalcode|zipcode|\bzip\b|\bplz\b|\bcap\b/.test(t)) return 'cap';
    if (/\bcity\b|citta|comune|\btown\b|\bort\b|localita/.test(t)) return 'citta';
    if (/street|indirizzo|address1|addressline|strasse|\bvia\b/.test(t)) return 'indirizzo';
    if (/province|provincia|\bregion\b|\bstate\b|kanton/.test(t)) return 'provincia';
    if (/country|paese|nazione/.test(t)) return 'paese';
    if (/company|azienda|organization|organizzazione|ditta/.test(t)) return 'organizzazione';
    if (/phone|telefono|mobile|cellulare/.test(t)) return 'telefono';
    if (/e?mail/.test(t)) return 'email';
    return null;
  }
  const campiIdentita = (ambito) => [...ambito.querySelectorAll('input, select')].filter((x) => visibile(x) && !['hidden', 'submit', 'button', 'checkbox', 'radio', 'password'].includes((x.type || '').toLowerCase()) && !tipoCampoCarta(x) && tipoCampoIdentita(x));
  async function compilaIdentita(campo, id) {
    const d = await chiedi({ a: 'compilaIdentita', id });
    if (!d?.campi) return;
    const c = d.campi;
    for (const el of campiIdentita(campo.form || document)) {
      if (!ammesso(el)) continue;
      const k = tipoCampoIdentita(el);
      const v = k === 'nomeCompleto' ? (c.nomeCompleto || [c.nome, c.secondoNome, c.cognome].filter(Boolean).join(' ')) : k === 'organizzazione' ? (c.organizzazione || c.azienda) : c[k];
      if (!v) continue;
      if (el.tagName === 'SELECT') scegli(el, [v]); else scrivi(el, v);
    }
  }
  async function apriIdentita(campo, risposta) {
    chiudiMenu(); attacca();
    const r = campo.getBoundingClientRect();
    menu = document.createElement('div'); menu.className = 'menu chrome';
    menu.style.left = `${r.left + scrollX}px`; menu.style.top = `${r.bottom + scrollY + 2}px`;
    menu.dataset.campo = String(campiId.get(campo));
    ombra.appendChild(menu);
    const mio = menu;
    const x = risposta || await chiedi({ a: 'identita' });
    if (menu !== mio) return;
    if (x?.errore === 'estensione') { menu.append(rigaMenu(inizialeMenu('D'), 'Ricarica la pagina', '', () => chiudiMenu())); return; }
    if (x?.errore) { menu.append(rigaMenu(inizialeMenu('D'), 'DiGiPass', String(x.errore), () => chiudiMenu())); return; }
    if (x?.bloccato) { menu.append(rigaMenu(inizialeMenu('D'), 'Sblocca DiGiPass', 'DiGiPass è bloccato', () => { chiedi({ a: 'apriFinestra' }); chiudiMenu(); })); return; }
    for (const i of x.identita || []) menu.append(rigaMenu(inizialeMenu(i.titolo), i.titolo, i.sotto, async () => { await compilaIdentita(campo, i.id); chiudiMenu(); }));
    if (!menu.children.length) { chiudiMenu(); return; }
  }
  async function apriIdentitaDaSolo(campo) {
    if (aprendo || compilando || (menu && menu.dataset.campo === String(campiId.get(campo)))) return;
    aprendo = true;
    try {
      const x = await chiedi({ a: 'identita' });
      if (x?.errore || x?.spento || x?.bloccato || !(x?.identita || []).length) return;
      if (document.activeElement !== campo) return;
      await apriIdentita(campo, x);
    } finally { aprendo = false; }
  }
  const identitaViste = new WeakSet();
  function cercaIdentita() {
    if ([...document.querySelectorAll('input[type=password]')].some(visibile)) return;
    const moduli = new Set([...document.querySelectorAll('input')].map((i) => i.form || document));
    for (const ambito of moduli) {
      const campi = campiIdentita(ambito);
      const tipi = new Set(campi.map(tipoCampoIdentita));
      if (tipi.size < 2 || ![...tipi].some((t) => t !== 'email' && t !== 'telefono')) continue;
      for (const el of campi) {
        if (el.tagName !== 'INPUT' || identitaViste.has(el) || icone.has(el) || !ammesso(el)) continue;
        identitaViste.add(el);
        campiId.set(el, prossimoId++);
        el.addEventListener('focus', () => apriIdentitaDaSolo(el));
        el.addEventListener('click', () => { if (!menu) apriIdentitaDaSolo(el); });
      }
    }
  }

  // ---------- codici 2FA (CHECKLIST 10.4): campi «codice monouso» ----------
  const totpVisti = new WeakSet();
  function cercaTotp() {
    for (const el of document.querySelectorAll('input[autocomplete~="one-time-code"], input[name*="otp" i], input[id*="otp" i], input[name*="totp" i], input[name*="2fa" i]')) {
      if (totpVisti.has(el) || !visibile(el) || !ammesso(el)) continue;
      totpVisti.add(el);
      campiId.set(el, prossimoId++);
      el.addEventListener('focus', async () => {
        if (aprendo || compilando) return;
        const x = await chiedi({ a: 'totpDelSito' });
        if (!(x?.codici || []).length || document.activeElement !== el) return;
        chiudiMenu(); attacca();
        const r = el.getBoundingClientRect();
        menu = document.createElement('div'); menu.className = 'menu chrome';
        menu.style.left = `${r.left + scrollX}px`; menu.style.top = `${r.bottom + scrollY + 2}px`;
        ombra.appendChild(menu);
        for (const c of x.codici) menu.append(rigaMenu(inizialeMenu(c.titolo), `Codice 2FA · ${c.titolo}`, c.codice, () => { scrivi(el, c.codice); chiudiMenu(); }));
      });
    }
  }
  new MutationObserver(() => requestAnimationFrame(() => { cercaIdentita(); cercaTotp(); })).observe(document.documentElement, { childList: true, subtree: true });
  cercaIdentita(); cercaTotp();

  // Login in due passi sulla stessa pagina: il campo password è già nella pagina ma nascosto, e al passo 2
  // viene solo mostrato (cambia style/class, nessun elemento aggiunto) con un'animazione: si guardano questi cambi, la fine
  // delle animazioni e, come ultima rete, il campo in cui si clicca (prima del clic, così la tendina si apre già al primo).
  let cercaPrevista = false;
  const pianificaCerca = () => { if (cercaPrevista) return; cercaPrevista = true; requestAnimationFrame(() => { cercaPrevista = false; cerca(); }); };
  new MutationObserver(pianificaCerca).observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['style', 'class', 'hidden', 'type'] });
  document.addEventListener('animationend', pianificaCerca, true);
  document.addEventListener('transitionend', pianificaCerca, true);
  document.addEventListener('focusin', (e) => { if (e.target?.tagName === 'INPUT' && !icone.has(e.target) && escluso !== null) cerca(); }, true);
  addEventListener('resize', posiziona); addEventListener('scroll', posiziona, true);
  cerca();

  // ---------- salvataggio dei login nuovi ----------
  // Login in due pagine (AWS, Google, Microsoft…): nella pagina della password il campo dell'email non c'è più, e la voce
  // veniva salvata «senza nome utente». Il nome utente scritto nella prima pagina si passa all'estensione,
  // che lo tiene 10 minuti per quella scheda e lo usa quando arriva la password dello stesso sito.
  function ricordaUtente() {
    if ([...document.querySelectorAll('input[type=password]')].some(visibile)) return;
    for (const [campo] of icone) {
      if (ePassword(campo) || carteViste.has(campo) || !ammesso(campo)) continue;
      const v = (campo.value || '').trim();
      if (v.length >= 3 && v.length <= 200) { chiedi({ a: 'utentePasso1', utente: v }); return; }
    }
  }
  // Alcuni siti tengono l'email in un campo nascosto nella pagina della password: si usa solo se non c'è altro.
  function utenteNascosto(form) {
    for (const i of (form || document).querySelectorAll?.('input[type=hidden]') || []) {
      const v = (i.value || '').trim();
      if (v.length >= 3 && v.length <= 200 && !/\s/.test(v) && (/\b(username|email)\b/i.test(i.autocomplete || '') || /e-?mail|user(name)?|login/i.test(`${i.name} ${i.id}`)) && (v.includes('@') || /user|login/i.test(`${i.name} ${i.id}`))) return v;
    }
    return '';
  }
  let ultimo = '';
  async function forseSalva(form) {
    await eEscluso();
    const primo = (form || document).querySelector?.('input[type=password]');
    if (!ammesso(primo)) return;
    // Solo moduli di accesso: un modulo con note o testi lunghi (es. una scheda da modificare) non è un login.
    if ((form || document).querySelector?.('textarea') || form?.closest?.('[data-digipass-ignore]')) return;
    const pw = [...(form || document).querySelectorAll('input[type=password]')].find((p) => p.value);
    if (!pw || eIscrizione(pw) && passwordDelForm(pw).length >= 3) return; // cambio password con 3 campi: si lascia stare
    const utente = campiUtente(pw)?.value || '';
    const chiave = `${utente}\n${pw.value}`;
    if (chiave === ultimo) return;
    ultimo = chiave;
    const valore = pw.value;
    const r = await chiedi({ a: 'salvaLogin', utente, nascosto: utente ? '' : utenteNascosto(form), password: valore });
    // Se la pagina non cambia, la domanda compare qui; se cambia, la fa la pagina dopo (inSospeso).
    if (r?.proposta) setTimeout(() => mostraProposta(r.proposta, valore), 1200);
  }
  async function controllaSospeso() {
    const p = await chiedi({ a: 'inSospeso' });
    if (p?.proposta) mostraProposta(p.proposta, '');
  }
  if (window.top === window) setTimeout(controllaSospeso, 800);
  document.addEventListener('submit', (e) => { ricordaUtente(); forseSalva(e.target); }, true);
  document.addEventListener('click', (e) => {
    let b = e.target.closest?.('button,input[type=submit],input[type=button],[role=button],a');
    // Pulsante finto (div/span con scritto Accedi, Login…): si risale finché il testo è corto.
    if (!b) { let x = e.target; while (x && x !== document.body && !b) { if ((x.textContent || '').trim().length <= 30 && /accedi|entra|login|log ?in|sign ?in|continua|avanti/i.test(x.textContent || '')) b = x; x = x.parentElement; } }
    // Anche i pulsanti finti (div o link con scritto Accedi/Login/Entra…) dei login fatti in JavaScript.
    if (b && (b.matches('button,input,[role=button]') || /accedi|entra|login|log ?in|sign ?in|continua|avanti/i.test(b.textContent || '')))
      { ricordaUtente(); setTimeout(() => forseSalva(b.form || b.closest('form')), 0); }
  }, true);
  document.addEventListener('keydown', (e) => { if (e.key !== 'Enter') return; if (e.target?.type === 'password') forseSalva(e.target.form); else if (e.target?.tagName === 'INPUT') ricordaUtente(); }, true);

  // Domanda come quella di Chrome: «Salvare nella Memoria siti?» Salva / No / Metti in cassaforte.
  let propostaMostrata = '';
  function mostraProposta(p, password) {
    const chiaveP = `${p.sito}
${p.utente}`;
    if (propostaMostrata === chiaveP && ombra.querySelector('.box')) return;
    propostaMostrata = chiaveP;
    attacca();
    ombra.querySelector('.box')?.remove();
    const box = document.createElement('div');
    box.className = 'box';
    box.style.cssText = 'position:fixed;right:16px;top:16px;width:320px';
    const cambiata = p.tipo === 'cassaforte' || p.tipo === 'memoria';
    box.innerHTML = `<b class="tit"></b><span class="sito"></span><span class="ut"></span><div class="rigapw"><span class="pw">••••••••</span><button class="vuotob mostra" style="height:28px;padding:0 10px">Mostra</button></div>`
      + `<button class="pieno salva"></button><button class="vuotob lucchetto">🔒 Metti in cassaforte</button><button class="vuotob no">No</button>`;
    box.querySelector('.tit').textContent = p.tipo === 'cassaforte' ? 'Aggiornare la password nella Cassaforte?' : p.tipo === 'memoria' ? 'Aggiornare la password nella Memoria siti?' : 'Salvare nella Memoria siti?';
    box.querySelector('.tit').style.cssText = 'font-size:16px';
    box.querySelector('.sito').textContent = p.sito;
    box.querySelector('.ut').textContent = p.utente || 'senza nome utente';
    box.querySelector('.rigapw').style.cssText = 'display:flex;align-items:center;justify-content:space-between;gap:8px';
    const mostra = box.querySelector('.mostra');
    if (!password) mostra.remove();
    else mostra.addEventListener('click', () => { const v = box.querySelector('.pw'); const nasc = v.textContent.startsWith('•'); v.textContent = nasc ? password : '••••••••'; mostra.textContent = nasc ? 'Nascondi' : 'Mostra'; });
    const salva = box.querySelector('.salva');
    salva.textContent = p.tipo === 'cassaforte' ? 'Aggiorna' : 'Salva';
    if (p.tipo === 'cassaforte') box.querySelector('.lucchetto').remove();
    const fatto = (testo) => { box.innerHTML = ''; const d = document.createElement('div'); d.className = 'ok'; d.textContent = testo; box.append(d); setTimeout(() => box.remove(), 2500); };
    // Esito vero (prima ogni errore diceva «bloccato»). Se non riesce, il riquadro resta per riprovare.
    const esito = (r, ok) => {
      if (r?.inAttesa) return fatto('DiGiPass è bloccato: lo salvo appena lo sblocchi');
      if (r?.ok) return fatto(ok(r));
      let e = box.querySelector('.errore'); if (!e) { e = document.createElement('div'); e.className = 'errore'; e.style.cssText = 'color:#FF6B6B;font-weight:700'; box.insertBefore(e, salva); }
      e.textContent = `Non salvato: ${r?.errore === 'estensione' ? 'l’estensione non ha risposto, riprova' : r?.errore || 'errore sconosciuto'}`;
    };
    salva.addEventListener('click', async () => esito(await chiedi({ a: 'conferma', scelta: p.tipo === 'cassaforte' ? 'cassaforte' : 'memoria' }), (r) => `✓ Salvato in ${r.dove || 'Memoria siti'}`));
    box.querySelector('.lucchetto')?.addEventListener('click', async () => esito(await chiedi({ a: 'conferma', scelta: 'cassaforte' }), () => '✓ Messo in cassaforte'));
    box.querySelector('.no').addEventListener('click', async () => { await chiedi({ a: 'conferma', scelta: 'no' }); box.remove(); });
    ombra.appendChild(box);
  }
})();

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
  function campiUtente(pw) {
    const ambito = pw.form || document;
    const tutti = [...ambito.querySelectorAll('input')].filter((i) => visibile(i));
    const k = tutti.indexOf(pw);
    for (let j = k - 1; j >= 0; j--) {
      const i = tutti[j];
      if (['text', 'email', 'tel', ''].includes((i.type || '').toLowerCase())) return i;
    }
    return null;
  }
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
  const chiudiMenu = () => { menu?.remove(); menu = null; };
  document.addEventListener('mousedown', (e) => { if (menu && !e.composedPath().includes(ospite)) chiudiMenu(); }, true);

  // Tendina come quella di Chrome: chiara e piccola sotto il campo, una riga per login
  // (logo del sito, nome utente, password a puntini), in fondo «Gestisci password…» che apre la web app.
  async function apriMenu(campo) {
    chiudiMenu();
    attacca();
    const pw = campo.type === 'password' ? campo : passwordDelForm(campo)[0] || [...document.querySelectorAll('input[type=password]')].find(visibile);
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
      if (sotto) { const ts = document.createElement('span'); ts.textContent = sotto; t.append(ts); }
      b.append(sinistra, t); b.addEventListener('click', azione); return b;
    };
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
      menu.append(riga(logo(x.titolo), x.utente || 'senza nome utente', '••••••••', async () => {
        const d = await chiedi({ a: 'compila', id: x.id });
        if (d?.password !== undefined) {
          scrivi(pw ? campiUtente(pw) : campo, d.utente);
          scrivi(pw, d.password);
        }
        chiudiMenu();
      }));
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
    const pw = campo.type === 'password' ? campo : passwordDelForm(campo)[0];
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
      ic.style.left = `${r.right + scrollX - 28}px`;
      ic.style.top = `${r.top + scrollY + (r.height - 22) / 2}px`;
    }
  }
  // Login in due passi (Amazon, Google, Microsoft…): prima pagina col solo campo email/utente, senza password.
  const SOLO_UTENTE = 'input[autocomplete~="username"],input[autocomplete~="email"],input[type=email],input[name*="email" i],input[id*="email" i],input[name*="user" i],input[id*="user" i],input[name*="login" i],input[id*="login" i]';
  function cerca() {
    if (escluso === null) { eEscluso().then(() => cerca()); return; }
    const campi = [];
    for (const pw of document.querySelectorAll('input[type=password]')) {
      if (visibile(pw)) campi.push(pw, campiUtente(pw));
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
        if (u.matches(SOLO_UTENTE) || u.type === 'email' || u.inputMode === 'email' || parole.test(`${u.placeholder} ${u.getAttribute('aria-label') || ''} ${etichetta} ${u.autocomplete}`)) campi.push(u);
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
        campo.addEventListener('focus', () => apriDaSolo(campo));
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
    for (const el of document.querySelectorAll('input')) {
      if (carteViste.has(el) || icone.has(el) || !visibile(el) || !ammesso(el)) continue;
      if (['hidden', 'submit', 'button', 'checkbox', 'radio', 'password'].includes((el.type || '').toLowerCase()) && !(el.type === 'password' && tipoCampoCarta(el) === 'cvv')) continue;
      if (!tipoCampoCarta(el)) continue;
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

  new MutationObserver(() => requestAnimationFrame(cerca)).observe(document.documentElement, { childList: true, subtree: true });
  addEventListener('resize', posiziona); addEventListener('scroll', posiziona, true);
  cerca();

  // ---------- salvataggio dei login nuovi ----------
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
    const r = await chiedi({ a: 'salvaLogin', utente, password: valore });
    // Se la pagina non cambia, la domanda compare qui; se cambia, la fa la pagina dopo (inSospeso).
    if (r?.proposta) setTimeout(() => mostraProposta(r.proposta, valore), 1200);
  }
  async function controllaSospeso() {
    const p = await chiedi({ a: 'inSospeso' });
    if (p?.proposta) mostraProposta(p.proposta, '');
  }
  if (window.top === window) setTimeout(controllaSospeso, 800);
  document.addEventListener('submit', (e) => forseSalva(e.target), true);
  document.addEventListener('click', (e) => {
    let b = e.target.closest?.('button,input[type=submit],input[type=button],[role=button],a');
    // Pulsante finto (div/span con scritto Accedi, Login…): si risale finché il testo è corto.
    if (!b) { let x = e.target; while (x && x !== document.body && !b) { if ((x.textContent || '').trim().length <= 30 && /accedi|entra|login|log ?in|sign ?in|continua|avanti/i.test(x.textContent || '')) b = x; x = x.parentElement; } }
    // Anche i pulsanti finti (div o link con scritto Accedi/Login/Entra…) dei login fatti in JavaScript.
    if (b && (b.matches('button,input,[role=button]') || /accedi|entra|login|log ?in|sign ?in|continua|avanti/i.test(b.textContent || '')))
      setTimeout(() => forseSalva(b.form || b.closest('form')), 0);
  }, true);
  document.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target?.type === 'password') forseSalva(e.target.form); }, true);

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

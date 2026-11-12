import 'dart:convert';
import 'dart:io';
import 'dart:typed_data';

import 'package:crypto/crypto.dart' as h;

import 'allegati.dart';
import 'archivio.dart';
import 'cripto.dart';

/// Sincronizzazione con il server di DiGiPass sul NAS.
/// La cassaforte resta sempre intera sul telefono (funziona anche col NAS spento); al NAS vanno solo voci cifrate.
/// Stato segreto (cookie di sessione, chiave di accesso, versioni) in sync.bin, cifrato con la chiave dei dati.
class Sincronia {
  Sincronia(this.archivio);
  final Archivio archivio;

  String url = '', utente = '';
  Map<String, dynamic> _s = {};
  String ultimoErrore = '';
  DateTime? ultimaVolta;
  bool _inCorso = false;

  bool get collegato => url.isNotEmpty && (_s['accesso'] ?? '').toString().isNotEmpty;
  File get _f => File('${archivio.cartella}/sync.bin');
  File get _fConf => File('${archivio.cartella}/nas.json');

  Future<void> carica() async {
    if (_fConf.existsSync()) {
      final j = jsonDecode(await _fConf.readAsString()) as Map<String, dynamic>;
      url = j['url'] ?? '';
      utente = j['utente'] ?? '';
    }
    final k = archivio.chiave;
    if (k == null || !_f.existsSync()) return;
    try {
      _s = jsonDecode(utf8.decode(await Cripto.decifra(k, await _f.readAsBytes(), aadExtra: 'digipass-sync'))) as Map<String, dynamic>;
    } catch (_) {
      _s = {};
    }
  }

  Future<void> _salvaStato() async {
    final k = archivio.chiave;
    if (k == null) return;
    await _fConf.writeAsString(jsonEncode({'url': url, 'utente': utente}));
    final tmp = File('${_f.path}.tmp');
    await tmp.writeAsBytes(await Cripto.cifra(k, Uint8List.fromList(utf8.encode(jsonEncode(_s))), aadExtra: 'digipass-sync'), flush: true);
    await tmp.rename(_f.path);
  }

  Future<void> scollega() async {
    _s = {};
    url = '';
    utente = '';
    if (_f.existsSync()) await _f.delete();
    if (_fConf.existsSync()) await _fConf.delete();
  }

  // ---------- Loghi dei siti ----------
  // Il NAS li prende dal sito stesso e li tiene in cache: nessun servizio esterno vede i siti.
  final Map<String, Future<Uint8List?>> _loghi = {};
  Future<Uint8List?> logo(String dominio) => _loghi.putIfAbsent(dominio, () => _scaricaLogo(dominio));
  Future<Uint8List?> _scaricaLogo(String d) async {
    if (url.isEmpty) return null;
    final c = HttpClient()..connectionTimeout = const Duration(seconds: 12);
    try {
      final r = await c.getUrl(Uri.parse('$url/api/icona/${Uri.encodeComponent(d)}'));
      r.headers.set('User-Agent', 'DiGiPass-Android');
      final cookie = (_s['cookie'] as Map?)?.cast<String, String>() ?? {};
      if (cookie.isNotEmpty) r.headers.set('Cookie', cookie.entries.map((e) => '${e.key}=${e.value}').join('; '));
      final res = await r.close().timeout(const Duration(seconds: 30));
      if (res.statusCode != 200 || res.headers.contentType?.primaryType != 'image') {
        await res.drain<void>();
        if (res.statusCode == 401) _loghi.remove(d); // sessione scaduta: si riprova dopo la sincronizzazione
        return null;
      }
      final b = BytesBuilder();
      await for (final p in res) {
        b.add(p);
      }
      return b.takeBytes();
    } catch (_) {
      _loghi.remove(d);
      return null;
    } finally {
      c.close(force: true);
    }
  }

  // ---------- HTTP ----------
  Future<(int, Map<String, dynamic>)> _chiama(String metodo, String percorso, [Object? corpo]) async {
    final c = HttpClient()..connectionTimeout = const Duration(seconds: 12);
    try {
      final r = await c.openUrl(metodo, Uri.parse('$url$percorso'));
      r.headers.set('User-Agent', 'DiGiPass-Android');
      r.headers.set('Accept', 'application/json');
      final cookie = (_s['cookie'] as Map?)?.cast<String, String>() ?? {};
      if (cookie.isNotEmpty) r.headers.set('Cookie', cookie.entries.map((e) => '${e.key}=${e.value}').join('; '));
      if ((_s['csrf'] ?? '').toString().isNotEmpty) r.headers.set('X-CSRF-Token', _s['csrf']);
      if (corpo != null) {
        r.headers.contentType = ContentType.json;
        r.write(jsonEncode(corpo));
      }
      final res = await r.close().timeout(const Duration(seconds: 30));
      for (final sc in res.headers[HttpHeaders.setCookieHeader] ?? <String>[]) {
        final kv = sc.split(';').first;
        final i = kv.indexOf('=');
        if (i <= 0) continue;
        final m = Map<String, String>.from(cookie);
        final v = kv.substring(i + 1);
        if (v.isEmpty || sc.contains('Max-Age=0')) {
          m.remove(kv.substring(0, i));
        } else {
          m[kv.substring(0, i)] = v;
        }
        _s['cookie'] = m;
        cookie
          ..clear()
          ..addAll(m);
      }
      final testo = await res.transform(utf8.decoder).join();
      Map<String, dynamic> j = {};
      try {
        final d = jsonDecode(testo);
        if (d is Map<String, dynamic>) j = d;
      } catch (_) {}
      return (res.statusCode, j);
    } finally {
      c.close(force: true);
    }
  }

  // ---------- allegati: al NAS solo byte già cifrati (lib/allegati.dart) ----------
  Future<(int, Uint8List, Map<String, dynamic>)> _binario(String metodo, String percorso, [Uint8List? corpo]) async {
    final c = HttpClient()..connectionTimeout = const Duration(seconds: 12);
    try {
      final r = await c.openUrl(metodo, Uri.parse('$url$percorso'));
      r.headers.set('User-Agent', 'DiGiPass-Android');
      final cookie = (_s['cookie'] as Map?)?.cast<String, String>() ?? {};
      if (cookie.isNotEmpty) r.headers.set('Cookie', cookie.entries.map((e) => '${e.key}=${e.value}').join('; '));
      if ((_s['csrf'] ?? '').toString().isNotEmpty) r.headers.set('X-CSRF-Token', _s['csrf']);
      if (corpo != null) {
        r.headers.contentType = ContentType('application', 'octet-stream');
        r.contentLength = corpo.length;
        r.add(corpo);
      }
      final res = await r.close().timeout(const Duration(minutes: 3));
      final b = BytesBuilder(copy: false);
      await for (final p in res) {
        b.add(p);
      }
      final dati = b.takeBytes();
      Map<String, dynamic> j = {};
      if (res.headers.contentType?.mimeType == 'application/json') {
        try {
          j = jsonDecode(utf8.decode(dati)) as Map<String, dynamic>;
        } catch (_) {}
      }
      return (res.statusCode, dati, j);
    } finally {
      c.close(force: true);
    }
  }

  /// Sessione col NAS scaduta: si rientra con la chiave di accesso, come nella sincronizzazione.
  Future<bool> _rientra() async {
    final (s1, l) = await _chiama('POST', '/api/auth/login', {'username': utente, 'password': _s['accesso'], 'code': '', 'remember': false});
    if (s1 != 200) return false;
    _s['csrf'] = l['csrf'];
    await _salvaStato();
    return true;
  }

  Future<(int, Uint8List, Map<String, dynamic>)> _binarioConAccesso(String metodo, String percorso, [Uint8List? corpo]) async {
    var r = await _binario(metodo, percorso, corpo);
    if (r.$1 == 401 && await _rientra()) r = await _binario(metodo, percorso, corpo);
    return r;
  }

  /// null se è andato bene, altrimenti il messaggio del NAS (troppo grande, spazio pieno) o «NAS non raggiungibile».
  Future<String?> caricaAllegato(String id, Uint8List cifrato) async {
    try {
      final (s, _, j) = await _binarioConAccesso('PUT', '/api/allegati/$id', cifrato);
      return s == 200 ? null : (j['error']?.toString() ?? 'Errore $s dal NAS');
    } catch (_) {
      return 'NAS non raggiungibile';
    }
  }

  Future<Uint8List?> scaricaAllegato(String id) async {
    try {
      final (s, b, _) = await _binarioConAccesso('GET', '/api/allegati/$id');
      return s == 200 ? b : null;
    } catch (_) {
      return null;
    }
  }

  Future<bool> cancellaAllegato(String id) async {
    try {
      final (s, _, _) = await _binarioConAccesso('DELETE', '/api/allegati/$id');
      return s == 200 || s == 404;
    } catch (_) {
      return false;
    }
  }

  /// Spazio usato e massimo degli allegati sul NAS, o null se non raggiungibile.
  Future<(int, int)?> spazioAllegati() async {
    if (!collegato) return null;
    try {
      var (s, j) = await _chiama('GET', '/api/allegati');
      if (s == 401 && await _rientra()) (s, j) = await _chiama('GET', '/api/allegati');
      return s == 200 ? ((j['usato'] as num).toInt(), (j['massimo'] as num).toInt()) : null;
    } catch (_) {
      return null;
    }
  }

  Never _errore(int stato, Map<String, dynamic> j) => throw HttpException(j['error']?.toString() ?? 'Errore $stato dal NAS');

  Future<Map<String, dynamic>> stato(String indirizzo) async {
    url = indirizzo.trim().replaceAll(RegExp(r'/+$'), '');
    final (s, j) = await _chiama('GET', '/api/auth/status');
    if (s != 200) _errore(s, j);
    return j;
  }

  /// Chiave di accesso per il server, dalla password principale e dalle chiavi locali.
  Future<String> _accessoDa(String password, Map<String, dynamic> chiavi) async {
    final kdf = chiavi['kdf'] as Map<String, dynamic>;
    final sale = base64Decode(chiavi['salePw']);
    final kek = await Cripto.chiaveDaPassword(password, sale, m: kdf['m'], t: kdf['t'], p: kdf['p']);
    return Cripto.chiaveAccesso(kek, sale);
  }

  // ---------- prima configurazione dal telefono ----------
  Future<Map<String, dynamic>> iniziaConfigurazione(String indirizzo, String nome, String codiceSetup) async {
    await stato(indirizzo);
    utente = nome.trim();
    final (s, j) = await _chiama('POST', '/api/auth/setup/start', {'username': utente, 'codiceSetup': codiceSetup.trim()});
    if (s != 200) _errore(s, j);
    return j;
  }

  /// Completa la configurazione: crea una chiave di recupero nuova (va sul foglio di emergenza con i 10 codici).
  Future<(String, List<String>)> completaConfigurazione(String token, String password, String codice) async {
    if (!await archivio.verificaPassword(password)) throw const HttpException('Password principale sbagliata');
    final recupero = await archivio.nuovaRecupero();
    final chiavi = await archivio.chiaviPubbliche();
    final accesso = await _accessoDa(password, chiavi);
    final saleRec = base64Decode(chiavi['saleRec']);
    final accRec = await Cripto.accessoRecupero(await Cripto.chiaveDaRecupero(recupero, saleRec), saleRec);
    final (s, j) = await _chiama('POST', '/api/auth/setup/complete', {'setupToken': token, 'password': accesso, 'code': codice, 'chiavi': chiavi, 'accessoRecupero': accRec, 'remember': true});
    if (s != 200) _errore(s, j);
    _s['csrf'] = j['csrf'];
    _s['accesso'] = accesso;
    _s['aggiornate'] = DateTime.now().millisecondsSinceEpoch;
    await _salvaStato();
    await sincronizza();
    return (recupero, (j['codiciRiserva'] as List).cast<String>());
  }

  /// Collega a una cassaforte già presente sul NAS (telefono nuovo o app reinstallata, oppure dopo la prima configurazione).
  Future<void> accedi(String indirizzo, String nome, String password, String codice, {bool ricorda = true}) async {
    await stato(indirizzo);
    utente = nome.trim();
    final (s0, pre) = await _chiama('POST', '/api/auth/prelogin', {'username': utente});
    if (s0 != 200) _errore(s0, pre);
    final kdf = pre['kdf'] as Map<String, dynamic>;
    final sale = base64Decode(pre['salePw']);
    final kek = await Cripto.chiaveDaPassword(password, sale, m: kdf['m'], t: kdf['t'], p: kdf['p']);
    final accesso = await Cripto.chiaveAccesso(kek, sale);
    final (s, j) = await _chiama('POST', '/api/auth/login', {'username': utente, 'password': accesso, 'code': codice, 'remember': ricorda});
    if (s != 200) _errore(s, j);
    _s['csrf'] = j['csrf'];
    final (s2, chiavi) = await _chiama('GET', '/api/chiavi');
    if (s2 != 200) _errore(s2, chiavi);
    final dek = await Cripto.decifra(kek, base64Decode(chiavi['dekPw']));
    if (archivio.aperto) {
      if (base64Encode(dek) != base64Encode(archivio.chiave!)) {
        throw const HttpException('Sul NAS c\'è un\'altra cassaforte: per usarla, reinstalla l\'app e scegli «Ho già DiGiPass sul NAS».');
      }
    } else {
      await archivio.adottaChiavi(chiavi, dek);
    }
    _s['accesso'] = accesso;
    _s['aggiornate'] = chiavi['aggiornate'];
    await _salvaStato();
    await sincronizza();
  }

  // ---------- sincronizzazione ----------
  static String impronta(Map<String, dynamic> v) => h.sha256.convert(utf8.encode(jsonEncode(v))).toString();

  /// Scarica i cambi, li fonde con quelli del telefono e manda i propri. Non fa niente se non è collegato.
  Future<bool> sincronizza() async {
    if (!collegato || !archivio.aperto || _inCorso) return false;
    _inCorso = true;
    try {
      await archivio.ricarica(avvisa: false);
      var (s, j) = await _chiama('GET', '/api/sync?da=${_s['rev'] ?? 0}');
      if (s == 401) {
        // Sessione scaduta: si rientra con la chiave di accesso; il telefono è un dispositivo ricordato (90 giorni).
        final (s1, l) = await _chiama('POST', '/api/auth/login', {'username': utente, 'password': _s['accesso'], 'code': '', 'remember': false});
        if (s1 != 200) throw HttpException('Accedi di nuovo al NAS dalle impostazioni (${l['error'] ?? s1})');
        _s['csrf'] = l['csrf'];
        (s, j) = await _chiama('GET', '/api/sync?da=${_s['rev'] ?? 0}');
      }
      if (s != 200) _errore(s, j);
      final stato = Map<String, dynamic>.from(_s['stato'] ?? {});
      // Copia della chiave e controllo del giro: se la cassaforte si blocca a metà, ci si ferma (niente cancellazioni
      // mandate al NAS per una cassaforte che sembra vuota solo perché è chiusa).
      final giro = archivio.giro;
      void aperta() {
        if (!archivio.aperto || archivio.giro != giro) throw const HttpException("Cassaforte bloccata durante l'aggiornamento");
      }
      final dek = Uint8List.fromList(archivio.chiave!);
      var cambiato = false;
      for (final r in (j['voci'] as List).cast<Map<String, dynamic>>()) {
        final id = r['id'] as String, tipo = r['tipo'] as String;
        final lista = tipo == 'voce' ? archivio.tutteLeVoci : archivio.memoria;
        final i = lista.indexWhere((x) => x['id'] == id);
        final st = stato[id] as Map<String, dynamic>?;
        if (r['cancellata'] == true) {
          if (i >= 0 && (st == null || impronta(lista[i]) == st['hash'])) {
            lista.removeAt(i);
            cambiato = true;
          }
          stato[id] = {'versione': r['versione'], 'hash': 'x', 'tipo': tipo, 'cancellata': true};
          continue;
        }
        Map<String, dynamic> loro;
        try {
          loro = await Cripto.decifraVoce(dek, id, r['blob']);
        } catch (_) {
          continue;
        }
        if (i < 0) {
          final cancellataQui = st != null && st['versione'] == r['versione'] && st['cancellata'] != true;
          if (!cancellataQui) {
            lista.add(loro);
            cambiato = true;
          }
        } else {
          final miaCambiata = st == null || impronta(lista[i]) != st['hash'];
          final loroPiuNuova = ((loro['modificata'] ?? 0) as num) >= ((lista[i]['modificata'] ?? 0) as num);
          if (!miaCambiata || loroPiuNuova) {
            lista[i] = loro;
            cambiato = true;
          }
        }
        stato[id] = {'versione': r['versione'], 'hash': impronta(loro), 'tipo': tipo};
      }
      aperta();
      if (cambiato) await archivio.salva();
      // Invio dei cambi del telefono.
      Future<void> invia(String id, String tipo, Map<String, dynamic>? v) async {
        aperta();
        final st = stato[id] as Map<String, dynamic>?;
        final corpo = {'tipo': tipo, 'base': st?['versione'] ?? 0, 'cancellata': v == null, 'blob': v == null ? '' : await Cripto.cifraVoce(dek, id, v)};
        final (s3, r3) = await _chiama('PUT', '/api/sync/$id', corpo);
        if (s3 == 200) {
          stato[id] = {'versione': r3['versione'], 'hash': v == null ? 'x' : impronta(v), 'tipo': tipo, if (v == null) 'cancellata': true};
        } else if (s3 == 409) {
          stato[id] = {...?st, 'versione': (r3['attuale'] as Map)['versione']};
        } else {
          _errore(s3, r3);
        }
      }

      final presenti = <String>{};
      for (final (tipo, lista) in [('voce', archivio.tutteLeVoci), ('sito', archivio.memoria)]) {
        for (final v in List<Map<String, dynamic>>.from(lista)) {
          final id = v['id'] as String;
          presenti.add(id);
          if ((stato[id] as Map?)?['hash'] != impronta(v)) await invia(id, tipo, v);
        }
      }
      for (final e in stato.entries.toList()) {
        final st = e.value as Map<String, dynamic>;
        if (!presenti.contains(e.key) && st['cancellata'] != true) await invia(e.key, st['tipo'] ?? 'voce', null);
      }
      _s['stato'] = stato;
      _s['rev'] = j['rev'];
      // Il nome utente vero lo sa il server (es. dopo un cambio di nome): si tiene allineato.
      final (s5, me) = await _chiama('GET', '/api/auth/me');
      if (s5 == 200 && (me['username'] ?? '').toString().isNotEmpty) utente = me['username'];
      // Password cambiata dalla webapp: le chiavi nuove valgono anche qui.
      final (s4, ch) = await _chiama('GET', '/api/chiavi');
      if (s4 == 200 && (ch['aggiornate'] ?? 0) > (_s['aggiornate'] ?? 0)) {
        aperta();
        await archivio.adottaChiavi(ch, dek);
        _s['aggiornate'] = ch['aggiornate'];
      }
      await _salvaStato();
      try {
        await Allegati.inSincronia();
      } catch (_) {/* gli allegati riprovano la volta dopo */}
      ultimoErrore = '';
      ultimaVolta = DateTime.now();
      return true;
    } catch (e) {
      ultimoErrore = e is HttpException ? e.message : 'NAS non raggiungibile';
      return false;
    } finally {
      _inCorso = false;
    }
  }

  /// Nuovo foglio di emergenza quando il telefono è collegato: chiave di recupero e 10 codici di riserva nuovi.
  Future<(String, List<String>)> nuovoFoglio(String password, String codice) async {
    if (!await archivio.verificaPassword(password)) throw const HttpException('Password principale sbagliata');
    final chiaviPrima = await archivio.chiaviPubbliche();
    final accesso = await _accessoDa(password, chiaviPrima);
    final recupero = Cripto.nuovaRecupero();
    final saleRec = Cripto.casuali(16);
    final rec = await Cripto.chiaveDaRecupero(recupero, saleRec);
    final chiavi = {...chiaviPrima, 'saleRec': base64Encode(saleRec), 'dekRec': base64Encode(await Cripto.cifra(rec, archivio.chiave!))};
    final (s, j) = await _chiama('POST', '/api/auth/foglio', {'password': accesso, 'code': codice, 'chiavi': chiavi, 'accessoRecupero': await Cripto.accessoRecupero(rec, saleRec)});
    if (s != 200) _errore(s, j);
    await archivio.adottaChiavi(chiavi, archivio.chiave!);
    final (s2, ch) = await _chiama('GET', '/api/chiavi');
    if (s2 == 200) _s['aggiornate'] = ch['aggiornate'];
    await _salvaStato();
    return (recupero, (j['codiciRiserva'] as List).cast<String>());
  }

  /// Cambio della password principale quando il telefono è collegato: lo sa anche il NAS (serve il codice).
  Future<void> cambiaPassword(String nuova, String codice) async {
    final vecchio = _s['accesso'];
    final chiavi = await archivio.chiaviPerPassword(nuova);
    final accesso = await _accessoDa(nuova, chiavi);
    final (s, j) = await _chiama('POST', '/api/auth/password', {'currentPassword': vecchio, 'code': codice, 'newPassword': accesso, 'chiavi': chiavi});
    if (s != 200) _errore(s, j);
    await archivio.adottaChiavi(chiavi, archivio.chiave!);
    _s['accesso'] = accesso;
    final (s2, ch) = await _chiama('GET', '/api/chiavi');
    if (s2 == 200) _s['aggiornate'] = ch['aggiornate'];
    await _salvaStato();
  }
}

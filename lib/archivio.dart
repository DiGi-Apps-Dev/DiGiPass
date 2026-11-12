import 'dart:convert';
import 'dart:io';

import 'package:flutter/foundation.dart';

import 'cripto.dart';
import 'nativo.dart';

/// Tipi di voce della Cassaforte, con i campi di ciascuno (chiave, etichetta, nascosto).
class TipoVoce {
  const TipoVoce(this.id, this.nome, this.campi, {this.sezioni = const {}});
  final String id;
  final String nome;
  final List<(String, String, bool)> campi;
  /// Titolo di sezione da mostrare prima del campo con quella chiave (identità: dati personali, indirizzo, contatti, lavoro).
  final Map<String, String> sezioni;

  // CHECKLIST 1.1 e 9.4: «email» è il campo email separato, mostrato quando in Impostazioni c'è «nome utente separato».
  static const login = TipoVoce('login', 'Login', [('email', 'Email', false), ('utente', 'Nome utente o email', false), ('password', 'Password', true)]);
  static const nota = TipoVoce('nota', 'Nota', []);
  static const carta = TipoVoce('carta', 'Carta', [
    ('titolare', 'Titolare', false),
    ('numero', 'Numero', true),
    ('scadenza', 'Scadenza (MM/AA)', false),
    ('cvv', 'CVV', true),
    ('pin', 'PIN', true),
  ]);
  // CHECKLIST 1.4: dati personali, indirizzo, contatti, lavoro. Le chiavi vecchie restano uguali (web ed estensione le leggono).
  static const identita = TipoVoce('identita', 'Identità', [
    ('nome', 'Nome', false),
    ('secondoNome', 'Secondo nome', false),
    ('cognome', 'Cognome', false),
    ('nomeCompleto', 'Nome completo', false),
    ('nascita', 'Data di nascita', false),
    ('sesso', 'Sesso', false),
    ('email', 'Email', false),
    ('telefono', 'Telefono', false),
    ('indirizzo', 'Via e numero', false),
    ('piano', 'Piano', false),
    ('cap', 'CAP', false),
    ('citta', 'Città', false),
    ('provincia', 'Provincia o stato', false),
    ('contea', 'Contea', false),
    ('paese', 'Paese', false),
    ('organizzazione', 'Organizzazione', false),
    ('telefono2', 'Secondo telefono', false),
    ('sito', 'Sito', false),
    ('patente', 'N° patente', false),
    ('documento', 'Documento (n° passaporto o carta d\'identità)', true),
    ('previdenza', 'N° previdenza sociale (AVS)', true),
    ('linkedin', 'LinkedIn', false),
    ('x', 'X', false),
    ('facebook', 'Facebook', false),
    ('instagram', 'Instagram', false),
    ('reddit', 'Reddit', false),
    ('yahoo', 'Yahoo', false),
    ('azienda', 'Azienda', false),
    ('ruolo', 'Ruolo', false),
    ('emailLavoro', 'Email di lavoro', false),
    ('telefonoLavoro', 'Telefono di lavoro', false),
    ('sitoPersonale', 'Sito personale', false),
  ], sezioni: {'nome': 'Dati personali', 'indirizzo': 'Indirizzo', 'telefono2': 'Contatti', 'azienda': 'Lavoro'});
  static const wifi = TipoVoce('wifi', 'Wi-Fi', [('ssid', 'Nome rete', false), ('password', 'Password', true), ('sicurezza', 'Sicurezza (WPA, WEP…)', false)]);

  static const tutti = [login, nota, carta, identita, wifi];

  /// Tipo della carta dal numero (CHECKLIST 1.3), solo da mostrare.
  static String tipoCarta(String numero) {
    final d = numero.replaceAll(RegExp(r'\D'), '');
    if (d.isEmpty) return '';
    int p(int n) => int.tryParse(d.length >= n ? d.substring(0, n) : d) ?? 0;
    final p2 = p(2), p3 = p(3), p4 = p(4);
    if (d.startsWith('4')) return 'Visa';
    if ((p2 >= 51 && p2 <= 55) || (p4 >= 2221 && p4 <= 2720)) return 'Mastercard';
    if (p2 == 34 || p2 == 37) return 'American Express';
    if (p4 == 6011 || p2 == 65 || (p3 >= 644 && p3 <= 649)) return 'Discover';
    if (p4 >= 3528 && p4 <= 3589) return 'JCB';
    if (p2 == 36 || p2 == 38 || (p3 >= 300 && p3 <= 305)) return 'Diners Club';
    if (p2 == 62) return 'UnionPay';
    if (p2 == 50 || (p2 >= 56 && p2 <= 69)) return 'Maestro';
    return '';
  }
  static TipoVoce di(String id) => tutti.firstWhere((t) => t.id == id, orElse: () => nota);
}

/// Cassaforte e Memoria siti, cifrate in vault.bin; chiavi in chiavi.json. Stesso formato letto dalla parte Kotlin.
class Archivio extends ChangeNotifier {
  late String _dir;
  Uint8List? _dek;
  Map<String, dynamic> _dati = {'v': 1, 'voci': [], 'memoria': []};

  bool get aperto => _dek != null;
  Uint8List? get chiave => _dek;
  List<Map<String, dynamic>> get tutteLeVoci => (_dati['voci'] as List).cast<Map<String, dynamic>>();
  List<Map<String, dynamic>> get voci => tutteLeVoci.where((v) => v['cestino'] == null).toList();
  List<Map<String, dynamic>> get cestino => tutteLeVoci.where((v) => v['cestino'] != null).toList();
  List<Map<String, dynamic>> get memoria => (_dati['memoria'] as List).cast<Map<String, dynamic>>();

  File get _fVault => File('$_dir/vault.bin');
  File get _fChiavi => File('$_dir/chiavi.json');

  Future<void> init() async => _dir = await Nativo.cartella();
  String get cartella => _dir;

  /// Chiamata dopo ogni salvataggio (la sincronizzazione col NAS).
  void Function()? dopoSalvataggio;

  /// Chiavi della cassaforte come le conserva il NAS (solo dati cifrati e parametri).
  Future<Map<String, dynamic>> chiaviPubbliche() async {
    final j = await _chiavi();
    return {'v': 1, 'kdf': j['kdf'], 'salePw': j['salePw'], 'dekPw': j['dekPw'], 'saleRec': j['saleRec'], 'dekRec': j['dekRec']};
  }

  Future<bool> verificaPassword(String password) async {
    final j = await _chiavi();
    final kdf = j['kdf'] as Map<String, dynamic>;
    final k = await Cripto.chiaveDaPassword(password, base64Decode(j['salePw']), m: kdf['m'], t: kdf['t'], p: kdf['p']);
    try {
      await Cripto.decifra(k, base64Decode(j['dekPw']));
      return true;
    } catch (_) {
      return false;
    }
  }

  /// Chiavi con una password nuova (la chiave di recupero resta quella di prima).
  Future<Map<String, dynamic>> chiaviPerPassword(String password) async {
    final j = await chiaviPubbliche();
    final sale = Cripto.casuali(16);
    final k = await Cripto.chiaveDaPassword(password, sale);
    j['kdf'] = {'alg': 'argon2id', 'm': Cripto.memoriaKiB, 't': Cripto.passaggi, 'p': Cripto.corsie};
    j['salePw'] = base64Encode(sale);
    j['dekPw'] = base64Encode(await Cripto.cifra(k, _dek!));
    return j;
  }

  /// Usa le chiavi arrivate dal NAS (password cambiata altrove, o telefono nuovo).
  Future<void> adottaChiavi(Map<String, dynamic> c, Uint8List dek) async {
    final j = {'v': 1, 'kdf': c['kdf'], 'salePw': c['salePw'], 'dekPw': c['dekPw'], 'saleRec': c['saleRec'], 'dekRec': c['dekRec']};
    final tmp = File('$_dir/chiavi.json.tmp');
    await tmp.writeAsString(jsonEncode(j), flush: true);
    await tmp.rename(_fChiavi.path);
    if (_dek == null) {
      _dek = Uint8List.fromList(dek);
      _dati = {'v': 1, 'voci': [], 'memoria': []};
      await _salvaSenzaAvviso();
      await Nativo.apriSessione(dek);
    }
  }
  bool get esiste => _fChiavi.existsSync();

  /// Prima volta: crea la DEK, la cifra con password principale e chiave di recupero. Ritorna la chiave di recupero.
  Future<String> crea(String password) async {
    final dek = Cripto.casuali(32);
    final recupero = Cripto.nuovaRecupero();
    await _scriviChiavi(dek, password: password, recupero: recupero);
    _dek = Uint8List.fromList(dek);
    _dati = {'v': 1, 'voci': [], 'memoria': []};
    await _salvaSenzaAvviso();
    await Nativo.apriSessione(dek);
    // Niente notifyListeners: prima si mostra il foglio di emergenza, poi pronto() apre la Cassaforte.
    return recupero;
  }

  void pronto() => notifyListeners();

  Future<void> _scriviChiavi(Uint8List dek, {String? password, String? recupero}) async {
    final old = _fChiavi.existsSync() ? jsonDecode(await _fChiavi.readAsString()) as Map<String, dynamic> : <String, dynamic>{};
    final j = Map<String, dynamic>.from(old)..['v'] = 1;
    if (password != null) {
      final sale = Cripto.casuali(16);
      final k = await Cripto.chiaveDaPassword(password, sale);
      j['kdf'] = {'alg': 'argon2id', 'm': Cripto.memoriaKiB, 't': Cripto.passaggi, 'p': Cripto.corsie};
      j['salePw'] = base64Encode(sale);
      j['dekPw'] = base64Encode(await Cripto.cifra(k, dek));
    }
    if (recupero != null) {
      final sale = Cripto.casuali(16);
      final k = await Cripto.chiaveDaRecupero(recupero, sale);
      j['saleRec'] = base64Encode(sale);
      j['dekRec'] = base64Encode(await Cripto.cifra(k, dek));
    }
    final tmp = File('$_dir/chiavi.json.tmp');
    await tmp.writeAsString(jsonEncode(j), flush: true);
    await tmp.rename(_fChiavi.path);
  }

  Future<Map<String, dynamic>> _chiavi() async => jsonDecode(await _fChiavi.readAsString()) as Map<String, dynamic>;

  /// Sblocco con la password principale. Falso se la password è sbagliata.
  Future<bool> sbloccaPassword(String password) async {
    final j = await _chiavi();
    final kdf = j['kdf'] as Map<String, dynamic>;
    final k = await Cripto.chiaveDaPassword(password, base64Decode(j['salePw']), m: kdf['m'], t: kdf['t'], p: kdf['p']);
    try {
      return await _apri(await Cripto.decifra(k, base64Decode(j['dekPw'])));
    } catch (_) {
      return false;
    }
  }

  /// Sblocco con la chiave di recupero del foglio di emergenza.
  Future<bool> sbloccaRecupero(String codice) async {
    final j = await _chiavi();
    final k = await Cripto.chiaveDaRecupero(codice, base64Decode(j['saleRec']));
    try {
      return await _apri(await Cripto.decifra(k, base64Decode(j['dekRec'])), avvisa: false);
    } catch (_) {
      return false;
    }
  }

  Future<bool> sbloccaChiave(Uint8List dek) async {
    try {
      return await _apri(dek);
    } catch (_) {
      return false;
    }
  }

  Future<bool> _apri(Uint8List dek, {bool avvisa = true}) async {
    _dek = Uint8List.fromList(dek);
    await ricarica(avvisa: avvisa);
    await Nativo.apriSessione(dek);
    if (avvisa) notifyListeners();
    return true;
  }

  /// Rilegge il file: l'autocompilazione può aver salvato un sito mentre l'app era in sottofondo.
  Future<void> ricarica({bool avvisa = true}) async {
    final k = _dek;
    if (k == null) return;
    if (!_fVault.existsSync()) return;
    final testo = utf8.decode(await Cripto.decifra(k, await _fVault.readAsBytes()));
    _dati = jsonDecode(testo) as Map<String, dynamic>;
    _dati['voci'] ??= [];
    _dati['memoria'] ??= [];
    if (avvisa) notifyListeners();
  }

  Future<void> salva() async {
    await _salvaSenzaAvviso();
    notifyListeners();
    dopoSalvataggio?.call();
  }

  Future<void> _salvaSenzaAvviso() async {
    final k = _dek;
    if (k == null) return;
    final blob = await Cripto.cifra(k, Uint8List.fromList(utf8.encode(jsonEncode(_dati))));
    final tmp = File('$_dir/vault.bin.tmp');
    await tmp.writeAsBytes(blob, flush: true);
    await tmp.rename(_fVault.path);
  }

  /// Cresce a ogni blocco: una sincronizzazione partita prima si ferma invece di lavorare su una cassaforte chiusa.
  int giro = 0;

  /// Chiude la cassaforte dell'app (tasto Blocca e blocco automatico). L'autocompilazione non si blocca mai
  /// («La compilazione non si deve mai bloccare»): la sua chiave resta nel Keystore.
  Future<void> blocca({bool tutto = false}) async {
    giro++;
    // La chiave arrivata dall'impronta (canale Android) è una lista non modificabile: azzerarla dava errore e il blocco
    // non avveniva mai (log del telefono, 12.11.2026). Ora _dek è sempre una copia nostra; l'azzeramento non può fermare il blocco.
    try {
      _dek?.fillRange(0, _dek!.length, 0);
    } catch (_) {}
    _dek = null;
    _dati = {'v': 1, 'voci': [], 'memoria': []};
    try {
      await (tutto ? Nativo.bloccaTutto() : Nativo.chiudiSessione());
    } finally {
      notifyListeners();
    }
  }

  Future<void> cambiaPassword(String nuova) async => _scriviChiavi(_dek!, password: nuova);
  Future<String> nuovaRecupero() async {
    final r = Cripto.nuovaRecupero();
    await _scriviChiavi(_dek!, recupero: r);
    return r;
  }

  // ---------- voci ----------
  static String nuovoId() => base64Url.encode(Cripto.casuali(12));

  /// Importazione (CHECKLIST 8.1): toglie le voci [togli] e aggiunge [nuove] con un solo salvataggio.
  Future<void> importaVoci(List<Map<String, dynamic>> nuove, {Set<String> togli = const {}}) async {
    await ricarica();
    final ora = DateTime.now().millisecondsSinceEpoch;
    final l = _dati['voci'] as List;
    if (togli.isNotEmpty) l.removeWhere((x) => togli.contains((x as Map)['id']));
    for (final v in nuove) {
      l.add({...v, 'id': nuovoId(), 'creata': ora, 'modificata': ora});
    }
    await salva();
  }

  /// Importazione in Memoria siti: toglie i siti [togli] e aggiunge [nuovi] con un solo salvataggio.
  Future<void> importaSiti(List<Map<String, dynamic>> nuovi, {Set<String> togli = const {}}) async {
    await ricarica();
    final ora = DateTime.now().millisecondsSinceEpoch;
    final l = _dati['memoria'] as List;
    if (togli.isNotEmpty) l.removeWhere((x) => togli.contains((x as Map)['id']));
    for (final s in nuovi) {
      l.add({...s, 'id': nuovoId(), 'creata': ora, 'modificata': ora});
    }
    await salva();
  }

  Future<void> salvaVoce(Map<String, dynamic> v) async {
    await ricarica();
    final ora = DateTime.now().millisecondsSinceEpoch;
    v['modificata'] = ora;
    v['creata'] ??= ora;
    final i = tutteLeVoci.indexWhere((x) => x['id'] == v['id']);
    if (i >= 0) {
      (_dati['voci'] as List)[i] = v;
    } else {
      (_dati['voci'] as List).add(v);
    }
    await salva();
  }

  Future<void> nelCestino(String id, bool si) async {
    await ricarica();
    final v = tutteLeVoci.firstWhere((x) => x['id'] == id);
    v['cestino'] = si ? DateTime.now().millisecondsSinceEpoch : null;
    await salva();
  }

  Future<void> eliminaDefinitiva(String id) async {
    await ricarica();
    (_dati['voci'] as List).removeWhere((x) => x['id'] == id);
    await salva();
  }

  Future<void> svuotaCestino() async {
    await ricarica();
    (_dati['voci'] as List).removeWhere((x) => x['cestino'] != null);
    await salva();
  }

  // ---------- memoria siti ----------
  Future<void> salvaSito(Map<String, dynamic> s) async {
    await ricarica();
    final ora = DateTime.now().millisecondsSinceEpoch;
    s['modificata'] = ora;
    s['creata'] ??= ora;
    final i = memoria.indexWhere((x) => x['id'] == s['id']);
    if (i >= 0) {
      (_dati['memoria'] as List)[i] = s;
    } else {
      (_dati['memoria'] as List).add(s);
    }
    await salva();
  }

  Future<void> eliminaSito(String id) async {
    await ricarica();
    (_dati['memoria'] as List).removeWhere((x) => x['id'] == id);
    await salva();
  }

  /// Import da file CSV di Chrome (name,url,username,password,note): tutto in Memoria siti. Ritorna (aggiunti, saltati).
  Future<(int, int)> importaChrome(String csv) async {
    await ricarica();
    final righe = leggiCsv(csv);
    if (righe.isEmpty) return (0, 0);
    final testa = righe.first.map((e) => e.trim().toLowerCase()).toList();
    int col(String n) => testa.indexOf(n);
    final cu = col('url'), cn = col('username'), cp = col('password'), cnome = col('name');
    if (cu < 0 || cp < 0) throw const FormatException('Il file non è un export delle password di Chrome');
    var aggiunti = 0, saltati = 0;
    final ora = DateTime.now().millisecondsSinceEpoch;
    for (final r in righe.skip(1)) {
      if (r.length <= cp) continue;
      // Indirizzo esattamente come nel file («import esatto», come la webapp).
      final sito = r[cu];
      final utente = cn >= 0 && r.length > cn ? r[cn] : '';
      final pw = r[cp];
      if (sito.isEmpty || pw.isEmpty) {
        saltati++;
        continue;
      }
      if (memoria.any((m) => m['sito'] == sito && m['utente'] == utente && m['password'] == pw)) {
        saltati++;
        continue;
      }
      (_dati['memoria'] as List).add({'id': nuovoId(), 'sito': sito, 'utente': utente, 'password': pw, if (cnome >= 0 && r.length > cnome) 'nome': r[cnome], 'creata': ora, 'modificata': ora});
      aggiunti++;
    }
    await salva();
    return (aggiunti, saltati);
  }

  static String dominio(String url) {
    var s = url.trim().toLowerCase();
    if (s.startsWith('android://')) {
      // Chrome salva le app come android://<firma>@<pacchetto>/
      final p = s.substring(10).split('@').last.split('/').first;
      return 'android://$p';
    }
    s = s.replaceFirst(RegExp(r'^[a-z]+://'), '');
    s = s.split('/').first.split(':').first;
    return s.startsWith('www.') ? s.substring(4) : s;
  }

  static List<List<String>> leggiCsv(String testo) {
    final righe = <List<String>>[];
    var riga = <String>[];
    final campo = StringBuffer();
    var virgolette = false;
    for (var i = 0; i < testo.length; i++) {
      final c = testo[i];
      if (virgolette) {
        if (c == '"') {
          if (i + 1 < testo.length && testo[i + 1] == '"') {
            campo.write('"');
            i++;
          } else {
            virgolette = false;
          }
        } else {
          campo.write(c);
        }
      } else if (c == '"') {
        virgolette = true;
      } else if (c == ',') {
        riga.add(campo.toString());
        campo.clear();
      } else if (c == '\n' || c == '\r') {
        if (c == '\r' && i + 1 < testo.length && testo[i + 1] == '\n') i++;
        riga.add(campo.toString());
        campo.clear();
        if (riga.any((e) => e.isNotEmpty)) righe.add(riga);
        riga = <String>[];
      } else {
        campo.write(c);
      }
    }
    if (campo.isNotEmpty || riga.isNotEmpty) {
      riga.add(campo.toString());
      if (riga.any((e) => e.isNotEmpty)) righe.add(riga);
    }
    return righe;
  }
}

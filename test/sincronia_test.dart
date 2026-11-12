import 'dart:convert';
import 'dart:io';
import 'dart:math';

import 'package:digipass/archivio.dart';
import 'package:digipass/sincronia.dart';
import 'package:digipass/totp.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';

/// Prova vera della sincronizzazione: avvia il server di DiGiPass sul PC (cartella temporanea, porta di prova)
/// e fa parlare due "telefoni" (due cassaforti in due cartelle) attraverso il server.
void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  HttpOverrides.global = null; // le prove di Flutter bloccano la rete: qui serve quella vera verso 127.0.0.1
  late Process server;
  late Directory radice;
  const porta = 18797;
  final url = 'http://127.0.0.1:$porta';
  var cartellaAttuale = '';
  final canale = const MethodChannel('digipass/android');

  setUpAll(() async {
    radice = await Directory.systemTemp.createTemp('digipass-sync-');
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger.setMockMethodCallHandler(canale, (c) async {
      if (c.method == 'cartella') return cartellaAttuale;
      return null;
    });
    final chiave = base64Url.encode(List.generate(32, (_) => Random.secure().nextInt(256))).replaceAll('=', '');
    server = await Process.start('node', ['server/src/server.js'], environment: {
      'PORTA': '$porta',
      'INDIRIZZO': '127.0.0.1',
      'CARTELLA_DATI': '${radice.path}/nas',
      'CARTELLA_BACKUP': '${radice.path}/backup',
      'DIGIPASS_AUTH_KEY': chiave,
    });
    server.stderr.transform(utf8.decoder).listen((e) => stderr.write('server: $e'));
    for (var i = 0; i < 50; i++) {
      try {
        final c = HttpClient();
        final r = await (await c.getUrl(Uri.parse('$url/stato'))).close();
        c.close();
        if (r.statusCode == 200) break;
      } catch (_) {}
      await Future.delayed(const Duration(milliseconds: 200));
    }
  });

  tearDownAll(() async {
    server.kill();
    await server.exitCode;
    await radice.delete(recursive: true);
  });

  Future<Archivio> telefono(String nome) async {
    final d = Directory('${radice.path}/$nome')..createSync();
    cartellaAttuale = d.path;
    final a = Archivio();
    await a.init();
    return a;
  }

  test('telefono 1 configura il NAS, telefono 2 scarica, modifiche e cancellazioni passano nei due sensi', () async {
    const pw = 'Password principale di prova!';
    final a1 = await telefono('telefono1');
    await a1.crea(pw);
    await a1.salvaVoce({'id': Archivio.nuovoId(), 'tipo': 'login', 'titolo': 'Banca', 'campi': {'utente': 'nome@esempio.ch', 'password': 'S3greta!'}, 'siti': ['banca.esempio'], 'note': '', 'totp': '', 'cestino': null});
    await a1.salvaSito({'id': Archivio.nuovoId(), 'sito': 'foto.esempio', 'utente': 'utente', 'password': 'pw-foto'});

    final s1 = Sincronia(a1);
    final setup = await s1.iniziaConfigurazione(url, 'admin', '');
    final codice = Totp(Totp.base32(setup['secret'])).codice();
    final (recupero, riserva) = await s1.completaConfigurazione(setup['setupToken'], pw, codice);
    expect(recupero.length, 34);
    expect(riserva.length, 10);
    expect(s1.ultimoErrore, '');

    // Telefono nuovo: scarica la cassaforte dal NAS con password + codice di riserva.
    final a2 = await telefono('telefono2');
    final s2 = Sincronia(a2);
    await s2.accedi(url, 'admin', pw, riserva.first);
    expect(a2.aperto, isTrue);
    expect(a2.voci.single['titolo'], 'Banca');
    expect(a2.memoria.single['sito'], 'foto.esempio');

    // Modifica sul telefono 2 -> arriva al telefono 1.
    final v = Map<String, dynamic>.from(a2.voci.single)..['titolo'] = 'Banca di casa';
    await a2.salvaVoce(v);
    expect(await s2.sincronizza(), isTrue, reason: s2.ultimoErrore);
    expect(await s1.sincronizza(), isTrue, reason: s1.ultimoErrore);
    expect(a1.voci.single['titolo'], 'Banca di casa');

    // Cancellazione sul telefono 1 -> sparisce anche dal telefono 2.
    await a1.eliminaSito(a1.memoria.single['id']);
    expect(await s1.sincronizza(), isTrue);
    expect(await s2.sincronizza(), isTrue);
    expect(a2.memoria, isEmpty);

    // Sul NAS niente in chiaro.
    final grezzo = latin1.decode(File('${radice.path}/nas/digipass.sqlite').readAsBytesSync());
    for (final p in ['Banca di casa', 'S3greta!', 'nome@esempio.ch', 'foto.esempio', pw]) {
      expect(grezzo.contains(p), isFalse, reason: p);
    }

    // NAS spento: il telefono continua a funzionare, la modifica parte alla sincronizzazione dopo.
    server.kill();
    await server.exitCode;
    await a1.salvaVoce({'id': Archivio.nuovoId(), 'tipo': 'nota', 'titolo': 'Scritta offline', 'campi': {}, 'siti': [], 'note': 'ok', 'totp': '', 'cestino': null});
    expect(await s1.sincronizza(), isFalse);
    expect(s1.ultimoErrore, isNotEmpty);
    expect(a1.voci.length, 2);
  }, timeout: const Timeout(Duration(minutes: 3)));
}

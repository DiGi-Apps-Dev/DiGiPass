import 'dart:convert';
import 'dart:io';

import 'package:digipass/main.dart';
import 'package:digipass/schermate/home.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';

// Avvio a freddo col telefono già collegato al NAS (segnalazione del 12-13.11.2026: in Cassaforte mancavano il tasto
// «Aggiorna» e i loghi dei siti, mentre Impostazioni diceva «Collegato al NAS»).
// Come sul telefono: l'app parte bloccata, l'indirizzo del NAS sta in nas.json, e la sincronizzazione dopo lo sblocco
// non trova niente di nuovo, quindi non ridisegna niente da sola.
void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  late Directory dir;

  setUpAll(() async {
    dir = Directory.systemTemp.createTempSync('digipass-avvio');
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger.setMockMethodCallHandler(const MethodChannel('digipass/android'), (c) async {
      switch (c.method) {
        case 'cartella':
          return dir.path;
        case 'improntaAttiva':
        case 'improntaDisponibile':
          return false;
        case 'autocompilazioneAttiva':
          return true;
      }
      return null;
    });
    await archivio.init();
    await impostazioni.init();
    await archivio.crea('password di prova lunga');
    await archivio.salvaVoce({'tipo': 'login', 'titolo': 'TEST sito', 'campi': {'utente': 'u', 'password': 'p'}, 'siti': ['https://esempio.test']});
    archivio.blocca();
    File('${dir.path}/nas.json').writeAsStringSync(jsonEncode({'url': 'https://nas.test', 'utente': 'admin'}));
    // Come in main(): l'indirizzo del NAS si legge prima del primo disegno.
    await sincronia.caricaIndirizzo();
  });

  tearDownAll(() => dir.deleteSync(recursive: true));

  testWidgets('dopo lo sblocco a freddo la barra della Cassaforte ha il tasto Aggiorna', (t) async {
    await t.pumpWidget(const DigiPass());
    await t.pumpAndSettle();
    await t.runAsync(() => archivio.sbloccaPassword('password di prova lunga'));
    await t.pumpAndSettle();
    expect(find.text('TEST sito'), findsWidgets, reason: 'la Cassaforte è aperta');
    final barra = find.byType(BarraPrincipale).first;
    expect(find.descendant(of: barra, matching: find.byIcon(Icons.sync)), findsOneWidget, reason: 'tasto Aggiorna nella barra della Cassaforte');
  });

  test('un logo chiesto prima che ci sia la sessione col NAS non resta «senza logo» per sempre', () async {
    expect(await sincronia.logo('esempio.test'), isNull); // niente sessione: niente logo, ma non va ricordato
    expect(sincronia.loghiRicordati, isNot(contains('esempio.test')));
  });
}

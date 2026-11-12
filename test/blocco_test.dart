import 'dart:io';

import 'package:digipass/main.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';

// Blocco della cassaforte («Blocca» non va e l'app non si blocca dopo il tempo impostato).
void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  late Directory dir;
  final chiamate = <String>[];

  setUpAll(() async {
    dir = Directory.systemTemp.createTempSync('digipass-blocco');
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger.setMockMethodCallHandler(const MethodChannel('digipass/android'), (c) async {
      chiamate.add(c.method);
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
    await sincronia.carica();
    await archivio.crea('password di prova lunga');
  });

  tearDownAll(() => dir.deleteSync(recursive: true));

  Future<void> apri(WidgetTester t) async {
    await t.runAsync(() => archivio.sbloccaPassword('password di prova lunga'));
    await t.pumpWidget(const DigiPass());
    await t.pumpAndSettle();
    expect(archivio.aperto, isTrue);
    expect(find.byTooltip('Blocca'), findsOneWidget);
  }

  testWidgets('il tasto Blocca chiude la cassaforte e mostra lo sblocco', (t) async {
    await apri(t);
    chiamate.clear();
    await t.tap(find.byTooltip('Blocca'));
    await t.runAsync(() => Future.delayed(const Duration(milliseconds: 200)));
    await t.pumpAndSettle();
    expect(archivio.aperto, isFalse);
    expect(find.byTooltip('Blocca'), findsNothing);
    expect(chiamate, isNot(contains('bloccaTutto')), reason: "la compilazione automatica non si blocca mai");
  });

  testWidgets('blocco all\'uscita (0 minuti): si chiude appena si esce', (t) async {
    await apri(t);
    impostazioni.bloccoMinuti = 0;
    chiamate.clear();
    t.binding.handleAppLifecycleStateChanged(AppLifecycleState.inactive);
    t.binding.handleAppLifecycleStateChanged(AppLifecycleState.hidden);
    t.binding.handleAppLifecycleStateChanged(AppLifecycleState.paused);
    await t.runAsync(() => Future.delayed(const Duration(milliseconds: 200)));
    await t.pumpAndSettle();
    expect(archivio.aperto, isFalse);
    expect(chiamate, contains('chiudiSessione'));
    expect(chiamate, isNot(contains('bloccaTutto')), reason: "il blocco automatico lascia pronta l'autocompilazione");
    for (final x in [AppLifecycleState.hidden, AppLifecycleState.inactive, AppLifecycleState.resumed]) {
      t.binding.handleAppLifecycleStateChanged(x);
    }
    await t.pumpAndSettle();
    expect(find.byTooltip('Blocca'), findsNothing);
  });

  testWidgets('con una scheda aperta, dopo il blocco non resta niente a schermo', (t) async {
    await t.runAsync(() => archivio.sbloccaPassword('password di prova lunga'));
    await t.runAsync(() => archivio.salvaVoce({'id': 'prova1', 'tipo': 'accesso', 'titolo': 'TEST da cancellare', 'campi': {'utente': 'x', 'password': 'y'}}));
    await apri(t);
    await t.tap(find.text('TEST da cancellare'));
    await t.pumpAndSettle();
    impostazioni.bloccoMinuti = 0;
    t.binding.handleAppLifecycleStateChanged(AppLifecycleState.inactive);
    t.binding.handleAppLifecycleStateChanged(AppLifecycleState.hidden);
    t.binding.handleAppLifecycleStateChanged(AppLifecycleState.paused);
    await t.runAsync(() => Future.delayed(const Duration(milliseconds: 200)));
    for (final x in [AppLifecycleState.hidden, AppLifecycleState.inactive, AppLifecycleState.resumed]) {
      t.binding.handleAppLifecycleStateChanged(x);
    }
    await t.pumpAndSettle();
    expect(archivio.aperto, isFalse);
    expect(find.text('Voce non trovata'), findsNothing, reason: 'la scheda aperta resta sopra la schermata di sblocco');
  });

  testWidgets("sbloccata con l'impronta (chiave non modificabile), Blocca chiude lo stesso", (t) async {
    await t.runAsync(() => archivio.sbloccaPassword('password di prova lunga'));
    final k = archivio.chiave!;
    final fissa = Uint8List.fromList(k).asUnmodifiableView();
    await t.runAsync(() => archivio.blocca());
    await t.runAsync(() => archivio.sbloccaChiave(fissa));
    await t.pumpWidget(const DigiPass());
    await t.pumpAndSettle();
    expect(archivio.aperto, isTrue);
    await t.tap(find.byTooltip('Blocca'));
    await t.runAsync(() => Future.delayed(const Duration(milliseconds: 200)));
    await t.pumpAndSettle();
    expect(archivio.aperto, isFalse);
  });
}

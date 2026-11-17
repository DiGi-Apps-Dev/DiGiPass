import 'dart:convert';
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';

import 'archivio.dart';
import 'nativo.dart';
import 'schermate/accesso.dart';
import 'schermate/home.dart';
import 'sincronia.dart';
import 'tema.dart';

final archivio = Archivio();
final impostazioni = Impostazioni();
final sincronia = Sincronia(archivio);

/// Impostazioni non segrete (blocco automatico, ordinamento), in chiaro in impostazioni.json.
/// Versione mostrata in fondo alle Impostazioni: uguale a `version` del pubspec (la prova test/versione_test.dart lo controlla).
const kVersione = '0.2.17';

class Impostazioni extends ChangeNotifier {
  late File _f;
  int bloccoMinuti = 5;
  String ordine = 'az';
  // CHECKLIST 6.4: appunti cancellati mai (0), dopo 60 s o dopo 180 s.
  int appuntiSecondi = 60;
  // CHECKLIST 9.3: icone dei siti, si possono spegnere.
  bool icone = true;
  // CHECKLIST 9.4: nel login, email e nome utente in due campi separati.
  bool utenteSeparato = false;
  // Autocompilazione (letti anche dalla parte Android): copia del 2FA (CHECKLIST 4.3), suggerimenti nella tastiera
  // invece del menu a comparsa (5.2), collegamento siti-app con i Digital Asset Links (5.5).
  bool copiaTotp = true;
  bool tastiera = false;
  bool collegaApp = true;
  // CHECKLIST 1.11: copia degli allegati sul telefono in anticipo: 'mai' (solo quando si aprono), 'wifi', 'sempre'.
  String allegatiOffline = 'mai';
  // CHECKLIST 6.5: screenshot consentiti (spento di base: schermate bloccate come prima).
  bool screenshot = false;

  Future<void> init() async {
    _f = File('${await Nativo.cartella()}/impostazioni.json');
    if (_f.existsSync()) {
      try {
        final j = jsonDecode(_f.readAsStringSync()) as Map<String, dynamic>;
        bloccoMinuti = j['bloccoMinuti'] ?? 5;
        ordine = j['ordine'] ?? 'az';
        appuntiSecondi = j['appuntiSecondi'] ?? 60;
        icone = j['icone'] ?? true;
        utenteSeparato = j['utenteSeparato'] ?? false;
        copiaTotp = j['copiaTotp'] ?? true;
        tastiera = j['tastiera'] ?? false;
        collegaApp = j['collegaApp'] ?? true;
        allegatiOffline = j['allegatiOffline'] ?? 'mai';
        screenshot = j['screenshot'] ?? false;
      } catch (_) {}
    }
    if (screenshot) await Nativo.screenshot(true);
  }

  Future<void> salva() async {
    await _f.writeAsString(jsonEncode({'bloccoMinuti': bloccoMinuti, 'ordine': ordine, 'appuntiSecondi': appuntiSecondi, 'icone': icone, 'utenteSeparato': utenteSeparato,
      'copiaTotp': copiaTotp, 'tastiera': tastiera, 'collegaApp': collegaApp,
      'allegatiOffline': allegatiOffline, 'screenshot': screenshot}));
    notifyListeners();
  }
}

/// Per scelta file, fotocamera e impronta l'app va in pausa senza che l'utente l'abbia lasciata.
int pauseConsentite = 0;
Future<T> senzaBlocco<T>(Future<T> Function() f) async {
  pauseConsentite++;
  try {
    return await f();
  } finally {
    Future.delayed(const Duration(seconds: 2), () => pauseConsentite--);
  }
}

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  await archivio.init();
  await impostazioni.init();
  await sincronia.caricaIndirizzo();
  runApp(const DigiPass());
}

class DigiPass extends StatefulWidget {
  const DigiPass({super.key});
  @override
  State<DigiPass> createState() => _DigiPassState();
}

class _DigiPassState extends State<DigiPass> with WidgetsBindingObserver {
  DateTime? _uscita;
  bool _eraAperto = false;
  bool _programmata = false;
  final _nav = GlobalKey<NavigatorState>();

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    _eraAperto = archivio.aperto;
    // Appena la cassaforte si apre: sincronizzazione col NAS (se collegato). Dopo ogni modifica: un'altra, raggruppata.
    archivio.addListener(_cambio);
    archivio.dopoSalvataggio = () {
      if (_programmata) return;
      _programmata = true;
      Future.delayed(const Duration(seconds: 2), () async {
        _programmata = false;
        await sincronia.sincronizza();
      });
    };
  }

  void _cambio() {
    if (archivio.aperto && !_eraAperto) sincronia.carica().then((_) => sincronia.sincronizza());
    // Appena si blocca: via le schede, i moduli e le finestre aperte sopra, resta solo lo sblocco
    // (prima una scheda aperta restava a schermo dopo il blocco automatico).
    if (!archivio.aperto && _eraAperto) _nav.currentState?.popUntil((r) => r.isFirst);
    _eraAperto = archivio.aperto;
  }

  @override
  void dispose() {
    archivio.removeListener(_cambio);
    WidgetsBinding.instance.removeObserver(this);
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState s) {
    if (!archivio.aperto) return;
    final ms = impostazioni.bloccoMinuti * 60000;
    if (s == AppLifecycleState.paused) {
      if (pauseConsentite > 0) return;
      _uscita = DateTime.now();
      if (ms == 0) {
        archivio.blocca();
      } else {
        Nativo.pausaSessione(ms);
      }
    } else if (s == AppLifecycleState.resumed && _uscita != null) {
      final passati = DateTime.now().difference(_uscita!).inMilliseconds;
      _uscita = null;
      if (passati >= ms) {
        archivio.blocca();
      } else {
        archivio.ricarica();
        Nativo.apriSessione(archivio.chiave!);
        sincronia.sincronizza();
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'DiGiPass',
      navigatorKey: _nav,
      debugShowCheckedModeBanner: false,
      theme: buildTheme(),
      locale: const Locale('it'),
      supportedLocales: const [Locale('it')],
      localizationsDelegates: const [GlobalMaterialLocalizations.delegate, GlobalWidgetsLocalizations.delegate, GlobalCupertinoLocalizations.delegate],
      home: ListenableBuilder(
        listenable: archivio,
        builder: (context, _) {
          if (!archivio.esiste) return const Benvenuto();
          if (!archivio.aperto) return const Sblocco();
          return const Home();
        },
      ),
    );
  }
}

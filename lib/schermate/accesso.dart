import 'dart:io';

import 'package:file_picker/file_picker.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:pdf/pdf.dart';
import 'package:pdf/widgets.dart' as pw;

import '../generatore.dart';
import '../main.dart';
import '../nativo.dart';
import '../tema.dart';
import 'nas.dart';

/// Prima apertura: si sceglie la password principale, poi il foglio di emergenza.
class Benvenuto extends StatefulWidget {
  const Benvenuto({super.key});
  @override
  State<Benvenuto> createState() => _BenvenutoState();
}

class _BenvenutoState extends State<Benvenuto> {
  final _p1 = TextEditingController(), _p2 = TextEditingController();
  bool _vedi = false, _lavoro = false;
  String? _errore, _recupero;

  Future<void> _crea() async {
    final p = _p1.text;
    if (p.length < 10) return setState(() => _errore = 'Almeno 10 caratteri');
    if (p != _p2.text) return setState(() => _errore = 'Le due password non sono uguali');
    setState(() {
      _errore = null;
      _lavoro = true;
    });
    final r = await archivio.crea(p);
    _p1.clear();
    _p2.clear();
    setState(() {
      _lavoro = false;
      _recupero = r;
    });
  }

  bool _passoImpronta = false;
  String? _erroreImpronta;

  /// Dopo il foglio di emergenza: si propone subito lo sblocco con l'impronta (se il telefono ce l'ha).
  Future<void> _dopoFoglio() async {
    if (await Nativo.improntaDisponibile()) {
      setState(() => _passoImpronta = true);
    } else {
      archivio.pronto();
    }
  }

  Future<void> _attivaImpronta() async {
    try {
      await senzaBlocco(() => Nativo.attivaImpronta(archivio.chiave!));
      archivio.pronto();
    } on PlatformException catch (e) {
      setState(() => _erroreImpronta = e.message ?? 'Impronta non attivata');
    }
  }

  @override
  Widget build(BuildContext context) {
    if (_passoImpronta) {
      return Scaffold(
        body: SafeArea(
          child: ListView(padding: const EdgeInsets.all(24), children: [
            const SizedBox(height: 60),
            Center(
              child: Container(
                width: 120,
                height: 120,
                decoration: BoxDecoration(shape: BoxShape.circle, color: kG1, border: Border.all(color: kFilo2, width: 2)),
                child: const Icon(Icons.fingerprint, size: 76, color: kRosa),
              ),
            ),
            const SizedBox(height: 22),
            const Center(child: Text('Attiva lo sblocco con l\'impronta?', textAlign: TextAlign.center, style: TextStyle(fontSize: 22, fontWeight: FontWeight.w800))),
            const SizedBox(height: 10),
            const Text('Così apri DiGiPass e compili le password nelle app con il dito, senza scrivere la password principale. '
                'Se l\'impronta non va, puoi usare il PIN del telefono.', textAlign: TextAlign.center, style: TextStyle(fontSize: 15, height: 1.4)),
            const SizedBox(height: 28),
            Principale(testo: 'Attiva l\'impronta', icona: Icons.fingerprint, alto: 58, onTap: _attivaImpronta),
            if (_erroreImpronta != null) ...[
              const SizedBox(height: 12),
              Text(_erroreImpronta!, textAlign: TextAlign.center, style: const TextStyle(color: kPuntoRosso, fontWeight: FontWeight.w700)),
            ],
            const SizedBox(height: 12),
            Secondario(testo: 'Più tardi (Impostazioni › Sblocco)', onTap: () => archivio.pronto()),
          ]),
        ),
      );
    }
    if (_recupero != null) {
      return Scaffold(
        appBar: const Barra(titolo: 'Foglio di emergenza', indietro: false),
        body: FoglioEmergenza(recupero: _recupero!, fine: _dopoFoglio),
      );
    }
    final (_, giudizio) = Generatore.forza(_p1.text);
    return Scaffold(
      body: SafeArea(
        child: ListView(padding: const EdgeInsets.all(20), children: [
          const SizedBox(height: 30),
          const Center(child: Logo(84)),
          const SizedBox(height: 14),
          const Center(child: Marchio()),
          const SizedBox(height: 26),
          // In alto, non in fondo: chi ha già la cassaforte sul NAS non deve crearne una nuova.
          Principale(
            testo: 'Ho già DiGiPass sul NAS',
            icona: Icons.cloud_download_outlined,
            onTap: () => Navigator.push(context, MaterialPageRoute(builder: (_) => const CollegaNas(telefonoNuovo: true))),
          ),
          const SizedBox(height: 28),
          const Center(child: Text('Oppure crea una cassaforte nuova', style: TextStyle(fontSize: 15))),
          const SizedBox(height: 14),
          const Etichetta('Password principale'),
          const SizedBox(height: 8),
          const Text('Apre la tua cassaforte. La sai solo tu: DiGiPass non la salva da nessuna parte e nessuno la può recuperare. '
              'Se la dimentichi, entri solo con la chiave del foglio di emergenza.', style: TextStyle(fontSize: 15, height: 1.4)),
          const SizedBox(height: 16),
          TextField(style: kStileCampo, 
            controller: _p1,
            obscureText: !_vedi,
            onChanged: (_) => setState(() {}),
            decoration: InputDecoration(
              labelText: 'Password principale',
              suffixIcon: IconButton(icon: Icon(_vedi ? Icons.visibility_off : Icons.visibility), onPressed: () => setState(() => _vedi = !_vedi)),
            ),
          ),
          const SizedBox(height: 6),
          Text('Forza: $giudizio', style: const TextStyle(fontWeight: FontWeight.w700)),
          const SizedBox(height: 12),
          TextField(style: kStileCampo, controller: _p2, obscureText: !_vedi, decoration: const InputDecoration(labelText: 'Ripeti la password')),
          if (_errore != null) ...[const SizedBox(height: 10), Text(_errore!, style: const TextStyle(color: kPuntoRosso, fontWeight: FontWeight.w700))],
          const SizedBox(height: 20),
          Principale(testo: _lavoro ? 'Creo la cassaforte…' : 'Crea la cassaforte', icona: Icons.lock_outline, onTap: _lavoro ? null : _crea),
        ]),
      ),
    );
  }
}

/// Mostra la chiave di recupero e la salva in un PDF da stampare.
class FoglioEmergenza extends StatelessWidget {
  const FoglioEmergenza({super.key, required this.recupero, required this.fine, this.codici});
  final String recupero;
  final VoidCallback fine;
  final List<String>? codici; // codici di riserva al posto di Authenticator (se collegato al NAS)

  static Future<Uint8List> pdf(String recupero, [List<String>? codici]) async {
    final d = pw.Document(title: 'DiGiPass - foglio di emergenza');
    final oggi = DateTime.now();
    final data = '${oggi.day.toString().padLeft(2, '0')}.${oggi.month.toString().padLeft(2, '0')}.${oggi.year}';
    pw.Widget riga(String t) => pw.Padding(padding: const pw.EdgeInsets.only(bottom: 6), child: pw.Text(t, style: const pw.TextStyle(fontSize: 12)));
    d.addPage(pw.Page(
      pageFormat: PdfPageFormat.a4,
      margin: const pw.EdgeInsets.all(48),
      build: (c) => pw.Column(crossAxisAlignment: pw.CrossAxisAlignment.start, children: [
        pw.Text('DiGiPass', style: pw.TextStyle(fontSize: 30, fontWeight: pw.FontWeight.bold)),
        pw.Text('Foglio di emergenza - creato il $data', style: const pw.TextStyle(fontSize: 14)),
        pw.SizedBox(height: 26),
        pw.Text('PASSWORD PRINCIPALE (scrivila a mano)', style: pw.TextStyle(fontSize: 13, fontWeight: pw.FontWeight.bold)),
        pw.SizedBox(height: 22),
        pw.Container(height: 1, color: PdfColors.black),
        pw.SizedBox(height: 28),
        pw.Text('CHIAVE DI RECUPERO', style: pw.TextStyle(fontSize: 13, fontWeight: pw.FontWeight.bold)),
        pw.SizedBox(height: 8),
        pw.Container(
          padding: const pw.EdgeInsets.all(14),
          decoration: pw.BoxDecoration(border: pw.Border.all(width: 1.5)),
          child: pw.Text(recupero, style: pw.TextStyle(fontSize: 22, font: pw.Font.courierBold(), letterSpacing: 1)),
        ),
        if (codici != null) ...[
          pw.SizedBox(height: 22),
          pw.Text('CODICI DI RISERVA (al posto di Google Authenticator, uno per volta)', style: pw.TextStyle(fontSize: 13, fontWeight: pw.FontWeight.bold)),
          pw.SizedBox(height: 8),
          pw.Wrap(spacing: 28, runSpacing: 8, children: [for (final c in codici) pw.Text(c, style: pw.TextStyle(fontSize: 16, font: pw.Font.courierBold()))]),
        ],
        pw.SizedBox(height: 26),
        pw.Text('COME SI USA', style: pw.TextStyle(fontSize: 13, fontWeight: pw.FontWeight.bold)),
        pw.SizedBox(height: 8),
        riga('1. Se dimentichi la password principale: apri DiGiPass, tocca "Ho dimenticato la password" e scrivi la chiave di recupero.'),
        riga('2. Poi scegli una password principale nuova e stampa un foglio nuovo: quello vecchio non vale piu.'),
        riga('3. Senza password e senza questa chiave i dati non si aprono, nemmeno con l\'aiuto di qualcuno.'),
        if (codici != null) riga('4. Telefono perso: per entrare nella webapp scrivi un codice di riserva al posto di quello di Authenticator. Ognuno vale una volta.'),
        pw.SizedBox(height: 20),
        pw.Text('Tienilo stampato in un posto sicuro. Non salvarlo nel telefono, nel PC o nel cloud.',
            style: pw.TextStyle(fontSize: 12, fontWeight: pw.FontWeight.bold)),
      ]),
    ));
    return d.save();
  }

  Future<void> _salva(BuildContext context) async {
    final bytes = await pdf(recupero, codici);
    final p = await senzaBlocco(() => FilePicker.saveFile(dialogTitle: 'Salva il foglio di emergenza', fileName: 'DiGiPass-foglio-emergenza.pdf', bytes: bytes));
    if (context.mounted && p != null) avviso(context, 'PDF salvato: stampalo e poi cancellalo dal telefono');
  }

  @override
  Widget build(BuildContext context) {
    return ListView(padding: const EdgeInsets.all(18), children: [
      const Etichetta('Chiave di recupero'),
      const SizedBox(height: 8),
      const Text('Se dimentichi la password principale, questa chiave è l\'unico modo di riaprire la cassaforte. Scrivila o stampala adesso.',
          style: TextStyle(fontSize: 15, height: 1.4)),
      const SizedBox(height: 14),
      Container(
        padding: const EdgeInsets.all(16),
        decoration: BoxDecoration(color: kG1, borderRadius: BorderRadius.circular(8), border: Border.all(color: kFilo2)),
        child: SelectableText(recupero, style: const TextStyle(fontSize: 22, fontFamily: 'monospace', fontWeight: FontWeight.w700, letterSpacing: 1)),
      ),
      if (codici != null) ...[
        const SizedBox(height: 16),
        const Etichetta('Codici di riserva'),
        const SizedBox(height: 6),
        const Text('Al posto del codice di Authenticator, se perdi il telefono. Ognuno vale una volta.', style: TextStyle(fontSize: 14)),
        const SizedBox(height: 8),
        Wrap(spacing: 18, runSpacing: 6, children: [
          for (final c in codici!) Text(c, style: const TextStyle(fontFamily: 'monospace', fontSize: 17, fontWeight: FontWeight.w700)),
        ]),
      ],
      const SizedBox(height: 14),
      Principale(testo: 'Salva il PDF da stampare', icona: Icons.picture_as_pdf_outlined, onTap: () => _salva(context)),
      const SizedBox(height: 10),
      Secondario(
        testo: 'Copia la chiave',
        icona: Icons.copy,
        onTap: () async {
          await Nativo.copia(recupero);
          if (context.mounted) avviso(context, 'Copiata: gli appunti si svuotano fra 60 secondi');
        },
      ),
      const SizedBox(height: 22),
      const Text('Nel PDF la password principale non c\'è: la scrivi tu a mano sul foglio stampato.', style: TextStyle(fontSize: 14)),
      const SizedBox(height: 18),
      Principale(
        testo: 'L\'ho scritta, continua',
        onTap: () async {
          final ok = await conferma(context, 'Hai la chiave di recupero?', 'Senza la chiave, se dimentichi la password i dati sono persi.', si: 'Sì, continua');
          if (ok) fine();
        },
      ),
    ]);
  }
}

/// Cassaforte chiusa: impronta, password principale o chiave di recupero.
class Sblocco extends StatefulWidget {
  const Sblocco({super.key});
  @override
  State<Sblocco> createState() => _SbloccoState();
}

class _SbloccoState extends State<Sblocco> {
  final _pw = TextEditingController();
  bool _impronta = false, _lavoro = false, _conPassword = false, _vedi = false;
  String? _errore;

  @override
  void initState() {
    super.initState();
    Nativo.improntaAttiva().then((a) {
      if (!mounted) return;
      setState(() {
        _impronta = a;
        _conPassword = !a;
      });
      if (a) _conImpronta();
    });
  }

  Future<void> _conImpronta() async {
    try {
      final k = await senzaBlocco(Nativo.sbloccaImpronta);
      if (!await archivio.sbloccaChiave(k)) setState(() => _errore = 'Sblocco non riuscito: usa la password principale');
    } on PlatformException catch (e) {
      if (mounted) setState(() => _errore = e.message);
    }
  }

  Future<void> _conLaPassword() async {
    if (_pw.text.isEmpty) return;
    setState(() {
      _lavoro = true;
      _errore = null;
    });
    final ok = await archivio.sbloccaPassword(_pw.text);
    if (!mounted) return;
    if (!ok) {
      setState(() {
        _lavoro = false;
        _errore = 'Password sbagliata';
      });
    } else {
      _pw.clear();
    }
  }

  Future<void> _recupero() async {
    final c = await chiediTesto(context, 'Chiave di recupero', etichetta: 'XXXX-XXXX-…', si: 'Apri', rosa: false);
    if (c == null || !mounted) return;
    setState(() => _lavoro = true);
    final ok = await archivio.sbloccaRecupero(c);
    if (!mounted) return;
    setState(() => _lavoro = false);
    if (!ok) return setState(() => _errore = 'Chiave di recupero sbagliata');
    // Aperta: si sceglie subito una password nuova.
    await Navigator.of(context).push(MaterialPageRoute(builder: (_) => const NuovaPassword(dopoRecupero: true)));
    archivio.pronto();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: SafeArea(
        child: ListView(padding: const EdgeInsets.all(24), children: [
          const SizedBox(height: 60),
          const Center(child: Logo(96)),
          const SizedBox(height: 14),
          const Center(child: Marchio()),
          const SizedBox(height: 8),
          const Center(child: Text('Cassaforte bloccata', style: TextStyle(fontSize: 17, fontWeight: FontWeight.w600))),
          const SizedBox(height: 30),
          if (_impronta && !_conPassword) ...[
            Center(
              child: InkWell(
                customBorder: const CircleBorder(),
                onTap: _conImpronta,
                child: Container(
                  width: 92,
                  height: 92,
                  decoration: BoxDecoration(shape: BoxShape.circle, color: kG1, border: Border.all(color: kFilo2, width: 2)),
                  child: const Icon(Icons.fingerprint, size: 56, color: kRosa),
                ),
              ),
            ),
            const SizedBox(height: 12),
            const Center(child: Text('Tocca per sbloccare con l\'impronta', style: TextStyle(fontSize: 16, fontWeight: FontWeight.w600))),
            const SizedBox(height: 26),
            Secondario(testo: 'Usa la password principale', onTap: () => setState(() => _conPassword = true)),
          ] else ...[
            TextField(style: kStileCampo, 
              controller: _pw,
              obscureText: !_vedi,
              autofocus: !_impronta,
              onSubmitted: (_) => _conLaPassword(),
              decoration: InputDecoration(
                labelText: 'Password principale',
                suffixIcon: IconButton(icon: Icon(_vedi ? Icons.visibility_off : Icons.visibility), onPressed: () => setState(() => _vedi = !_vedi)),
              ),
            ),
            const SizedBox(height: 14),
            Principale(testo: _lavoro ? 'Apro…' : 'Sblocca', onTap: _lavoro ? null : _conLaPassword),
            if (_impronta) ...[
              const SizedBox(height: 10),
              Secondario(testo: 'Usa l\'impronta', icona: Icons.fingerprint, onTap: () => setState(() => _conPassword = false)),
            ],
          ],
          if (_errore != null) ...[
            const SizedBox(height: 14),
            Text(_errore!, textAlign: TextAlign.center, style: const TextStyle(color: kPuntoRosso, fontWeight: FontWeight.w700, fontSize: 15)),
          ],
          const SizedBox(height: 30),
          Center(
            child: TextButton(
              onPressed: _lavoro ? null : _recupero,
              child: const Text('Ho dimenticato la password', style: TextStyle(color: kInk, fontSize: 15, fontWeight: FontWeight.w700, decoration: TextDecoration.underline)),
            ),
          ),
          Center(child: Text('Si blocca da sola dopo ${impostazioni.bloccoMinuti == 0 ? 'l\'uscita' : '${impostazioni.bloccoMinuti} min'}', style: const TextStyle(fontSize: 14))),
        ]),
      ),
    );
  }
}

/// Nuova password principale (dalle impostazioni o dopo il recupero).
class NuovaPassword extends StatefulWidget {
  const NuovaPassword({super.key, this.dopoRecupero = false});
  final bool dopoRecupero;
  @override
  State<NuovaPassword> createState() => _NuovaPasswordState();
}

class _NuovaPasswordState extends State<NuovaPassword> {
  final _p1 = TextEditingController(), _p2 = TextEditingController(), _codice = TextEditingController();
  String? _errore, _recupero;
  bool _lavoro = false;
  bool get _colNas => sincronia.collegato && !widget.dopoRecupero;

  Future<void> _salva() async {
    if (_p1.text.length < 10) return setState(() => _errore = 'Almeno 10 caratteri');
    if (_p1.text != _p2.text) return setState(() => _errore = 'Le due password non sono uguali');
    setState(() => _lavoro = true);
    if (_colNas) {
      try {
        await sincronia.cambiaPassword(_p1.text, _codice.text.trim());
      } catch (e) {
        return setState(() {
          _lavoro = false;
          _errore = e is HttpException ? e.message : 'NAS non raggiungibile: la password non è stata cambiata';
        });
      }
    } else {
      await archivio.cambiaPassword(_p1.text);
    }
    // Dopo un recupero la chiave vecchia è stata usata: se ne crea una nuova.
    final r = widget.dopoRecupero ? await archivio.nuovaRecupero() : null;
    if (!mounted) return;
    if (r != null) return setState(() => _recupero = r);
    avviso(context, 'Password principale cambiata');
    Navigator.pop(context);
  }

  @override
  Widget build(BuildContext context) {
    if (_recupero != null) {
      return Scaffold(
        appBar: const Barra(titolo: 'Nuovo foglio di emergenza', indietro: false),
        body: FoglioEmergenza(recupero: _recupero!, fine: () => Navigator.pop(context)),
      );
    }
    return Scaffold(
      appBar: Barra(titolo: 'Nuova password principale', indietro: !widget.dopoRecupero),
      body: ListView(padding: const EdgeInsets.all(18), children: [
        TextField(style: kStileCampo, controller: _p1, obscureText: true, decoration: const InputDecoration(labelText: 'Nuova password principale')),
        const SizedBox(height: 12),
        TextField(style: kStileCampo, controller: _p2, obscureText: true, decoration: const InputDecoration(labelText: 'Ripeti la password')),
        if (_colNas) ...[
          const SizedBox(height: 12),
          TextField(style: kStileCampo, controller: _codice, decoration: const InputDecoration(labelText: 'Codice di Authenticator (la cambi anche sul NAS)')),
        ],
        if (_errore != null) ...[const SizedBox(height: 10), Text(_errore!, style: const TextStyle(color: kPuntoRosso, fontWeight: FontWeight.w700))],
        const SizedBox(height: 18),
        Principale(testo: _lavoro ? 'Salvo…' : 'Salva', onTap: _lavoro ? null : _salva),
      ]),
    );
  }
}

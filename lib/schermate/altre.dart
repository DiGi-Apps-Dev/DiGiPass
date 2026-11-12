import 'dart:convert';
import 'dart:io';

import 'package:file_picker/file_picker.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../archivio.dart';
import '../generatore.dart';
import '../allegati.dart';
import '../doppioni.dart';
import '../esporta.dart';
import '../importa.dart';
import '../main.dart';
import '../nativo.dart';
import '../tema.dart';
import 'accesso.dart';
import 'home.dart';
import 'nas.dart';
import 'voce.dart';

Future<void> importaChrome(BuildContext context) async {
  final r = await senzaBlocco(() => FilePicker.pickFiles(dialogTitle: 'File CSV delle password di Chrome', type: FileType.any, withData: true));
  final f = r?.files.single;
  if (f == null || !context.mounted) return;
  try {
    final bytes = f.bytes ?? (f.path != null ? await File(f.path!).readAsBytes() : null);
    if (bytes == null) throw const FormatException('File non leggibile');
    final (agg, salt) = await archivio.importaChrome(utf8.decode(bytes, allowMalformed: true));
    if (context.mounted) {
      await conferma(context, 'Importazione finita',
          'In Memoria siti: $agg siti aggiunti, $salt saltati (già presenti o senza password).\n\nOra puoi cancellare il file CSV: contiene le password in chiaro.',
          si: 'Ok');
    }
  } on FormatException catch (e) {
    if (context.mounted) avviso(context, e.message);
  }
}

/// Importa l'export di Proton Pass in Cassaforte (CHECKLIST 8.1), come la webapp: «Aggiungi» mette tutte le voci del
/// file; «Sostituisci» toglie prima le voci con lo stesso tipo, titolo e nome utente. Il file si legge e basta.
Future<void> importaProtonPass(BuildContext context) async {
  final r = await senzaBlocco(() => FilePicker.pickFiles(dialogTitle: 'Export di Proton Pass (JSON o ZIP)', type: FileType.any, withData: true));
  final f = r?.files.single;
  if (f == null || !context.mounted) return;
  try {
    final bytes = f.bytes ?? (f.path != null ? await File(f.path!).readAsBytes() : null);
    if (bytes == null) throw const FormatException('File non leggibile');
    final nuove = importaProton(bytes, nomeFile: f.name);
    String chiave(Map v) => '${v['tipo']}\n${(v['titolo'] ?? '').toString().trim().toLowerCase()}\n${((v['campi'] as Map?)?['utente'] ?? '').toString().trim().toLowerCase()}';
    final daFile = nuove.map(chiave).toSet();
    final uguali = archivio.tutteLeVoci.where((v) => daFile.contains(chiave(v))).map((v) => v['id'] as String).toSet();
    if (!context.mounted) return;
    final scelta = await showDialog<String>(
      context: context,
      builder: (d) => AlertDialog(
        title: const Text('Importa da Proton Pass', style: TextStyle(color: kInk, fontWeight: FontWeight.w700)),
        content: Text(
            'Nel file ci sono ${nuove.length} voci.\n\n«Aggiungi» le mette tutte in Cassaforte.\n«Sostituisci» prima toglie le ${uguali.length} voci con lo stesso titolo e nome utente, poi mette quelle del file. Le altre voci restano.',
            style: const TextStyle(color: kInk, fontSize: 15)),
        actions: [
          TextButton(onPressed: () => Navigator.pop(d), child: const Text('Annulla', style: TextStyle(color: kInk))),
          TextButton(onPressed: () => Navigator.pop(d, 'sostituisci'), child: const Text('Sostituisci', style: TextStyle(color: kInk, fontWeight: FontWeight.w700))),
          TextButton(onPressed: () => Navigator.pop(d, 'aggiungi'), child: const Text('Aggiungi', style: TextStyle(color: kInk, fontWeight: FontWeight.w700))),
        ],
      ),
    );
    if (scelta == null) return;
    if (scelta == 'sostituisci') await Allegati.dimentica([for (final v in archivio.tutteLeVoci.where((v) => uguali.contains(v['id']))) ...Allegati.idDi(v)]);
    await archivio.importaVoci(nuove, togli: scelta == 'sostituisci' ? uguali : const {});
    if (context.mounted) {
      await conferma(context, 'Importazione finita',
          '${nuove.length} voci messe in Cassaforte${scelta == 'sostituisci' ? ', ${uguali.length} tolte' : ''}.\n\nOra puoi cancellare il file di Proton: contiene le password in chiaro.',
          si: 'Ok');
    }
  } on FormatException catch (e) {
    if (context.mounted) avviso(context, e.message);
  }
}

/// Esportazione (CHECKLIST 10.12), come nella web app: file cifrato .dpx e CSV in chiaro.
String _oggi() => DateTime.now().toIso8601String().substring(0, 10);
Future<void> esportaCifrato(BuildContext context) async {
  final p1 = await chiediTesto(context, 'Passphrase per il file', etichetta: 'Almeno 12 caratteri', si: 'Avanti', nascosto: true);
  if (p1 == null || !context.mounted) return;
  final p2 = await chiediTesto(context, 'Ripeti la passphrase', si: 'Esporta', nascosto: true);
  if (p2 == null || !context.mounted) return;
  if (p1.length < 12 || p1 != p2) return avviso(context, 'La passphrase deve avere almeno 12 caratteri ed essere uguale nelle due volte');
  final bytes = await fileCifrato(p1, archivio.tutteLeVoci, archivio.memoria);
  final p = await senzaBlocco(() => FilePicker.saveFile(dialogTitle: 'Salva il file cifrato', fileName: 'DiGiPass-${_oggi()}.dpx', bytes: bytes));
  if (p != null && context.mounted) avviso(context, 'File cifrato salvato');
}

Future<void> esportaCsv(BuildContext context) async {
  if (!await conferma(context, 'Esportare in chiaro?', 'Il CSV contiene tutte le password in chiaro. Chi apre il file le legge tutte.', si: 'Esporta')) return;
  final bytes = Uint8List.fromList(utf8.encode(csvDaEsportare(archivio.voci, archivio.memoria)));
  final p = await senzaBlocco(() => FilePicker.saveFile(dialogTitle: 'Salva il CSV', fileName: 'DiGiPass-${_oggi()}.csv', bytes: bytes));
  if (p != null && context.mounted) avviso(context, 'CSV salvato: cancellalo appena non serve più');
}

/// CSV di un altro programma (CHECKLIST 10.11): L'utente sceglie Cassaforte o Memoria siti, poi Aggiungi o Sostituisci.
Future<void> importaCsvGenerico(BuildContext context) async {
  final r = await senzaBlocco(() => FilePicker.pickFiles(dialogTitle: 'File CSV di un altro programma', type: FileType.any, withData: true));
  final f = r?.files.single;
  if (f == null || !context.mounted) return;
  try {
    final bytes = f.bytes ?? (f.path != null ? await File(f.path!).readAsBytes() : null);
    if (bytes == null) throw const FormatException('File non leggibile');
    final righe = leggiCsvGenerico(utf8.decode(bytes, allowMalformed: true));
    if (!context.mounted) return;
    final scelta = await showDialog<String>(
      context: context,
      builder: (d) => SimpleDialog(
        title: Text('Nel file ci sono ${righe.length} righe. Dove le metto?', style: const TextStyle(color: kInk, fontWeight: FontWeight.w700, fontSize: 17)),
        children: [
          for (final (k, t) in const [
            ('cassaforte-aggiungi', 'Cassaforte · Aggiungi'),
            ('cassaforte-sostituisci', 'Cassaforte · Sostituisci'),
            ('memoria-aggiungi', 'Memoria siti · Aggiungi'),
            ('memoria-sostituisci', 'Memoria siti · Sostituisci'),
            ('', 'Annulla'),
          ])
            SimpleDialogOption(onPressed: () => Navigator.pop(d, k), child: Text(t, style: const TextStyle(color: kInk, fontSize: 16))),
        ],
      ),
    );
    if (scelta == null || scelta.isEmpty) return;
    final sostituisci = scelta.endsWith('sostituisci');
    String esito;
    if (scelta.startsWith('cassaforte')) {
      final nuove = csvInCassaforte(righe);
      String chiave(Map v) => '${v['tipo']}\n${(v['titolo'] ?? '').toString().trim().toLowerCase()}\n${((v['campi'] as Map?)?['utente'] ?? '').toString().trim().toLowerCase()}';
      final daFile = nuove.map(chiave).toSet();
      final vecchie = sostituisci ? archivio.tutteLeVoci.where((v) => daFile.contains(chiave(v))).toList() : <Map<String, dynamic>>[];
      if (vecchie.isNotEmpty) {
        if (!context.mounted || !await conferma(context, 'Sostituire?', 'In Cassaforte tolgo ${vecchie.length} voci con lo stesso titolo e nome utente e metto le ${nuove.length} del file, esattamente come sono.', si: 'Sostituisci')) return;
        await Allegati.dimentica([for (final v in vecchie) ...Allegati.idDi(v)]);
      }
      await archivio.importaVoci(nuove, togli: {for (final v in vecchie) v['id'] as String});
      esito = 'Cassaforte: ${vecchie.isNotEmpty ? 'tolte ${vecchie.length}, ' : ''}importate ${nuove.length}.';
    } else {
      final nuovi = csvInMemoria(righe);
      String chiave(Map s) => '${s['sito']}\n${(s['utente'] ?? '').toString().toLowerCase()}';
      final daFile = nuovi.map(chiave).toSet();
      final vecchi = sostituisci ? archivio.memoria.where((s) => daFile.contains(chiave(s))).toList() : <Map<String, dynamic>>[];
      final gia = archivio.memoria.map((s) => '${s['sito']}\n${s['utente']}\n${s['password']}').toSet();
      final daMettere = sostituisci ? nuovi : nuovi.where((s) => !gia.contains('${s['sito']}\n${s['utente']}\n${s['password']}')).toList();
      if (vecchi.isNotEmpty && (!context.mounted || !await conferma(context, 'Sostituire?', 'In Memoria siti tolgo ${vecchi.length} siti con lo stesso indirizzo e nome utente e metto i ${nuovi.length} del file, esattamente come sono.', si: 'Sostituisci'))) return;
      await archivio.importaSiti(daMettere, togli: {for (final s in vecchi) s['id'] as String});
      esito = 'Memoria siti: ${vecchi.isNotEmpty ? 'tolti ${vecchi.length}, ' : ''}importati ${daMettere.length} (${nuovi.length - daMettere.length} già presenti, ${righe.length - nuovi.length} senza indirizzo o password).';
    }
    if (context.mounted) await conferma(context, 'Importazione finita', '$esito\n\nOra puoi cancellare il file CSV: contiene le password in chiaro.', si: 'Ok');
  } on FormatException catch (e) {
    if (context.mounted) avviso(context, e.message);
  }
}

/// Memoria siti: tutti i siti in cui entri, come le password di Chrome. Non compaiono nella Cassaforte.
class MemoriaVista extends StatefulWidget {
  const MemoriaVista({super.key});
  @override
  State<MemoriaVista> createState() => _MemoriaVistaState();
}

class _MemoriaVistaState extends State<MemoriaVista> {
  final _cerca = TextEditingController();

  Future<void> _inCassaforte(Map<String, dynamic> s) async {
    final sito = (s['sito'] ?? '').toString();
    final nome = TextEditingController(text: _nome(sito));
    final note = TextEditingController();
    final ok = await showDialog<bool>(
      context: context,
      builder: (d) => AlertDialog(
        title: const Text('Metti in cassaforte'),
        content: Column(mainAxisSize: MainAxisSize.min, children: [
          TextField(style: kStileCampo, controller: nome, decoration: campoRosa('Nome')),
          const SizedBox(height: 10),
          TextField(style: kStileCampo, controller: note, decoration: campoRosa('Note (facoltative)'), maxLines: 3, minLines: 1),
        ]),
        actions: [
          TextButton(onPressed: () => Navigator.pop(d, false), child: const Text('Annulla', style: TextStyle(color: kInk))),
          TextButton(onPressed: () => Navigator.pop(d, true), child: const Text('Metti in cassaforte', style: TextStyle(color: kInk, fontWeight: FontWeight.w700))),
        ],
      ),
    );
    if (ok != true) return;
    await archivio.salvaVoce({
      'id': Archivio.nuovoId(),
      'tipo': 'login',
      'titolo': nome.text.trim().isEmpty ? _nome(sito) : nome.text.trim(),
      'cartella': '',
      'fissata': false,
      'campi': {'utente': s['utente'] ?? '', 'password': s['password'] ?? ''},
      'siti': [sito],
      'note': note.text.trim(),
      'totp': '',
      'cestino': null,
    });
    if (mounted) avviso(context, 'Messo in cassaforte');
  }

  static String _nome(String sito) {
    final s = sito.replaceFirst('android://', '');
    final b = s.split('.').first;
    return b.isEmpty ? s : b[0].toUpperCase() + b.substring(1);
  }

  Future<void> _apri(Map<String, dynamic> s) async {
    var vedi = false;
    await showModalBottomSheet(
      context: context,
      builder: (c) => StatefulBuilder(
        builder: (c, set) => SafeArea(
          child: Padding(
            padding: const EdgeInsets.fromLTRB(16, 18, 16, 16),
            child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.stretch, children: [
              Text(nomeSito(s), style: const TextStyle(fontSize: 20, fontWeight: FontWeight.w800)),
              const SizedBox(height: 12),
              Elenco(figli: [
                ListTile(
                  title: const Text('NOME UTENTE', style: TextStyle(fontSize: 13, fontWeight: FontWeight.w700)),
                  subtitle: Text((s['utente'] ?? '').toString().isEmpty ? '—' : s['utente'], style: const TextStyle(fontSize: 16, color: kInk)),
                  trailing: IconButton(icon: const Icon(Icons.copy), onPressed: () => Nativo.copia(s['utente'] ?? '', segreto: false)),
                ),
                ListTile(
                  title: const Text('PASSWORD', style: TextStyle(fontSize: 13, fontWeight: FontWeight.w700)),
                  subtitle: Text(vedi ? s['password'] ?? '' : '•' * 12, style: const TextStyle(fontSize: 16, color: kInk)),
                  trailing: Row(mainAxisSize: MainAxisSize.min, children: [
                    IconButton(icon: Icon(vedi ? Icons.visibility_off : Icons.visibility), onPressed: () => set(() => vedi = !vedi)),
                    IconButton(
                      icon: const Icon(Icons.copy),
                      onPressed: () async {
                        await Nativo.copia(s['password'] ?? '', secondi: impostazioni.appuntiSecondi);
                        if (c.mounted) avviso(c, 'Password copiata: gli appunti si svuotano fra 60 secondi');
                      },
                    ),
                  ]),
                ),
              ]),
              const SizedBox(height: 14),
              Principale(
                testo: 'Metti in cassaforte',
                icona: Icons.lock_outline,
                onTap: () {
                  Navigator.pop(c);
                  _inCassaforte(s);
                },
              ),
              const SizedBox(height: 10),
              Secondario(
                testo: 'Elimina da Memoria siti',
                icona: Icons.delete_outline,
                onTap: () async {
                  if (await conferma(c, 'Eliminare questo sito?', 'Utente e password di ${s['sito']} spariscono da Memoria siti.', si: 'Elimina')) {
                    await archivio.eliminaSito(s['id']);
                    if (c.mounted) Navigator.pop(c);
                  }
                },
              ),
            ]),
          ),
        ),
      ),
    );
  }

  static const _nomiOrdineSiti = {'az': 'A-Z', 'za': 'Z-A', 'recenti': 'Più recenti', 'vecchie': 'Più vecchie'};
  int _confronta(Map a, Map b) {
    int t(Map v) => ((v['modificata'] ?? v['creata'] ?? 0) as num).toInt();
    // Stesso ordine della web app: sul nome mostrato sulla riga.
    String n(Map v) => nomeSito(v).toLowerCase();
    switch (impostazioni.ordine) {
      case 'za':
        return n(b).compareTo(n(a));
      case 'recenti':
        return t(b).compareTo(t(a));
      case 'vecchie':
        return t(a).compareTo(t(b));
      default:
        return n(a).compareTo(n(b));
    }
  }

  @override
  Widget build(BuildContext context) {
    return ListenableBuilder(
      listenable: archivio,
      builder: (context, _) {
        final q = _cerca.text.trim().toLowerCase();
        final siti = archivio.memoria.where((s) => q.isEmpty || '${s['sito']} ${s['utente']}'.toLowerCase().contains(q)).toList()
          ..sort(_confronta);
        return Scaffold(
          appBar: const BarraPrincipale(),
          body: ListView(padding: const EdgeInsets.fromLTRB(14, 14, 14, 30), children: [
            TextField(style: kStileCampo, controller: _cerca, onChanged: (_) => setState(() {}), decoration: InputDecoration(hintText: 'Cerca un sito', prefixIcon: const Icon(Icons.search), suffixIcon: _cerca.text.isEmpty ? null : IconButton(icon: const Icon(Icons.close), tooltip: 'Cancella', onPressed: () => setState(() => _cerca.clear())))),
            const SizedBox(height: 14),
            // Ordina: stesse scelte della Cassaforte, ricordate.
            Row(children: [
              Expanded(child: Etichetta('${archivio.memoria.length} siti · ${_nomiOrdineSiti[impostazioni.ordine] ?? 'A-Z'}')),
              PopupMenuButton<String>(
                tooltip: 'Ordina',
                icon: const Icon(Icons.sort),
                color: kG2,
                onSelected: (o) => setState(() {
                  impostazioni.ordine = o;
                  impostazioni.salva();
                }),
                itemBuilder: (_) => [for (final e in _nomiOrdineSiti.entries) PopupMenuItem(value: e.key, child: Text(e.value, style: const TextStyle(color: kInk)))],
              ),
            ]),
            const SizedBox(height: 8),
            if (siti.isNotEmpty)
              Elenco(figli: [
                for (final s in siti)
                  InkWell(
                    onTap: () => _apri(s),
                    child: Padding(
                      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 9),
                      child: Row(children: [
                        Avatar(nomeSito(s), lato: 34, sito: s['sito'].toString()),
                        const SizedBox(width: 12),
                        Expanded(
                          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                            Text(nomeSito(s), maxLines: 1, overflow: TextOverflow.ellipsis,
                                style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w700)),
                            Text((s['utente'] ?? '').toString().isEmpty ? 'senza nome utente' : s['utente'], maxLines: 1, overflow: TextOverflow.ellipsis,
                                style: const TextStyle(fontSize: 14)),
                          ]),
                        ),
                        const SizedBox(width: 8),
                        InkWell(
                          onTap: () => _inCassaforte(s),
                          borderRadius: BorderRadius.circular(6),
                          child: Ink(
                            padding: const EdgeInsets.symmetric(horizontal: 9, vertical: 6),
                            decoration: BoxDecoration(gradient: kMarchio, borderRadius: BorderRadius.circular(6)),
                            child: const Text('In cassaforte', style: TextStyle(color: Colors.white, fontSize: 13, fontWeight: FontWeight.w700)),
                          ),
                        ),
                      ]),
                    ),
                  ),
              ])
            else
              const Padding(
                padding: EdgeInsets.symmetric(vertical: 20),
                child: Text('Ancora nessun sito. Quando entri in un sito o in un\'app, DiGiPass lo ricorda qui da solo.',
                    style: TextStyle(fontSize: 15)),
              ),
            const SizedBox(height: 14),
            Secondario(testo: 'Importa le password di Chrome', icona: Icons.file_download_outlined, onTap: () => importaChrome(context)),
            const SizedBox(height: 8),
            const Text('In Chrome: Impostazioni › Gestore delle password › Impostazioni › Esporta password. Poi scegli qui il file CSV.',
                style: TextStyle(fontSize: 13)),
          ]),
        );
      },
    );
  }
}

/// Password deboli e ripetute della Cassaforte.
/// Sicurezza: i due riquadri si toccano e scelgono l'elenco sotto; quello scelto ha il colore pieno del marchio.
/// Nome mostrato in Memoria siti: per le app Android il nome del CSV o il pacchetto, mai l'hash.
String nomeSito(Map s) {
  final sito = (s['sito'] ?? '').toString();
  if (!sito.toLowerCase().startsWith('android://')) return sito;
  final n = (s['nome'] ?? '').toString().trim();
  return n.isNotEmpty ? n : 'app: ${sito.substring(10).split('@').last.split('/').first}';
}

class SicurezzaVista extends StatefulWidget {
  const SicurezzaVista({super.key});
  @override
  State<SicurezzaVista> createState() => _SicurezzaVistaState();
}

class _SicurezzaVistaState extends State<SicurezzaVista> {
  String _vista = 'deboli';
  @override
  Widget build(BuildContext context) {
    return ListenableBuilder(
      listenable: archivio,
      builder: (context, _) {
        final login = archivio.voci.where((v) => v['tipo'] == 'login').toList();
        String pw(Map v) => ((v['campi'] as Map?)?['password'] ?? '').toString();
        final deboli = login.where((v) => Generatore.debole(pw(v))).toList();
        final gruppi = <String, List<Map<String, dynamic>>>{};
        for (final v in login) {
          if (pw(v).isNotEmpty) gruppi.putIfAbsent(pw(v), () => []).add(v);
        }
        final ripetute = gruppi.values.where((g) => g.length > 1).toList();
        void apri(Map v) => Navigator.push(context, MaterialPageRoute(builder: (_) => SchedaVoce(id: v['id'])));
        Widget stato(String k, String t, int n) {
          final on = _vista == k;
          return InkWell(
            borderRadius: BorderRadius.circular(8),
            onTap: () => setState(() => _vista = k),
            child: Container(
              padding: const EdgeInsets.all(14),
              decoration: BoxDecoration(
                  gradient: on ? kMarchio : null, color: on ? null : kG1, borderRadius: BorderRadius.circular(8), border: Border.all(color: on ? Colors.transparent : kFilo2)),
              child: Row(children: [
                Icon(n == 0 ? Icons.check_circle : Icons.warning_amber_rounded, color: on ? Colors.white : (n == 0 ? kVerde : kPuntoGiallo), size: 28),
                const SizedBox(width: 12),
                Expanded(child: Text(t, style: TextStyle(fontSize: 16, fontWeight: FontWeight.w700, color: on ? Colors.white : kInk))),
                Text('$n', style: TextStyle(fontSize: 22, fontWeight: FontWeight.w800, color: on ? Colors.white : kInk)),
              ]),
            ),
          );
        }
        return Scaffold(
          appBar: const BarraPrincipale(),
          body: ListView(padding: const EdgeInsets.all(14), children: [
            stato('deboli', 'Password deboli', deboli.length),
            const SizedBox(height: 10),
            stato('ripetute', 'Password usate in più voci', ripetute.fold(0, (a, g) => a + g.length)),
            if (_vista == 'deboli' && deboli.isEmpty) const Padding(padding: EdgeInsets.only(top: 24), child: Center(child: Text('Nessuna password debole', style: TextStyle(fontSize: 16)))),
            if (_vista == 'ripetute' && ripetute.isEmpty) const Padding(padding: EdgeInsets.only(top: 24), child: Center(child: Text('Nessuna password usata in più voci', style: TextStyle(fontSize: 16)))),
            if (_vista == 'deboli' && deboli.isNotEmpty) ...[
              const SizedBox(height: 18),
              const Etichetta('Deboli'),
              const SizedBox(height: 8),
              Elenco(figli: [for (final v in deboli) RigaVoce(v, onTap: () => apri(v))]),
            ],
            if (_vista == 'ripetute')
            for (final (i, g) in ripetute.indexed) ...[
              const SizedBox(height: 18),
              Etichetta('Stessa password · gruppo ${i + 1}'),
              const SizedBox(height: 8),
              Elenco(figli: [for (final v in g) RigaVoce(v, onTap: () => apri(v))]),
            ],
            const SizedBox(height: 16),
            Text('Controllate le ${login.length} voci di tipo Login della Cassaforte, sul telefono: nessuna password esce.', style: const TextStyle(fontSize: 13)),
          ]),
        );
      },
    );
  }
}

class ImpostazioniVista extends StatefulWidget {
  const ImpostazioniVista({super.key});
  @override
  State<ImpostazioniVista> createState() => _ImpostazioniVistaState();
}

class _ImpostazioniVistaState extends State<ImpostazioniVista> with WidgetsBindingObserver {
  bool _impronta = false, _improntaPossibile = false, _autofill = false;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    _leggi();
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState s) {
    if (s == AppLifecycleState.resumed) _leggi();
  }

  Future<void> _leggi() async {
    final a = await Nativo.improntaAttiva(), p = await Nativo.improntaDisponibile(), f = await Nativo.autocompilazioneAttiva();
    if (mounted) {
      setState(() {
        _impronta = a;
        _improntaPossibile = p;
        _autofill = f;
      });
    }
  }

  Future<void> _cambiaImpronta(bool on) async {
    try {
      if (on) {
        await senzaBlocco(() => Nativo.attivaImpronta(archivio.chiave!));
      } else {
        await Nativo.togliImpronta();
      }
    } on PlatformException catch (e) {
      if (mounted) avviso(context, e.message ?? 'Impronta non attivata');
    }
    await _leggi();
  }

  Widget _riga(String titolo, String sotto, Widget coda, {VoidCallback? onTap}) => InkWell(
        onTap: onTap,
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
          child: Row(children: [
            Expanded(
              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Text(titolo, style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w700)),
                const SizedBox(height: 2),
                Text(sotto, style: const TextStyle(fontSize: 14)),
              ]),
            ),
            const SizedBox(width: 10),
            coda,
          ]),
        ),
      );

  @override
  Widget build(BuildContext context) {
    // CHECKLIST 6.2: subito, 1, 2, 5, 10 min, 1 ora, 4 ore («15 min» tolto).
    const tempi = [(0, 'Subito'), (1, '1 min'), (2, '2 min'), (5, '5 min'), (10, '10 min'), (60, '1 ora'), (240, '4 ore')];
    const appunti = [(0, 'Mai'), (60, 'Dopo 60 secondi'), (180, 'Dopo 180 secondi')];
    return Scaffold(
      appBar: const BarraPrincipale(),
      body: ListView(padding: const EdgeInsets.all(14), children: [
        const Etichetta('Sblocco'),
        const SizedBox(height: 8),
        Elenco(figli: [
          _riga('Impronta o PIN del telefono', _improntaPossibile ? 'Apre la cassaforte e l\'autocompilazione senza password' : 'Il telefono non ha un\'impronta registrata',
              Switch(value: _impronta, onChanged: _improntaPossibile ? _cambiaImpronta : null)),
          _riga('Consenti screenshot', impostazioni.screenshot ? 'Si possono fare schermate di DiGiPass' : 'Schermate e anteprima nelle app recenti bloccate',
              Switch(value: impostazioni.screenshot, onChanged: (x) async {
                impostazioni.screenshot = x;
                await impostazioni.salva();
                await Nativo.screenshot(x);
                setState(() {});
              })),
        ]),
        const SizedBox(height: 14),
        const Text('Blocco automatico dopo che esci dall\'app', style: TextStyle(fontSize: 15, fontWeight: FontWeight.w700)),
        const SizedBox(height: 8),
        Wrap(spacing: 8, runSpacing: 8, children: [
          for (final (m, t) in tempi)
            Chip2(t, acceso: impostazioni.bloccoMinuti == m, onTap: () async {
              impostazioni.bloccoMinuti = m;
              await impostazioni.salva();
              setState(() {});
            }),
        ]),
        const SizedBox(height: 14),
        const Text('Svuota gli appunti dopo una copia di password o codici', style: TextStyle(fontSize: 15, fontWeight: FontWeight.w700)),
        const SizedBox(height: 8),
        Wrap(spacing: 8, runSpacing: 8, children: [
          for (final (s, t) in appunti)
            Chip2(t, acceso: impostazioni.appuntiSecondi == s, onTap: () async {
              impostazioni.appuntiSecondi = s;
              await impostazioni.salva();
              setState(() {});
            }),
        ]),
        const SizedBox(height: 14),
        Elenco(figli: [
          _riga('Nome utente separato', impostazioni.utenteSeparato ? 'Nei login: Email e Nome utente in due campi' : 'Nei login: un campo solo, nome utente o email',
              Switch(value: impostazioni.utenteSeparato, onChanged: (x) async {
                impostazioni.utenteSeparato = x;
                await impostazioni.salva();
                setState(() {});
              })),
          _riga('Icone dei siti', impostazioni.icone ? 'Logo del sito accanto alle voci, preso dal NAS' : 'Solo l\'iniziale colorata',
              Switch(value: impostazioni.icone, onChanged: (x) async {
                impostazioni.icone = x;
                await impostazioni.salva();
                setState(() {});
              })),
        ]),
        const SizedBox(height: 20),
        const Etichetta('Autocompilazione'),
        const SizedBox(height: 8),
        Elenco(figli: [
          _riga(_autofill ? 'DiGiPass compila le password' : 'Autocompilazione spenta',
              _autofill ? 'Nelle app e nei siti propone prima la Cassaforte, poi Memoria siti' : 'Tocca per scegliere DiGiPass come servizio di Android',
              Icon(_autofill ? Icons.check_circle : Icons.chevron_right, color: _autofill ? kVerde : kInk),
              onTap: () => Nativo.apriAutocompilazione()),
          _riga('Copia il codice 2FA', 'Dopo aver compilato un login col 2FA, il codice va negli appunti',
              Switch(value: impostazioni.copiaTotp, onChanged: (x) async {
                impostazioni.copiaTotp = x;
                await impostazioni.salva();
                setState(() {});
              })),
          _riga('Suggerimenti nella tastiera', impostazioni.tastiera ? 'Le voci compaiono sopra la tastiera, se la tastiera lo permette' : 'Le voci compaiono in un menu sotto il campo',
              Switch(value: impostazioni.tastiera, onChanged: (x) async {
                impostazioni.tastiera = x;
                await impostazioni.salva();
                setState(() {});
              })),
          _riga('Collega siti e app', 'Un login di un sito vale anche nella sua app, se il sito la dichiara (Digital Asset Links)',
              Switch(value: impostazioni.collegaApp, onChanged: (x) async {
                impostazioni.collegaApp = x;
                await impostazioni.salva();
                setState(() {});
              })),
        ]),
        const SizedBox(height: 20),
        const Etichetta('NAS e webapp'),
        const SizedBox(height: 8),
        Elenco(figli: [
          if (!sincronia.collegato)
            _riga('Collega al NAS', 'Copia cifrata sul NAS e accesso dalla webapp quando non hai il telefono', const Icon(Icons.chevron_right),
                onTap: () async {
                  await Navigator.push(context, MaterialPageRoute(builder: (_) => const CollegaNas()));
                  setState(() {});
                })
          else ...[
            _riga(
                sincronia.ultimoErrore.isEmpty ? 'Collegato al NAS' : 'Sincronizzazione non riuscita',
                sincronia.ultimoErrore.isNotEmpty
                    ? sincronia.ultimoErrore
                    : sincronia.ultimaVolta == null
                        ? sincronia.url
                        : 'Ultima sincronizzazione alle ${sincronia.ultimaVolta!.hour.toString().padLeft(2, '0')}:${sincronia.ultimaVolta!.minute.toString().padLeft(2, '0')}',
                Icon(sincronia.ultimoErrore.isEmpty ? Icons.cloud_done_outlined : Icons.cloud_off_outlined, color: sincronia.ultimoErrore.isEmpty ? kVerde : kPuntoGiallo)),
            _riga('Sincronizza adesso', sincronia.url, const Icon(Icons.sync), onTap: () async {
              final ok = await sincronia.sincronizza();
              if (!context.mounted) return;
              avviso(context, ok ? 'Sincronizzato' : sincronia.ultimoErrore);
              setState(() {});
            }),
            _riga('Scollega dal NAS', 'La cassaforte resta sul telefono; sul NAS resta la copia cifrata', const Icon(Icons.link_off), onTap: () async {
              if (!await conferma(context, 'Scollegare dal NAS?', 'Il telefono smette di sincronizzare. Per ricollegarlo servono password e codice.', si: 'Scollega')) return;
              await sincronia.scollega();
              setState(() {});
            }),
          ],
        ]),
        const SizedBox(height: 20),
        const Etichetta('Dati'),
        const SizedBox(height: 8),
        const Text('Allegati sul telefono', style: TextStyle(fontSize: 15, fontWeight: FontWeight.w700)),
        const SizedBox(height: 8),
        Wrap(spacing: 8, runSpacing: 8, children: [
          for (final (k, t) in const [('mai', 'Solo quando li apri'), ('wifi', 'Sempre, solo con Wi-Fi'), ('sempre', 'Sempre')])
            Chip2(t, acceso: impostazioni.allegatiOffline == k, onTap: () async {
              impostazioni.allegatiOffline = k;
              await impostazioni.salva();
              setState(() {});
            }),
        ]),
        const SizedBox(height: 10),
        Elenco(figli: [
          _riga('Importa da Proton Pass', 'File JSON o ZIP non cifrato: le voci vanno in Cassaforte', const Icon(Icons.chevron_right), onTap: () => importaProtonPass(context)),
          _riga('Importa le password di Chrome', 'Vanno in Memoria siti', const Icon(Icons.chevron_right), onTap: () => importaChrome(context)),
          _riga('Importa un CSV di un altro programma', 'Scegli tu: Cassaforte o Memoria siti', const Icon(Icons.chevron_right), onTap: () => importaCsvGenerico(context)),
          _riga('Esporta in un file cifrato', 'Cassaforte e Memoria siti, protetti da una passphrase', const Icon(Icons.chevron_right), onTap: () => esportaCifrato(context)),
          _riga('Esporta in CSV', 'Tutte le password in chiaro: attenzione', const Icon(Icons.chevron_right), onTap: () => esportaCsv(context)),
          _riga('Doppioni', 'Voci uguali in Cassaforte: si uniscono in una', const Icon(Icons.chevron_right),
              onTap: () => Navigator.push(context, MaterialPageRoute(builder: (_) => const DoppioniVista()))),
          // Il numero segue l'archivio: prima restava quello di quando si era aperta la pagina (prova sul telefono, 12.11.2026).
          ListenableBuilder(
            listenable: archivio,
            builder: (context, _) => _riga('Cestino', archivio.cestino.length == 1 ? '1 voce' : '${archivio.cestino.length} voci', const Icon(Icons.chevron_right),
                onTap: () => Navigator.push(context, MaterialPageRoute(builder: (_) => const CestinoVista()))),
          ),
        ]),
        const SizedBox(height: 20),
        const Etichetta('Password principale'),
        const SizedBox(height: 8),
        Elenco(figli: [
          _riga('Cambia la password principale', 'La chiave di recupero resta valida', const Icon(Icons.chevron_right),
              onTap: () => Navigator.push(context, MaterialPageRoute(builder: (_) => const NuovaPassword()))),
          _riga('Nuovo foglio di emergenza', 'Crea una chiave di recupero nuova: quella vecchia non vale più', const Icon(Icons.chevron_right), onTap: () async {
            if (!await conferma(context, 'Nuova chiave di recupero?', 'La chiave del foglio stampato smette di funzionare.', si: 'Crea')) return;
            String r;
            List<String>? codici;
            if (!context.mounted) return;
            if (sincronia.collegato) {
              // Col NAS servono password e codice: cambiano anche i 10 codici di riserva.
              final pw = await chiediTesto(context, 'Password principale', si: 'Avanti');
              if (pw == null || !context.mounted) return;
              final cod = await chiediTesto(context, 'Codice di Authenticator', si: 'Crea');
              if (cod == null) return;
              try {
                (r, codici) = await sincronia.nuovoFoglio(pw, cod);
              } catch (e) {
                if (context.mounted) avviso(context, e is HttpException ? e.message : 'NAS non raggiungibile');
                return;
              }
            } else {
              r = await archivio.nuovaRecupero();
            }
            if (!context.mounted) return;
            await Navigator.push(
              context,
              MaterialPageRoute(
                builder: (c) => Scaffold(appBar: const Barra(titolo: 'Foglio di emergenza'), body: FoglioEmergenza(recupero: r, codici: codici, fine: () => Navigator.pop(c))),
              ),
            );
          }),
        ]),
        const SizedBox(height: 24),
        const Center(child: Text('DiGiPass $kVersione · i dati restano cifrati sul telefono', style: TextStyle(fontSize: 13))),
      ]),
    );
  }
}

class CestinoVista extends StatelessWidget {
  const CestinoVista({super.key});
  @override
  Widget build(BuildContext context) {
    return ListenableBuilder(
      listenable: archivio,
      builder: (context, _) {
        final c = archivio.cestino;
        return Scaffold(
          appBar: Barra(titolo: 'Cestino', azioni: [
            if (c.isNotEmpty)
              TextButton(
                onPressed: () async {
                  if (await conferma(context, 'Svuotare il cestino?', '${c.length} voci spariscono per sempre e non si possono recuperare.', si: 'Svuota')) {
                    await Allegati.dimentica([for (final v in c) ...Allegati.idDi(v)]);
                    await archivio.svuotaCestino();
                  }
                },
                child: const Text('Svuota', style: TextStyle(color: Colors.white, fontWeight: FontWeight.w700)),
              ),
          ]),
          body: ListView(padding: const EdgeInsets.all(14), children: [
            if (c.isEmpty) const Text('Il cestino è vuoto.', style: TextStyle(fontSize: 15)),
            if (c.isNotEmpty)
              Elenco(figli: [
                for (final v in c)
                  RigaVoce(v,
                      onTap: () => Navigator.push(context, MaterialPageRoute(builder: (_) => SchedaVoce(id: v['id']))),
                      coda: IconButton(icon: const Icon(Icons.restore), tooltip: 'Ripristina', onPressed: () => archivio.nelCestino(v['id'], false))),
              ]),
          ]),
        );
      },
    );
  }
}

/// Doppioni della Cassaforte (CHECKLIST 2.11), solo da Impostazioni.
class DoppioniVista extends StatelessWidget {
  const DoppioniVista({super.key});

  Future<void> _unisci(BuildContext context, List<List<Map<String, dynamic>>> gruppi) async {
    final n = gruppi.fold<int>(0, (t, g) => t + g.length - 1);
    if (!await conferma(context, gruppi.length == 1 ? 'Unire queste voci?' : 'Unire tutti i doppioni?',
        'Resta la voce modificata per ultima, con i siti e le note delle altre. ${n == 1 ? "L'altra va" : 'Le altre $n vanno'} nel Cestino, da cui si ${n == 1 ? 'può' : 'possono'} recuperare.',
        si: 'Unisci')) {
      return;
    }
    for (final g in gruppi) {
      await Doppioni.unisci(g);
    }
    if (context.mounted) avviso(context, gruppi.length == 1 ? 'Unite' : 'Uniti ${gruppi.length} gruppi');
  }

  @override
  Widget build(BuildContext context) {
    return ListenableBuilder(
      listenable: archivio,
      builder: (context, _) {
        final gruppi = Doppioni.gruppi();
        return Scaffold(
          appBar: Barra(titolo: 'Doppioni', azioni: [
            if (gruppi.length > 1)
              TextButton(
                onPressed: () => _unisci(context, gruppi),
                child: const Text('Unisci tutti', style: TextStyle(color: Colors.white, fontWeight: FontWeight.w700)),
              ),
          ]),
          body: ListView(padding: const EdgeInsets.all(14), children: [
            if (gruppi.isEmpty) const Padding(padding: EdgeInsets.all(20), child: Center(child: Text('Nessun doppione in Cassaforte', style: TextStyle(fontSize: 16)))),
            for (final g in gruppi) ...[
              Elenco(figli: [for (final v in g) RigaVoce(v, onTap: () => Navigator.push(context, MaterialPageRoute(builder: (_) => SchedaVoce(id: v['id']))))]),
              const SizedBox(height: 8),
              Secondario(testo: 'Unisci queste ${g.length}', icona: Icons.merge_type, onTap: () => _unisci(context, [g])),
              const SizedBox(height: 18),
            ],
          ]),
        );
      },
    );
  }
}

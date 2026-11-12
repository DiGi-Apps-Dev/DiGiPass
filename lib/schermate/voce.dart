import 'dart:async';

import 'package:flutter/material.dart';
import 'package:mobile_scanner/mobile_scanner.dart';

import '../archivio.dart';
import '../generatore.dart';
import '../allegati.dart';
import '../main.dart';
import 'allegati_vista.dart';
import '../nativo.dart';
import '../tema.dart';
import '../totp.dart';
import 'home.dart';

/// Scheda di una voce: campi con copia, password nascoste, codice 2FA che cambia da solo.
class SchedaVoce extends StatefulWidget {
  const SchedaVoce({super.key, required this.id});
  final String id;
  @override
  State<SchedaVoce> createState() => _SchedaVoceState();
}

class _SchedaVoceState extends State<SchedaVoce> {
  final _visibili = <String>{};
  Timer? _t;

  @override
  void initState() {
    super.initState();
    _t = Timer.periodic(const Duration(seconds: 1), (_) => setState(() {}));
  }

  @override
  void dispose() {
    _t?.cancel();
    super.dispose();
  }

  Future<void> _copia(String testo, String cosa, {bool segreto = true}) async {
    await Nativo.copia(testo, segreto: segreto, secondi: impostazioni.appuntiSecondi);
    final s = impostazioni.appuntiSecondi;
    if (mounted) avviso(context, segreto && s > 0 ? '$cosa copiato: gli appunti si svuotano fra $s secondi' : '$cosa copiato');
  }

  /// Indirizzo apribile: solo http/https, https:// se manca; le app (android://) no.
  static String? urlSito(String s) {
    final t = s.trim();
    if (t.isEmpty || t.startsWith('android://')) return null;
    final u = Uri.tryParse(RegExp(r'^[a-zA-Z][a-zA-Z0-9+.-]*:').hasMatch(t) ? t : 'https://$t');
    return u != null && (u.scheme == 'http' || u.scheme == 'https') && u.host.isNotEmpty ? u.toString() : null;
  }

  Widget _campo(String chiave, String etichetta, String valore, {bool nascosto = false, String? link}) {
    final vedi = !nascosto || _visibili.contains(chiave);
    return Container(
      padding: const EdgeInsets.fromLTRB(12, 9, 4, 9),
      decoration: BoxDecoration(color: kG1, borderRadius: BorderRadius.circular(8), border: Border.all(color: kFilo2)),
      child: Row(children: [
        Expanded(
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text(etichetta.toUpperCase(), style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w400, color: kRosa)),
            const SizedBox(height: 2),
            if (link != null)
              // Sito cliccabile: si apre nel browser esterno.
              InkWell(
                onTap: () => Nativo.apriLink(link),
                child: Text(valore, style: const TextStyle(fontSize: 17, color: kInk, decoration: TextDecoration.underline, decorationColor: kInk)),
              )
            else
              SelectableText(vedi ? valore : '•' * 12, style: TextStyle(fontSize: 17, color: kInk, letterSpacing: vedi ? 0 : 2)),
          ]),
        ),
        if (nascosto)
          IconButton(
            icon: Icon(vedi ? Icons.visibility_off : Icons.visibility),
            tooltip: vedi ? 'Nascondi' : 'Mostra',
            onPressed: () => setState(() => vedi ? _visibili.remove(chiave) : _visibili.add(chiave)),
          ),
        if (link != null) IconButton(icon: const Icon(Icons.open_in_new), tooltip: 'Apri il sito', onPressed: () => Nativo.apriLink(link)),
        IconButton(icon: const Icon(Icons.copy), tooltip: 'Copia', onPressed: () => _copia(valore, etichetta, segreto: nascosto)),
      ]),
    );
  }

  /// Nella scheda dell'identità il titolo della sezione compare prima del primo campo compilato di quella sezione.
  String? _primoDellaSezione(TipoVoce tipo, String k, Map campi) {
    if (tipo.sezioni.isEmpty) return null;
    String? sezione;
    for (final (kk, _, _) in tipo.campi) {
      if (tipo.sezioni.containsKey(kk)) sezione = kk;
      if (kk == k) break;
    }
    if (sezione == null) return null;
    var dentro = false;
    for (final (kk, _, _) in tipo.campi) {
      if (kk == sezione) dentro = true;
      if (!dentro) continue;
      if (kk != sezione && tipo.sezioni.containsKey(kk)) break;
      if ((campi[kk] ?? '').toString().isNotEmpty) return kk == k ? tipo.sezioni[sezione] : null;
    }
    return null;
  }

  @override
  Widget build(BuildContext context) {
    return ListenableBuilder(
      listenable: archivio,
      builder: (context, _) {
        final i = archivio.tutteLeVoci.indexWhere((x) => x['id'] == widget.id);
        if (i < 0) return const Scaffold(appBar: Barra(titolo: ''), body: Center(child: Text('Voce non trovata')));
        final v = archivio.tutteLeVoci[i];
        final tipo = TipoVoce.di(v['tipo']);
        final campi = (v['campi'] as Map?)?.cast<String, dynamic>() ?? {};
        final titolo = (v['titolo'] ?? '') as String;
        final totp = Totp.leggi((v['totp'] ?? '').toString());
        final extra = ((v['extra'] as List?) ?? []).cast<Map>();
        final nelCestino = v['cestino'] != null;
        final siti = ((v['siti'] as List?) ?? []).cast<String>();
        final tipoCarta = tipo == TipoVoce.carta ? TipoVoce.tipoCarta((campi['numero'] ?? '').toString()) : '';
        String etichetta(String k, String et) => tipo == TipoVoce.login && k == 'utente' && (campi['email'] ?? '').toString().isNotEmpty ? 'Nome utente' : et;
        final righe = <Widget>[
          if (tipoCarta.isNotEmpty) _campo('tipoCarta', 'Tipo di carta', tipoCarta),
          for (final (k, et, nasc) in tipo.campi)
            if ((campi[k] ?? '').toString().isNotEmpty) ...[
              if (_primoDellaSezione(tipo, k, campi) != null)
                Padding(padding: const EdgeInsets.only(top: 6, bottom: 2), child: Etichetta(_primoDellaSezione(tipo, k, campi)!)),
              _campo(k, etichetta(k, et), campi[k].toString(), nascosto: nasc),
            ],
          if (totp != null)
            Container(
              padding: const EdgeInsets.fromLTRB(12, 9, 4, 9),
              decoration: BoxDecoration(color: kG1, borderRadius: BorderRadius.circular(8), border: Border.all(color: kFilo2)),
              child: Row(children: [
                Expanded(
                  child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                    const Text('CODICE 2FA', style: TextStyle(fontSize: 13, fontWeight: FontWeight.w400, color: kRosa)),
                    Text(totp.codice().replaceAllMapped(RegExp(r'^(\d{3})(\d+)$'), (m) => '${m[1]} ${m[2]}'),
                        style: const TextStyle(fontSize: 28, fontWeight: FontWeight.w800, letterSpacing: 3)),
                  ]),
                ),
                SizedBox(
                  width: 30,
                  height: 30,
                  child: Stack(alignment: Alignment.center, children: [
                    CircularProgressIndicator(value: totp.restanti() / totp.periodo, strokeWidth: 3, color: kRosa, backgroundColor: kG3),
                    Text('${totp.restanti()}', style: const TextStyle(fontSize: 11, fontWeight: FontWeight.w700)),
                  ]),
                ),
                IconButton(icon: const Icon(Icons.copy), tooltip: 'Copia', onPressed: () => _copia(totp.codice(), 'Codice', segreto: true)),
              ]),
            ),
          for (final s in siti.where((s) => !s.startsWith('android://'))) _campo('sito$s', 'Sito', s, link: urlSito(s)),
          for (final s in siti.where((s) => s.startsWith('android://'))) _campo('sito$s', 'App collegata', s.substring(10)),
          for (final (n, e) in extra.indexed)
            if ((e['valore'] ?? '').toString().isNotEmpty)
              e['tipo'] == 'totp' && Totp.leggi(e['valore'].toString()) != null
                  ? _campo('extra$n', e['nome'] ?? 'Codice', Totp.leggi(e['valore'].toString())!.codice())
                  : _campo('extra$n', (e['nome'] ?? 'Campo').toString(), e['valore'].toString(), nascosto: e['tipo'] == 'nascosto'),
          if ((v['note'] ?? '').toString().isNotEmpty) _campo('note', 'Note', v['note'].toString()),
          SezioneAllegati(voce: v, nelCestino: nelCestino),
        ];
        return Scaffold(
          appBar: Barra(titolo: titolo, azioni: [
            if (!nelCestino)
              IconButton(
                icon: const Icon(Icons.edit_outlined),
                tooltip: 'Modifica',
                onPressed: () => Navigator.push(context, MaterialPageRoute(builder: (_) => ModificaVoce(voce: Map<String, dynamic>.from(v)))),
              ),
            PopupMenuButton<String>(
              color: kG2,
              iconColor: Colors.white,
              onSelected: (a) async {
                if (a == 'fissa') {
                  v['fissata'] = v['fissata'] != true;
                  await archivio.salvaVoce(v);
                } else if (a == 'cestino') {
                  await archivio.nelCestino(v['id'], true);
                  if (context.mounted) {
                    avviso(context, 'Eliminata: la trovi nel Cestino, da cui puoi recuperarla');
                    Navigator.pop(context);
                  }
                } else if (a == 'ripristina') {
                  await archivio.nelCestino(v['id'], false);
                } else if (a == 'elimina') {
                  if (await conferma(context, 'Eliminare per sempre?', '«$titolo» sparisce e non si può recuperare.', si: 'Elimina')) {
                    await Allegati.dimentica(Allegati.idDi(v).toList());
                    await archivio.eliminaDefinitiva(v['id']);
                    if (context.mounted) Navigator.pop(context);
                  }
                }
              },
              itemBuilder: (_) => nelCestino
                  ? const [
                      PopupMenuItem(value: 'ripristina', child: Text('Ripristina', style: TextStyle(color: kInk))),
                      PopupMenuItem(value: 'elimina', child: Text('Elimina per sempre', style: TextStyle(color: kInk))),
                    ]
                  : [
                      PopupMenuItem(value: 'fissa', child: Text(v['fissata'] == true ? 'Togli da Fissate' : 'Fissa in alto', style: const TextStyle(color: kInk))),
                      const PopupMenuItem(value: 'cestino', child: Text('Elimina', style: TextStyle(color: kInk))),
                    ],
            ),
          ]),
          body: ListView(padding: const EdgeInsets.all(14), children: [
            Row(children: [
              Avatar(titolo, lato: 52, sito: ((v['siti'] as List?) ?? []).isEmpty ? null : (v['siti'] as List).first.toString()),
              const SizedBox(width: 12),
              Expanded(
                child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  Text(titolo, style: const TextStyle(fontSize: 26, fontWeight: FontWeight.w600)),
                  Text([tipo.nome, if (nelCestino) 'nel cestino'].join(' · '),
                      style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w600)),
                ]),
              ),
            ]),
            const SizedBox(height: 14),
            for (final r in righe) ...[r, const SizedBox(height: 10)],
          ]),
        );
      },
    );
  }
}

/// Nuova voce o modifica.
class ModificaVoce extends StatefulWidget {
  const ModificaVoce({super.key, this.voce});
  final Map<String, dynamic>? voce;
  @override
  State<ModificaVoce> createState() => _ModificaVoceState();
}

class _ModificaVoceState extends State<ModificaVoce> {
  late Map<String, dynamic> _v;
  final _c = <String, TextEditingController>{};
  final _nascosti = <String>{};
  late List<Map<String, dynamic>> _extra;
  late List<TextEditingController> _extraNome, _extraValore;

  TextEditingController _ctl(String k, String iniziale) => _c.putIfAbsent(k, () => TextEditingController(text: iniziale));

  @override
  void initState() {
    super.initState();
    _v = widget.voce ??
        {'id': Archivio.nuovoId(), 'tipo': 'login', 'titolo': '', 'cartella': '', 'fissata': false, 'campi': <String, dynamic>{}, 'siti': [], 'note': '', 'totp': '', 'cestino': null};
    final campi = (_v['campi'] as Map?)?.cast<String, dynamic>() ?? {};
    for (final t in TipoVoce.tutti) {
      for (final (k, _, nasc) in t.campi) {
        _ctl('campo.$k', (campi[k] ?? '').toString());
        if (nasc) _nascosti.add('campo.$k');
      }
    }
    _ctl('titolo', _v['titolo'] ?? '');
    _ctl('cartella', _v['cartella'] ?? '');
    final tuttiSiti = ((_v['siti'] as List?) ?? []).cast<String>();
    _ctl('siti', tuttiSiti.where((s) => !s.startsWith('android://')).join('\n'));
    _ctl('app', tuttiSiti.where((s) => s.startsWith('android://')).map((s) => s.substring(10)).join('\n'));
    _ctl('note', _v['note'] ?? '');
    _ctl('totp', _v['totp'] ?? '');
    _extra = ((_v['extra'] as List?) ?? []).map((e) => Map<String, dynamic>.from(e as Map)).toList();
    _extraNome = [for (final e in _extra) TextEditingController(text: e['nome'] ?? '')];
    _extraValore = [for (final e in _extra) TextEditingController(text: e['valore'] ?? '')];
  }

  TipoVoce get _tipo => TipoVoce.di(_v['tipo']);

  Future<void> _salva() async {
    final titolo = _c['titolo']!.text.trim();
    if (titolo.isEmpty) return avviso(context, 'Scrivi un titolo');
    final totp = _c['totp']!.text.trim();
    if (_tipo == TipoVoce.login && totp.isNotEmpty && Totp.leggi(totp) == null) return avviso(context, 'Il segreto 2FA non è valido');
    _v['titolo'] = titolo;
    _v['cartella'] = _c['cartella']!.text.trim();
    _v['note'] = _c['note']!.text.trim();
    // I campi che questa versione non mostra (scritti da un'altra parte di DiGiPass) restano com'erano.
    final prima = (_v['campi'] as Map?)?.cast<String, dynamic>() ?? {};
    _v['campi'] = {...prima, for (final (k, _, _) in _tipo.campi) k: _c['campo.$k']!.text};
    if (_tipo == TipoVoce.login) {
      List<String> righe(String k) => _c[k]!.text.split(RegExp(r'[\n,]')).map((s) => s.trim()).where((s) => s.isNotEmpty).toList();
      _v['siti'] = [...righe('siti'), for (final a in righe('app')) a.startsWith('android://') ? a : 'android://$a'];
      _v['totp'] = totp;
    } else {
      _v['siti'] = [];
      _v['totp'] = '';
    }
    _v['extra'] = [
      for (var i = 0; i < _extra.length; i++)
        if (_extraNome[i].text.trim().isNotEmpty || _extraValore[i].text.trim().isNotEmpty)
          {'nome': _extraNome[i].text.trim(), 'tipo': _extra[i]['tipo'], 'valore': _extraValore[i].text.trim()},
    ];
    await archivio.salvaVoce(_v);
    if (mounted) Navigator.pop(context);
  }

  Widget _testo(String k, String etichetta, {bool nascosto = false, int righe = 1, Widget? dopo}) {
    final vedi = !nascosto || !_nascosti.contains(k);
    return Padding(
      padding: const EdgeInsets.only(bottom: 10),
      child: TextField(style: kStileCampo, 
        controller: _c[k],
        obscureText: !vedi,
        maxLines: vedi ? righe : 1,
        minLines: 1,
        onChanged: (_) => setState(() {}),
        decoration: campoRosa(
          etichetta,
          suffixIcon: Row(mainAxisSize: MainAxisSize.min, children: [
            if (nascosto)
              IconButton(icon: Icon(vedi ? Icons.visibility_off : Icons.visibility), onPressed: () => setState(() => vedi ? _nascosti.add(k) : _nascosti.remove(k))),
            if (dopo != null) dopo,
          ]),
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final nuova = widget.voce == null;
    final pw = _c['campo.password']!.text;
    return Scaffold(
      appBar: Barra(titolo: nuova ? 'Nuova voce' : 'Modifica', azioni: [
        TextButton(onPressed: _salva, child: const Text('Salva', style: TextStyle(color: Colors.white, fontSize: 16, fontWeight: FontWeight.w700))),
      ]),
      body: ListView(padding: const EdgeInsets.all(14), children: [
        if (nuova) ...[
          Wrap(spacing: 8, runSpacing: 8, children: [
            for (final t in TipoVoce.tutti) Chip2(t.nome, acceso: _tipo == t, onTap: () => setState(() => _v['tipo'] = t.id)),
          ]),
          const SizedBox(height: 14),
        ],
        _testo('titolo', 'Titolo'),
        for (final (k, et, nasc) in _tipo.campi)
          if (_tipo == TipoVoce.login && k == 'email' && !impostazioni.utenteSeparato && _c['campo.email']!.text.isEmpty)
            const SizedBox.shrink()
          else if (_tipo == TipoVoce.login && k == 'utente')
            _testo('campo.$k', impostazioni.utenteSeparato || _c['campo.email']!.text.isNotEmpty ? 'Nome utente' : et)
          else if (k == 'password') ...[
            _testo('campo.$k', et,
                nascosto: true,
                dopo: IconButton(
                  icon: const Icon(Icons.auto_awesome),
                  tooltip: 'Genera',
                  onPressed: () async {
                    final p = await generaPassword(context);
                    if (p != null) setState(() => _c['campo.$k']!.text = p);
                  },
                )),
            if (pw.isNotEmpty)
              Padding(
                padding: const EdgeInsets.only(bottom: 10, left: 4),
                child: Text('Forza: ${Generatore.forza(pw).$2}', style: const TextStyle(fontWeight: FontWeight.w700)),
              ),
          ] else ...[
            if (_tipo.sezioni.containsKey(k)) Padding(padding: const EdgeInsets.only(top: 6, bottom: 8), child: Etichetta(_tipo.sezioni[k]!)),
            _testo('campo.$k', et, nascosto: nasc),
            if (_tipo == TipoVoce.carta && k == 'numero' && TipoVoce.tipoCarta(_c['campo.numero']!.text).isNotEmpty)
              Padding(
                padding: const EdgeInsets.only(bottom: 10, left: 4),
                child: Text(TipoVoce.tipoCarta(_c['campo.numero']!.text), style: const TextStyle(fontWeight: FontWeight.w700)),
              ),
          ],
        if (_tipo == TipoVoce.login) ...[
          _testo('siti', 'Siti (uno per riga, es. norton.com)', righe: 3),
          _testo('app', 'App collegate (una per riga, es. com.amazon.mShop.android.shopping)', righe: 2),
          _testo('totp', 'Segreto 2FA (facoltativo)',
              nascosto: false,
              dopo: IconButton(
                icon: const Icon(Icons.qr_code_scanner),
                tooltip: 'Leggi il QR',
                onPressed: () async {
                  final r = await senzaBlocco(() => Navigator.push<String>(context, MaterialPageRoute(builder: (_) => const ScansioneQr())));
                  if (r != null) setState(() => _c['totp']!.text = r);
                },
              )),
        ],
        _testo('note', 'Note', righe: 5),
        const SizedBox(height: 6),
        const Etichetta('Campi personalizzati'),
        const SizedBox(height: 8),
        for (var i = 0; i < _extra.length; i++)
          Container(
            margin: const EdgeInsets.only(bottom: 10),
            padding: const EdgeInsets.all(10),
            decoration: BoxDecoration(color: kG1, borderRadius: BorderRadius.circular(8), border: Border.all(color: kFilo)),
            child: Column(children: [
              Row(children: [
                Expanded(child: TextField(style: kStileCampo, controller: _extraNome[i], decoration: campoRosa('Nome del campo'))),
                IconButton(
                  icon: const Icon(Icons.delete_outline),
                  tooltip: 'Togli',
                  onPressed: () => setState(() {
                    _extra.removeAt(i);
                    _extraNome.removeAt(i);
                    _extraValore.removeAt(i);
                  }),
                ),
              ]),
              const SizedBox(height: 8),
              Wrap(spacing: 6, children: [
                for (final (id, n) in [('testo', 'Testo'), ('nascosto', 'Nascosto'), ('data', 'Data'), ('totp', '2FA')])
                  Chip2(n, acceso: _extra[i]['tipo'] == id, onTap: () => setState(() => _extra[i]['tipo'] = id)),
              ]),
              const SizedBox(height: 8),
              TextField(style: kStileCampo, 
                controller: _extraValore[i],
                obscureText: _extra[i]['tipo'] == 'nascosto',
                decoration: campoRosa(_extra[i]['tipo'] == 'data' ? 'Data (GG.MM.AAAA)' : _extra[i]['tipo'] == 'totp' ? 'Segreto 2FA' : 'Valore'),
              ),
            ]),
          ),
        Secondario(
          testo: 'Aggiungi un campo',
          icona: Icons.add,
          onTap: () => setState(() {
            _extra.add({'tipo': 'testo'});
            _extraNome.add(TextEditingController());
            _extraValore.add(TextEditingController());
          }),
        ),
        const SizedBox(height: 18),
        Principale(testo: 'Salva', onTap: _salva),
        const SizedBox(height: 30),
      ]),
    );
  }
}

/// Foglio del generatore: casuale o di parole. Ritorna la password scelta.
Future<String?> generaPassword(BuildContext context) => showModalBottomSheet<String>(
      context: context,
      isScrollControlled: true,
      builder: (_) => const _Generatore(),
    );

class _Generatore extends StatefulWidget {
  const _Generatore();
  @override
  State<_Generatore> createState() => _GeneratoreState();
}

class _GeneratoreState extends State<_Generatore> {
  bool _parole = false, _mai = true, _num = true, _sim = true, _iniziale = true;
  double _lung = 20, _quante = 4;
  String _sep = '-';
  late String _p;

  @override
  void initState() {
    super.initState();
    _nuova();
  }

  void _nuova() => _p = _parole
      ? Generatore.parole(quante: _quante.round(), separatore: _sep, numero: _num, maiuscola: _iniziale)
      : Generatore.casuale(lunghezza: _lung.round(), maiuscole: _mai, numeri: _num, simboli: _sim);

  @override
  Widget build(BuildContext context) {
    void cambia(VoidCallback f) => setState(() {
          f();
          _nuova();
        });
    return SafeArea(
      child: Padding(
        padding: const EdgeInsets.fromLTRB(16, 18, 16, 16),
        child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          const Etichetta('Genera una password'),
          const SizedBox(height: 12),
          Row(children: [
            Expanded(child: Chip2('Casuale', acceso: !_parole, onTap: () => cambia(() => _parole = false))),
            const SizedBox(width: 8),
            Expanded(child: Chip2('Di parole', acceso: _parole, onTap: () => cambia(() => _parole = true))),
          ]),
          const SizedBox(height: 14),
          Container(
            padding: const EdgeInsets.all(14),
            decoration: BoxDecoration(color: kG2, borderRadius: BorderRadius.circular(8)),
            child: SelectableText(_p, style: const TextStyle(fontSize: 19, fontFamily: 'monospace', fontWeight: FontWeight.w700)),
          ),
          const SizedBox(height: 6),
          Text('Forza: ${Generatore.forza(_p).$2}', style: const TextStyle(fontWeight: FontWeight.w700)),
          const SizedBox(height: 10),
          if (!_parole) ...[
            Text('Lunghezza: ${_lung.round()}', style: const TextStyle(fontWeight: FontWeight.w600)),
            Slider(value: _lung, min: 8, max: 64, divisions: 56, activeColor: kRosa, onChanged: (x) => cambia(() => _lung = x)),
            Wrap(spacing: 8, runSpacing: 8, children: [
              Chip2('Maiuscole', acceso: _mai, onTap: () => cambia(() => _mai = !_mai)),
              Chip2('Numeri', acceso: _num, onTap: () => cambia(() => _num = !_num)),
              Chip2('Simboli', acceso: _sim, onTap: () => cambia(() => _sim = !_sim)),
            ]),
          ] else ...[
            Text('Parole: ${_quante.round()}', style: const TextStyle(fontWeight: FontWeight.w600)),
            Slider(value: _quante, min: 3, max: 8, divisions: 5, activeColor: kRosa, onChanged: (x) => cambia(() => _quante = x)),
            Wrap(spacing: 8, runSpacing: 8, children: [
              for (final (s, n) in [('-', 'Trattino'), (' ', 'Spazio'), ('.', 'Punto'), ('_', 'Trattino basso'), (',', 'Virgola'), ('numeri', 'Numeri'), ('numerisimboli', 'Numeri e simboli')])
                Chip2(n, acceso: _sep == s, onTap: () => cambia(() => _sep = s)),
              Chip2('Iniziale maiuscola', acceso: _iniziale, onTap: () => cambia(() => _iniziale = !_iniziale)),
              Chip2('Con un numero', acceso: _num, onTap: () => cambia(() => _num = !_num)),
            ]),
          ],
          const SizedBox(height: 16),
          Row(children: [
            Expanded(child: Secondario(testo: 'Un\'altra', icona: Icons.refresh, onTap: () => setState(_nuova))),
            const SizedBox(width: 10),
            Expanded(child: Principale(testo: 'Usa questa', onTap: () => Navigator.pop(context, _p))),
          ]),
        ]),
      ),
    );
  }
}

/// Fotocamera per leggere il QR del 2FA. Ritorna il testo letto.
class ScansioneQr extends StatefulWidget {
  const ScansioneQr({super.key});
  @override
  State<ScansioneQr> createState() => _ScansioneQrState();
}

class _ScansioneQrState extends State<ScansioneQr> {
  bool _fatto = false;
  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: const Barra(titolo: 'Inquadra il QR del 2FA'),
      body: Stack(children: [
        MobileScanner(
          onDetect: (c) {
            final v = c.barcodes.map((b) => b.rawValue).whereType<String>().firstWhere((s) => Totp.leggi(s) != null, orElse: () => '');
            if (v.isEmpty || _fatto) return;
            _fatto = true;
            Navigator.pop(context, v);
          },
        ),
        const Positioned(
          left: 16,
          right: 16,
          bottom: 30,
          child: Text('Apri la pagina del sito che mostra il QR per l\'autenticazione a due fattori e inquadralo.',
              textAlign: TextAlign.center, style: TextStyle(fontSize: 15, fontWeight: FontWeight.w600, color: Colors.white)),
        ),
      ]),
    );
  }
}

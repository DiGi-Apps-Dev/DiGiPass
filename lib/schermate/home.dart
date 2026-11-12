import 'dart:typed_data';

import 'package:flutter/material.dart';

import '../archivio.dart';
import '../main.dart';
import '../tema.dart';
import 'altre.dart';
import 'voce.dart';

/// Colore fisso per ogni nome, per riconoscere le voci a colpo d'occhio.
Color coloreDi(String s) {
  const c = [Color(0xFF2B6FD6), Color(0xFFC7A008), Color(0xFF1F8F5A), Color(0xFF8A2BA8), Color(0xFFD2453A), Color(0xFF2E9E8F), Color(0xFFE07A30), Color(0xFF7A4FD0), Color(0xFFC2417A)];
  var h = 0;
  for (final u in s.codeUnits) {
    h = (h * 31 + u) & 0x7fffffff;
  }
  return c[h % c.length];
}

/// Dominio di un sito salvato per il logo («https://www.norton.com/x» → «norton.com»); le app android:// no.
String? dominioDi(String? s) {
  final t = (s ?? '').trim().toLowerCase();
  if (t.isEmpty || t.startsWith('android://')) return null;
  final u = Uri.tryParse(RegExp(r'^[a-z][a-z0-9+.-]*:').hasMatch(t) ? t : 'https://$t');
  if (u == null || (u.scheme != 'http' && u.scheme != 'https')) return null;
  final d = u.host.replaceFirst(RegExp(r'^www\.'), '');
  return d.contains('.') && !RegExp(r'^[\d.]+$').hasMatch(d) && !d.contains(':') ? d : null;
}

/// Iniziale colorata; se il sito ha un logo (preso dal NAS, mai da servizi esterni) compare sopra.
class Avatar extends StatelessWidget {
  const Avatar(this.nome, {super.key, this.lato = 38, this.sito});
  final String nome;
  final double lato;
  final String? sito;
  @override
  Widget build(BuildContext context) {
    final iniziale = Container(
      width: lato,
      height: lato,
      alignment: Alignment.center,
      decoration: BoxDecoration(color: coloreDi(nome), borderRadius: BorderRadius.circular(8)),
      child: Text(nome.isEmpty ? '?' : nome.characters.first.toUpperCase(),
          style: TextStyle(color: Colors.white, fontWeight: FontWeight.w800, fontSize: lato * .42)),
    );
    final d = dominioDi(sito);
    if (d == null || !impostazioni.icone) return iniziale;
    return FutureBuilder<Uint8List?>(
      future: sincronia.logo(d),
      builder: (context, f) => f.data == null
          ? iniziale
          : ClipRRect(
              borderRadius: BorderRadius.circular(8),
              child: Image.memory(f.data!, width: lato, height: lato, fit: BoxFit.cover, errorBuilder: (_, __, ___) => iniziale),
            ),
    );
  }
}

String sottotitolo(Map<String, dynamic> v) {
  final c = (v['campi'] as Map?)?.cast<String, dynamic>() ?? {};
  switch (v['tipo']) {
    case 'login':
      final u = (c['utente'] ?? '') as String;
      return [if (u.isNotEmpty) u, if ((v['totp'] ?? '').toString().isNotEmpty) '2FA'].join(' · ').ifEmpty('Login');
    case 'carta':
      final n = (c['numero'] ?? '').toString().replaceAll(' ', '');
      return n.length >= 4 ? 'Carta ·· ${n.substring(n.length - 4)}' : 'Carta';
    case 'wifi':
      return 'Rete Wi-Fi ${c['ssid'] ?? ''}'.trim();
    case 'identita':
      return 'Identità';
    default:
      final n = (v['note'] ?? '').toString().split('\n').first;
      return n.isEmpty ? 'Nota' : n;
  }
}

extension on String {
  String ifEmpty(String a) => isEmpty ? a : this;
}

class RigaVoce extends StatelessWidget {
  const RigaVoce(this.v, {super.key, this.onTap, this.coda});
  final Map<String, dynamic> v;
  final VoidCallback? onTap;
  final Widget? coda;
  @override
  Widget build(BuildContext context) {
    final t = (v['titolo'] ?? '') as String;
    return InkWell(
      onTap: onTap,
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
        child: Row(children: [
          Avatar(t, sito: ((v['siti'] as List?) ?? []).isEmpty ? null : (v['siti'] as List).first.toString()),
          const SizedBox(width: 12),
          Expanded(
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text(t, maxLines: 1, overflow: TextOverflow.ellipsis, style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w700)),
              Text(sottotitolo(v), maxLines: 1, overflow: TextOverflow.ellipsis, style: const TextStyle(fontSize: 13)),
            ]),
          ),
          if (coda != null) coda!,
          if (v['fissata'] == true)
            Container(width: 10, height: 10, decoration: BoxDecoration(color: kPuntoGiallo, shape: BoxShape.circle, border: Border.all(color: kContorno, width: 1.5))),
        ]),
      ),
    );
  }
}

/// Barra delle quattro schede principali: sempre lucchetto e scritta DiGiPass, il titolo non cambia.
class BarraPrincipale extends StatelessWidget implements PreferredSizeWidget {
  const BarraPrincipale({super.key});
  @override
  Size get preferredSize => const Size.fromHeight(63);
  @override
  Widget build(BuildContext context) => Barra(
        marchio: true,
        indietro: false,
        azioni: [
          // Aggiorna dal NAS: senza passare dalle Impostazioni.
          if (sincronia.url.isNotEmpty)
            IconButton(
              icon: const Icon(Icons.sync),
              tooltip: 'Aggiorna',
              onPressed: () async {
                final ok = await sincronia.sincronizza();
                // Mai un avviso vuoto: se non sincronizza, si dice perché.
                final msg = ok
                    ? 'Aggiornato'
                    : sincronia.ultimoErrore.isNotEmpty
                        ? sincronia.ultimoErrore
                        : !sincronia.collegato
                            ? 'Non collegato al NAS: collegalo da Impostazioni'
                            : 'Aggiornamento già in corso: riprova fra un attimo';
                if (context.mounted) avviso(context, msg);
              },
            ),
          IconButton(icon: const Icon(Icons.lock_outline), tooltip: 'Blocca', onPressed: () => archivio.blocca()),
        ],
      );
}

class Home extends StatefulWidget {
  const Home({super.key});
  @override
  State<Home> createState() => _HomeState();
}

class _HomeState extends State<Home> {
  int _scheda = 0;

  @override
  Widget build(BuildContext context) {
    final pagine = [const CassaforteVista(), const MemoriaVista(), const SicurezzaVista(), const ImpostazioniVista()];
    return Scaffold(
      body: IndexedStack(index: _scheda, children: pagine),
      bottomNavigationBar: Container(
        decoration: const BoxDecoration(color: kG1, border: Border(top: BorderSide(color: kFilo2))),
        child: SafeArea(
          top: false,
          child: SizedBox(
            height: 64,
            child: Row(children: [
              for (final (i, ic, t) in [(0, Icons.lock_outline, 'Cassaforte'), (1, Icons.language, 'Memoria siti'), (2, Icons.shield_outlined, 'Sicurezza'), (3, Icons.settings_outlined, 'Impostazioni')])
                // Voce scelta col colore pieno del marchio: prima l'Ink disegnava la sfumatura
                // sotto il fondo grigio della barra e non si vedeva.
                Expanded(
                  child: Container(
                    decoration: BoxDecoration(gradient: _scheda == i ? kBarra : null),
                    child: Material(
                    type: MaterialType.transparency,
                    child: InkWell(
                    onTap: () => setState(() => _scheda = i),
                    child: Column(mainAxisAlignment: MainAxisAlignment.center, children: [
                        Icon(ic, color: _scheda == i ? Colors.white : kInk, size: 22),
                        const SizedBox(height: 3),
                        Text(t, style: TextStyle(fontSize: 12.5, fontWeight: FontWeight.w600, color: _scheda == i ? Colors.white : kInk)),
                      ]),
                    ),
                    ),
                  ),
                ),
            ]),
          ),
        ),
      ),
    );
  }
}

/// Elenco della Cassaforte: solo quello che l'utente ci ha messo.
class CassaforteVista extends StatefulWidget {
  const CassaforteVista({super.key});
  @override
  State<CassaforteVista> createState() => _CassaforteVistaState();
}

class _CassaforteVistaState extends State<CassaforteVista> {
  final _cerca = TextEditingController();
  String _tipo = '';

  List<Map<String, dynamic>> _ordina(List<Map<String, dynamic>> l) {
    // CHECKLIST 2.6: più recenti (ultima modifica), dal più nuovo e dal più vecchio (creazione), A-Z, Z-A.
    int t(Map v) => ((v['modificata'] ?? 0) as num).toInt();
    int c(Map v) => ((v['creata'] ?? v['modificata'] ?? 0) as num).toInt();
    String n(Map v) => (v['titolo'] ?? '').toString().toLowerCase();
    switch (impostazioni.ordine) {
      case 'za':
        l.sort((a, b) => n(b).compareTo(n(a)));
      case 'recenti':
        l.sort((a, b) => t(b).compareTo(t(a)));
      case 'nuove':
        l.sort((a, b) => c(b).compareTo(c(a)));
      case 'vecchie':
        l.sort((a, b) => c(a).compareTo(c(b)));
      default:
        l.sort((a, b) => n(a).compareTo(n(b)));
    }
    return l;
  }

  static const _nomiOrdine = {'recenti': 'Più recenti', 'nuove': 'Dal più nuovo', 'vecchie': 'Dal più vecchio', 'az': 'Titolo A-Z', 'za': 'Titolo Z-A'};

  @override
  Widget build(BuildContext context) {
    return ListenableBuilder(
      listenable: Listenable.merge([archivio, impostazioni]),
      builder: (context, _) {
        final tutte = archivio.voci;
        final q = _cerca.text.trim().toLowerCase();
        bool trova(Map<String, dynamic> v) {
          if (q.isEmpty) return true;
          final c = (v['campi'] as Map?)?.values.join(' ') ?? '';
          final testo = '${v['titolo']} ${v['note']} ${(v['siti'] as List?)?.join(' ') ?? ''} $c'.toLowerCase();
          return testo.contains(q);
        }

        final filtrate = tutte.where((v) => (_tipo.isEmpty || v['tipo'] == _tipo) && trova(v)).toList();
        final fissate = _ordina(filtrate.where((v) => v['fissata'] == true).toList());
        final altre = _ordina(filtrate.where((v) => v['fissata'] != true).toList());
        int conta(String t) => tutte.where((v) => v['tipo'] == t).length;

        return Scaffold(
          appBar: const BarraPrincipale(),
          floatingActionButton: DecoratedBox(
            decoration: BoxDecoration(gradient: kMarchio, borderRadius: BorderRadius.circular(16)),
            child: FloatingActionButton(
              backgroundColor: Colors.transparent,
              elevation: 0,
              tooltip: 'Nuova voce',
              onPressed: () => Navigator.push(context, MaterialPageRoute(builder: (_) => const ModificaVoce())),
              child: const Icon(Icons.add, color: Colors.white, size: 30),
            ),
          ),
          body: ListView(padding: const EdgeInsets.fromLTRB(14, 14, 14, 100), children: [
            TextField(style: kStileCampo, 
              controller: _cerca,
              onChanged: (_) => setState(() {}),
              decoration: InputDecoration(
                hintText: 'Cerca nella cassaforte',
                prefixIcon: const Icon(Icons.search),
                suffixIcon: _cerca.text.isEmpty ? null : IconButton(icon: const Icon(Icons.close), onPressed: () => setState(() => _cerca.clear())),
              ),
            ),
            const SizedBox(height: 10),
            Wrap(spacing: 8, runSpacing: 8, children: [
              Chip2('Tutto ${tutte.length}', acceso: _tipo.isEmpty, onTap: () => setState(() => _tipo = '')),
              for (final t in TipoVoce.tutti)
                if (conta(t.id) > 0) Chip2('${t.nome} ${conta(t.id)}', acceso: _tipo == t.id, onTap: () => setState(() => _tipo = _tipo == t.id ? '' : t.id)),
            ]),
            if (tutte.isEmpty) ...[
              const SizedBox(height: 40),
              const Center(child: Icon(Icons.lock_outline, size: 54)),
              const SizedBox(height: 12),
              const Center(child: Text('La cassaforte è vuota', style: TextStyle(fontSize: 18, fontWeight: FontWeight.w700))),
              const SizedBox(height: 6),
              const Center(child: Text('Tocca + per aggiungere la prima voce.', style: TextStyle(fontSize: 15))),
            ],
            if (fissate.isNotEmpty) ...[
              const SizedBox(height: 16),
              const Etichetta('Fissate'),
              const SizedBox(height: 8),
              Elenco(figli: [for (final v in fissate) RigaVoce(v, onTap: () => _apri(v))]),
            ],
            if (altre.isNotEmpty) ...[
              const SizedBox(height: 16),
              Row(children: [
                Expanded(child: Etichetta('Tutte · ${_nomiOrdine[impostazioni.ordine]}')),
                PopupMenuButton<String>(
                  tooltip: 'Ordina',
                  icon: const Icon(Icons.sort),
                  color: kG2,
                  onSelected: (o) {
                    impostazioni.ordine = o;
                    impostazioni.salva();
                  },
                  itemBuilder: (_) => [for (final e in _nomiOrdine.entries) PopupMenuItem(value: e.key, child: Text(e.value, style: const TextStyle(color: kInk)))],
                ),
              ]),
              const SizedBox(height: 8),
              Elenco(figli: [for (final v in altre) RigaVoce(v, onTap: () => _apri(v))]),
            ],
            if (tutte.isNotEmpty && filtrate.isEmpty) ...[
              const SizedBox(height: 30),
              const Center(child: Text('Nessuna voce trovata', style: TextStyle(fontSize: 16, fontWeight: FontWeight.w600))),
            ],
          ]),
        );
      },
    );
  }

  void _apri(Map<String, dynamic> v) => Navigator.push(context, MaterialPageRoute(builder: (_) => SchedaVoce(id: v['id'])));
}

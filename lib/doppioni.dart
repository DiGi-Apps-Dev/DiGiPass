import 'main.dart';

/// Doppioni della Cassaforte (CHECKLIST 2.11; solo in Impostazioni).
/// Login doppi: stesso nome utente (o email) e stessa password, con un sito in comune o lo stesso titolo.
/// Le altre voci: stesso tipo e stessi campi. «Unisci»: resta la voce modificata per ultima, le si aggiungono i siti e le
/// note delle altre; le altre vanno nel Cestino (da lì si possono recuperare).
class Doppioni {
  static String _d(Object? s) => (s ?? '').toString().trim().toLowerCase();
  static String _sito(String s) => _d(s).replaceFirst(RegExp(r'^[a-z][a-z0-9+.-]*://'), '').replaceFirst(RegExp(r'^www\.'), '').split(RegExp(r'[/?#]')).first;

  static bool _uguali(Map a, Map b) {
    if (a['tipo'] != b['tipo']) return false;
    final ca = (a['campi'] as Map?) ?? {}, cb = (b['campi'] as Map?) ?? {};
    if (a['tipo'] == 'login') {
      final ua = _d(ca['utente']).isNotEmpty ? _d(ca['utente']) : _d(ca['email']);
      final ub = _d(cb['utente']).isNotEmpty ? _d(cb['utente']) : _d(cb['email']);
      if (ua != ub || (ca['password'] ?? '') != (cb['password'] ?? '') || (ca['password'] ?? '').toString().isEmpty) return false;
      final sa = ((a['siti'] as List?) ?? []).map((s) => _sito(s.toString())).toSet();
      final sb = ((b['siti'] as List?) ?? []).map((s) => _sito(s.toString())).toSet();
      return sa.intersection(sb).isNotEmpty || (_d(a['titolo']).isNotEmpty && _d(a['titolo']) == _d(b['titolo']));
    }
    final chiavi = {...ca.keys, ...cb.keys};
    if (chiavi.every((k) => _d(ca[k]).isEmpty && _d(cb[k]).isEmpty)) {
      return a['tipo'] == 'nota' && _d(a['titolo']) == _d(b['titolo']) && _d(a['note']) == _d(b['note']) && _d(a['note']).isNotEmpty;
    }
    return chiavi.every((k) => (ca[k] ?? '').toString().trim() == (cb[k] ?? '').toString().trim());
  }

  /// Gruppi di voci doppie (almeno 2 per gruppo), fra quelle fuori dal Cestino.
  static List<List<Map<String, dynamic>>> gruppi() {
    final voci = archivio.voci;
    final presi = <String>{};
    final out = <List<Map<String, dynamic>>>[];
    for (var i = 0; i < voci.length; i++) {
      if (presi.contains(voci[i]['id'])) continue;
      final g = [voci[i]];
      for (var j = i + 1; j < voci.length; j++) {
        if (!presi.contains(voci[j]['id']) && g.any((x) => _uguali(x, voci[j]))) g.add(voci[j]);
      }
      if (g.length > 1) {
        out.add(g);
        presi.addAll(g.map((x) => x['id'] as String));
      }
    }
    return out;
  }

  /// Unisce un gruppo: resta la voce modificata per ultima, con i siti e le note delle altre; le altre nel Cestino.
  static Future<void> unisci(List<Map<String, dynamic>> gruppo) async {
    final g = [...gruppo]..sort((a, b) => ((b['modificata'] ?? 0) as num).compareTo((a['modificata'] ?? 0) as num));
    final resta = Map<String, dynamic>.from(g.first);
    final siti = <String>[...((resta['siti'] as List?) ?? []).map((s) => s.toString())];
    final note = <String>[if ((resta['note'] ?? '').toString().trim().isNotEmpty) resta['note'].toString().trim()];
    for (final v in g.skip(1)) {
      for (final s in ((v['siti'] as List?) ?? []).map((s) => s.toString())) {
        if (!siti.any((x) => x.trim() == s.trim())) siti.add(s); // indirizzi interi: si toglie solo l'identico
      }
      final n = (v['note'] ?? '').toString().trim();
      if (n.isNotEmpty && !note.any((x) => x.contains(n))) note.add(n);
    }
    resta['siti'] = siti;
    resta['note'] = note.join('\n\n');
    await archivio.salvaVoce(resta);
    for (final v in g.skip(1)) {
      await archivio.nelCestino(v['id'] as String, true);
    }
  }
}

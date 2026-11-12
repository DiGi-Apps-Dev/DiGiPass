import 'dart:math';

/// Generatore di password (casuale o di parole) e stima della forza.
class Generatore {
  static final _r = Random.secure();
  static const _min = 'abcdefghijkmnopqrstuvwxyz', _mai = 'ABCDEFGHJKLMNPQRSTUVWXYZ', _num = '23456789', _sim = '!@#\$%&*+-=?_.:';

  static String casuale({int lunghezza = 20, bool maiuscole = true, bool numeri = true, bool simboli = true}) {
    final gruppi = [_min, if (maiuscole) _mai, if (numeri) _num, if (simboli) _sim];
    final tutti = gruppi.join();
    while (true) {
      final p = List.generate(lunghezza, (_) => tutti[_r.nextInt(tutti.length)]).join();
      // Almeno un carattere per ogni gruppo scelto.
      if (gruppi.every((g) => p.split('').any(g.contains))) return p;
    }
  }

  /// [separatore]: un carattere, oppure 'numeri' (una cifra a caso fra le parole) o 'numerisimboli' (cifra o simbolo a caso).
  static String parole({int quante = 4, String separatore = '-', bool maiuscola = true, bool numero = true}) {
    final ps = List.generate(quante, (_) {
      final w = _parole[_r.nextInt(_parole.length)];
      return maiuscola ? w[0].toUpperCase() + w.substring(1) : w;
    });
    if (numero) {
      final i = _r.nextInt(ps.length);
      ps[i] = '${ps[i]}${_r.nextInt(10)}';
    }
    if (separatore != 'numeri' && separatore != 'numerisimboli') return ps.join(separatore);
    final scelta = separatore == 'numeri' ? _num : _num + _sim;
    final b = StringBuffer(ps.first);
    for (final p in ps.skip(1)) {
      b.write(scelta[_r.nextInt(scelta.length)]);
      b.write(p);
    }
    return b.toString();
  }

  /// Bit di casualità stimati e giudizio a parole.
  static (int, String) forza(String p) {
    if (p.isEmpty) return (0, 'Vuota');
    var alfabeto = 0;
    if (RegExp(r'[a-z]').hasMatch(p)) alfabeto += 26;
    if (RegExp(r'[A-Z]').hasMatch(p)) alfabeto += 26;
    if (RegExp(r'[0-9]').hasMatch(p)) alfabeto += 10;
    if (RegExp(r'[^a-zA-Z0-9]').hasMatch(p)) alfabeto += 20;
    final diversi = p.split('').toSet().length;
    final bit = (min(p.length, diversi * 2) * log(max(alfabeto, 2)) / ln2).round();
    final giudizio = bit < 40 ? 'Debole' : bit < 60 ? 'Media' : bit < 80 ? 'Forte' : 'Molto forte';
    return (bit, giudizio);
  }

  static bool debole(String p) => p.isNotEmpty && forza(p).$1 < 50;

  // Parole italiane comuni, brevi e facili da scrivere.
  static const _parole = [
    'albero', 'amico', 'anello', 'angolo', 'arancia', 'argento', 'aria', 'barca', 'bosco', 'bottone', 'brodo', 'burro',
    'cactus', 'caffe', 'calma', 'camino', 'campo', 'candela', 'cane', 'canto', 'capra', 'carta', 'casa', 'castello',
    'cavallo', 'cena', 'cielo', 'ciliegia', 'cipolla', 'colle', 'colore', 'conchiglia', 'coniglio', 'corda', 'corsa',
    'cuore', 'cuscino', 'delfino', 'dente', 'disco', 'divano', 'domani', 'drago', 'erba', 'estate', 'falco', 'farina',
    'faro', 'festa', 'fiamma', 'fiore', 'fiume', 'foglia', 'fontana', 'forno', 'fragola', 'freccia', 'fulmine', 'fumo',
    'gatto', 'gelato', 'giardino', 'ginepro', 'giraffa', 'gomma', 'grano', 'grotta', 'guanto', 'isola', 'lago', 'lampada',
    'lana', 'lavagna', 'legno', 'leone', 'limone', 'luna', 'lupo', 'mare', 'matita', 'mela', 'melone', 'miele', 'monte',
    'muro', 'nave', 'neve', 'nido', 'noce', 'nuvola', 'oca', 'olivo', 'ombra', 'onda', 'orso', 'orto', 'pane', 'panda',
    'pepe', 'pera', 'pesca', 'piano', 'pietra', 'pigna', 'pino', 'pioggia', 'piuma', 'ponte', 'porta', 'prato', 'quadro',
    'radice', 'ragno', 'rana', 'ramo', 'riccio', 'riso', 'roccia', 'rosa', 'ruota', 'sabbia', 'sale', 'salmone', 'sasso',
    'scala', 'scoglio', 'seme', 'sedia', 'sentiero', 'sole', 'sorriso', 'spiga', 'stella', 'strada', 'tamburo', 'tavolo',
    'tenda', 'terra', 'tetto', 'tigre', 'topo', 'torre', 'treno', 'trota', 'tulipano', 'uccello', 'uva', 'vaso', 'vela',
    'vento', 'verde', 'vetro', 'vigna', 'viola', 'volpe', 'zaino', 'zucca',
  ];
}

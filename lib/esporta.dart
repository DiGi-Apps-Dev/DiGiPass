import 'dart:convert';
import 'dart:typed_data';

import 'cripto.dart';

/// Esportazione dall'app (CHECKLIST 10.12: file cifrato e CSV), stessi formati della web app
/// (server/public/risorse/app.js esportaCifrato, importa.js csvDaEsportare): un file fatto qui si ripristina anche dal web.

String _campoCsv(Object? x) {
  final s = (x ?? '').toString();
  return RegExp(r'[",\n\r]').hasMatch(s) ? '"${s.replaceAll('"', '""')}"' : s;
}

/// CSV in chiaro: Cassaforte (fuori dal Cestino) e Memoria siti.
String csvDaEsportare(List<Map<String, dynamic>> voci, List<Map<String, dynamic>> siti) {
  final righe = <List<Object?>>[
    ['dove', 'tipo', 'titolo', 'url', 'utente', 'password', 'totp', 'note', 'cartella', 'altri campi'],
  ];
  for (final v in voci) {
    final c = (v['campi'] as Map?) ?? {};
    final altri = [
      for (final e in c.entries)
        if (!['utente', 'password'].contains(e.key) && (e.value ?? '').toString().isNotEmpty) '${e.key}: ${e.value}',
      for (final e in ((v['extra'] as List?) ?? []).cast<Map>()) '${e['nome']}: ${e['valore']}',
    ].join('; ');
    righe.add(['cassaforte', v['tipo'], v['titolo'], ((v['siti'] as List?) ?? []).join(' '), c['utente'] ?? '', c['password'] ?? '',
      v['totp'] ?? '', v['note'] ?? '', v['cartella'] ?? '', altri]);
  }
  for (final s in siti) {
    righe.add(['memoria siti', 'login', s['sito'], s['sito'], s['utente'] ?? '', s['password'] ?? '', '', '', '', '']);
  }
  return '﻿${righe.map((r) => r.map(_campoCsv).join(',')).join('\r\n')}\r\n';
}

/// File cifrato .dpx: Argon2id dalla passphrase, AES-256-GCM con aad «digipass-export».
Future<Uint8List> fileCifrato(String passphrase, List<Map<String, dynamic>> voci, List<Map<String, dynamic>> memoria) async {
  final sale = Cripto.casuali(16);
  final k = await Cripto.chiaveDaPassword(passphrase, sale, m: 19456, t: 2, p: 1);
  final dati = Uint8List.fromList(utf8.encode(jsonEncode({'v': 1, 'voci': voci, 'memoria': memoria})));
  final file = {
    'formato': 'digipass-export', 'v': 1, 'kdf': {'alg': 'argon2id', 'm': 19456, 't': 2, 'p': 1},
    'sale': base64Encode(sale), 'dati': base64Encode(await Cripto.cifra(k, dati, aadExtra: 'digipass-export')),
  };
  return Uint8List.fromList(utf8.encode(jsonEncode(file)));
}

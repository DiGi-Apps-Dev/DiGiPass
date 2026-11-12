import 'dart:convert';
import 'dart:io';
import 'dart:typed_data';

import 'archivio.dart';

/// Importazione dall'export di Proton Pass (CHECKLIST 8.1), uguale a server/public/risorse/importa.js:
/// i dati si copiano esattamente come sono nel file (indirizzi interi, con porta e percorso). Il file non si modifica mai.

/// Legge uno ZIP (solo «stored» e «deflate»): nome del file -> contenuto.
Map<String, Uint8List> leggiZip(Uint8List buf) {
  final v = ByteData.sublistView(buf);
  var fine = -1;
  for (var i = buf.length - 22; i >= 0 && i >= buf.length - 65557; i--) {
    if (v.getUint32(i, Endian.little) == 0x06054b50) {
      fine = i;
      break;
    }
  }
  if (fine < 0) throw const FormatException('File ZIP non valido.');
  final n = v.getUint16(fine + 10, Endian.little);
  var p = v.getUint32(fine + 16, Endian.little);
  final out = <String, Uint8List>{};
  for (var k = 0; k < n; k++) {
    if (v.getUint32(p, Endian.little) != 0x02014b50) throw const FormatException('File ZIP non valido.');
    final metodo = v.getUint16(p + 10, Endian.little), comp = v.getUint32(p + 20, Endian.little);
    final ln = v.getUint16(p + 28, Endian.little), le = v.getUint16(p + 30, Endian.little), lc = v.getUint16(p + 32, Endian.little);
    final loc = v.getUint32(p + 42, Endian.little);
    final nome = utf8.decode(buf.sublist(p + 46, p + 46 + ln), allowMalformed: true);
    final inizio = loc + 30 + v.getUint16(loc + 26, Endian.little) + v.getUint16(loc + 28, Endian.little);
    final dati = buf.sublist(inizio, inizio + comp);
    if (metodo == 0) {
      out[nome] = dati;
    } else if (metodo == 8) {
      out[nome] = Uint8List.fromList(ZLibDecoder(raw: true).convert(dati));
    }
    p += 46 + ln + le + lc;
  }
  return out;
}

String _t(Object? x) => x == null ? '' : x.toString();

Map<String, dynamic> _voce(Map<String, dynamic> it) {
  final d = (it['data'] as Map?)?.cast<String, dynamic>() ?? {};
  final c = (d['content'] as Map?)?.cast<String, dynamic>() ?? {};
  final m = (d['metadata'] as Map?)?.cast<String, dynamic>() ?? {};
  final extra = <Map<String, dynamic>>[
    for (final e in ((d['extraFields'] as List?) ?? []).cast<Map>())
      {
        'nome': _t(e['fieldName']),
        'tipo': const {'hidden': 'nascosto', 'totp': 'totp', 'timestamp': 'data'}[e['type']] ?? 'testo',
        'valore': _t((e['data'] as Map?)?['content'] ??
            ((e['data'] as Map?)?['timestamp'] != null ? _data(int.tryParse(_t((e['data'] as Map)['timestamp'])) ?? 0) : '')),
      }
  ].where((e) => (e['valore'] as String).isNotEmpty).toList();
  final base = <String, dynamic>{
    'origine': 'proton',
    'titolo': _t(m['name']).isEmpty ? 'Senza titolo' : _t(m['name']),
    'cartella': '', // il nome della cassaforte di Proton (es. «Personal») non diventa una cartella
    'fissata': it['pinned'] == true,
    'note': _t(m['note']),
    'siti': <String>[],
    'totp': '',
    'cestino': it['state'] == 2 ? DateTime.now().millisecondsSinceEpoch : null,
    'extra': extra,
  };
  switch (d['type']) {
    case 'login':
      final u = _t(c['itemUsername']), e = _t(c['itemEmail']);
      return {
        ...base,
        'tipo': 'login',
        // Con nome utente ed email tutti e due: l'email va nel suo campo (CHECKLIST 1.1).
        'campi': {'utente': u.isNotEmpty ? u : e, 'password': _t(c['password']), if (u.isNotEmpty && e.isNotEmpty) 'email': e},
        'siti': [for (final x in ((c['urls'] as List?) ?? [])) if (_t(x).isNotEmpty) _t(x)],
        'totp': _t(c['totpUri']),
      };
    case 'creditCard':
      final s = _t(c['expirationDate']);
      final scad = RegExp(r'^\d{4}-\d{2}$').hasMatch(s) ? '${s.substring(5)}/${s.substring(2, 4)}' : s;
      return {
        ...base,
        'tipo': 'carta',
        'campi': {'titolare': _t(c['cardholderName']), 'numero': _t(c['number']), 'scadenza': scad, 'cvv': _t(c['verificationNumber']), 'pin': _t(c['pin'])},
      };
    case 'identity':
      return {
        ...base,
        'tipo': 'identita',
        'campi': {
          'nome': _t(c['firstName']).isNotEmpty ? _t(c['firstName']) : _t(c['fullName']),
          'secondoNome': _t(c['middleName']),
          'cognome': _t(c['lastName']),
          'nomeCompleto': _t(c['fullName']),
          'nascita': _t(c['birthdate']),
          'sesso': _t(c['gender']),
          'email': _t(c['email']),
          'telefono': _t(c['phoneNumber']),
          'indirizzo': _t(c['streetAddress']),
          'piano': _t(c['floor']),
          'cap': _t(c['zipOrPostalCode']),
          'citta': _t(c['city']),
          'provincia': _t(c['stateOrProvince']),
          'contea': _t(c['county']),
          'paese': _t(c['countryOrRegion']),
          'organizzazione': _t(c['organization']),
          'telefono2': _t(c['secondPhoneNumber']),
          'sito': _t(c['website']),
          'patente': _t(c['licenseNumber']),
          'documento': _t(c['passportNumber']).isNotEmpty ? _t(c['passportNumber']) : _t(c['licenseNumber']),
          'previdenza': _t(c['socialSecurityNumber']),
          'linkedin': _t(c['linkedin']),
          'x': _t(c['xHandle']),
          'facebook': _t(c['facebook']),
          'instagram': _t(c['instagram']),
          'reddit': _t(c['reddit']),
          'yahoo': _t(c['yahoo']),
          'azienda': _t(c['company']),
          'ruolo': _t(c['jobTitle']),
          'emailLavoro': _t(c['workEmail']),
          'telefonoLavoro': _t(c['workPhoneNumber']),
          'sitoPersonale': _t(c['personalWebsite']),
        },
      };
    case 'wifi':
      const sic = ['', 'WPA', 'WPA2', 'WPA3', 'WEP'];
      final n = int.tryParse(_t(c['security']));
      return {
        ...base,
        'tipo': 'wifi',
        'campi': {'ssid': _t(c['ssid']), 'password': _t(c['password']), 'sicurezza': n != null && n >= 0 && n < sic.length && sic[n].isNotEmpty ? sic[n] : _t(c['security'])},
      };
    case 'note':
      return {...base, 'tipo': 'nota', 'campi': <String, dynamic>{}};
    default:
      // Alias, chiavi SSH, voci personalizzate: si tengono come nota con i campi, per non perdere niente.
      final righe = [
        if ((base['note'] as String).isNotEmpty) base['note'] as String,
        for (final e in c.entries)
          if (e.value is String && (e.value as String).isNotEmpty) '${e.key}: ${e.value}',
      ];
      return {...base, 'tipo': 'nota', 'campi': <String, dynamic>{}, 'note': righe.join('\n')};
  }
}

String _data(int secondi) {
  final d = DateTime.fromMillisecondsSinceEpoch(secondi * 1000);
  return '${d.day.toString().padLeft(2, '0')}.${d.month.toString().padLeft(2, '0')}.${d.year}';
}

/// Export di Proton Pass (data.json, anche dentro lo ZIP) -> voci della Cassaforte. Gli export cifrati (PGP) non si leggono.
List<Map<String, dynamic>> importaProton(Uint8List buf, {String nomeFile = ''}) {
  Map<String, dynamic> json;
  if (nomeFile.toLowerCase().endsWith('.zip') || (buf.length > 1 && buf[0] == 0x50 && buf[1] == 0x4b)) {
    final z = leggiZip(buf);
    final nome = z.keys.where((k) => k.toLowerCase().endsWith('data.json')).firstOrNull;
    if (nome == null) throw const FormatException('Nello ZIP non c\'è data.json: serve l\'export di Proton Pass non cifrato.');
    json = jsonDecode(utf8.decode(z[nome]!)) as Map<String, dynamic>;
  } else {
    json = jsonDecode(utf8.decode(buf)) as Map<String, dynamic>;
  }
  if (json['encrypted'] == true) throw const FormatException('Questo export di Proton Pass è cifrato (PGP): esportalo di nuovo senza cifratura.');
  final casse = json['vaults'];
  if (casse is! Map) throw const FormatException('Il file non è un export di Proton Pass.');
  return [
    for (final cassa in casse.values)
      for (final it in (((cassa as Map)['items'] as List?) ?? [])) _voce((it as Map).cast<String, dynamic>()),
  ];
}

// ---------- CSV di un altro programma (CHECKLIST 10.11), come la webapp (server/public/risorse/importa.js) ----------
// login e password vanno in Cassaforte, le sole memorie dei siti in Memoria siti; dal file non si capisce,
// quindi la destinazione la sceglie l'utente. Le colonne si riconoscono dal nome nella prima riga; i valori si copiano
// esattamente come sono (nessun trim, indirizzi interi).
const _colonne = {
  'url': ['url', 'uri', 'website', 'web site', 'sito', 'indirizzo', 'login_uri', 'login url', 'address'],
  'utente': ['username', 'user', 'user name', 'utente', 'nome utente', 'login', 'login_username', 'email', 'e-mail'],
  'password': ['password', 'pass', 'pwd', 'login_password'],
  'nome': ['name', 'title', 'titolo', 'nome'],
  'note': ['note', 'notes', 'nota', 'commento', 'comments'],
  'totp': ['totp', 'otp', '2fa', 'otpauth', 'login_totp'],
};

List<Map<String, String>> leggiCsvGenerico(String testo) {
  final righe = Archivio.leggiCsv(testo.startsWith('\uFEFF') ? testo.substring(1) : testo);
  if (righe.length < 2) throw const FormatException('Il file CSV è vuoto.');
  final testa = righe.first.map((x) => x.trim().toLowerCase()).toList();
  final col = {for (final e in _colonne.entries) e.key: testa.indexWhere((h) => e.value.contains(h))};
  if (col['password']! < 0) throw const FormatException('Nel CSV non c\'è una colonna «password».');
  String val(List<String> r, String k) => col[k]! >= 0 && r.length > col[k]! ? r[col[k]!] : '';
  return [
    for (final r in righe.skip(1))
      {for (final k in _colonne.keys) k: val(r, k)}
  ].where((x) => x['password']!.isNotEmpty || x['utente']!.isNotEmpty || x['url']!.isNotEmpty).toList();
}

List<Map<String, dynamic>> csvInCassaforte(List<Map<String, String>> righe) => [
      for (final r in righe)
        {
          'origine': 'csv', 'tipo': 'login', 'titolo': r['nome']!.isNotEmpty ? r['nome'] : (r['url']!.isNotEmpty ? r['url'] : 'Senza titolo'),
          'cartella': '', 'fissata': false, 'campi': {'utente': r['utente'], 'password': r['password']},
          'siti': [if (r['url']!.isNotEmpty) r['url']], 'note': r['note'], 'totp': r['totp'], 'cestino': null, 'extra': <Map>[],
        }
    ];

List<Map<String, dynamic>> csvInMemoria(List<Map<String, String>> righe) => [
      for (final r in righe)
        if (r['url']!.isNotEmpty && r['password']!.isNotEmpty) {'sito': r['url'], 'utente': r['utente'], 'password': r['password'], 'nome': r['nome']}
    ];

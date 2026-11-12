import 'dart:convert';
import 'dart:typed_data';

import 'package:digipass/importa.dart';
import 'package:flutter_test/flutter_test.dart';

// Export di Proton Pass FINTO (nessun dato vero): l'importazione copia tutto esattamente com'è.
void main() {
  final finto = {
    'encrypted': false,
    'vaults': {
      'v1': {
        'name': 'Personal',
        'items': [
          {
            'state': 1,
            'pinned': true,
            'data': {
              'type': 'login',
              'metadata': {'name': 'TEST login', 'note': 'nota di prova'},
              'content': {'itemUsername': 'utente.prova', 'itemEmail': 'prova@esempio.ch', 'password': 'pw di prova', 'urls': ['http://192.168.1.10:3000/accesso?x=1', ' https://esempio.ch/ '], 'totpUri': ''},
              'extraFields': [
                {'fieldName': 'PIN', 'type': 'hidden', 'data': {'content': '1234'}},
              ],
            },
          },
          {
            'state': 2,
            'data': {
              'type': 'creditCard',
              'metadata': {'name': 'TEST carta'},
              'content': {'cardholderName': 'Mario Prova', 'number': '4111111111111111', 'expirationDate': '2029-07', 'verificationNumber': '123', 'pin': ''},
            },
          },
          {
            'state': 1,
            'data': {
              'type': 'identity',
              'metadata': {'name': 'TEST identità'},
              'content': {'firstName': 'Mario', 'lastName': 'Prova', 'company': 'Ditta Prova', 'stateOrProvince': 'TI', 'socialSecurityNumber': '756.0000.0000.00'},
            },
          },
        ],
      },
    },
  };

  test('Proton Pass: dati copiati esattamente, indirizzi interi con porta e percorso', () {
    final v = importaProton(Uint8List.fromList(utf8.encode(jsonEncode(finto))));
    expect(v.length, 3);
    final l = v[0];
    expect(l['tipo'], 'login');
    expect(l['titolo'], 'TEST login');
    expect(l['fissata'], true);
    expect(l['siti'], ['http://192.168.1.10:3000/accesso?x=1', ' https://esempio.ch/ ']);
    expect(l['campi'], {'utente': 'utente.prova', 'password': 'pw di prova', 'email': 'prova@esempio.ch'});
    expect((l['extra'] as List).first, {'nome': 'PIN', 'tipo': 'nascosto', 'valore': '1234'});
    final c = v[1];
    expect(c['tipo'], 'carta');
    expect((c['campi'] as Map)['scadenza'], '07/29');
    expect(c['cestino'], isNotNull);
    final i = v[2];
    expect((i['campi'] as Map)['azienda'], 'Ditta Prova');
    expect((i['campi'] as Map)['provincia'], 'TI');
    expect((i['campi'] as Map)['previdenza'], '756.0000.0000.00');
  });

  test('Proton Pass: export cifrato rifiutato con un messaggio chiaro', () {
    expect(() => importaProton(Uint8List.fromList(utf8.encode('{"encrypted":true}'))), throwsA(isA<FormatException>()));
    expect(() => importaProton(Uint8List.fromList(utf8.encode('{"altro":1}'))), throwsA(isA<FormatException>()));
  });

  test('CSV generico: colonne riconosciute, valori esatti, Cassaforte o Memoria siti', () {
    const csv = '\uFEFFname,login_uri,login_username,login_password,notes,login_totp\nTEST uno,http://192.168.1.10:3000/accesso?x=1,utente.prova, pw con spazio ,nota,\nTEST due,,solo.utente,pw2,,\n,,,,,\n';
    final r = leggiCsvGenerico(csv);
    expect(r.length, 2);
    expect(r[0]['password'], ' pw con spazio ');
    final c = csvInCassaforte(r);
    expect(c[0]['siti'], ['http://192.168.1.10:3000/accesso?x=1']);
    expect(c[0]['titolo'], 'TEST uno');
    expect((c[0]['campi'] as Map)['utente'], 'utente.prova');
    final m = csvInMemoria(r);
    expect(m.length, 1, reason: 'senza indirizzo non va in Memoria siti');
    expect(m[0]['sito'], 'http://192.168.1.10:3000/accesso?x=1');
    expect(() => leggiCsvGenerico('a,b\n1,2'), throwsA(isA<FormatException>()));
  });
}

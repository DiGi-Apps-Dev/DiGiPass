import 'dart:convert';
import 'dart:io';

import 'package:digipass/cripto.dart';
import 'package:flutter_test/flutter_test.dart';

/// Scrive server/test/fixture-dart.json: dati cifrati dall'app che la webapp (cripto.js) deve saper aprire.
void main() {
  test('Fixture per la prova incrociata app -> web', () async {
    const password = 'Prova di DiGiPass 2026!';
    const kdf = {'alg': 'argon2id', 'm': 1024, 't': 1, 'p': 1};
    final dek = Cripto.casuali(32);
    final salePw = Cripto.casuali(16), saleRec = Cripto.casuali(16);
    final kek = await Cripto.chiaveDaPassword(password, salePw, m: 1024, t: 1, p: 1);
    final recupero = Cripto.nuovaRecupero();
    final rec = await Cripto.chiaveDaRecupero(recupero, saleRec);
    const voce = {'id': 'vocediprova01', 'tipo': 'login', 'titolo': 'Esempio', 'campi': {'utente': 'nome@esempio.ch', 'password': 'segreta'}};
    final f = {
      'password': password,
      'recupero': recupero,
      'chiavi': {
        'v': 1,
        'kdf': kdf,
        'salePw': base64Encode(salePw),
        'dekPw': base64Encode(await Cripto.cifra(kek, dek)),
        'saleRec': base64Encode(saleRec),
        'dekRec': base64Encode(await Cripto.cifra(rec, dek)),
      },
      'accesso': await Cripto.chiaveAccesso(kek, salePw),
      'accessoRec': await Cripto.accessoRecupero(rec, saleRec),
      'dek': base64Encode(dek),
      'voce': {'id': 'vocediprova01', 'blob': await Cripto.cifraVoce(dek, 'vocediprova01', voce), 'testo': voce},
    };
    File('server/test/fixture-dart.json').writeAsStringSync(const JsonEncoder.withIndent('  ').convert(f));
    expect(File('server/test/fixture-dart.json').existsSync(), isTrue);
  });
}

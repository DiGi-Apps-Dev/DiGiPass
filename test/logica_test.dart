import 'dart:convert';
import 'dart:io';
import 'dart:typed_data';

import 'package:digipass/archivio.dart';
import 'package:digipass/cripto.dart';
import 'package:digipass/generatore.dart';
import 'package:digipass/totp.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  test('TOTP: valori di prova della RFC 6238 (SHA1, 8 cifre)', () {
    final t = Totp(Uint8List.fromList(utf8.encode('12345678901234567890')), cifre: 8);
    expect(t.codice(DateTime.fromMillisecondsSinceEpoch(59 * 1000, isUtc: true)), '94287082');
    expect(t.codice(DateTime.fromMillisecondsSinceEpoch(1111111109 * 1000, isUtc: true)), '07081804');
    expect(t.codice(DateTime.fromMillisecondsSinceEpoch(2000000000 * 1000, isUtc: true)), '69279037');
  });

  test('TOTP: link otpauth del QR', () {
    final t = Totp.leggi('otpauth://totp/Prova:nome@esempio.ch?secret=GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ&issuer=Prova&digits=6')!;
    expect(t.cifre, 6);
    expect(Totp.etichetta('otpauth://totp/Prova:nome@esempio.ch?secret=GEZD&issuer=Prova'), 'Prova');
    expect(Totp.leggi('non valido!'), isNull);
  });

  test('AES-GCM: cifra e decifra, chiave sbagliata rifiutata', () async {
    final k = Cripto.casuali(32);
    final blob = await Cripto.cifra(k, Uint8List.fromList(utf8.encode('{"v":1}')));
    expect(utf8.decode(await Cripto.decifra(k, blob)), '{"v":1}');
    expect(() => Cripto.decifra(Cripto.casuali(32), blob), throwsA(anything));
    // File per il controllo incrociato con un'altra libreria (stesso formato letto da Kotlin).
    final dir = Platform.environment['DIGIPASS_PROVA'];
    if (dir != null) {
      File('$dir/chiave.bin').writeAsBytesSync(k);
      File('$dir/blob.bin').writeAsBytesSync(blob);
    }
  });

  test('Argon2id e chiave di recupero', () async {
    final sale = Cripto.casuali(16);
    final a = await Cripto.chiaveDaPassword('password di prova lunga', sale, m: 1024, t: 1);
    final b = await Cripto.chiaveDaPassword('password di prova lunga', sale, m: 1024, t: 1);
    final c = await Cripto.chiaveDaPassword('password diversa', sale, m: 1024, t: 1);
    expect(a, b);
    expect(a, isNot(c));
    final r = Cripto.nuovaRecupero();
    expect(RegExp(r'^([A-Z2-9]{4}-){6}[A-Z2-9]{4}$').hasMatch(r), isTrue);
    expect(await Cripto.chiaveDaRecupero(r.toLowerCase().replaceAll('-', ' '), sale), await Cripto.chiaveDaRecupero(r, sale));
  });

  test('CSV di Chrome', () {
    const csv = 'name,url,username,password,note\n'
        'esempio.ch,https://www.esempio.ch/login,nome@esempio.ch,"pa,ss""word",\n'
        'app,android://abc==@com.esempio.app/,utente,pw2,"nota\nsu due righe"\n';
    final r = Archivio.leggiCsv(csv);
    expect(r.length, 3);
    expect(r[1][3], 'pa,ss"word');
    expect(r[2][4], 'nota\nsu due righe');
    expect(Archivio.dominio(r[1][1]), 'esempio.ch');
    expect(Archivio.dominio(r[2][1]), 'android://com.esempio.app');
  });

  test('Generatore e forza', () {
    final p = Generatore.casuale(lunghezza: 24);
    expect(p.length, 24);
    expect(Generatore.debole('123456'), isTrue);
    expect(Generatore.debole(p), isFalse);
    expect(Generatore.parole(quante: 5, separatore: '-').split('-').length, 5);
  });
}

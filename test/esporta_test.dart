import 'dart:convert';

import 'package:digipass/cripto.dart';
import 'package:digipass/esporta.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  final voci = [
    {'id': 'a', 'tipo': 'login', 'titolo': 'TEST, sito', 'siti': ['https://x.test:8443/p'], 'campi': {'utente': 'u', 'password': 'p"1', 'email': 'e@x.test'}, 'note': 'riga1\nriga2'},
  ];
  final memoria = [{'id': 'm', 'sito': 'https://y.test', 'utente': 'mu', 'password': 'mp'}];

  test('CSV come la web app', () {
    final csv = csvDaEsportare(voci, memoria);
    expect(csv.startsWith('﻿dove,tipo,titolo,url,utente,password,totp,note,cartella,altri campi\r\n'), isTrue);
    expect(csv, contains('cassaforte,login,"TEST, sito",https://x.test:8443/p,u,"p""1",,"riga1\nriga2",,email: e@x.test\r\n'));
    expect(csv, contains('memoria siti,login,https://y.test,https://y.test,mu,mp,,,,\r\n'));
  });

  test('file cifrato: si riapre con la passphrase e non con un\'altra', () async {
    final f = jsonDecode(utf8.decode(await fileCifrato('passphrase-di-prova', voci, memoria))) as Map<String, dynamic>;
    expect(f['formato'], 'digipass-export');
    final k = await Cripto.chiaveDaPassword('passphrase-di-prova', base64Decode(f['sale']));
    final dati = jsonDecode(utf8.decode(await Cripto.decifra(k, base64Decode(f['dati']), aadExtra: 'digipass-export')));
    expect(dati['voci'][0]['campi']['password'], 'p"1');
    expect(dati['memoria'][0]['utente'], 'mu');
    final k2 = await Cripto.chiaveDaPassword('altra-passphrase-xx', base64Decode(f['sale']));
    expect(() => Cripto.decifra(k2, base64Decode(f['dati']), aadExtra: 'digipass-export'), throwsA(anything));
  });
}

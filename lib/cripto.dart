import 'dart:convert';
import 'dart:isolate';
import 'dart:math';
import 'dart:typed_data';

import 'package:cryptography/cryptography.dart';
import 'package:cryptography/dart.dart';

/// Cifratura di DiGiPass. Tutto avviene sul telefono: la password principale non esce mai.
///
/// - chiave dei dati (DEK): 32 byte casuali, cifra l'archivio con AES-256-GCM;
/// - la DEK è salvata due volte, cifrata: con la chiave ricavata dalla password principale (Argon2id)
///   e con la chiave ricavata dalla chiave di recupero del foglio di emergenza (HKDF-SHA256);
/// - con l'impronta la DEK è cifrata da una chiave del Keystore (parte Kotlin).
class Cripto {
  static const aad = 'digipass-v1';
  // Argon2id: 19 MiB, 2 passaggi, 1 corsia (valori minimi consigliati da OWASP).
  static const memoriaKiB = 19456, passaggi = 2, corsie = 1;

  static final _rnd = Random.secure();
  static Uint8List casuali(int n) => Uint8List.fromList(List.generate(n, (_) => _rnd.nextInt(256)));

  static Future<Uint8List> chiaveDaPassword(String password, Uint8List sale, {int m = memoriaKiB, int t = passaggi, int p = corsie}) {
    // In un isolate a parte: Argon2id impiega qualche secondo e non deve bloccare lo schermo.
    return Isolate.run(() async {
      final kdf = DartArgon2id(parallelism: p, memory: m, iterations: t, hashLength: 32, maxIsolates: 1);
      final k = await kdf.deriveKeyFromPassword(password: password, nonce: sale);
      return Uint8List.fromList(await k.extractBytes());
    });
  }

  static Future<Uint8List> chiaveDaRecupero(String codice, Uint8List sale) async {
    final pulito = normalizzaRecupero(codice);
    final k = await Hkdf(hmac: Hmac.sha256(), outputLength: 32)
        .deriveKey(secretKey: SecretKey(utf8.encode(pulito)), nonce: sale, info: utf8.encode('digipass-recupero'));
    return Uint8List.fromList(await k.extractBytes());
  }

  static Future<Uint8List> _hkdf(List<int> ikm, Uint8List sale, String info) async {
    final k = await Hkdf(hmac: Hmac.sha256(), outputLength: 32).deriveKey(secretKey: SecretKey(ikm), nonce: sale, info: utf8.encode(info));
    return Uint8List.fromList(await k.extractBytes());
  }

  /// Prova di identità per il server del NAS (stessa di public/risorse/cripto.js): non apre i dati.
  static Future<String> chiaveAccesso(Uint8List kek, Uint8List sale) async => base64Url.encode(await _hkdf(kek, sale, 'digipass-accesso')).replaceAll('=', '');
  static Future<String> accessoRecupero(Uint8List rec, Uint8List sale) async => base64Url.encode(await _hkdf(rec, sale, 'digipass-accesso-recupero')).replaceAll('=', '');

  /// Voce o sito per il server: JSON cifrato con la chiave dei dati, legato al suo id.
  static Future<String> cifraVoce(Uint8List dek, String id, Map<String, dynamic> v) async =>
      base64Encode(await cifra(dek, Uint8List.fromList(utf8.encode(jsonEncode(v))), aadExtra: 'digipass-voce:$id'));
  static Future<Map<String, dynamic>> decifraVoce(Uint8List dek, String id, String blob) async =>
      jsonDecode(utf8.decode(await decifra(dek, base64Decode(blob), aadExtra: 'digipass-voce:$id'))) as Map<String, dynamic>;

  static Future<Uint8List> cifra(Uint8List chiave, Uint8List dati, {String? aadExtra}) async {
    final box = await AesGcm.with256bits().encrypt(dati, secretKey: SecretKey(chiave), nonce: casuali(12), aad: utf8.encode(aadExtra ?? aad));
    return box.concatenation();
  }

  static Future<Uint8List> decifra(Uint8List chiave, Uint8List blob, {String? aadExtra}) async {
    final box = SecretBox.fromConcatenation(blob, nonceLength: 12, macLength: 16);
    return Uint8List.fromList(await AesGcm.with256bits().decrypt(box, secretKey: SecretKey(chiave), aad: utf8.encode(aadExtra ?? aad)));
  }

  /// Chiave di recupero: 28 caratteri (140 bit) a gruppi di 4, senza lettere che si confondono.
  static String nuovaRecupero() {
    const alfabeto = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    final c = List.generate(28, (_) => alfabeto[_rnd.nextInt(alfabeto.length)]).join();
    return [for (var i = 0; i < c.length; i += 4) c.substring(i, i + 4)].join('-');
  }

  static String normalizzaRecupero(String s) => s.toUpperCase().replaceAll(RegExp(r'[^A-Z0-9]'), '');
}

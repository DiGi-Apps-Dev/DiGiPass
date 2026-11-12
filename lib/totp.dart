import 'dart:typed_data';

import 'package:crypto/crypto.dart';

/// Codici 2FA a tempo (RFC 6238). Accetta il segreto base32 o il link otpauth:// del QR.
class Totp {
  Totp(this.segreto, {this.cifre = 6, this.periodo = 30, this.algoritmo = 'SHA1'});
  final Uint8List segreto;
  final int cifre;
  final int periodo;
  final String algoritmo;

  static Totp? leggi(String testo) {
    final t = testo.trim();
    if (t.isEmpty) return null;
    try {
      if (t.toLowerCase().startsWith('otpauth://')) {
        final u = Uri.parse(t);
        final s = u.queryParameters['secret'];
        if (s == null) return null;
        return Totp(base32(s),
            cifre: int.tryParse(u.queryParameters['digits'] ?? '') ?? 6,
            periodo: int.tryParse(u.queryParameters['period'] ?? '') ?? 30,
            algoritmo: (u.queryParameters['algorithm'] ?? 'SHA1').toUpperCase());
      }
      final b = base32(t);
      return b.isEmpty ? null : Totp(b);
    } catch (_) {
      return null;
    }
  }

  /// Nome del servizio scritto nel QR (otpauth://totp/Servizio:utente).
  static String? etichetta(String testo) {
    if (!testo.toLowerCase().startsWith('otpauth://')) return null;
    final u = Uri.parse(testo);
    return u.queryParameters['issuer'] ?? Uri.decodeComponent(u.path.replaceFirst('/', '')).split(':').first;
  }

  static Uint8List base32(String s) {
    const a = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
    final pulito = s.toUpperCase().replaceAll(RegExp(r'[\s=-]'), '');
    var bits = 0, valore = 0;
    final out = <int>[];
    for (final c in pulito.split('')) {
      final i = a.indexOf(c);
      if (i < 0) throw const FormatException('Segreto 2FA non valido');
      valore = (valore << 5) | i;
      bits += 5;
      if (bits >= 8) {
        out.add((valore >> (bits - 8)) & 0xff);
        bits -= 8;
      }
    }
    return Uint8List.fromList(out);
  }

  String codice([DateTime? ora]) {
    final t = ((ora ?? DateTime.now()).millisecondsSinceEpoch ~/ 1000) ~/ periodo;
    final msg = ByteData(8)..setInt64(0, t);
    final h = switch (algoritmo) { 'SHA256' => sha256, 'SHA512' => sha512, _ => sha1 };
    final d = Hmac(h, segreto).convert(msg.buffer.asUint8List()).bytes;
    final o = d.last & 0x0f;
    final n = ((d[o] & 0x7f) << 24) | (d[o + 1] << 16) | (d[o + 2] << 8) | d[o + 3];
    var mod = 1;
    for (var i = 0; i < cifre; i++) {
      mod *= 10;
    }
    return (n % mod).toString().padLeft(cifre, '0');
  }

  int restanti([DateTime? ora]) => periodo - ((ora ?? DateTime.now()).millisecondsSinceEpoch ~/ 1000) % periodo;
}

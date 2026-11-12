
import 'package:flutter/services.dart';

/// Ponte verso la parte Android (Kotlin): impronta, sessione per l'autocompilazione, appunti.
class Nativo {
  static const _c = MethodChannel('digipass/android');

  static Future<String> cartella() async => (await _c.invokeMethod<String>('cartella'))!;
  static Future<void> apriSessione(Uint8List chiave) => _c.invokeMethod('apriSessione', {'chiave': chiave});
  static Future<void> pausaSessione(int ms) => _c.invokeMethod('pausaSessione', {'ms': ms});
  static Future<void> chiudiSessione() => _c.invokeMethod('chiudiSessione');
  static Future<void> bloccaTutto() => _c.invokeMethod('bloccaTutto');
  static Future<bool> improntaDisponibile() async => (await _c.invokeMethod<bool>('improntaDisponibile')) ?? false;
  static Future<bool> improntaAttiva() async => (await _c.invokeMethod<bool>('improntaAttiva')) ?? false;
  static Future<void> attivaImpronta(Uint8List chiave) => _c.invokeMethod('attivaImpronta', {'chiave': chiave});
  static Future<Uint8List> sbloccaImpronta() async => (await _c.invokeMethod<Uint8List>('sbloccaImpronta'))!;
  static Future<void> togliImpronta() => _c.invokeMethod('togliImpronta');
  static Future<void> screenshot(bool consenti) => _c.invokeMethod('screenshot', {'consenti': consenti});
  /// [secondi]: dopo quanto si svuotano gli appunti per i dati segreti (0 = mai).
  static Future<void> copia(String testo, {bool segreto = true, int secondi = 60}) =>
      _c.invokeMethod('copia', {'testo': testo, 'segreto': segreto, 'secondi': secondi});
  static Future<bool> autocompilazioneAttiva() async => (await _c.invokeMethod<bool>('autocompilazioneAttiva')) ?? false;
  static Future<void> apriAutocompilazione() => _c.invokeMethod('apriAutocompilazione');
  static Future<bool> suWifi() async => (await _c.invokeMethod<bool>('suWifi')) ?? false;
  static Future<bool> apriLink(String url) async => (await _c.invokeMethod<bool>('apriLink', {'url': url})) ?? false;
}

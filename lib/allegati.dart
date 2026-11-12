import 'dart:convert';
import 'dart:io';
import 'dart:typed_data';

import 'archivio.dart';
import 'cripto.dart';
import 'main.dart';
import 'nativo.dart';

/// Allegati delle voci (CHECKLIST 1.11; 25 MB per file, 2 GB in tutto).
/// Il file si cifra sul telefono con la chiave dei dati (dati aggiuntivi `digipass-allegato:<id>`, come la webapp):
/// al NAS arrivano solo byte cifrati. Sul telefono la copia cifrata sta in `<cartella>/allegati/<id>`; in chiaro non si
/// scrive mai niente su disco. Nella voce restano nome, tipo, grandezza (cifrati con la voce).
class Allegati {
  static const massimoFile = 25 * 1024 * 1024;
  static const massimoTotale = 2 * 1024 * 1024 * 1024;

  static Directory get _dir => Directory('${archivio.cartella}/allegati')..createSync(recursive: true);
  static File _file(String id) => File('${_dir.path}/$id');
  static File get _daCancellare => File('${archivio.cartella}/allegati-da-cancellare.json');

  static List<Map<String, dynamic>> di(Map v) => ((v['allegati'] as List?) ?? []).map((e) => Map<String, dynamic>.from(e as Map)).toList();

  static String misura(num n) => n >= 1048576 ? '${(n / 1048576).toStringAsFixed(1)} MB' : n > 0 ? '${(n / 1024).round().clamp(1, 1024)} KB' : '0 KB';

  /// Aggiunge un file alla voce. Ritorna un messaggio se qualcosa non va (troppo grande, NAS non raggiungibile: in quel
  /// caso l'allegato resta sul telefono e si carica alla prossima sincronizzazione).
  static Future<String?> aggiungi(Map<String, dynamic> v, String nome, String tipo, Uint8List chiaro) async {
    if (chiaro.length > massimoFile) return '«$nome» è troppo grande: un allegato può essere al massimo di 25 MB';
    final dek = archivio.chiave;
    if (dek == null) return 'Cassaforte chiusa';
    final id = Archivio.nuovoId();
    final cifrato = await Cripto.cifra(dek, chiaro, aadExtra: 'digipass-allegato:$id');
    await _file(id).writeAsBytes(cifrato, flush: true);
    String? errore;
    var daCaricare = false;
    if (sincronia.collegato) {
      errore = await sincronia.caricaAllegato(id, cifrato);
      if (errore != null && !errore.contains('pieno') && !errore.contains('grande')) daCaricare = true;
      if (errore != null && !daCaricare) {
        await _file(id).delete();
        return errore;
      }
    }
    final lista = di(v)..add({'id': id, 'nome': nome, 'tipo': tipo, 'dimensione': chiaro.length, 'creato': DateTime.now().millisecondsSinceEpoch, if (daCaricare) 'daCaricare': true});
    v['allegati'] = lista;
    await archivio.salvaVoce(v);
    return daCaricare ? 'Allegato salvato sul telefono: va sul NAS alla prossima sincronizzazione' : null;
  }

  /// Il contenuto in chiaro (solo in memoria): dalla copia del telefono, altrimenti dal NAS.
  static Future<Uint8List?> apri(Map a) async {
    final dek = archivio.chiave;
    if (dek == null) return null;
    final id = a['id'] as String;
    var cifrato = _file(id).existsSync() ? await _file(id).readAsBytes() : null;
    if (cifrato == null) {
      cifrato = await sincronia.scaricaAllegato(id);
      if (cifrato == null) return null;
      await _file(id).writeAsBytes(cifrato, flush: true);
    }
    return Cripto.decifra(dek, cifrato, aadExtra: 'digipass-allegato:$id');
  }

  static Future<void> rinomina(Map<String, dynamic> v, String id, String nome) async {
    v['allegati'] = [for (final a in di(v)) a['id'] == id ? {...a, 'nome': nome} : a];
    await archivio.salvaVoce(v);
  }

  static Future<void> elimina(Map<String, dynamic> v, List<String> ids) async {
    v['allegati'] = di(v).where((a) => !ids.contains(a['id'])).toList();
    await archivio.salvaVoce(v);
    await dimentica(ids);
  }

  /// Toglie i file dal telefono e dal NAS (se il NAS non risponde, si riprova alla prossima sincronizzazione).
  static Future<void> dimentica(Iterable<String> ids) async {
    final restano = <String>[];
    for (final id in ids) {
      if (_file(id).existsSync()) await _file(id).delete();
      if (sincronia.collegato && !await sincronia.cancellaAllegato(id)) restano.add(id);
    }
    if (restano.isNotEmpty) {
      final vecchi = _daCancellare.existsSync() ? (jsonDecode(await _daCancellare.readAsString()) as List).cast<String>() : <String>[];
      await _daCancellare.writeAsString(jsonEncode({...vecchi, ...restano}.toList()));
    }
  }

  static Iterable<String> idDi(Map v) => di(v).map((a) => a['id'] as String);

  /// Dopo ogni sincronizzazione: carica quelli rimasti sul telefono, cancella sul NAS quelli in sospeso, scarica in
  /// anticipo se l'impostazione lo chiede, toglie dal telefono i file che nessuna voce usa più.
  static Future<void> inSincronia() async {
    if (archivio.chiave == null) return;
    for (final v in List<Map<String, dynamic>>.from(archivio.tutteLeVoci)) {
      final lista = di(v);
      if (!lista.any((a) => a['daCaricare'] == true)) continue;
      var cambiata = false;
      for (final a in lista.where((a) => a['daCaricare'] == true)) {
        final f = _file(a['id']);
        if (!f.existsSync()) continue;
        if (await sincronia.caricaAllegato(a['id'], await f.readAsBytes()) == null) {
          a.remove('daCaricare');
          cambiata = true;
        }
      }
      if (cambiata) {
        v['allegati'] = lista;
        await archivio.salvaVoce(v);
      }
    }
    if (_daCancellare.existsSync()) {
      final ids = (jsonDecode(await _daCancellare.readAsString()) as List).cast<String>();
      final restano = <String>[for (final id in ids) if (!await sincronia.cancellaAllegato(id)) id];
      restano.isEmpty ? await _daCancellare.delete() : await _daCancellare.writeAsString(jsonEncode(restano));
    }
    final usati = {for (final v in archivio.tutteLeVoci) ...idDi(v)};
    for (final f in _dir.listSync().whereType<File>()) {
      // Solo file vecchi di 10 minuti: uno appena aggiunto non è ancora scritto nella sua voce.
      if (!usati.contains(f.uri.pathSegments.last) && DateTime.now().difference(f.lastModifiedSync()).inMinutes > 10) await f.delete();
    }
    final quando = impostazioni.allegatiOffline;
    if (quando == 'sempre' || (quando == 'wifi' && await Nativo.suWifi())) {
      for (final id in usati) {
        if (_file(id).existsSync()) continue;
        final c = await sincronia.scaricaAllegato(id);
        if (c != null) await _file(id).writeAsBytes(c, flush: true);
      }
    }
  }
}

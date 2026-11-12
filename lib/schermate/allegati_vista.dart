import 'dart:io';
import 'dart:typed_data';

import 'package:file_picker/file_picker.dart';
import 'package:flutter/material.dart';
import 'package:image_picker/image_picker.dart';

import '../allegati.dart';
import '../main.dart';
import '../tema.dart';

/// Allegati di una voce nella scheda (CHECKLIST 1.11): aggiungi da file, galleria o fotocamera; apri, salva, rinomina,
/// elimina, elimina tutti; spazio usato sul NAS (2 GB in tutto, avviso quando è quasi pieno).
class SezioneAllegati extends StatefulWidget {
  const SezioneAllegati({super.key, required this.voce, this.nelCestino = false});
  final Map<String, dynamic> voce;
  final bool nelCestino;
  @override
  State<SezioneAllegati> createState() => _SezioneAllegatiState();
}

class _SezioneAllegatiState extends State<SezioneAllegati> {
  bool _lavoro = false;
  (int, int)? _spazio;

  @override
  void initState() {
    super.initState();
    _aggiornaSpazio();
  }

  Future<void> _aggiornaSpazio() async {
    final s = await sincronia.spazioAllegati();
    if (mounted) setState(() => _spazio = s);
  }

  Future<void> _aggiungi(List<(String, String, List<int>)> file) async {
    if (file.isEmpty) return;
    setState(() => _lavoro = true);
    final messaggi = <String>[];
    for (final (nome, tipo, byte) in file) {
      final m = await Allegati.aggiungi(widget.voce, nome, tipo, byte is Uint8List ? byte : Uint8List.fromList(byte));
      if (m != null) messaggi.add(m);
    }
    if (!mounted) return;
    setState(() => _lavoro = false);
    _aggiornaSpazio();
    avviso(context, messaggi.isEmpty ? (file.length == 1 ? 'Allegato aggiunto' : '${file.length} allegati aggiunti') : messaggi.join('\n'));
  }

  Future<void> _daFile({bool immagini = false}) async {
    final r = await senzaBlocco(() => FilePicker.pickFiles(dialogTitle: immagini ? 'Scegli le foto' : 'Scegli i file', type: immagini ? FileType.image : FileType.any, allowMultiple: true, withData: true));
    if (r == null) return;
    final out = <(String, String, List<int>)>[];
    for (final f in r.files) {
      final b = f.bytes ?? (f.path != null ? await File(f.path!).readAsBytes() : null);
      if (b != null) out.add((f.name, _tipo(f.name), b));
    }
    await _aggiungi(out);
  }

  Future<void> _fotocamera() async {
    try {
      final x = await senzaBlocco(() => ImagePicker().pickImage(source: ImageSource.camera));
      if (x == null) return;
      final ora = DateTime.now();
      final nome = 'Foto ${ora.day.toString().padLeft(2, '0')}.${ora.month.toString().padLeft(2, '0')}.${ora.year} ${ora.hour.toString().padLeft(2, '0')}.${ora.minute.toString().padLeft(2, '0')}.jpg';
      await _aggiungi([(nome, 'image/jpeg', await x.readAsBytes())]);
    } catch (_) {
      if (mounted) avviso(context, 'Fotocamera non disponibile: controlla il permesso della fotocamera per DiGiPass');
    }
  }

  static String _tipo(String nome) {
    final e = nome.toLowerCase().split('.').last;
    return const {
          'jpg': 'image/jpeg', 'jpeg': 'image/jpeg', 'png': 'image/png', 'gif': 'image/gif', 'webp': 'image/webp', 'heic': 'image/heic',
          'pdf': 'application/pdf', 'txt': 'text/plain', 'csv': 'text/csv', 'doc': 'application/msword', 'zip': 'application/zip',
          'docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          'xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        }[e] ??
        'application/octet-stream';
  }

  Future<void> _apri(Map a) async {
    setState(() => _lavoro = true);
    final b = await Allegati.apri(a);
    if (!mounted) return;
    setState(() => _lavoro = false);
    if (b == null) return avviso(context, 'Allegato non raggiungibile: controlla il collegamento al NAS');
    final immagine = (a['tipo'] ?? '').toString().startsWith('image/');
    await showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      builder: (c) => SafeArea(
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.stretch, children: [
            Text(a['nome'] ?? 'Allegato', style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w700)),
            const SizedBox(height: 4),
            Text(Allegati.misura(b.length), style: const TextStyle(fontSize: 14)),
            const SizedBox(height: 12),
            if (immagine)
              ConstrainedBox(
                constraints: BoxConstraints(maxHeight: MediaQuery.sizeOf(c).height * .6),
                child: InteractiveViewer(child: Image.memory(b, fit: BoxFit.contain, errorBuilder: (_, __, ___) => const Text('Anteprima non disponibile'))),
              )
            else
              const Text('Per aprirlo, salvalo sul telefono e aprilo con l\'app che preferisci.', style: TextStyle(fontSize: 15)),
            const SizedBox(height: 14),
            Principale(
              testo: 'Salva sul telefono',
              icona: Icons.download_outlined,
              onTap: () async {
                final p = await senzaBlocco(() => FilePicker.saveFile(dialogTitle: 'Salva l\'allegato', fileName: (a['nome'] ?? 'allegato').toString(), bytes: b));
                if (c.mounted) Navigator.pop(c);
                if (p != null && mounted) avviso(context, 'Salvato');
              },
            ),
          ]),
        ),
      ),
    );
  }

  Future<void> _rinomina(Map a) async {
    final ctl = TextEditingController(text: (a['nome'] ?? '').toString());
    final nome = await showDialog<String>(
      context: context,
      builder: (d) => AlertDialog(
        title: const Text('Rinomina allegato', style: TextStyle(color: kInk, fontWeight: FontWeight.w700)),
        content: TextField(controller: ctl, autofocus: true, style: kStileCampo, decoration: campoRosa('Nome')),
        actions: [
          TextButton(onPressed: () => Navigator.pop(d), child: const Text('Annulla', style: TextStyle(color: kInk))),
          TextButton(onPressed: () => Navigator.pop(d, ctl.text.trim()), child: const Text('Rinomina', style: TextStyle(color: kInk, fontWeight: FontWeight.w700))),
        ],
      ),
    );
    if (nome == null || nome.isEmpty) return;
    await Allegati.rinomina(widget.voce, a['id'], nome);
  }

  Future<void> _elimina(List<Map> quali) async {
    final testo = quali.length == 1 ? 'L\'allegato «${quali.first['nome']}» sparisce dal telefono e dal NAS e non si può recuperare.' : 'I ${quali.length} allegati spariscono dal telefono e dal NAS e non si possono recuperare.';
    if (!await conferma(context, quali.length == 1 ? 'Eliminare l\'allegato?' : 'Eliminare tutti gli allegati?', testo, si: 'Elimina')) return;
    await Allegati.elimina(widget.voce, [for (final a in quali) a['id'] as String]);
    _aggiornaSpazio();
  }

  @override
  Widget build(BuildContext context) {
    final lista = Allegati.di(widget.voce);
    final spazio = _spazio;
    final quasiPieno = spazio != null && spazio.$1 > spazio.$2 * .9;
    return Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
      const SizedBox(height: 6),
      Etichetta('Allegati · ${lista.length}'),
      const SizedBox(height: 8),
      for (final a in lista)
        Container(
          margin: const EdgeInsets.only(bottom: 8),
          decoration: BoxDecoration(color: kG1, borderRadius: BorderRadius.circular(8), border: Border.all(color: kFilo2)),
          child: ListTile(
            leading: Icon((a['tipo'] ?? '').toString().startsWith('image/') ? Icons.image_outlined : Icons.insert_drive_file_outlined, color: kInk),
            title: Text((a['nome'] ?? 'Allegato').toString(), style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w600, color: kInk)),
            subtitle: Text([Allegati.misura((a['dimensione'] ?? 0) as num), if (a['daCaricare'] == true) 'non ancora sul NAS'].join(' · '),
                style: const TextStyle(fontSize: 14, color: kInk)),
            onTap: _lavoro ? null : () => _apri(a),
            trailing: widget.nelCestino
                ? null
                : PopupMenuButton<String>(
                    color: kG2,
                    onSelected: (s) => s == 'rinomina' ? _rinomina(a) : _elimina([a]),
                    itemBuilder: (_) => const [
                      PopupMenuItem(value: 'rinomina', child: Text('Rinomina', style: TextStyle(color: kInk))),
                      PopupMenuItem(value: 'elimina', child: Text('Elimina', style: TextStyle(color: kInk))),
                    ],
                  ),
          ),
        ),
      if (_lavoro) const Padding(padding: EdgeInsets.all(8), child: Center(child: CircularProgressIndicator(color: kRosa))),
      if (!widget.nelCestino) ...[
        Wrap(spacing: 8, runSpacing: 8, children: [
          Chip2('File', icona: Icons.attach_file, onTap: _lavoro ? null : () => _daFile()),
          Chip2('Galleria', icona: Icons.photo_library_outlined, onTap: _lavoro ? null : () => _daFile(immagini: true)),
          Chip2('Fotocamera', icona: Icons.photo_camera_outlined, onTap: _lavoro ? null : _fotocamera),
          if (lista.length > 1) Chip2('Elimina tutti', icona: Icons.delete_outline, onTap: _lavoro ? null : () => _elimina(lista)),
        ]),
        const SizedBox(height: 6),
        Text(
          spazio == null
              ? 'Al massimo 25 MB per file'
              : 'Spazio usato sul NAS: ${Allegati.misura(spazio.$1)} di 2 GB${quasiPieno ? ' · quasi pieno' : ''} · al massimo 25 MB per file',
          style: TextStyle(fontSize: 13, fontWeight: quasiPieno ? FontWeight.w800 : FontWeight.w400, color: kInk),
        ),
      ],
    ]);
  }
}

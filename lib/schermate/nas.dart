import 'dart:io';

import 'package:flutter/material.dart';

import '../main.dart';
import '../nativo.dart';
import '../tema.dart';
import 'accesso.dart';

/// Collega l'app al server di DiGiPass sul NAS.
/// - NAS nuovo: prima configurazione con Google Authenticator (crea anche un foglio di emergenza nuovo con 10 codici);
/// - NAS già configurato: accesso con password principale + codice (telefono nuovo o app reinstallata).
class CollegaNas extends StatefulWidget {
  const CollegaNas({super.key, this.telefonoNuovo = false});
  final bool telefonoNuovo;
  @override
  State<CollegaNas> createState() => _CollegaNasState();
}

class _CollegaNasState extends State<CollegaNas> {
  final _url = TextEditingController();
  final _utente = TextEditingController(text: 'admin');
  final _pw = TextEditingController(), _codice = TextEditingController(), _codiceSetup = TextEditingController();
  Map<String, dynamic>? _setup; // dati della prima configurazione (segreto e link otpauth)
  bool? _configurato;
  bool _lavoro = false;
  String? _errore;

  Future<void> _fai(Future<void> Function() f) async {
    setState(() {
      _lavoro = true;
      _errore = null;
    });
    try {
      await senzaBlocco(f);
    } on HttpException catch (e) {
      _errore = e.message;
    } on SocketException {
      _errore = 'NAS non raggiungibile: controlla l\'indirizzo e la connessione';
    } catch (e) {
      _errore = 'Non riuscito: $e';
    }
    if (mounted) setState(() => _lavoro = false);
  }

  Future<void> _continua() => _fai(() async {
        final st = await sincronia.stato(_url.text);
        if (st['initialized'] == true) {
          _configurato = true;
        } else if (widget.telefonoNuovo) {
          throw const HttpException('Su questo NAS non c\'è ancora una cassaforte: creala sul telefono e poi collegala.');
        } else if (st['setupAllowed'] == true) {
          _configurato = false;
          if (_codiceSetup.text.trim().isEmpty) throw const HttpException('Su questo NAS non c\'è ancora una cassaforte: scrivi il codice di configurazione e tocca di nuovo Continua.');
          _setup = await sincronia.iniziaConfigurazione(_url.text, _utente.text, _codiceSetup.text);
        } else {
          throw const HttpException('Il NAS non accetta ancora la prima configurazione (manca DIGIPASS_ALLOW_SETUP=1).');
        }
      });

  Future<void> _completa() => _fai(() async {
        if (_configurato == false) {
          final (recupero, codici) = await sincronia.completaConfigurazione(_setup!['setupToken'], _pw.text, _codice.text.trim());
          if (!mounted) return;
          await Navigator.of(context).pushReplacement(MaterialPageRoute(
            builder: (c) => Scaffold(
              appBar: const Barra(titolo: 'Foglio di emergenza nuovo', indietro: false),
              body: FoglioEmergenza(recupero: recupero, codici: codici, fine: () => Navigator.pop(c)),
            ),
          ));
        } else {
          await sincronia.accedi(_url.text, _utente.text, _pw.text, _codice.text.trim());
          if (!mounted) return;
          avviso(context, 'Collegato al NAS: cassaforte sincronizzata');
          if (widget.telefonoNuovo) {
            Navigator.pop(context);
            archivio.pronto();
          } else {
            Navigator.pop(context);
          }
        }
      });

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: Barra(titolo: widget.telefonoNuovo ? 'Cassaforte sul NAS' : 'Collega al NAS'),
      body: ListView(padding: const EdgeInsets.all(16), children: [
        Text(
            widget.telefonoNuovo
                ? 'Scarica sul telefono la cassaforte che hai già sul NAS. Servono la password principale e il codice di Google Authenticator.'
                : 'Il NAS tiene una copia cifrata della cassaforte, per la webapp e per non perdere niente se cambi telefono. Il NAS non vede mai le password.',
            style: const TextStyle(fontSize: 15, height: 1.4)),
        const SizedBox(height: 16),
        TextField(style: kStileCampo, controller: _url, enabled: _configurato == null, keyboardType: TextInputType.url, decoration: campoRosa('Indirizzo del server (https://…)')),
        const SizedBox(height: 10),
        TextField(style: kStileCampo, controller: _utente, enabled: _configurato == null, decoration: campoRosa('Nome utente')),
        if (_configurato == null && !widget.telefonoNuovo) ...[
          const SizedBox(height: 10),
          TextField(style: kStileCampo, controller: _codiceSetup, decoration: campoRosa('Codice di configurazione (solo la prima volta)')),
        ],
        const SizedBox(height: 14),
        if (_configurato == null) Principale(testo: _lavoro ? 'Controllo…' : 'Continua', onTap: _lavoro ? null : _continua),
        if (_configurato == false && _setup != null) ...[
          const Etichetta('Google Authenticator'),
          const SizedBox(height: 8),
          const Text('Aggiungi DiGiPass a Google Authenticator: tocca il pulsante, oppure in Authenticator scegli «Inserisci chiave di configurazione» e scrivi la chiave qui sotto.',
              style: TextStyle(fontSize: 15, height: 1.4)),
          const SizedBox(height: 10),
          Secondario(testo: 'Apri in Google Authenticator', icona: Icons.open_in_new, onTap: () => Nativo.apriLink(_setup!['otpauthUrl'])),
          const SizedBox(height: 10),
          Container(
            padding: const EdgeInsets.all(12),
            decoration: BoxDecoration(color: kG1, borderRadius: BorderRadius.circular(8), border: Border.all(color: kFilo2)),
            child: SelectableText(_setup!['secret'], style: const TextStyle(fontFamily: 'monospace', fontSize: 17, fontWeight: FontWeight.w700)),
          ),
          const SizedBox(height: 14),
        ],
        if (_configurato != null) ...[
          TextField(style: kStileCampo, controller: _pw, obscureText: true, decoration: campoRosa('Password principale')),
          const SizedBox(height: 10),
          TextField(style: kStileCampo, 
            controller: _codice,
            decoration: campoRosa(_configurato == false ? 'Codice di Authenticator (6 cifre)' : 'Codice di Authenticator o di riserva'),
          ),
          const SizedBox(height: 14),
          Principale(testo: _lavoro ? 'Collego…' : 'Collega', icona: Icons.cloud_done_outlined, onTap: _lavoro ? null : _completa),
        ],
        if (_errore != null) ...[const SizedBox(height: 12), Text(_errore!, style: const TextStyle(color: kPuntoRosso, fontWeight: FontWeight.w700, fontSize: 15))],
      ]),
    );
  }
}

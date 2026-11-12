package dev.digiapps.digipass

import android.content.ClipData
import android.content.ClipDescription
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.os.PersistableBundle
import android.provider.Settings
import android.view.WindowManager
import android.view.autofill.AutofillManager
import io.flutter.embedding.android.FlutterFragmentActivity
import io.flutter.embedding.engine.FlutterEngine
import io.flutter.plugin.common.MethodChannel

class MainActivity : FlutterFragmentActivity() {
    private val mano = Handler(Looper.getMainLooper())

    override fun onCreate(savedInstanceState: Bundle?) {
        // Niente screenshot e niente anteprima nelle app recenti.
        window.setFlags(WindowManager.LayoutParams.FLAG_SECURE, WindowManager.LayoutParams.FLAG_SECURE)
        super.onCreate(savedInstanceState)
    }

    override fun configureFlutterEngine(flutterEngine: FlutterEngine) {
        super.configureFlutterEngine(flutterEngine)
        MethodChannel(flutterEngine.dartExecutor.binaryMessenger, "digipass/android").setMethodCallHandler { call, res ->
            try {
                when (call.method) {
                    "cartella" -> res.success(filesDir.absolutePath)
                    "apriSessione" -> {
                        val k = call.argument<ByteArray>("chiave")!!
                        Cassaforte.apriSessione(k); Cassaforte.salvaAutocompilazione(this, k); res.success(null)
                    }
                    "pausaSessione" -> { Cassaforte.pausaSessione((call.argument<Number>("ms") ?: 0).toLong()); res.success(null) }
                    "chiudiSessione" -> { Cassaforte.chiudiSessione(); res.success(null) }
                    "bloccaTutto" -> { Cassaforte.chiudiSessione(); Cassaforte.togliAutocompilazione(this); res.success(null) }
                    "improntaDisponibile" -> res.success(Impronta.disponibile(this))
                    "improntaAttiva" -> res.success(Cassaforte.improntaAttiva(this))
                    "attivaImpronta" -> {
                        val dek = call.argument<ByteArray>("chiave")!!
                        Impronta.chiedi(this, "Attiva lo sblocco con l'impronta", Cassaforte.cipherPerCifrare(), { c ->
                            try { Cassaforte.salvaImpronta(this, c, dek); res.success(true) }
                            catch (e: Exception) { res.error("impronta", e.message, null) }
                        }, { m -> res.error("impronta", m, null) })
                    }
                    "sbloccaImpronta" -> {
                        val c = try { Cassaforte.cipherPerDecifrare(this) } catch (e: Exception) { null }
                        if (c == null) { Cassaforte.togliImpronta(this); res.error("impronta", "Impronta da riattivare: sblocca con la password principale", null) }
                        else Impronta.chiedi(this, "Sblocca DiGiPass", c, { cc ->
                            try { res.success(Cassaforte.leggiImpronta(this, cc)) }
                            catch (e: Exception) { res.error("impronta", "Sblocco non riuscito", null) }
                        }, { m -> res.error("impronta", m, null) })
                    }
                    "togliImpronta" -> { Cassaforte.togliImpronta(this); res.success(null) }
                    // CHECKLIST 6.5: «Consenti screenshot» (spento = schermate e anteprima nelle app recenti bloccate).
                    "screenshot" -> {
                        if (call.argument<Boolean>("consenti") == true) window.clearFlags(WindowManager.LayoutParams.FLAG_SECURE)
                        else window.setFlags(WindowManager.LayoutParams.FLAG_SECURE, WindowManager.LayoutParams.FLAG_SECURE)
                        res.success(null)
                    }
                    "copia" -> { copia(call.argument<String>("testo") ?: "", call.argument<Boolean>("segreto") ?: true, (call.argument<Number>("secondi") ?: 60).toInt()); res.success(null) }
                    "autocompilazioneAttiva" -> {
                        val am = getSystemService(AutofillManager::class.java)
                        res.success(am != null && am.hasEnabledAutofillServices())
                    }
                    "suWifi" -> {
                        val cm = getSystemService(android.net.ConnectivityManager::class.java)
                        val caps = cm?.getNetworkCapabilities(cm.activeNetwork)
                        res.success(caps?.hasTransport(android.net.NetworkCapabilities.TRANSPORT_WIFI) == true)
                    }
                    "apriLink" -> {
                        try { startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(call.argument<String>("url")))); res.success(true) }
                        catch (e: Exception) { res.success(false) }
                    }
                    "apriAutocompilazione" -> {
                        val i = Intent(Settings.ACTION_REQUEST_SET_AUTOFILL_SERVICE).setData(Uri.parse("package:$packageName"))
                        startActivity(i); res.success(null)
                    }
                    else -> res.notImplemented()
                }
            } catch (e: Exception) {
                res.error("errore", e.message, null)
            }
        }
    }

    /** Copia negli appunti (Appunti.kt). */
    private fun copia(testo: String, segreto: Boolean, secondi: Int = 60) = Appunti.copia(this, testo, segreto, secondi)
}

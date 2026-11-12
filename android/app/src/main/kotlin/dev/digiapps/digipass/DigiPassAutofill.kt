package dev.digiapps.digipass

import android.annotation.SuppressLint
import android.app.PendingIntent
import android.app.assist.AssistStructure
import android.app.slice.Slice
import android.content.Context
import android.content.Intent
import android.graphics.drawable.Icon
import android.os.Build
import android.os.CancellationSignal
import android.service.autofill.AutofillService
import android.service.autofill.Dataset
import android.service.autofill.FillCallback
import android.service.autofill.FillRequest
import android.service.autofill.FillResponse
import android.service.autofill.InlinePresentation
import android.service.autofill.SaveCallback
import android.service.autofill.SaveInfo
import android.service.autofill.SaveRequest
import android.view.autofill.AutofillId
import android.view.autofill.AutofillValue
import android.view.inputmethod.InlineSuggestionsRequest
import android.widget.RemoteViews
import androidx.autofill.inline.v1.InlineSuggestionUi
import org.json.JSONObject

/**
 * Autocompilazione di DiGiPass: propone prima i login della Cassaforte, poi quelli di Memoria siti; sui moduli di pagamento
 * le carte, sui moduli di dati personali le identità. Dopo un accesso nuovo, Android chiede di salvare: il sito va in
 * Memoria siti e si può mettere in cassaforte. La compilazione non si blocca mai.
 */
class DigiPassAutofill : AutofillService() {

    override fun onFillRequest(req: FillRequest, cs: CancellationSignal, cb: FillCallback) {
        val s = req.fillContexts.last().structure
        val c = Campi.leggi(s)
        if (c.vuoto || c.pacchetto == packageName) { cb.onSuccess(null); return }
        val inline = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) req.inlineSuggestionsRequest else null
        // Il collegamento siti-app chiede il file del sito in rete: niente rete sul thread principale.
        Thread {
            val r = try {
                val dek = Cassaforte.chiavePerAutocompilazione(this)
                if (dek == null) {
                    // Solo prima del primo sblocco dopo l'installazione: una riga «Sblocca DiGiPass» che apre l'impronta.
                    val i = Intent(this, SbloccaAutofillActivity::class.java)
                    val pi = PendingIntent.getActivity(this, 1, i, PendingIntent.FLAG_CANCEL_CURRENT or PendingIntent.FLAG_MUTABLE)
                    val r = FillResponse.Builder()
                        .setAuthentication(c.ids, pi.intentSender, riga(this, "Sblocca DiGiPass", "con l'impronta"))
                    salvataggio(c)?.let { r.setSaveInfo(it) }
                    r.build()
                } else risposta(this, c, Cassaforte.leggi(this, dek), inline)
            } catch (e: Exception) { null }
            if (!cs.isCanceled) try { cb.onSuccess(r) } catch (_: Exception) { }
        }.start()
    }

    override fun onSaveRequest(req: SaveRequest, cb: SaveCallback) {
        val c = Campi.leggi(req.fillContexts.last().structure)
        if (c.valorePassword.isBlank()) { cb.onSuccess(); return }
        val i = Intent(this, SalvaActivity::class.java)
            .putExtra("sito", c.sito).putExtra("utente", c.valoreUtente).putExtra("password", c.valorePassword)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        val pi = PendingIntent.getActivity(this, System.currentTimeMillis().toInt(), i,
            PendingIntent.FLAG_CANCEL_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        cb.onSuccess(pi.intentSender)
    }

    companion object {
        fun riga(ctx: Context, titolo: String, sotto: String): RemoteViews =
            RemoteViews(ctx.packageName, R.layout.riga_autofill).apply {
                setTextViewText(R.id.titolo, titolo)
                setTextViewText(R.id.sotto, sotto)
            }

        fun salvataggio(c: Campi): SaveInfo? {
            val p = c.password ?: return null
            val tipo = if (c.utente != null) SaveInfo.SAVE_DATA_TYPE_PASSWORD or SaveInfo.SAVE_DATA_TYPE_USERNAME else SaveInfo.SAVE_DATA_TYPE_PASSWORD
            val b = SaveInfo.Builder(tipo, arrayOf(p))
            c.utente?.let { b.setOptionalIds(arrayOf(it)) }
            return b.build()
        }

        /**
         * Suggerimento nella tastiera (CHECKLIST 5.2, impostazione «Suggerimenti nella tastiera»): se la tastiera li
         * supporta compaiono lì, altrimenti resta il menu a comparsa.
         */
        @SuppressLint("RestrictedApi")
        private fun nellaTastiera(ctx: Context, inline: InlineSuggestionsRequest?, n: Int, titolo: String, sotto: String): InlinePresentation? {
            if (Build.VERSION.SDK_INT < Build.VERSION_CODES.R || inline == null) return null
            if (n >= inline.maxSuggestionCount) return null
            val specs = inline.inlinePresentationSpecs
            if (specs.isEmpty()) return null
            val spec = specs[minOf(n, specs.size - 1)]
            return try {
                val pi = PendingIntent.getActivity(ctx, 0, Intent(ctx, MainActivity::class.java), PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
                val b = InlineSuggestionUi.newContentBuilder(pi).setTitle(titolo)
                if (sotto.isNotBlank()) b.setSubtitle(sotto)
                b.setStartIcon(Icon.createWithResource(ctx, R.mipmap.ic_launcher))
                val slice: Slice = b.build().slice
                InlinePresentation(slice, spec, false)
            } catch (_: Exception) { null }
        }

        private fun metti(d: Dataset.Builder, id: AutofillId, v: AutofillValue?, vista: RemoteViews, tastiera: InlinePresentation?) {
            if (tastiera != null && Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) d.setValue(id, v, vista, tastiera) else d.setValue(id, v, vista)
        }

        fun risposta(ctx: Context, c: Campi, json: JSONObject, inline: InlineSuggestionsRequest? = null): FillResponse? {
            val pref = Preferenze.leggi(ctx)
            val inl = if (pref.tastiera) inline else null
            val r = FillResponse.Builder()
            var n = 0
            // ---- login (Cassaforte, poi Memoria siti) ----
            val collegato: ((String) -> Boolean)? = if (pref.collegaApp) { d -> SitiApp.collegati(ctx, d, c.pacchetto) } else null
            if (c.utente != null || c.password != null) for (s in Campi.suggerimenti(json, c, collegato)) {
                val sotto = s.utente.ifBlank { "senza nome utente" }
                val vista = riga(ctx, s.titolo, sotto)
                val tastiera = nellaTastiera(ctx, inl, n, s.utente.ifBlank { s.titolo }, s.titolo)
                val d = Dataset.Builder()
                // Login col 2FA (CHECKLIST 4.3): la scelta passa da un attimo di DiGiPass che copia il codice e poi compila.
                if (pref.copiaTotp && s.totp.isNotBlank() && Totp.codice(s.totp) != null) {
                    val i = Intent(ctx, CopiaTotpActivity::class.java)
                        .putExtra("utente", s.utente).putExtra("password", s.password).putExtra("totp", s.totp)
                        .putExtra("titolo", s.titolo)
                        .putExtra("idUtente", c.utente).putExtra("idPassword", c.password)
                    val pi = PendingIntent.getActivity(ctx, 100 + n, i, PendingIntent.FLAG_CANCEL_CURRENT or PendingIntent.FLAG_MUTABLE)
                    c.utente?.let { metti(d, it, null, vista, tastiera) }
                    c.password?.let { metti(d, it, null, vista, tastiera) }
                    d.setAuthentication(pi.intentSender)
                } else {
                    c.utente?.let { metti(d, it, AutofillValue.forText(s.utente), vista, tastiera) }
                    c.password?.let { metti(d, it, AutofillValue.forText(s.password), vista, tastiera) }
                }
                r.addDataset(d.build()); n++
            }
            // ---- carte ----
            if (c.carta) for (v in Campi.carte(json)) {
                val campi = v.optJSONObject("campi") ?: JSONObject()
                val numero = campi.optString("numero").filter { it.isDigit() }
                val titolo = v.optString("titolo").ifBlank { "Carta" }
                val sotto = "${Campi.tipoDaNumero(numero)} •••• ${numero.takeLast(4)}"
                val vista = riga(ctx, titolo, sotto)
                val tastiera = nellaTastiera(ctx, inl, n, titolo, sotto)
                // Scadenza salvata come MM/AA (o MM/AAAA).
                val sc = campi.optString("scadenza").filter { it.isDigit() || it == '/' }
                val mm = sc.substringBefore('/').filter { it.isDigit() }.padStart(2, '0').takeLast(2)
                val aa = sc.substringAfter('/', "").filter { it.isDigit() }
                val anno4 = if (aa.length == 2) "20$aa" else aa
                val anno2 = anno4.takeLast(2)
                val d = Dataset.Builder()
                var messi = 0
                fun campo(cc: Campi.CampoCarta?, testo: String, varianti: List<String> = listOf(testo)) {
                    if (cc == null) return
                    val av = Campi.valore(cc, testo, varianti) ?: return
                    metti(d, cc.id, av, vista, tastiera); messi++
                }
                campo(c.numero, numero)
                campo(c.titolare, campi.optString("titolare"))
                campo(c.cvv, campi.optString("cvv"))
                if (aa.isNotBlank()) {
                    val lung = c.scadenza?.lunghezza ?: 0
                    campo(c.scadenza, if (lung in 6..7) "$mm/$anno4" else "$mm/$anno2", listOf("$mm/$anno2", "$mm/$anno4"))
                    campo(c.mese, mm, listOf(mm, mm.trimStart('0')))
                    campo(c.anno, if (c.anno?.lunghezza == 2) anno2 else anno4, listOf(anno4, anno2))
                }
                if (messi > 0) { r.addDataset(d.build()); n++ }
            }
            // ---- identità ----
            if (c.perIdentita) for (v in Campi.identita(json)) {
                val k = v.optJSONObject("campi") ?: JSONObject()
                val completo = k.optString("nomeCompleto").ifBlank { listOf(k.optString("nome"), k.optString("secondoNome"), k.optString("cognome")).filter { it.isNotBlank() }.joinToString(" ") }
                val titolo = v.optString("titolo").ifBlank { "Identità" }
                val sotto = completo.ifBlank { k.optString("email") }
                val vista = riga(ctx, titolo, sotto)
                val tastiera = nellaTastiera(ctx, inl, n, titolo, sotto)
                val d = Dataset.Builder()
                var messi = 0
                for ((chiave, cc) in c.identita) {
                    val testo = when (chiave) {
                        "nomeCompleto" -> completo
                        "organizzazione" -> k.optString("organizzazione").ifBlank { k.optString("azienda") }
                        else -> k.optString(chiave)
                    }
                    if (testo.isBlank()) continue
                    val av = Campi.valore(cc, testo, listOf(testo)) ?: continue
                    metti(d, cc.id, av, vista, tastiera); messi++
                }
                if (messi > 0) { r.addDataset(d.build()); n++ }
            }
            val si = salvataggio(c)
            if (si != null) r.setSaveInfo(si)
            return if (n == 0 && si == null) null else r.build()
        }

        @Suppress("unused")
        fun struttura(i: Intent): AssistStructure? =
            if (Build.VERSION.SDK_INT >= 33) i.getParcelableExtra(android.view.autofill.AutofillManager.EXTRA_ASSIST_STRUCTURE, AssistStructure::class.java)
            else @Suppress("DEPRECATION") i.getParcelableExtra(android.view.autofill.AutofillManager.EXTRA_ASSIST_STRUCTURE)
    }
}

package dev.digiapps.digipass

import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import org.json.JSONArray
import java.net.HttpURLConnection
import java.net.URL
import java.security.MessageDigest

/**
 * Collegamento siti-app (Digital Asset Links, CHECKLIST 5.5): un login salvato per un sito vale anche nell'app
 * se il sito dichiara quell'app in https://<sito>/.well-known/assetlinks.json con la stessa firma dell'app installata.
 * Si chiedono solo i siti il cui nome compare nel nome del pacchetto (es. amazon.it per com.amazon.mShop…).
 * Il risultato resta in memoria per 7 giorni. La richiesta va solo al sito stesso.
 */
object SitiApp {
    private const val PREF = "digipass_siti_app"
    private const val VALIDO = 7L * 24 * 60 * 60 * 1000

    /** Il nome principale del dominio (amazon per www.amazon.co.uk). */
    fun nome(dominio: String): String {
        val p = dominio.lowercase().removePrefix("www.").split('.').filter { it.isNotBlank() }
        if (p.size < 2) return p.firstOrNull() ?: ""
        val tld2 = setOf("co", "com", "net", "org", "gov", "ac", "edu")
        return if (p.size >= 3 && p[p.size - 2] in tld2) p[p.size - 3] else p[p.size - 2]
    }

    /** Il pacchetto contiene il nome del sito come parte intera (com.amazon.mShop → amazon). */
    fun candidato(dominio: String, pacchetto: String): Boolean {
        val n = nome(dominio)
        if (n.length < 3) return false
        return pacchetto.lowercase().split('.', '_').any { it == n || (it.startsWith(n) && it.length <= n.length + 8) }
    }

    private fun impronteApp(ctx: Context, pacchetto: String): Set<String> = try {
        val pm = ctx.packageManager
        val firme = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            val info = pm.getPackageInfo(pacchetto, PackageManager.GET_SIGNING_CERTIFICATES)
            info.signingInfo?.let { if (it.hasMultipleSigners()) it.apkContentsSigners else it.signingCertificateHistory }?.toList() ?: emptyList()
        } else {
            @Suppress("DEPRECATION")
            pm.getPackageInfo(pacchetto, PackageManager.GET_SIGNATURES).signatures?.toList() ?: emptyList()
        }
        firme.map { s -> MessageDigest.getInstance("SHA-256").digest(s.toByteArray()).joinToString(":") { "%02X".format(it) } }.toSet()
    } catch (_: Exception) { emptySet() }

    private fun dichiarate(dominio: String): JSONArray? = try {
        val c = URL("https://$dominio/.well-known/assetlinks.json").openConnection() as HttpURLConnection
        c.connectTimeout = 2500; c.readTimeout = 2500; c.instanceFollowRedirects = true
        if (c.responseCode != 200) null else c.inputStream.use { s ->
            val b = s.readBytes(); if (b.size > 200_000) null else JSONArray(String(b, Charsets.UTF_8))
        }
    } catch (_: Exception) { null }

    /** Il sito [dominio] dichiara l'app [pacchetto] con la firma installata? Da chiamare fuori dal thread principale. */
    fun collegati(ctx: Context, dominio: String, pacchetto: String): Boolean {
        val chiave = "$dominio|$pacchetto"
        val p = ctx.getSharedPreferences(PREF, Context.MODE_PRIVATE)
        val vecchio = p.getString(chiave, null)
        if (vecchio != null) {
            val (quando, esito) = vecchio.split('|').let { (it.getOrNull(0)?.toLongOrNull() ?: 0L) to (it.getOrNull(1) == "1") }
            if (System.currentTimeMillis() - quando < VALIDO) return esito
        }
        val impronte = impronteApp(ctx, pacchetto)
        var ok = false
        val l = if (impronte.isEmpty()) null else dichiarate(dominio) ?: dichiarate("www.$dominio")
        if (l != null) for (i in 0 until l.length()) {
            val t = l.optJSONObject(i)?.optJSONObject("target") ?: continue
            if (t.optString("namespace") != "android_app" || t.optString("package_name") != pacchetto) continue
            val fp = t.optJSONArray("sha256_cert_fingerprints") ?: continue
            for (k in 0 until fp.length()) if (fp.optString(k).uppercase() in impronte) ok = true
        }
        // Senza risposta del sito non si memorizza niente: si riprova la volta dopo.
        if (l != null || impronte.isEmpty()) p.edit().putString(chiave, "${System.currentTimeMillis()}|${if (ok) 1 else 0}").apply()
        return ok
    }
}

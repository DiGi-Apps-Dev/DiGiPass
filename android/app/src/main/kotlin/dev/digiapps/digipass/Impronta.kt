package dev.digiapps.digipass

import android.os.Build
import androidx.biometric.BiometricManager
import androidx.biometric.BiometricPrompt
import androidx.core.content.ContextCompat
import androidx.fragment.app.FragmentActivity
import javax.crypto.Cipher

/** Finestra di sistema per impronta (o PIN del telefono da Android 11) legata alla chiave del Keystore. */
object Impronta {
    private fun autenticatori(): Int =
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R)
            BiometricManager.Authenticators.BIOMETRIC_STRONG or BiometricManager.Authenticators.DEVICE_CREDENTIAL
        else BiometricManager.Authenticators.BIOMETRIC_STRONG

    fun disponibile(a: FragmentActivity): Boolean =
        BiometricManager.from(a).canAuthenticate(autenticatori()) == BiometricManager.BIOMETRIC_SUCCESS

    fun chiedi(a: FragmentActivity, titolo: String, cipher: Cipher, ok: (Cipher) -> Unit, errore: (String) -> Unit) {
        val info = BiometricPrompt.PromptInfo.Builder()
            .setTitle(titolo)
            .setSubtitle("DiGiPass")
            .setAllowedAuthenticators(autenticatori())
            .apply { if (Build.VERSION.SDK_INT < Build.VERSION_CODES.R) setNegativeButtonText("Annulla") }
            .build()
        val p = BiometricPrompt(a, ContextCompat.getMainExecutor(a), object : BiometricPrompt.AuthenticationCallback() {
            override fun onAuthenticationSucceeded(r: BiometricPrompt.AuthenticationResult) {
                val c = r.cryptoObject?.cipher
                if (c == null) errore("Sblocco non riuscito") else ok(c)
            }
            override fun onAuthenticationError(code: Int, msg: CharSequence) { errore(msg.toString()) }
        })
        p.authenticate(info, BiometricPrompt.CryptoObject(cipher))
    }

    /** Sblocca la cassaforte con l'impronta e apre la sessione. */
    fun sblocca(a: FragmentActivity, ok: (ByteArray) -> Unit, errore: (String) -> Unit) {
        Cassaforte.chiavePerAutocompilazione(a)?.let { ok(it); return }
        val c = try { Cassaforte.cipherPerDecifrare(a) } catch (e: Exception) { null }
        if (c == null) { errore("Impronta non attiva: apri DiGiPass e sblocca con la password principale"); return }
        chiedi(a, "Sblocca DiGiPass", c, { cc ->
            try {
                val dek = Cassaforte.leggiImpronta(a, cc)
                Cassaforte.apriSessione(dek)
                Cassaforte.pausaSessione(5 * 60_000L)
                Cassaforte.salvaAutocompilazione(a, dek)
                ok(dek)
            } catch (e: Exception) { errore("Sblocco non riuscito") }
        }, errore)
    }
}

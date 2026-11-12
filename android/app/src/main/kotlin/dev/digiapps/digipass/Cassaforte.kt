package dev.digiapps.digipass

import android.content.Context
import android.os.Build
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.security.KeyStore
import java.security.SecureRandom
import java.util.UUID
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.SecretKeySpec

/**
 * Archivio cifrato condiviso fra l'app Flutter e la parte Android (autocompilazione, salvataggio).
 * File: filesDir/vault.bin = nonce(12) | testo cifrato | tag(16), AES-256-GCM, dati aggiuntivi "digipass-v1".
 * Contenuto: JSON {"v":1,"voci":[...],"memoria":[...]} (stesso formato scritto da lib/archivio.dart).
 */
object Cassaforte {
    private const val AAD = "digipass-v1"
    private const val ALIAS_BIO = "digipass_impronta"
    private const val PREF = "digipass_impronta"

    fun fileArchivio(ctx: Context) = File(ctx.filesDir, "vault.bin")

    // ---------- chiave in memoria (sessione sbloccata) ----------
    @Volatile private var dek: ByteArray? = null
    @Volatile private var scadenza: Long = 0L

    fun apriSessione(chiave: ByteArray) { dek = chiave.copyOf(); scadenza = Long.MAX_VALUE }
    fun pausaSessione(ms: Long) { if (dek != null) scadenza = if (ms <= 0) 0 else System.currentTimeMillis() + ms }
    fun chiudiSessione() { dek?.fill(0); dek = null; scadenza = 0 }
    fun chiaveValida(): ByteArray? {
        val k = dek ?: return null
        if (scadenza != Long.MAX_VALUE && System.currentTimeMillis() > scadenza) { chiudiSessione(); return null }
        return k
    }

    // ---------- AES-GCM ----------
    fun cifra(chiave: ByteArray, dati: ByteArray): ByteArray {
        val nonce = ByteArray(12).also { SecureRandom().nextBytes(it) }
        val c = Cipher.getInstance("AES/GCM/NoPadding")
        c.init(Cipher.ENCRYPT_MODE, SecretKeySpec(chiave, "AES"), GCMParameterSpec(128, nonce))
        c.updateAAD(AAD.toByteArray())
        return nonce + c.doFinal(dati)
    }

    fun decifra(chiave: ByteArray, blob: ByteArray): ByteArray {
        val c = Cipher.getInstance("AES/GCM/NoPadding")
        c.init(Cipher.DECRYPT_MODE, SecretKeySpec(chiave, "AES"), GCMParameterSpec(128, blob, 0, 12))
        c.updateAAD(AAD.toByteArray())
        return c.doFinal(blob, 12, blob.size - 12)
    }

    fun leggi(ctx: Context, chiave: ByteArray): JSONObject {
        val f = fileArchivio(ctx)
        if (!f.exists()) return JSONObject().put("v", 1).put("voci", JSONArray()).put("memoria", JSONArray())
        return JSONObject(String(decifra(chiave, f.readBytes()), Charsets.UTF_8))
    }

    @Synchronized
    fun scrivi(ctx: Context, chiave: ByteArray, json: JSONObject) {
        val f = fileArchivio(ctx)
        val tmp = File(f.parentFile, "vault.bin.tmp")
        tmp.writeBytes(cifra(chiave, json.toString().toByteArray(Charsets.UTF_8)))
        if (!tmp.renameTo(f)) { f.delete(); tmp.renameTo(f) }
    }

    /** Mette un sito in Memoria siti (o aggiorna la password se sito e utente ci sono già). Ritorna l'id. */
    @Synchronized
    fun salvaInMemoria(ctx: Context, chiave: ByteArray, sito: String, utente: String, password: String): Pair<String, Boolean> {
        val json = leggi(ctx, chiave)
        val mem = json.optJSONArray("memoria") ?: JSONArray().also { json.put("memoria", it) }
        val ora = System.currentTimeMillis()
        for (i in 0 until mem.length()) {
            val m = mem.getJSONObject(i)
            if (m.optString("sito") == sito && m.optString("utente") == utente) {
                m.put("password", password).put("modificata", ora)
                scrivi(ctx, chiave, json)
                return Pair(m.getString("id"), true)
            }
        }
        val id = UUID.randomUUID().toString()
        mem.put(JSONObject().put("id", id).put("sito", sito).put("utente", utente).put("password", password)
            .put("creata", ora).put("modificata", ora))
        scrivi(ctx, chiave, json)
        return Pair(id, false)
    }

    /** Copia una voce di Memoria siti in Cassaforte come login. */
    @Synchronized
    fun mettiInCassaforte(ctx: Context, chiave: ByteArray, idMemoria: String, nome: String, note: String) {
        val json = leggi(ctx, chiave)
        val mem = json.optJSONArray("memoria") ?: return
        var m: JSONObject? = null
        for (i in 0 until mem.length()) if (mem.getJSONObject(i).optString("id") == idMemoria) m = mem.getJSONObject(i)
        val s = m ?: return
        val voci = json.optJSONArray("voci") ?: JSONArray().also { json.put("voci", it) }
        val ora = System.currentTimeMillis()
        val sito = s.optString("sito")
        voci.put(JSONObject()
            .put("id", UUID.randomUUID().toString()).put("tipo", "login")
            .put("titolo", nome.ifBlank { nomeDaSito(sito) }).put("cartella", "").put("fissata", false)
            .put("campi", JSONObject().put("utente", s.optString("utente")).put("password", s.optString("password")))
            .put("siti", JSONArray().put(sito)).put("note", note).put("totp", "")
            .put("creata", ora).put("modificata", ora).put("cestino", JSONObject.NULL))
        scrivi(ctx, chiave, json)
    }

    fun nomeDaSito(sito: String): String {
        val s = sito.removePrefix("android://").removePrefix("www.")
        val base = s.substringBefore('.')
        return base.replaceFirstChar { it.uppercase() }
    }

    // ---------- impronta (chiave nel Keystore, sbloccata solo con impronta o PIN del telefono) ----------
    private fun chiaveKeystore(crea: Boolean): SecretKey? {
        val ks = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        (ks.getKey(ALIAS_BIO, null) as? SecretKey)?.let { return it }
        if (!crea) return null
        val b = KeyGenParameterSpec.Builder(ALIAS_BIO, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
            .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
            .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
            .setKeySize(256)
            .setUserAuthenticationRequired(true)
            .setInvalidatedByBiometricEnrollment(true)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R)
            b.setUserAuthenticationParameters(0, KeyProperties.AUTH_BIOMETRIC_STRONG or KeyProperties.AUTH_DEVICE_CREDENTIAL)
        val g = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore")
        g.init(b.build())
        return g.generateKey()
    }

    fun improntaAttiva(ctx: Context): Boolean =
        ctx.getSharedPreferences(PREF, Context.MODE_PRIVATE).contains("dek") && chiaveKeystore(false) != null

    fun cipherPerCifrare(): Cipher {
        val c = Cipher.getInstance("AES/GCM/NoPadding")
        c.init(Cipher.ENCRYPT_MODE, chiaveKeystore(true))
        return c
    }

    fun cipherPerDecifrare(ctx: Context): Cipher? {
        val p = ctx.getSharedPreferences(PREF, Context.MODE_PRIVATE)
        val iv = Base64.decode(p.getString("iv", null) ?: return null, Base64.NO_WRAP)
        val k = chiaveKeystore(false) ?: return null
        val c = Cipher.getInstance("AES/GCM/NoPadding")
        c.init(Cipher.DECRYPT_MODE, k, GCMParameterSpec(128, iv))
        return c
    }

    fun salvaImpronta(ctx: Context, cipher: Cipher, chiave: ByteArray) {
        val ct = cipher.doFinal(chiave)
        ctx.getSharedPreferences(PREF, Context.MODE_PRIVATE).edit()
            .putString("iv", Base64.encodeToString(cipher.iv, Base64.NO_WRAP))
            .putString("dek", Base64.encodeToString(ct, Base64.NO_WRAP)).apply()
    }

    fun leggiImpronta(ctx: Context, cipher: Cipher): ByteArray {
        val p = ctx.getSharedPreferences(PREF, Context.MODE_PRIVATE)
        return cipher.doFinal(Base64.decode(p.getString("dek", ""), Base64.NO_WRAP))
    }

    // ---------- autocompilazione sempre pronta («deve essere come sul PC») ----------
    // Come l'estensione sul PC: la chiave dell'archivio resta cifrata con una chiave del Keystore che non esce dal
    // telefono e non chiede impronta; così Chrome e le app si compilano senza password principale. Non si blocca mai
    //: né il blocco automatico né il tasto «Blocca» dell'app la toccano.
    private const val ALIAS_AUTO = "digipass_autocompilazione"
    private const val PREF_AUTO = "digipass_autocompilazione"

    private fun chiaveAuto(crea: Boolean): SecretKey? {
        val ks = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        (ks.getKey(ALIAS_AUTO, null) as? SecretKey)?.let { return it }
        if (!crea) return null
        val g = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore")
        g.init(KeyGenParameterSpec.Builder(ALIAS_AUTO, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
            .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
            .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
            .setKeySize(256)
            .build())
        return g.generateKey()
    }

    fun salvaAutocompilazione(ctx: Context, chiave: ByteArray) {
        try {
            val c = Cipher.getInstance("AES/GCM/NoPadding")
            c.init(Cipher.ENCRYPT_MODE, chiaveAuto(true))
            val ct = c.doFinal(chiave)
            ctx.getSharedPreferences(PREF_AUTO, Context.MODE_PRIVATE).edit()
                .putString("iv", Base64.encodeToString(c.iv, Base64.NO_WRAP))
                .putString("dek", Base64.encodeToString(ct, Base64.NO_WRAP)).apply()
        } catch (_: Exception) { }
    }

    fun togliAutocompilazione(ctx: Context) {
        ctx.getSharedPreferences(PREF_AUTO, Context.MODE_PRIVATE).edit().clear().apply()
    }

    /** La chiave per l'autocompilazione: quella della sessione aperta, altrimenti quella conservata nel Keystore. */
    fun chiavePerAutocompilazione(ctx: Context): ByteArray? {
        chiaveValida()?.let { return it }
        return try {
            val p = ctx.getSharedPreferences(PREF_AUTO, Context.MODE_PRIVATE)
            val iv = Base64.decode(p.getString("iv", null) ?: return null, Base64.NO_WRAP)
            val ct = Base64.decode(p.getString("dek", null) ?: return null, Base64.NO_WRAP)
            val c = Cipher.getInstance("AES/GCM/NoPadding")
            c.init(Cipher.DECRYPT_MODE, chiaveAuto(false) ?: return null, GCMParameterSpec(128, iv))
            c.doFinal(ct)
        } catch (_: Exception) { null }
    }

    fun togliImpronta(ctx: Context) {
        ctx.getSharedPreferences(PREF, Context.MODE_PRIVATE).edit().clear().apply()
        try { KeyStore.getInstance("AndroidKeyStore").apply { load(null) }.deleteEntry(ALIAS_BIO) } catch (_: Exception) {}
    }
}

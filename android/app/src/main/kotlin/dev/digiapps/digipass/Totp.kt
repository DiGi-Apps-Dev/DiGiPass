package dev.digiapps.digipass

import android.net.Uri
import javax.crypto.Mac
import javax.crypto.spec.SecretKeySpec

/** Codice 2FA a tempo (RFC 6238) dal segreto base32 o dal link otpauth://, come lib/totp.dart. */
object Totp {
    private fun base32(s: String): ByteArray {
        val a = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567"
        var bits = 0; var v = 0
        val out = ArrayList<Byte>()
        for (ch in s.uppercase().filter { it != ' ' && it != '=' && it != '-' }) {
            val i = a.indexOf(ch); if (i < 0) throw IllegalArgumentException("2FA")
            v = (v shl 5) or i; bits += 5
            if (bits >= 8) { out.add(((v ushr (bits - 8)) and 255).toByte()); bits -= 8 }
        }
        return out.toByteArray()
    }

    fun codice(t: String, adesso: Long = System.currentTimeMillis()): String? = try {
        var segreto: ByteArray; var cifre = 6; var periodo = 30; var alg = "HmacSHA1"
        if (t.trim().startsWith("otpauth:", true)) {
            val u = Uri.parse(t.trim())
            segreto = base32(u.getQueryParameter("secret") ?: "")
            cifre = u.getQueryParameter("digits")?.toIntOrNull() ?: 6
            periodo = u.getQueryParameter("period")?.toIntOrNull() ?: 30
            alg = when ((u.getQueryParameter("algorithm") ?: "").uppercase()) { "SHA256" -> "HmacSHA256"; "SHA512" -> "HmacSHA512"; else -> "HmacSHA1" }
        } else segreto = base32(t.trim())
        if (segreto.isEmpty()) null else {
            val passo = adesso / 1000 / periodo
            val msg = ByteArray(8) { i -> ((passo ushr (56 - 8 * i)) and 0xff).toByte() }
            val mac = Mac.getInstance(alg).apply { init(SecretKeySpec(segreto, alg)) }
            val d = mac.doFinal(msg)
            val o = d[d.size - 1].toInt() and 15
            val n = ((d[o].toInt() and 127) shl 24) or ((d[o + 1].toInt() and 255) shl 16) or ((d[o + 2].toInt() and 255) shl 8) or (d[o + 3].toInt() and 255)
            var m = 1; repeat(cifre) { m *= 10 }
            (n % m).toString().padStart(cifre, '0')
        }
    } catch (_: Exception) { null }
}

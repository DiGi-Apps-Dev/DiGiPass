package dev.digiapps.digipass

import android.content.ClipData
import android.content.ClipDescription
import android.content.ClipboardManager
import android.content.Context
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.os.PersistableBundle
import org.json.JSONObject
import java.io.File

/** Copia negli appunti; i dati segreti spariscono dopo [secondi] se sono ancora lì (0 = mai, CHECKLIST 6.4). */
object Appunti {
    private val mano = Handler(Looper.getMainLooper())

    fun copia(ctx: Context, testo: String, segreto: Boolean, secondi: Int) {
        val cm = ctx.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
        val clip = ClipData.newPlainText("DiGiPass", testo)
        if (segreto && Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU)
            clip.description.extras = PersistableBundle().apply { putBoolean(ClipDescription.EXTRA_IS_SENSITIVE, true) }
        cm.setPrimaryClip(clip)
        if (segreto && secondi > 0) mano.postDelayed({
            try {
                // In sottofondo Android non lascia leggere gli appunti (ora == null): si svuotano comunque.
                val ora = try { cm.primaryClip?.getItemAt(0)?.text?.toString() } catch (_: Exception) { null }
                if (ora == null || ora == testo) {
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) cm.clearPrimaryClip()
                    else cm.setPrimaryClip(ClipData.newPlainText("", ""))
                }
            } catch (_: Exception) {}
        }, secondi * 1000L)
    }
}

/** Impostazioni dell'app (impostazioni.json, scritto dalla parte Flutter, non segreto) lette dalla parte Android. */
class Preferenze(val appuntiSecondi: Int, val copiaTotp: Boolean, val tastiera: Boolean, val collegaApp: Boolean) {
    companion object {
        fun leggi(ctx: Context): Preferenze {
            val j = try { JSONObject(File(ctx.filesDir, "impostazioni.json").readText()) } catch (_: Exception) { JSONObject() }
            return Preferenze(
                j.optInt("appuntiSecondi", 60),
                j.optBoolean("copiaTotp", true),
                j.optBoolean("tastiera", false),
                j.optBoolean("collegaApp", true),
            )
        }
    }
}

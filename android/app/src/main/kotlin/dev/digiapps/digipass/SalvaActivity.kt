package dev.digiapps.digipass

import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.os.Bundle
import android.text.InputType
import android.util.TypedValue
import android.view.Gravity
import android.view.ViewGroup.LayoutParams.MATCH_PARENT
import android.view.ViewGroup.LayoutParams.WRAP_CONTENT
import android.view.WindowManager
import android.widget.Button
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.TextView
import android.widget.Toast
import androidx.fragment.app.FragmentActivity

/**
 * Dopo un accesso nuovo: il sito va da solo in Memoria siti; qui si può anche mettere in cassaforte (nome e note a scelta).
 */
class SalvaActivity : FragmentActivity() {
    private val g0 = Color.parseColor("#141317")
    private val g1 = Color.parseColor("#1C1B20")
    private val g2 = Color.parseColor("#25242B")
    private val ink = Color.parseColor("#F6F4F8")
    private val filo = Color.parseColor("#24FFFFFF")

    override fun onCreate(savedInstanceState: Bundle?) {
        window.setFlags(WindowManager.LayoutParams.FLAG_SECURE, WindowManager.LayoutParams.FLAG_SECURE)
        super.onCreate(savedInstanceState)
        val sito = intent.getStringExtra("sito") ?: ""
        val utente = intent.getStringExtra("utente") ?: ""
        val password = intent.getStringExtra("password") ?: ""
        if (sito.isBlank() || password.isBlank()) { finish(); return }
        Impronta.sblocca(this, { dek ->
            try {
                val (id, aggiornato) = Cassaforte.salvaInMemoria(this, dek, sito, utente, password)
                mostra(dek, id, sito, utente, aggiornato)
            } catch (e: Exception) {
                Toast.makeText(this, "Salvataggio non riuscito", Toast.LENGTH_LONG).show(); finish()
            }
        }, { m -> Toast.makeText(this, "Non salvato: $m", Toast.LENGTH_LONG).show(); finish() })
    }

    private fun dp(v: Int) = TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, v.toFloat(), resources.displayMetrics).toInt()

    private fun testo(t: String, size: Float, bold: Boolean = false) = TextView(this).apply {
        text = t; setTextColor(ink); setTextSize(TypedValue.COMPLEX_UNIT_SP, size)
        if (bold) typeface = Typeface.DEFAULT_BOLD
    }

    private fun campo(etichetta: String, valore: String) = EditText(this).apply {
        hint = etichetta; setText(valore); setTextColor(ink); setHintTextColor(ink)
        inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_FLAG_CAP_SENTENCES
        background = GradientDrawable().apply { setColor(g1); cornerRadius = dp(8).toFloat(); setStroke(dp(1), filo) }
        setPadding(dp(12), dp(12), dp(12), dp(12))
    }

    private fun pulsante(t: String, pieno: Boolean) = Button(this).apply {
        text = t; isAllCaps = false; setTextColor(Color.WHITE); setTextSize(TypedValue.COMPLEX_UNIT_SP, 16f)
        background = if (pieno) GradientDrawable(GradientDrawable.Orientation.LEFT_RIGHT,
            intArrayOf(Color.parseColor("#E0306A"), Color.parseColor("#B52E8C"), Color.parseColor("#8A2BA8"))).apply { cornerRadius = dp(8).toFloat() }
        else GradientDrawable().apply { setColor(g2); cornerRadius = dp(8).toFloat(); setStroke(dp(1), filo) }
        if (!pieno) setTextColor(ink)
    }

    private fun mostra(dek: ByteArray, id: String, sito: String, utente: String, aggiornato: Boolean) {
        val radice = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL; setBackgroundColor(g0); gravity = Gravity.BOTTOM
            setPadding(dp(18), dp(24), dp(18), dp(24))
        }
        val scheda = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            background = GradientDrawable().apply { setColor(g1); cornerRadius = dp(14).toFloat(); setStroke(dp(1), filo) }
            setPadding(dp(16), dp(18), dp(16), dp(18))
        }
        fun add(v: android.view.View, sopra: Int = 10) {
            scheda.addView(v, LinearLayout.LayoutParams(MATCH_PARENT, WRAP_CONTENT).apply { topMargin = dp(sopra) })
        }
        add(testo(if (aggiornato) "✓ Password aggiornata in Memoria siti" else "✓ Salvato in Memoria siti", 15f, true), 0)
        add(testo(sito.removePrefix("android://"), 20f, true))
        add(testo(utente.ifBlank { "senza nome utente" } + " · password salvata", 15f), 4)
        add(testo("VUOI TENERLO ANCHE IN CASSAFORTE?", 17f, true), 18)
        val nome = campo("Nome", Cassaforte.nomeDaSito(sito)); add(nome)
        val note = campo("Note (facoltative)", ""); add(note)
        val metti = pulsante("Metti in cassaforte", true); add(metti, 14)
        val no = pulsante("No, basta Memoria siti", false); add(no)
        metti.setOnClickListener {
            try {
                Cassaforte.mettiInCassaforte(this, dek, id, nome.text.toString().trim(), note.text.toString().trim())
                Toast.makeText(this, "Messo in cassaforte", Toast.LENGTH_SHORT).show()
            } catch (e: Exception) { Toast.makeText(this, "Non riuscito", Toast.LENGTH_LONG).show() }
            finish()
        }
        no.setOnClickListener { finish() }
        radice.addView(scheda, LinearLayout.LayoutParams(MATCH_PARENT, WRAP_CONTENT))
        setContentView(radice)
    }
}

package dev.digiapps.digipass

import android.app.Activity
import android.content.Intent
import android.os.Bundle
import android.view.WindowManager
import android.view.autofill.AutofillManager
import android.widget.Toast
import androidx.fragment.app.FragmentActivity

/** Si apre dalla riga «Sblocca DiGiPass» nel campo di un'app: impronta, poi i suggerimenti. */
class SbloccaAutofillActivity : FragmentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        window.setFlags(WindowManager.LayoutParams.FLAG_SECURE, WindowManager.LayoutParams.FLAG_SECURE)
        super.onCreate(savedInstanceState)
        val s = DigiPassAutofill.struttura(intent)
        if (s == null) { finish(); return }
        Impronta.sblocca(this, { dek ->
            try {
                val c = Campi.leggi(s)
                val r = DigiPassAutofill.risposta(this, c, Cassaforte.leggi(this, dek))
                if (r == null) {
                    Toast.makeText(this, "Nessun login salvato per questo sito", Toast.LENGTH_SHORT).show()
                    setResult(Activity.RESULT_CANCELED)
                } else setResult(Activity.RESULT_OK, Intent().putExtra(AutofillManager.EXTRA_AUTHENTICATION_RESULT, r))
            } catch (e: Exception) { setResult(Activity.RESULT_CANCELED) }
            finish()
        }, { m ->
            Toast.makeText(this, m, Toast.LENGTH_LONG).show()
            setResult(Activity.RESULT_CANCELED); finish()
        })
    }
}

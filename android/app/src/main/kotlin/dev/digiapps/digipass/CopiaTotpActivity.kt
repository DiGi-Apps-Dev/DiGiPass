package dev.digiapps.digipass

import android.app.Activity
import android.content.Intent
import android.os.Build
import android.os.Bundle
import android.service.autofill.Dataset
import android.view.WindowManager
import android.view.autofill.AutofillId
import android.view.autofill.AutofillManager
import android.view.autofill.AutofillValue
import android.widget.Toast

/**
 * Login col 2FA scelto nella tendina (CHECKLIST 4.3): copia il codice a tempo negli appunti e compila utente e password.
 * Non chiede niente e non si vede: un attimo e si chiude.
 */
class CopiaTotpActivity : Activity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        window.setFlags(WindowManager.LayoutParams.FLAG_SECURE, WindowManager.LayoutParams.FLAG_SECURE)
        super.onCreate(savedInstanceState)
        val utente = intent.getStringExtra("utente") ?: ""
        val password = intent.getStringExtra("password") ?: ""
        val titolo = intent.getStringExtra("titolo") ?: "DiGiPass"
        val idUtente = id("idUtente")
        val idPassword = id("idPassword")
        val codice = Totp.codice(intent.getStringExtra("totp") ?: "")
        if (codice != null) {
            Appunti.copia(this, codice, true, Preferenze.leggi(this).appuntiSecondi)
            Toast.makeText(this, "Codice 2FA copiato", Toast.LENGTH_SHORT).show()
        }
        val vista = DigiPassAutofill.riga(this, titolo, utente)
        val d = Dataset.Builder()
        idUtente?.let { d.setValue(it, AutofillValue.forText(utente), vista) }
        idPassword?.let { d.setValue(it, AutofillValue.forText(password), vista) }
        if (idUtente != null || idPassword != null)
            setResult(RESULT_OK, Intent().putExtra(AutofillManager.EXTRA_AUTHENTICATION_RESULT, d.build()))
        else setResult(RESULT_CANCELED)
        finish()
    }

    private fun id(nome: String): AutofillId? =
        if (Build.VERSION.SDK_INT >= 33) intent.getParcelableExtra(nome, AutofillId::class.java)
        else @Suppress("DEPRECATION") intent.getParcelableExtra(nome)
}

package dev.digiapps.digipass

import android.app.assist.AssistStructure
import android.text.InputType
import android.view.View
import android.view.autofill.AutofillId
import android.view.autofill.AutofillValue
import org.json.JSONObject

/** Campi di accesso (e di carta di credito) trovati in una schermata (app o pagina web). */
class Campi {
    var utente: AutofillId? = null
    var password: AutofillId? = null
    var valoreUtente: String = ""
    var valorePassword: String = ""
    var dominio: String = ""
    var porta: String = ""
    var pacchetto: String = ""

    // Carta di credito (compilazione delle carte in Chrome e nelle app).
    class CampoCarta(val id: AutofillId, val lista: Array<CharSequence>?, val lunghezza: Int)
    var numero: CampoCarta? = null
    var scadenza: CampoCarta? = null
    var mese: CampoCarta? = null
    var anno: CampoCarta? = null
    var cvv: CampoCarta? = null
    var titolare: CampoCarta? = null
    private val campiCarta get() = listOfNotNull(numero, scadenza, mese, anno, cvv, titolare)
    val carta: Boolean get() = numero != null

    // Identità (CHECKLIST 5.1): nome, cognome, email, telefono, indirizzo… nei moduli senza password.
    val identita = LinkedHashMap<String, CampoCarta>()
    /** Modulo di dati personali: almeno 2 campi d'identità, uno dei quali non è email o telefono, e nessuna password. */
    val perIdentita: Boolean get() = password == null && identita.size >= 2 && identita.keys.any { it != "email" && it != "telefono" }

    val ids: Array<AutofillId> get() = (listOfNotNull(utente, password) + (if (carta) campiCarta.map { it.id } else emptyList()) +
        (if (perIdentita) identita.values.map { it.id } else emptyList())).distinct().toTypedArray()
    val vuoto: Boolean get() = password == null && utente == null && !carta && !perIdentita

    /** Come si salva il sito: dominio web, altrimenti l'app. */
    val sito: String get() = if (dominio.isNotBlank()) dominio else "android://$pacchetto"

    companion object {
        private val PAROLE_UTENTE = listOf("user", "email", "e-mail", "mail", "login", "utente", "account", "username", "benutzer", "identifiant")
        private val PAROLE_PASS = listOf("pass", "pwd", "password", "kennwort", "mot de passe", "passwort")

        fun leggi(s: AssistStructure): Campi {
            val c = Campi()
            c.pacchetto = s.activityComponent?.packageName ?: ""
            for (i in 0 until s.windowNodeCount) visita(s.getWindowNodeAt(i).rootViewNode, c)
            // Porta della pagina, se il browser la dà (es. «localhost:8765»): serve per gli indirizzi locali.
            c.porta = c.dominio.trim().substringAfter("://").substringBefore('/').substringAfter(':', "")
            c.dominio = pulisciDominio(c.dominio)
            return c
        }

        private fun visita(n: AssistStructure.ViewNode, c: Campi) {
            if (!n.webDomain.isNullOrBlank() && c.dominio.isBlank()) c.dominio = n.webDomain!!
            val id = n.autofillId
            if (id != null && n.visibility == View.VISIBLE && (n.autofillType == View.AUTOFILL_TYPE_TEXT || n.autofillType == View.AUTOFILL_TYPE_LIST)) {
                val cc = tipoCarta(n)
                if (cc != null) {
                    val campo = CampoCarta(id, if (n.autofillType == View.AUTOFILL_TYPE_LIST) n.autofillOptions else null, n.maxTextLength)
                    when (cc) {
                        "numero" -> if (c.numero == null) c.numero = campo
                        "scadenza" -> if (c.scadenza == null) c.scadenza = campo
                        "mese" -> if (c.mese == null) c.mese = campo
                        "anno" -> if (c.anno == null) c.anno = campo
                        "cvv" -> if (c.cvv == null) c.cvv = campo
                        "titolare" -> if (c.titolare == null) c.titolare = campo
                    }
                } else {
                    val ci = tipoIdentita(n)
                    if (ci != null && !c.identita.containsKey(ci))
                        c.identita[ci] = CampoCarta(id, if (n.autofillType == View.AUTOFILL_TYPE_LIST) n.autofillOptions else null, n.maxTextLength)
                    if (n.autofillType == View.AUTOFILL_TYPE_TEXT) when (tipo(n)) {
                        "password" -> if (c.password == null) { c.password = id; c.valorePassword = n.autofillValue?.textValue?.toString() ?: "" }
                        "utente" -> if (c.utente == null && (ci == null || ci == "email" || ci == "telefono")) { c.utente = id; c.valoreUtente = n.autofillValue?.textValue?.toString() ?: "" }
                    }
                }
            }
            for (i in 0 until n.childCount) visita(n.getChildAt(i), c)
        }

        private fun tipo(n: AssistStructure.ViewNode): String? {
            n.autofillHints?.forEach { h ->
                val l = h.lowercase()
                if (l.contains("password")) return "password"
                if (l.contains("username") || l.contains("email") || l.contains("phone")) return "utente"
            }
            val cls = n.inputType and InputType.TYPE_MASK_CLASS
            val varr = n.inputType and InputType.TYPE_MASK_VARIATION
            if (cls == InputType.TYPE_CLASS_TEXT && (varr == InputType.TYPE_TEXT_VARIATION_PASSWORD ||
                        varr == InputType.TYPE_TEXT_VARIATION_WEB_PASSWORD || varr == InputType.TYPE_TEXT_VARIATION_VISIBLE_PASSWORD)) return "password"
            if (cls == InputType.TYPE_CLASS_NUMBER && varr == InputType.TYPE_NUMBER_VARIATION_PASSWORD) return "password"
            n.htmlInfo?.attributes?.forEach { a ->
                if (a.first.equals("type", true) && a.second.equals("password", true)) return "password"
                if (a.first.equals("type", true) && a.second.equals("email", true)) return "utente"
            }
            if (cls == InputType.TYPE_CLASS_TEXT && varr == InputType.TYPE_TEXT_VARIATION_EMAIL_ADDRESS) return "utente"
            val testo = listOfNotNull(n.idEntry, n.hint, n.htmlInfo?.attributes?.firstOrNull { it.first.equals("name", true) }?.second)
                .joinToString(" ").lowercase()
            if (PAROLE_PASS.any { testo.contains(it) }) return "password"
            if (PAROLE_UTENTE.any { testo.contains(it) }) return "utente"
            return null
        }

        /** Campo di carta di credito: dai suggerimenti dell'app, dall'autocomplete della pagina (cc-*) o dal nome. */
        private fun tipoCarta(n: AssistStructure.ViewNode): String? {
            val segni = mutableListOf<String>()
            n.autofillHints?.forEach { segni.add(it.lowercase()) }
            n.htmlInfo?.attributes?.forEach { if (it.first.equals("autocomplete", true)) segni.add(it.second.lowercase()) }
            for (s in segni) {
                for (t0 in s.split(' ')) {
                    val t = t0.replace("_", "").replace("-", "")
                    when {
                        t.contains("creditcardnumber") || t == "ccnumber" -> return "numero"
                        t.contains("creditcardsecuritycode") || t == "cccsc" -> return "cvv"
                        t.contains("creditcardexpirationmonth") || t == "ccexpmonth" -> return "mese"
                        t.contains("creditcardexpirationyear") || t == "ccexpyear" -> return "anno"
                        t.contains("creditcardexpirationdate") || t == "ccexp" -> return "scadenza"
                        t == "ccname" || t.contains("creditcardholder") -> return "titolare"
                    }
                }
            }
            val testo = listOfNotNull(n.idEntry, n.hint, n.htmlInfo?.attributes?.firstOrNull { it.first.equals("name", true) }?.second,
                n.htmlInfo?.attributes?.firstOrNull { it.first.equals("id", true) }?.second)
                .joinToString(" ").lowercase().replace("_", "").replace("-", "")
            if (testo.isBlank()) return null
            return when {
                listOf("cardnumber", "ccnumber", "ccnum", "numerocarta", "numero carta", "kartennummer").any { testo.contains(it) } -> "numero"
                listOf("cvv", "cvc", "csc", "securitycode", "codice di sicurezza", "codicesicurezza").any { testo.contains(it) } -> "cvv"
                listOf("cardholder", "nameoncard", "holdername", "ccname", "titolare", "intestatario", "karteninhaber").any { testo.contains(it) } -> "titolare"
                listOf("expmonth", "expirymonth", "expirationmonth", "mesescadenza", "ccmonth").any { testo.contains(it) } -> "mese"
                listOf("expyear", "expiryyear", "expirationyear", "annoscadenza", "ccyear").any { testo.contains(it) } -> "anno"
                listOf("expiry", "expiration", "expdate", "scadenza", "ablaufdatum", "ccexp").any { testo.contains(it) } -> "scadenza"
                else -> null
            }
        }

        /** Campo di un modulo di dati personali: chiave della voce Identità che ci va dentro. */
        private fun tipoIdentita(n: AssistStructure.ViewNode): String? {
            val segni = mutableListOf<String>()
            n.autofillHints?.forEach { segni.add(it.lowercase()) }
            n.htmlInfo?.attributes?.forEach { if (it.first.equals("autocomplete", true)) segni.addAll(it.second.lowercase().split(' ')) }
            for (s in segni) when (s.replace("_", "").replace("-", "")) {
                "givenname", "persongivenname", "fname", "firstname" -> return "nome"
                "familyname", "personfamilyname", "lname", "lastname" -> return "cognome"
                "additionalname", "personmiddlename" -> return "secondoNome"
                "name", "personname" -> return "nomeCompleto"
                "email", "emailaddress" -> return "email"
                "tel", "phone", "phonenumber", "telnational" -> return "telefono"
                "streetaddress", "addressline1", "postaladdress" -> return "indirizzo"
                "postalcode" -> return "cap"
                "addresslevel2", "addresslocality" -> return "citta"
                "addresslevel1", "addressregion" -> return "provincia"
                "country", "countryname", "addresscountry" -> return "paese"
                "organization" -> return "organizzazione"
                "bday", "birthdatefull" -> return "nascita"
            }
            val t = listOfNotNull(n.idEntry, n.hint, n.htmlInfo?.attributes?.firstOrNull { it.first.equals("name", true) }?.second,
                n.htmlInfo?.attributes?.firstOrNull { it.first.equals("id", true) }?.second)
                .joinToString(" ").lowercase().replace("_", "").replace("-", "")
            if (t.isBlank()) return null
            return when {
                listOf("firstname", "givenname", "vorname", "prénom", "prenom").any { t.contains(it) } || Regex("(^|\\s)nome(\\s|$)").containsMatchIn(t) -> "nome"
                listOf("lastname", "surname", "familyname", "cognome", "nachname").any { t.contains(it) } -> "cognome"
                listOf("fullname", "nomecompleto").any { t.contains(it) } -> "nomeCompleto"
                listOf("postcode", "postalcode", "zipcode", "zip", "plz", "codicepostale").any { t.contains(it) } || Regex("(^|\\s)cap(\\s|$)").containsMatchIn(t) -> "cap"
                listOf("city", "citta", "città", "comune", "town", "ort", "localita", "località").any { t.contains(it) } -> "citta"
                listOf("street", "indirizzo", "address1", "addressline", "strasse", "straße").any { t.contains(it) } || Regex("(^|\\s)via(\\s|$)").containsMatchIn(t) -> "indirizzo"
                listOf("province", "provincia", "region", "state", "kanton").any { t.contains(it) } -> "provincia"
                listOf("country", "paese", "nazione", "land").any { t.contains(it) } -> "paese"
                listOf("company", "azienda", "organization", "organizzazione", "ditta", "firma").any { t.contains(it) } -> "organizzazione"
                listOf("phone", "telefono", "mobile", "cellulare", "handy").any { t.contains(it) } -> "telefono"
                listOf("email", "e mail", "mail").any { t.contains(it) } -> "email"
                else -> null
            }
        }

        /** Identità della Cassaforte (non nel cestino). */
        fun identita(json: JSONObject): List<JSONObject> {
            val out = mutableListOf<JSONObject>()
            val voci = json.optJSONArray("voci") ?: return out
            for (i in 0 until voci.length()) {
                val v = voci.getJSONObject(i)
                if (v.optString("tipo") == "identita" && (!v.has("cestino") || v.isNull("cestino"))) out.add(v)
            }
            return out
        }

        /** Tipo della carta dal numero (solo per mostrarlo nella tendina). */
        fun tipoDaNumero(numero: String): String {
            val d = numero.filter { it.isDigit() }
            if (d.isEmpty()) return "Carta"
            val p2 = d.take(2).toIntOrNull() ?: 0
            val p3 = d.take(3).toIntOrNull() ?: 0
            val p4 = d.take(4).toIntOrNull() ?: 0
            return when {
                d.startsWith("4") -> "Visa"
                p2 in 51..55 || p4 in 2221..2720 -> "Mastercard"
                p2 == 34 || p2 == 37 -> "Amex"
                p4 == 6011 || p2 == 65 || p3 in 644..649 -> "Discover"
                p4 in 3528..3589 -> "JCB"
                p2 == 36 || p2 == 38 || p3 in 300..305 -> "Diners"
                p2 == 62 -> "UnionPay"
                p2 == 50 || p2 in 56..69 -> "Maestro"
                else -> "Carta"
            }
        }

        /** Valore da mettere in un campo della carta (testo o voce di un elenco a tendina). */
        fun valore(campo: CampoCarta, testo: String, varianti: List<String>): AutofillValue? {
            val l = campo.lista
            if (l != null) {
                for (v in varianti) for (i in l.indices) if (l[i].toString().trim().equals(v, true)) return AutofillValue.forList(i)
                for (v in varianti) for (i in l.indices) if (v.isNotBlank() && l[i].toString().trim().endsWith(v)) return AutofillValue.forList(i)
                return null
            }
            return if (testo.isBlank()) null else AutofillValue.forText(testo)
        }

        /** Carte della Cassaforte (non nel cestino) con un numero. */
        fun carte(json: JSONObject): List<JSONObject> {
            val out = mutableListOf<JSONObject>()
            val voci = json.optJSONArray("voci") ?: return out
            for (i in 0 until voci.length()) {
                val v = voci.getJSONObject(i)
                if (v.optString("tipo") != "carta" || (v.has("cestino") && !v.isNull("cestino"))) continue
                if (v.optJSONObject("campi")?.optString("numero").isNullOrBlank()) continue
                out.add(v)
            }
            return out
        }

        fun pulisciDominio(d: String): String = d.lowercase().trim().removePrefix("www.").substringBefore('/').substringBefore(':')

        /** Il sito salvato corrisponde a questa schermata? */
        fun corrisponde(salvato: String, c: Campi): Boolean {
            val s = salvato.lowercase().trim()
            if (s.startsWith("android://")) return c.dominio.isBlank() && s.removePrefix("android://") == c.pacchetto
            if (c.dominio.isBlank()) return false
            val d = pulisciDominio(s.substringAfter("://"))
            // Indirizzi locali (IP o localhost): come nell'estensione conta anche la porta, esatta, quando il browser la dà
            // (prova sul telefono, 12.11.2026: su localhost:8765 comparivano le voci di localhost:20128).
            if (c.porta.isNotBlank() && (c.dominio == "localhost" || c.dominio.matches(Regex("[0-9.]+")))) {
                val p = s.substringAfter("://").substringBefore('/').substringAfter(':', "")
                return d == c.dominio && p == c.porta
            }
            return d.isNotBlank() && (c.dominio == d || c.dominio.endsWith(".$d") || d.endsWith(".${c.dominio}"))
        }

        class Suggerimento(val titolo: String, val utente: String, val password: String, val totp: String)

        /**
         * Login della Cassaforte e poi di Memoria siti che vanno bene per questa schermata. [collegato] dice se un sito
         * è dichiarato dall'app (Digital Asset Links): serve solo nelle app, mai nelle pagine web.
         */
        fun suggerimenti(json: JSONObject, c: Campi, collegato: ((String) -> Boolean)? = null): List<Suggerimento> {
            val out = mutableListOf<Suggerimento>()
            fun vale(sito: String): Boolean =
                corrisponde(sito, c) || (collegato != null && c.dominio.isBlank() && c.pacchetto.isNotBlank() && !sito.startsWith("android://") &&
                    pulisciDominio(sito.substringAfter("://")).let { d -> d.isNotBlank() && SitiApp.candidato(d, c.pacchetto) && collegato(d) })
            val voci = json.optJSONArray("voci")
            if (voci != null) for (i in 0 until voci.length()) {
                val v = voci.getJSONObject(i)
                if (v.optString("tipo") != "login" || !v.isNull("cestino") && v.has("cestino")) continue
                val siti = v.optJSONArray("siti") ?: continue
                var ok = false
                for (k in 0 until siti.length()) if (!ok && vale(siti.getString(k))) ok = true
                if (!ok) continue
                val campi = v.optJSONObject("campi") ?: JSONObject()
                val utente = campi.optString("utente").ifBlank { campi.optString("email") }
                out.add(Suggerimento("Cassaforte · " + v.optString("titolo"), utente, campi.optString("password"), v.optString("totp")))
            }
            val mem = json.optJSONArray("memoria")
            if (mem != null) for (i in 0 until mem.length()) {
                val m = mem.getJSONObject(i)
                if (!vale(m.optString("sito"))) continue
                if (out.any { it.utente == m.optString("utente") && it.password == m.optString("password") }) continue
                out.add(Suggerimento("Memoria siti · " + m.optString("sito").removePrefix("android://"), m.optString("utente"), m.optString("password"), ""))
            }
            return out.take(8)
        }
    }
}

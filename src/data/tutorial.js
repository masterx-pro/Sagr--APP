// Tutorial slideshow per ruolo. Una slide = { id, immagine, titolo, descrizione, evidenzia }
// - immagine: path relativo a /public (es. '/guida/cam-01-...'); null → placeholder
// - evidenzia: { x, y, raggio } in % sull'immagine, oppure null
// Testi derivati da docs/GUIDA_UTENTE.md, condensati a max 2 righe.

const slidesCameriere = [
  {
    id: 'cam-01',
    immagine: '/guida/cam-01-lista-tavoli.png',
    titolo: 'Benvenuto! 👋',
    descrizione: 'Questa è la tua lista tavoli. Ogni card è un tavolo aperto. Il pulsante "+ Nuovo Tavolo" è sempre in cima.',
    evidenzia: null,
  },
  {
    id: 'cam-02',
    immagine: '/guida/cam-02-lista-tavoli-attivi.png',
    titolo: 'Tavoli attivi',
    descrizione: 'I tavoli sono raggruppati per stato: 🟢 Pronti da portare, 🟡 In preparazione, 💵 In attesa cassa, ⚠️ Stornati.',
    evidenzia: null,
  },
  {
    id: 'cam-03',
    immagine: '/guida/cam-03-nuovo-tavolo-form.png',
    titolo: 'Apri un nuovo tavolo',
    descrizione: 'Inserisci numero tavolo, quante persone (max 30) e il nome del capotavola.',
    evidenzia: null,
  },
  {
    id: 'cam-04',
    immagine: '/guida/cam-04-menu-m1-cucina.png',
    titolo: 'Menu Cucina — M1',
    descrizione: 'M1 = prima mandata: antipasti. Tappa + sulla riga per aggiungere, − per togliere.',
    evidenzia: null,
  },
  {
    id: 'cam-05',
    immagine: '/guida/cam-05-menu-m1-bar.png',
    titolo: 'Menu Bar — M1',
    descrizione: 'Cambia tab "Bar" in alto e aggiungi acqua e vino. Restano nella stessa mandata M1.',
    evidenzia: null,
  },
  {
    id: 'cam-06',
    immagine: '/guida/cam-06-menu-m2.png',
    titolo: 'M2 = Primi',
    descrizione: 'Passa al tab M2 per i primi. Le mandate si servono in ordine: M1 → M2 → M3 → M4.',
    evidenzia: null,
  },
  {
    id: 'cam-07',
    immagine: '/guida/cam-07-scelta-pagamento.png',
    titolo: 'Scelta pagamento',
    descrizione: '💳 Bancomat → l\'ordine parte subito. 💵 Contanti → il cliente passa dalla cassa.',
    evidenzia: null,
  },
  {
    id: 'cam-08',
    immagine: '/guida/cam-08-ordine-inviato.png',
    titolo: 'Ordine inviato',
    descrizione: 'Torni alla lista. La card del tavolo è ora visibile in "🟡 In preparazione".',
    evidenzia: null,
  },
  {
    id: 'cam-09',
    immagine: '/guida/cam-09-card-in-preparazione.png',
    titolo: 'Stato delle mandate',
    descrizione: 'I pallini M1 ⏳ M2 ⏳ M3 ⏳ ti dicono lo stato di ogni mandata in cucina e al bar.',
    evidenzia: null,
  },
  {
    id: 'cam-10',
    immagine: '/guida/cam-10-card-pronta.png',
    titolo: 'Pronta da portare!',
    descrizione: 'Card verde 🟢 con bordo lampeggiante = una mandata è pronta al pass. Vai a prenderla.',
    evidenzia: null,
  },
  {
    id: 'cam-11',
    immagine: '/guida/cam-11-dettaglio-ordine.png',
    titolo: 'Dettaglio ordine',
    descrizione: 'Tappa la card per vedere tutti i piatti, marcare le mandate come consegnate, stornare o aggiungere.',
    evidenzia: null,
  },
  {
    id: 'cam-12',
    immagine: '/guida/cam-12-pulsante-invia-m4.png',
    titolo: 'Invia M4 — Dolci e caffè',
    descrizione: 'Quando il tavolo è pronto per il dolce, premi questo pulsante giallo. Senza, M4 NON parte.',
    evidenzia: { x: 50, y: 88, raggio: 30 },
  },
  {
    id: 'cam-13',
    immagine: '/guida/cam-13-card-pulsante-riordino.png',
    titolo: "+ Aggiungi all'ordine",
    descrizione: 'Cliente vuole una bottiglia in più? Tappa il pulsante azzurro sulla card del suo tavolo.',
    evidenzia: { x: 86, y: 88, raggio: 16 },
  },
  {
    id: 'cam-14',
    immagine: '/guida/cam-14-riordino-lista-menu.png',
    titolo: "Aggiungi all'ordine — lista menu",
    descrizione: 'Tutto il menu in una lista unica (cucina e bar). Scorri o usa la barra di ricerca.',
    evidenzia: null,
  },
  {
    id: 'cam-15',
    immagine: '/guida/cam-15-riordino-cerca.png',
    titolo: 'Cerca rapida',
    descrizione: 'Digita "acqua", "caffè" o un nome qualsiasi per filtrare. Risparmi tempo.',
    evidenzia: null,
  },
  {
    id: 'cam-16',
    immagine: '/guida/cam-16-riordino-pagamento.png',
    titolo: "Pagamento dell'aggiunta",
    descrizione: 'Stesso flusso di un normale ordine: scegli Bancomat o Contanti.',
    evidenzia: null,
  },
  {
    id: 'cam-17',
    immagine: '/guida/cam-17-riordino-confermato.png',
    titolo: 'Aggiunta inviata',
    descrizione: 'Il riordino parte subito a cucina/bar con il nome del cliente + "(riordino)".',
    evidenzia: null,
  },
]

const slidesBar = [
  {
    id: 'bar-01',
    immagine: '/guida/bar-01-ordine-arrivato.png',
    titolo: 'Benvenuto al Bar! 🍺',
    descrizione: 'Ogni card è un tavolo. Le mandate bar (M1, M2…) non sono bloccate: puoi gestirle in parallelo.',
    evidenzia: null,
  },
  {
    id: 'bar-02',
    immagine: '/guida/bar-02-in-preparazione.png',
    titolo: 'Da preparare → In preparazione',
    descrizione: 'Premi il pulsante blu quando inizi a preparare la mandata. Diventa arancione "In preparazione".',
    evidenzia: null,
  },
  {
    id: 'bar-03',
    immagine: '/guida/bar-03-pronto-swipe.png',
    titolo: 'Pronto + swipe',
    descrizione: 'Quando hai finito, premi Pronto. Poi trascina via la card o tocca la ✕ per pulire la schermata.',
    evidenzia: null,
  },
  {
    id: 'bar-04',
    immagine: '/guida/bar-04-m4-bloccata.png',
    titolo: 'M4 bloccata',
    descrizione: 'Caffè, amari e dolci NON appaiono finché il cameriere non preme "Invia M4". È normale.',
    evidenzia: null,
  },
  {
    id: 'bar-05',
    immagine: '/guida/bar-05-m4-sbloccata.png',
    titolo: 'M4 sbloccata!',
    descrizione: 'Quando il cameriere invia M4, le voci appaiono come una nuova mandata da preparare.',
    evidenzia: null,
  },
  {
    id: 'bar-06',
    immagine: '/guida/bar-06-riordino-al-bar.png',
    titolo: 'Riordini in arrivo',
    descrizione: 'Card con nome + "(riordino)" = aggiunta a un tavolo già seduto. Stesso flusso, tutto in M1.',
    evidenzia: null,
  },
]

const slidesCucina = [
  {
    id: 'cuc-01',
    immagine: '/guida/cuc-02-ordine-arrivato.png',
    titolo: 'Benvenuto in Cucina! 🍳',
    descrizione: 'Ogni card è un tavolo con le mandate M1, M2, M3. Le mandate si attivano una dopo l\'altra.',
    evidenzia: null,
  },
  {
    id: 'cuc-02',
    immagine: '/guida/cuc-03-in-preparazione.png',
    titolo: 'Da preparare → In preparazione',
    descrizione: 'Premi il pulsante blu quando inizi a impiattare. Il colore cambia in arancione.',
    evidenzia: null,
  },
  {
    id: 'cuc-03',
    immagine: '/guida/cuc-04-pronto.png',
    titolo: 'Pronto al pass',
    descrizione: 'Premi Pronto quando il piatto è pronto da prendere. Diventa verde e si sblocca la mandata dopo.',
    evidenzia: null,
  },
  {
    id: 'cuc-04',
    immagine: '/guida/cuc-05-m2-bloccata.png',
    titolo: 'M2 bloccata in attesa',
    descrizione: 'La M2 resta grigia finché la M1 non è "Pronta". Garantisce l\'ordine: prima i primi, poi i secondi.',
    evidenzia: null,
  },
  {
    id: 'cuc-05',
    immagine: '/guida/cuc-06-m2-sbloccata.png',
    titolo: 'M2 attiva!',
    descrizione: 'Appena segni "Pronta" la M1, la M2 si sblocca e diventa "Da preparare".',
    evidenzia: null,
  },
  {
    id: 'cuc-06',
    immagine: '/guida/cuc-07-aggregato.png',
    titolo: 'Vista Aggregata',
    descrizione: 'Modalità per cucinare a lotti: vedi quanti pezzi di ogni piatto servono in totale, su tutti i tavoli.',
    evidenzia: null,
  },
  {
    id: 'cuc-07',
    immagine: '/guida/cuc-08-tavolo-completato.png',
    titolo: 'Tavolo completato',
    descrizione: 'Tavoli con tutte le mandate pronte scendono in fondo. Trascina la card per rimuoverla dalla vista.',
    evidenzia: null,
  },
  {
    id: 'cuc-08',
    immagine: '/guida/cuc-01-lista-vuota.png',
    titolo: 'Lista vuota = pausa',
    descrizione: 'Quando tutti i tavoli sono evasi vedi "Tutto pronto 🎉". Buon momento per respirare.',
    evidenzia: null,
  },
]

const slidesCassa = [
  {
    id: 'cas-01',
    immagine: '/guida/cas-01-lista-attesa.png',
    titolo: 'Benvenuto in Cassa! 💰',
    descrizione: 'Lista ordini in attesa di incasso. Puoi cercare per numero tavolo o nome.',
    evidenzia: null,
  },
  {
    id: 'cas-02',
    immagine: '/guida/cas-02-dettaglio-ordine.png',
    titolo: 'Dettaglio + Incassato',
    descrizione: 'Tappa la card per vedere il totale e gli articoli. Premi "✅ Incassato" e l\'ordine parte.',
    evidenzia: null,
  },
  {
    id: 'cas-03',
    immagine: '/guida/cas-03-storno-due-pulsanti.png',
    titolo: 'Ordine stornato',
    descrizione: 'Bordo rosso = ordine in pausa. Scegli con quale metodo il cliente paga davvero: Bancomat o Contanti.',
    evidenzia: null,
  },
  {
    id: 'cas-04',
    immagine: '/guida/cas-04-incassato.png',
    titolo: 'Incassato!',
    descrizione: 'L\'ordine sparisce dalla lista e torna attivo in cucina/bar. Buon lavoro.',
    evidenzia: null,
  },
]

const slidesAdmin = [
  {
    id: 'adm-01',
    immagine: '/guida/adm-01-tab-ordini.png',
    titolo: 'Tab Ordini',
    descrizione: 'Vedi tutti gli ordini (attivi, completati, stornati) con filtri per stato. Cancellabili uno per uno.',
    evidenzia: null,
  },
  {
    id: 'adm-02',
    immagine: '/guida/adm-02-tab-menu-cucina.png',
    titolo: 'Menu Cucina',
    descrizione: 'Aggiungi piatti con nome, prezzo e sottocategoria (antipasto, primo, ecc). Disattivali quando finiscono.',
    evidenzia: null,
  },
  {
    id: 'adm-03',
    immagine: '/guida/adm-03-tab-menu-bar.png',
    titolo: 'Menu Bar',
    descrizione: 'Scorri in basso per gestire le voci bar (acqua, vino, caffè, amari).',
    evidenzia: null,
  },
  {
    id: 'adm-04',
    immagine: '/guida/adm-04-tab-riepilogo.png',
    titolo: 'Riepilogo serata',
    descrizione: 'Statistiche live: incassi totali, persone servite, breakdown bancomat/contanti.',
    evidenzia: null,
  },
  {
    id: 'adm-05',
    immagine: '/guida/adm-05-tab-staff.png',
    titolo: 'Staff e WhatsApp',
    descrizione: 'Elenco personale con PIN. Pulsante per inviare le credenziali via WhatsApp con un click.',
    evidenzia: null,
  },
  {
    id: 'adm-06',
    immagine: '/guida/adm-06-impostazioni-fasce.png',
    titolo: 'Fasce orarie',
    descrizione: 'Configura colazione/pranzo/aperitivo/cena. La cena può attraversare la mezzanotte.',
    evidenzia: null,
  },
  {
    id: 'adm-07',
    immagine: '/guida/adm-07-impostazioni-timer.png',
    titolo: 'Timer mandate',
    descrizione: 'Tempi (in minuti) per il timer di urgenza tra una mandata e l\'altra in cucina/bar.',
    evidenzia: null,
  },
  {
    id: 'adm-08',
    immagine: '/guida/adm-08-impostazioni-reset.png',
    titolo: 'Reset fine serata',
    descrizione: 'Azzera ordini, menu o tutto. Richiede di scrivere "CONFERMO". Irreversibile, usalo solo a fine festa.',
    evidenzia: null,
  },
]

export const TUTORIALS = {
  cameriere: slidesCameriere,
  bar:       slidesBar,
  cucina:    slidesCucina,
  cassa:     slidesCassa,
  admin:     slidesAdmin,
}

export function getTutorial(ruolo) {
  return TUTORIALS[ruolo] || []
}

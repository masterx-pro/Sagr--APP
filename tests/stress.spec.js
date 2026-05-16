// Stress test + Cattura screenshot per guida utente — Festa Manager v5
// FASE 1: Worker dedicato che cattura ~45 screenshot per docs/GUIDA_UTENTE.md
// FASE 2: Stress ridotto (4 cam · 8 tav · 24 ord) per validare flussi end-to-end

import { test, chromium } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'

const APP_URL = 'https://sagra-app-coral.vercel.app'

// =============================================================
// COSTANTI
// =============================================================

const PARAMETRI_CAMERIERI = [
  { idx: 0, pin: '1111', label: 'Mario',  tavoli: [1, 2] },
  { idx: 1, pin: '2222', label: 'Giulia', tavoli: [3, 4] },
  { idx: 2, pin: '1234', label: 'Carlo',  tavoli: [5, 6] },
  { idx: 3, pin: '5678', label: 'Anna',   tavoli: [7, 8] },
]

const PINS = {
  cucina: '4444',
  bar:    '3333',
  cassa:  '0000',
  admin:  '999999',
}

const NOMI = [
  'Mattia','Marco','Sara','Luca','Anna','Paolo','Giulia','Roberto',
  'Elena','Francesco','Chiara','Davide','Martina','Andrea','Sofia',
]

const ORDINI_PER_CAMERIERE = 6 // 2 tavoli x 3 turni
const PERSONE_MIN = 4
const PERSONE_MAX = 8
const PERC_BANCOMAT = 0.5

const VIEWPORT = { width: 390, height: 844 }
const UA_MOBILE = 'Mozilla/5.0 (Linux; Android 12; Pixel 6) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Mobile Safari/537.36'

const ACTION_TIMEOUT = 15000
const TOTAL_TIMEOUT  = 3600000 // 60 min
const SLOW_MO = 150

// Tavoli "alti" usati SOLO dalla cattura — non si sovrappongono allo stress
const TAVOLO_CAPTURE_BANCOMAT = 99
const TAVOLO_CAPTURE_CONTANTI = 98
const TAVOLO_CAPTURE_STORNO   = 97

const SCREENSHOTS_DIR = path.join('tests', 'screenshots')
const GUIDA_DIR       = path.join('tests', 'guida-screenshots')
if (!fs.existsSync(SCREENSHOTS_DIR)) fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true })
if (!fs.existsSync(GUIDA_DIR))       fs.mkdirSync(GUIDA_DIR, { recursive: true })

// =============================================================
// STATS GLOBALI
// =============================================================

const stats = {
  startTime: Date.now(),
  camerieri: PARAMETRI_CAMERIERI.map(p => ({
    idx: p.idx, pin: p.pin, label: p.label,
    tavoli: 0, fallito: 0, coperti: 0, bancomat: 0, contanti: 0,
  })),
  cassa:  { incassati: 0, errori: 0 },
  cucina: [{ idx: 0, mandate: 0, errori: 0 }],
  bar:    [{ idx: 0, mandate: 0, errori: 0 }],
  errori: { timeout: 0, selector: 0, rete: 0, altro: 0, totali: 0 },
  stopRequested: false,
  screenshot: { catturati: [], falliti: [] },
}

// =============================================================
// HELPERS
// =============================================================

function tsHHMM() { return new Date().toISOString().slice(11, 19) }
function log(msg) { console.log(`[${tsHHMM()}] ${msg}`) }

function logErr(prefix, e) {
  stats.errori.totali++
  const m = String(e?.message || e || '')
  const lm = m.toLowerCase()
  if (lm.includes('timeout'))       stats.errori.timeout++
  else if (lm.includes('selector')) stats.errori.selector++
  else if (lm.includes('network'))  stats.errori.rete++
  else                              stats.errori.altro++
  log(`❌ ${prefix}: ${m.slice(0, 200)}`)
}

async function screenshotErr(page, tag) {
  try {
    const f = path.join(SCREENSHOTS_DIR, `err-${Date.now()}-${tag}.png`)
    await page.screenshot({ path: f, fullPage: false })
  } catch {}
}

async function snap(page, relPath, descr) {
  try {
    const full = path.join(GUIDA_DIR, relPath)
    fs.mkdirSync(path.dirname(full), { recursive: true })
    await page.screenshot({ path: full, fullPage: false })
    stats.screenshot.catturati.push(relPath)
    log(`📸 ${relPath} — ${descr}`)
    return true
  } catch (e) {
    stats.screenshot.falliti.push(relPath)
    log(`⚠️  Snap fallito: ${relPath} (${e.message?.slice(0, 80)})`)
    return false
  }
}

function rand(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min }
function pick(arr) { return arr && arr.length ? arr[Math.floor(Math.random() * arr.length)] : null }
function sleep(ms) { return new Promise(r => setTimeout(r, ms)) }
function escapeRe(s) { return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&') }

function totTavoli() { return stats.camerieri.reduce((s, c) => s + c.tavoli, 0) }
function totFallito() { return stats.camerieri.reduce((s, c) => s + c.fallito, 0) }
function totCoperti() { return stats.camerieri.reduce((s, c) => s + c.coperti, 0) }

// =============================================================
// STATS PRINTER (heartbeat 60s)
// =============================================================

let statsTimer = null
function startStatsPrinter() {
  statsTimer = setInterval(() => {
    const elapsed = Math.floor((Date.now() - stats.startTime) / 1000)
    const mm = String(Math.floor(elapsed / 60)).padStart(2, '0')
    const ss = String(elapsed % 60).padStart(2, '0')
    const cucM = stats.cucina.reduce((s, c) => s + c.mandate, 0)
    const barM = stats.bar.reduce((s, b) => s + b.mandate, 0)
    log(`📊 [${mm}:${ss}] Coperti ${totCoperti()} · Tavoli ${totTavoli()}✅ ${totFallito()}❌ · Cassa ${stats.cassa.incassati} · Cuc ${cucM} · Bar ${barM} · Snap ${stats.screenshot.catturati.length}/${stats.screenshot.catturati.length + stats.screenshot.falliti.length} · Err ${stats.errori.totali}`)
  }, 60_000)
}
function stopStatsPrinter() { if (statsTimer) clearInterval(statsTimer) }

// =============================================================
// LOGIN
// =============================================================

async function pressPin(page, pin) {
  for (const c of pin) {
    await page.getByRole('button', { name: c, exact: true }).first().click({ timeout: ACTION_TIMEOUT })
  }
  await page.getByRole('button', { name: 'Entra', exact: true }).click({ timeout: ACTION_TIMEOUT })
}

async function loginCon(page, pin, ruoloPagina) {
  await page.goto(APP_URL, { waitUntil: 'domcontentloaded', timeout: 30000 })
  await page.waitForSelector('button:has-text("Entra")', { timeout: ACTION_TIMEOUT })
  await pressPin(page, pin)
  const sel = ruoloPagina === 'cameriere' ? 'button:has-text("Nuovo Tavolo")'
            : ruoloPagina === 'cassa'     ? 'h1:has-text("Cassa")'
            : ruoloPagina === 'cucina'    ? 'h1:has-text("Cucina")'
            : ruoloPagina === 'bar'       ? 'h1:has-text("Bar")'
            :                                'h1:has-text("Admin")'
  await page.waitForSelector(sel, { timeout: ACTION_TIMEOUT })
}

async function logout(page) {
  try {
    await page.getByRole('button', { name: 'Esci', exact: true }).first().click({ timeout: 5000 })
    await page.waitForSelector('button:has-text("Entra")', { timeout: ACTION_TIMEOUT })
  } catch {}
}

// =============================================================
// SCOUT MENU
// =============================================================

async function scoutMenu() {
  log('🔍 Scout: leggo il menu attivo...')
  const browser = await chromium.launch({ headless: false, slowMo: SLOW_MO })
  const ctx = await browser.newContext({ viewport: VIEWPORT, userAgent: UA_MOBILE })
  ctx.on('dialog', async d => { try { await d.accept() } catch {} })
  const page = await ctx.newPage()
  page.setDefaultTimeout(ACTION_TIMEOUT)

  try {
    await loginCon(page, PARAMETRI_CAMERIERI[0].pin, 'cameriere')
    await page.locator('button:has-text("Nuovo Tavolo")').click()
    await page.waitForSelector('input[placeholder*="capotavola" i]', { timeout: ACTION_TIMEOUT })

    const result = { cucina: {}, bar: {} }

    for (const cat of ['Cucina', 'Bar']) {
      await page.getByRole('button', { name: cat, exact: true }).first().click()
      await sleep(400)
      const raw = await page.$$eval('ul > li', els => els.map(li => ({
        text:  (li.textContent || '').trim(),
        isCard: li.classList.contains('card'),
        nome:  li.querySelector('p')?.textContent?.trim() || null,
      })))
      const groups = {}
      let cur = null
      for (const li of raw) {
        const m = li.text.match(/^—\s*(.+?)\s*—$/)
        if (m && !li.isCard) {
          cur = m[1].trim()
          if (!groups[cur]) groups[cur] = []
          continue
        }
        if (cur && li.isCard && li.nome) groups[cur].push(li.nome)
      }
      result[cat.toLowerCase()] = groups
    }

    const menu = {
      antipasti: result.cucina['Antipasti'] || [],
      primi:     result.cucina['Primi']     || [],
      secondi:   result.cucina['Secondi']   || [],
      contorni:  result.cucina['Contorni']  || [],
      dolci:     result.cucina['Dolci']     || [],
      acque:     result.bar['Acqua']        || [],
      vini:      [
        ...(result.bar['Vino sfuso']                || []),
        ...(result.bar['Verdicchio']                || []),
        ...(result.bar["Lacrima di Morro d'Alba"]   || []),
      ],
      caffe:     result.bar['Caffè']        || [],
      amari:     result.bar['Amari']        || [],
    }
    log(`   Cucina: antipasti(${menu.antipasti.length}) primi(${menu.primi.length}) secondi(${menu.secondi.length}) contorni(${menu.contorni.length}) dolci(${menu.dolci.length})`)
    log(`   Bar:    acque(${menu.acque.length}) vini(${menu.vini.length}) caffè(${menu.caffe.length}) amari(${menu.amari.length})`)
    return menu
  } finally {
    await ctx.close().catch(() => {})
    await browser.close().catch(() => {})
  }
}

// =============================================================
// HELPERS UI ORDINI
// =============================================================

async function selezionaPiatto(page, nome, qty) {
  const row = page.locator('li.card').filter({
    has: page.locator('p', { hasText: new RegExp(`^${escapeRe(nome)}$`) }),
  }).first()
  await row.waitFor({ state: 'visible', timeout: ACTION_TIMEOUT })
  const plus = row.locator('button').filter({ hasText: /^\+$/ }).first()
  for (let i = 0; i < qty; i++) {
    await plus.click({ timeout: ACTION_TIMEOUT })
  }
}

async function selezionaTabMandata(page, n) {
  await page.locator('button').filter({ hasText: new RegExp(`^M${n}($|\\s|·)`) }).first().click()
  await sleep(120)
}

async function selezionaTabCategoria(page, cat) {
  await page.getByRole('button', { name: cat, exact: true }).first().click()
  await sleep(120)
}

// Crea un ordine senza screenshot — usato dallo stress test
async function creaOrdine(page, tavoloNum, menu, opts = {}) {
  const persone = opts.persone ?? rand(PERSONE_MIN, PERSONE_MAX)
  const nome = opts.nome ?? pick(NOMI)
  const isBancomat = opts.isBancomat ?? (Math.random() < PERC_BANCOMAT)
  const includeM4 = opts.includeM4 ?? false

  await page.locator('button:has-text("Nuovo Tavolo")').click({ timeout: ACTION_TIMEOUT })
  await page.waitForSelector('input[placeholder*="capotavola" i]', { timeout: ACTION_TIMEOUT })

  const inputs = page.locator('input[type="number"]')
  await inputs.nth(0).fill(String(tavoloNum))
  await inputs.nth(1).fill(String(persone))
  await page.locator('input[placeholder*="capotavola" i]').fill(nome)

  // M1: antipasto + acqua + vino
  await selezionaTabMandata(page, 1)
  if (menu.antipasti.length) {
    await selezionaTabCategoria(page, 'Cucina')
    await selezionaPiatto(page, pick(menu.antipasti), persone)
  }
  if (menu.acque.length || menu.vini.length) {
    await selezionaTabCategoria(page, 'Bar')
    if (menu.acque.length) await selezionaPiatto(page, pick(menu.acque), persone)
    if (menu.vini.length)  await selezionaPiatto(page, pick(menu.vini),  persone)
  }

  // M2: primo
  await selezionaTabMandata(page, 2)
  if (menu.primi.length) {
    await selezionaTabCategoria(page, 'Cucina')
    await selezionaPiatto(page, pick(menu.primi), persone)
  }

  // M3: secondo + contorno
  await selezionaTabMandata(page, 3)
  if (menu.secondi.length || menu.contorni.length) {
    await selezionaTabCategoria(page, 'Cucina')
    if (menu.secondi.length)  await selezionaPiatto(page, pick(menu.secondi), persone)
    if (menu.contorni.length) await selezionaPiatto(page, pick(menu.contorni), persone)
  }

  // M4: dolci/caffè/amari
  if (includeM4) {
    await selezionaTabMandata(page, 4)
    if (menu.dolci.length) {
      await selezionaTabCategoria(page, 'Cucina')
      await selezionaPiatto(page, pick(menu.dolci), persone)
    }
    if (menu.caffe.length || menu.amari.length) {
      await selezionaTabCategoria(page, 'Bar')
      if (menu.caffe.length) await selezionaPiatto(page, pick(menu.caffe), persone)
      if (menu.amari.length) await selezionaPiatto(page, pick(menu.amari), persone)
    }
  }

  const avanti = page.locator('button:has-text("Avanti")').first()
  await avanti.scrollIntoViewIfNeeded({ timeout: ACTION_TIMEOUT })
  await avanti.click({ timeout: ACTION_TIMEOUT })

  await page.waitForSelector('button:has-text("BANCOMAT")', { timeout: ACTION_TIMEOUT })
  if (isBancomat) {
    await page.locator('button:has-text("BANCOMAT")').click()
  } else {
    await page.locator('button:has-text("CONTANTI")').click()
  }

  await page.waitForSelector('button:has-text("Nuovo Tavolo")', { timeout: ACTION_TIMEOUT })

  return { persone, isBancomat }
}

// =============================================================
// CAPTURE GUIDE — flusso sequenziale, stati controllati
// =============================================================

async function captureGuide(menu) {
  log('📸 ════════ INIZIO CATTURA SCREENSHOT GUIDA ════════')

  // Browser separati per ogni ruolo, mantenuti aperti per coordinare gli stati
  const make = async () => {
    const browser = await chromium.launch({ headless: false, slowMo: SLOW_MO })
    const ctx = await browser.newContext({ viewport: VIEWPORT, userAgent: UA_MOBILE })
    ctx.on('dialog', async d => { try { await d.accept() } catch {} })
    const page = await ctx.newPage()
    page.setDefaultTimeout(ACTION_TIMEOUT)
    page.setDefaultNavigationTimeout(30000)
    return { browser, ctx, page }
  }

  let camB = null, cucB = null, barB = null, casB = null, admB = null

  try {
    // -----------------------------------------------------
    // 01) LOGIN — schermate PIN pad
    // -----------------------------------------------------
    log('📸 [LOGIN] Apertura schermate PIN pad')
    camB = await make()
    await camB.page.goto(APP_URL, { waitUntil: 'domcontentloaded', timeout: 30000 })
    await camB.page.waitForSelector('button:has-text("Entra")', { timeout: ACTION_TIMEOUT })
    await snap(camB.page, 'guida/01-login-pinpad.png', 'PIN pad vuoto')

    // Digita 2 cifre per "PIN parzialmente inserito"
    await camB.page.getByRole('button', { name: '1', exact: true }).first().click()
    await camB.page.getByRole('button', { name: '2', exact: true }).first().click()
    await snap(camB.page, 'guida/02-login-digitando.png', 'PIN parzialmente inserito')

    // Reset: torna alla home
    await camB.page.getByRole('button', { name: 'C', exact: true }).first().click().catch(() => {})

    // -----------------------------------------------------
    // 02) CAMERIERE — login + lista
    // -----------------------------------------------------
    log('📸 [CAM] Login cameriere e lista iniziale')
    await loginCon(camB.page, PARAMETRI_CAMERIERI[0].pin, 'cameriere')
    await sleep(800)
    await snap(camB.page, 'cam/01-lista-tavoli.png', 'Lista tavoli del cameriere all\'accesso')

    // -----------------------------------------------------
    // 03) CAMERIERE — flusso nuovo ordine T99 (BANCOMAT, con M4)
    // -----------------------------------------------------
    log('📸 [CAM] Nuovo ordine T99 (bancomat, con M4)')
    await camB.page.locator('button:has-text("Nuovo Tavolo")').click()
    await camB.page.waitForSelector('input[placeholder*="capotavola" i]')
    await snap(camB.page, 'cam/03-nuovo-tavolo-form.png', 'Form inserimento tavolo + persone + nome')

    // Riempi i campi
    const inputs = camB.page.locator('input[type="number"]')
    await inputs.nth(0).fill(String(TAVOLO_CAPTURE_BANCOMAT))
    await inputs.nth(1).fill('6')
    await camB.page.locator('input[placeholder*="capotavola" i]').fill('Mario')

    // M1: Cucina (antipasto)
    await selezionaTabMandata(camB.page, 1)
    await selezionaTabCategoria(camB.page, 'Cucina')
    if (menu.antipasti.length) {
      await selezionaPiatto(camB.page, menu.antipasti[0], 6)
    }
    await snap(camB.page, 'cam/04-menu-m1-cucina.png', 'Selezione piatti M1 — tab Cucina')

    // M1: Bar (acqua + vino)
    await selezionaTabCategoria(camB.page, 'Bar')
    if (menu.acque.length) await selezionaPiatto(camB.page, menu.acque[0], 6)
    if (menu.vini.length)  await selezionaPiatto(camB.page, menu.vini[0], 6)
    await snap(camB.page, 'cam/05-menu-m1-bar.png', 'Selezione bevande M1 — tab Bar')

    // M2 (con M1 ormai "indietro")
    await selezionaTabMandata(camB.page, 2)
    await selezionaTabCategoria(camB.page, 'Cucina')
    if (menu.primi.length) await selezionaPiatto(camB.page, menu.primi[0], 6)
    await snap(camB.page, 'cam/06-menu-m2.png', 'Selezione M2 — primi')

    // M3: secondo + contorno
    await selezionaTabMandata(camB.page, 3)
    await selezionaTabCategoria(camB.page, 'Cucina')
    if (menu.secondi.length)  await selezionaPiatto(camB.page, menu.secondi[0], 6)
    if (menu.contorni.length) await selezionaPiatto(camB.page, menu.contorni[0], 6)

    // M4: dolci + caffè + amari
    await selezionaTabMandata(camB.page, 4)
    await selezionaTabCategoria(camB.page, 'Cucina')
    if (menu.dolci.length) await selezionaPiatto(camB.page, menu.dolci[0], 6)
    await selezionaTabCategoria(camB.page, 'Bar')
    if (menu.caffe.length) await selezionaPiatto(camB.page, menu.caffe[0], 6)
    if (menu.amari.length) await selezionaPiatto(camB.page, menu.amari[0], 6)

    // Vai alla scelta pagamento
    const avanti1 = camB.page.locator('button:has-text("Avanti")').first()
    await avanti1.scrollIntoViewIfNeeded()
    await avanti1.click()
    await camB.page.waitForSelector('button:has-text("BANCOMAT")')
    await snap(camB.page, 'cam/07-scelta-pagamento.png', 'Scelta pagamento bancomat/contanti con totale')

    // Conferma BANCOMAT
    await camB.page.locator('button:has-text("BANCOMAT")').click()
    await camB.page.waitForSelector('button:has-text("Nuovo Tavolo")')
    await sleep(500)
    await snap(camB.page, 'cam/08-ordine-inviato.png', 'Ritorno alla lista dopo invio ordine')
    await snap(camB.page, 'cam/02-lista-tavoli-attivi.png', 'Lista con tavolo attivo')

    // -----------------------------------------------------
    // 04) CUCINA — login e cattura stati
    // -----------------------------------------------------
    log('📸 [CUC] Login cucina e cattura stati')
    cucB = await make()
    await loginCon(cucB.page, PINS.cucina, 'cucina')
    await sleep(1500)
    await snap(cucB.page, 'cuc/02-ordine-arrivato.png', 'Cucina vede il nuovo ordine — M1 da preparare')

    // M2 deve essere visibile in stato "in attesa di M1" (bloccata grigia)
    await snap(cucB.page, 'cuc/05-m2-bloccata.png', 'M2 grigia in attesa che M1 sia pronta')

    // Vista aggregata
    try {
      await cucB.page.locator('button:has-text("Aggregato")').first().click({ timeout: 3000 })
      await sleep(500)
      await snap(cucB.page, 'cuc/07-aggregato.png', 'Vista aggregata cucina — totali per pietanza')
      await cucB.page.locator('button:has-text("Per Tavolo")').first().click({ timeout: 3000 })
      await sleep(500)
    } catch (e) {
      log('⚠️  Vista aggregata cucina non raggiungibile')
    }

    // M1 cucina: Da preparare -> In preparazione
    try {
      const m1DaPrep = cucB.page.locator('button').filter({ hasText: /Da preparare/ }).first()
      await m1DaPrep.click({ timeout: ACTION_TIMEOUT })
      await sleep(800)
      await snap(cucB.page, 'cuc/03-in-preparazione.png', 'M1 in preparazione (pulsante arancione)')

      // M1 cucina: In preparazione -> Pronto
      const m1InPrep = cucB.page.locator('button').filter({ hasText: /In preparazione/ }).first()
      await m1InPrep.click({ timeout: ACTION_TIMEOUT })
      await sleep(1000)
      await snap(cucB.page, 'cuc/04-pronto.png', 'M1 pronta — verde')
      await snap(cucB.page, 'cuc/06-m2-sbloccata.png', 'M2 attiva dopo che M1 è pronta')
    } catch (e) {
      log(`⚠️  Avanzamento cucina M1 fallito: ${e.message?.slice(0, 80)}`)
    }

    // -----------------------------------------------------
    // 05) BAR — login e cattura
    // -----------------------------------------------------
    log('📸 [BAR] Login bar e cattura stati')
    barB = await make()
    await loginCon(barB.page, PINS.bar, 'bar')
    await sleep(1500)
    await snap(barB.page, 'bar/01-ordine-arrivato.png', 'Bar vede ordine M1 (acqua + vino) — M4 NON visibile')
    await snap(barB.page, 'bar/04-m4-bloccata.png', 'M4 caffè/amari bloccata: non compaiono finché cameriere non invia M4')

    // Bar M1: Da preparare → In preparazione → Pronto
    try {
      const barDaPrep = barB.page.locator('button').filter({ hasText: /Da preparare/ }).first()
      await barDaPrep.click({ timeout: ACTION_TIMEOUT })
      await sleep(800)
      await snap(barB.page, 'bar/02-in-preparazione.png', 'Bar M1 in preparazione')

      const barInPrep = barB.page.locator('button').filter({ hasText: /In preparazione/ }).first()
      await barInPrep.click({ timeout: ACTION_TIMEOUT })
      await sleep(1000)
      await snap(barB.page, 'bar/03-pronto-swipe.png', 'Bar M1 pronta — swipe per rimuovere card')
    } catch (e) {
      log(`⚠️  Avanzamento bar M1 fallito: ${e.message?.slice(0, 80)}`)
    }

    // -----------------------------------------------------
    // 06) CAMERIERE — apre dettaglio + Invia M4
    // -----------------------------------------------------
    log('📸 [CAM] Dettaglio ordine + pulsante Invia M4')
    try {
      // Cerca la card del tavolo T99
      const card = camB.page.locator('li').filter({ hasText: new RegExp(`Tav\\.?\\s*${TAVOLO_CAPTURE_BANCOMAT}`) }).first()
      await card.scrollIntoViewIfNeeded({ timeout: 5000 })
      await snap(camB.page, 'cam/09-card-in-preparazione.png', 'Card tavolo con stato cucina/bar')
      await card.click({ timeout: ACTION_TIMEOUT })
      await camB.page.waitForSelector('button:has-text("Invia M4")', { timeout: ACTION_TIMEOUT })
      await snap(camB.page, 'cam/11-dettaglio-ordine.png', 'Dettaglio ordine: mandate cucina+bar con stati')
      await snap(camB.page, 'cam/12-pulsante-invia-m4.png', 'Pulsante "Invia M4" visibile (giallo, pulsa)')

      // Clicca Invia M4
      await camB.page.locator('button:has-text("Invia M4")').first().click({ timeout: ACTION_TIMEOUT })
      await sleep(1500)
    } catch (e) {
      log(`⚠️  Dettaglio/InviaM4 fallito: ${e.message?.slice(0, 80)}`)
    }

    // -----------------------------------------------------
    // 07) BAR — vede M4 sbloccata
    // -----------------------------------------------------
    log('📸 [BAR] M4 sbloccata dopo invio')
    try {
      await sleep(2000) // aspetta realtime
      await snap(barB.page, 'bar/05-m4-sbloccata.png', 'M4 attiva dopo Invia M4 — caffè/amari/dolci visibili')
    } catch (e) {
      log(`⚠️  Snap bar M4 sbloccata fallito: ${e.message?.slice(0, 80)}`)
    }

    // -----------------------------------------------------
    // 08) CAMERIERE — secondo ordine T98 con CONTANTI (per cassa)
    // -----------------------------------------------------
    log('📸 [CAM] Crea ordine T98 (contanti) per cassa')
    try {
      // Torna alla lista
      try {
        await camB.page.getByRole('button', { name: /Indietro/, exact: false }).first().click({ timeout: 3000 })
      } catch {}
      await camB.page.waitForSelector('button:has-text("Nuovo Tavolo")', { timeout: ACTION_TIMEOUT })
      await creaOrdine(camB.page, TAVOLO_CAPTURE_CONTANTI, menu, {
        persone: 4, nome: 'Anna', isBancomat: false, includeM4: false,
      })
    } catch (e) {
      log(`⚠️  Ordine contanti fallito: ${e.message?.slice(0, 80)}`)
    }

    // -----------------------------------------------------
    // 09) CAMERIERE — terzo ordine T97 (BANCOMAT) — poi storno per cassa
    // -----------------------------------------------------
    log('📸 [CAM] Crea ordine T97 (bancomat) e storna')
    try {
      await creaOrdine(camB.page, TAVOLO_CAPTURE_STORNO, menu, {
        persone: 4, nome: 'Luca', isBancomat: true, includeM4: false,
      })
      // Apri dettaglio e storna
      const cardStorno = camB.page.locator('li').filter({ hasText: new RegExp(`Tav\\.?\\s*${TAVOLO_CAPTURE_STORNO}`) }).first()
      await cardStorno.click({ timeout: ACTION_TIMEOUT })
      await sleep(500)
      const stornoBtn = camB.page.locator('button').filter({ hasText: /Storna/ }).first()
      await stornoBtn.scrollIntoViewIfNeeded()
      await stornoBtn.click({ timeout: ACTION_TIMEOUT })
      await sleep(1500) // dialog accept gestito
    } catch (e) {
      log(`⚠️  Storno T97 fallito: ${e.message?.slice(0, 80)}`)
    }

    // -----------------------------------------------------
    // 10) CASSA — login + cattura
    // -----------------------------------------------------
    log('📸 [CAS] Login cassa e cattura stati')
    casB = await make()
    await loginCon(casB.page, PINS.cassa, 'cassa')
    await sleep(2000)
    await snap(casB.page, 'cas/01-lista-attesa.png', 'Lista ordini in attesa pagamento')

    // Apri dettaglio del primo ordine in attesa contanti
    try {
      const cardCont = casB.page.locator('main li').filter({ hasText: /Tav\.?\s*\d+/ }).filter({ hasNot: casB.page.locator('text=/Stornato/i') }).first()
      await cardCont.click({ timeout: ACTION_TIMEOUT })
      await sleep(800)
      await snap(casB.page, 'cas/02-dettaglio-ordine.png', 'Dettaglio ordine con totale e pulsante incassa')
      // Torna indietro
      await casB.page.getByRole('button', { name: /Indietro/ }).first().click({ timeout: 3000 }).catch(() => {})
      await sleep(500)
    } catch (e) {
      log(`⚠️  Dettaglio cassa contanti fallito: ${e.message?.slice(0, 80)}`)
    }

    // Apri dettaglio dell'ordine stornato (T97) — due pulsanti scelta pagamento
    try {
      const cardStor = casB.page.locator('main li').filter({ hasText: new RegExp(`Tav\\.?\\s*${TAVOLO_CAPTURE_STORNO}`) }).first()
      await cardStor.click({ timeout: ACTION_TIMEOUT })
      await casB.page.waitForSelector('button:has-text("Ri-conferma Bancomat")', { timeout: ACTION_TIMEOUT })
      await snap(casB.page, 'cas/03-storno-due-pulsanti.png', 'Ordine stornato: scelta Bancomat / Contanti')
      // Ri-conferma con contanti
      await casB.page.locator('button:has-text("Ri-conferma Contanti")').first().click({ timeout: ACTION_TIMEOUT })
      await sleep(1500)
      await snap(casB.page, 'cas/04-incassato.png', 'Cassa: dopo incasso, lista aggiornata')
    } catch (e) {
      log(`⚠️  Storno cassa fallito: ${e.message?.slice(0, 80)}`)
    }

    // -----------------------------------------------------
    // 11) CUCINA — vista finale (T99 più avanti del flusso)
    // -----------------------------------------------------
    try {
      // Provo a portare la cucina al completamento di T99
      for (let i = 0; i < 6; i++) {
        const daPrep = cucB.page.locator('button').filter({ hasText: /Da preparare/ })
        const inPrep = cucB.page.locator('button').filter({ hasText: /In preparazione/ })
        if (await daPrep.count() > 0) {
          await daPrep.first().click({ timeout: 5000 }).catch(() => {})
          await sleep(800)
        } else if (await inPrep.count() > 0) {
          await inPrep.first().click({ timeout: 5000 }).catch(() => {})
          await sleep(800)
        } else break
      }
      await snap(cucB.page, 'cuc/08-tavolo-completato.png', 'Tavolo completato — in fondo alla lista')
      await snap(cucB.page, 'cuc/01-lista-vuota.png', 'Cucina con backlog ridotto')
    } catch (e) {
      log(`⚠️  Completamento cucina fallito: ${e.message?.slice(0, 80)}`)
    }

    // -----------------------------------------------------
    // 12) ADMIN — tutti i tab
    // -----------------------------------------------------
    log('📸 [ADM] Login admin e cattura tab')
    admB = await make()
    await loginCon(admB.page, PINS.admin, 'admin')
    await sleep(1500)

    // Tab Ordini
    try {
      await admB.page.locator('button:has-text("Ordini")').first().click({ timeout: 5000 })
      await sleep(800)
      await snap(admB.page, 'adm/01-tab-ordini.png', 'Tab Ordini con filtri di stato')
    } catch (e) { log(`⚠️  Admin Ordini: ${e.message?.slice(0, 80)}`) }

    // Tab Menu
    try {
      await admB.page.locator('button:has-text("Menu")').first().click({ timeout: 5000 })
      await sleep(1000)
      // Per default cucina
      await snap(admB.page, 'adm/02-tab-menu-cucina.png', 'Gestione menu cucina con sottocategorie')
      // Tenta switch a bar via select
      try {
        const selCat = admB.page.locator('select').first()
        await selCat.selectOption({ label: 'Bar' })
        await sleep(800)
        await snap(admB.page, 'adm/03-tab-menu-bar.png', 'Gestione menu bar')
      } catch {
        log('⚠️  Switch categoria bar nel tab menu non riuscito')
      }
    } catch (e) { log(`⚠️  Admin Menu: ${e.message?.slice(0, 80)}`) }

    // Tab Riepilogo
    try {
      await admB.page.locator('button:has-text("Riepilogo")').first().click({ timeout: 5000 })
      await sleep(1200)
      await snap(admB.page, 'adm/04-tab-riepilogo.png', 'Riepilogo incassi con statistiche')
    } catch (e) { log(`⚠️  Admin Riepilogo: ${e.message?.slice(0, 80)}`) }

    // Tab Staff
    try {
      await admB.page.locator('button:has-text("Staff")').first().click({ timeout: 5000 })
      await sleep(1000)
      await snap(admB.page, 'adm/05-tab-staff.png', 'Gestione staff con pulsante WhatsApp')
    } catch (e) { log(`⚠️  Admin Staff: ${e.message?.slice(0, 80)}`) }

    // Tab Impostazioni (icona ⚙️)
    try {
      await admB.page.locator('button:has-text("⚙️")').first().click({ timeout: 5000 })
      await sleep(1500)
      await snap(admB.page, 'adm/06-impostazioni-fasce.png', 'Impostazioni fasce orarie')
      // Scroll per timer
      await admB.page.evaluate(() => window.scrollBy(0, 600))
      await sleep(500)
      await snap(admB.page, 'adm/07-impostazioni-timer.png', 'Impostazioni timer mandate')
      // Scroll fino in fondo
      await admB.page.evaluate(() => window.scrollTo(0, document.body.scrollHeight))
      await sleep(500)
      await snap(admB.page, 'adm/08-impostazioni-reset.png', 'Sezione reset e manutenzione')
    } catch (e) { log(`⚠️  Admin Impostazioni: ${e.message?.slice(0, 80)}`) }

    // -----------------------------------------------------
    // 13) CAMERIERE — card pronta finale
    // -----------------------------------------------------
    try {
      const cardFinal = camB.page.locator('li').filter({ hasText: new RegExp(`Tav\\.?\\s*${TAVOLO_CAPTURE_BANCOMAT}`) }).first()
      if (await cardFinal.count() > 0) {
        await cardFinal.scrollIntoViewIfNeeded({ timeout: 3000 }).catch(() => {})
        await snap(camB.page, 'cam/10-card-pronta.png', 'Card tavolo con elementi pronti da portare')
      }
    } catch (e) { log(`⚠️  Card pronta finale: ${e.message?.slice(0, 80)}`) }

    log('📸 ════════ FINE CATTURA — ' + stats.screenshot.catturati.length + ' OK, ' + stats.screenshot.falliti.length + ' KO ════════')
  } catch (e) {
    logErr('captureGuide', e)
  } finally {
    for (const b of [camB, cucB, barB, casB, admB]) {
      if (b) {
        await b.ctx.close().catch(() => {})
        await b.browser.close().catch(() => {})
      }
    }
  }
}

// =============================================================
// STRESS — CAMERIERE WORKER
// =============================================================

async function workerCameriere(p, menu) {
  const cam = stats.camerieri[p.idx]
  const browser = await chromium.launch({ headless: false, slowMo: SLOW_MO })
  const context = await browser.newContext({ viewport: VIEWPORT, userAgent: UA_MOBILE })
  context.on('dialog', async d => { try { await d.accept() } catch {} })
  const page = await context.newPage()
  page.setDefaultTimeout(ACTION_TIMEOUT)
  page.setDefaultNavigationTimeout(30000)

  try {
    await loginCon(page, p.pin, 'cameriere')
    log(`🟢 Cam[${p.idx}] ${p.label} PIN[${p.pin}]: pronto`)

    let tavoloIdx = 0
    let ordini = 0
    while (ordini < ORDINI_PER_CAMERIERE && !stats.stopRequested) {
      const tavoloNum = p.tavoli[tavoloIdx % p.tavoli.length]
      tavoloIdx++

      let attempt = 0
      let ok = false
      while (attempt < 3 && !ok) {
        attempt++
        try {
          const r = await creaOrdine(page, tavoloNum, menu)
          cam.tavoli++
          cam.coperti += r.persone
          if (r.isBancomat) cam.bancomat++; else cam.contanti++
          ordini++
          ok = true
        } catch (e) {
          logErr(`Cam[${p.idx}] T${tavoloNum} attempt ${attempt}`, e)
          await screenshotErr(page, `cam${p.idx}-t${tavoloNum}-att${attempt}`)
          try {
            await page.goto(APP_URL, { waitUntil: 'domcontentloaded' })
            await page.waitForSelector('button:has-text("Nuovo Tavolo")', { timeout: ACTION_TIMEOUT })
          } catch {
            try { await loginCon(page, p.pin, 'cameriere') } catch {}
          }
        }
      }
      if (!ok) cam.fallito++
      await sleep(800)
    }
  } catch (e) {
    logErr(`Cam[${p.idx}] fatal`, e)
  } finally {
    await context.close().catch(() => {})
    await browser.close().catch(() => {})
    log(`🏁 Cam[${p.idx}] ${p.label}: ${cam.tavoli}✅ ${cam.fallito}❌ · ${cam.coperti} coperti`)
  }
}

// =============================================================
// STRESS — CASSA WORKER
// =============================================================

async function workerCassa() {
  const browser = await chromium.launch({ headless: false, slowMo: SLOW_MO })
  const context = await browser.newContext({ viewport: VIEWPORT, userAgent: UA_MOBILE })
  context.on('dialog', async d => { try { await d.accept() } catch {} })
  const page = await context.newPage()
  page.setDefaultTimeout(ACTION_TIMEOUT)
  page.setDefaultNavigationTimeout(30000)

  try {
    await loginCon(page, PINS.cassa, 'cassa')
    log(`🟢 Cassa: pronta`)

    while (!stats.stopRequested) {
      try {
        const cards = page.locator('main li').filter({ hasText: /Tav\./ })
        const n = await cards.count()
        if (n === 0) { await sleep(2000); continue }
        await cards.first().click({ timeout: ACTION_TIMEOUT })
        // Caso storno: due pulsanti — scelgo Contanti
        const riconfCont = page.locator('button:has-text("Ri-conferma Contanti")')
        if (await riconfCont.count() > 0) {
          await riconfCont.first().click({ timeout: ACTION_TIMEOUT })
        } else {
          await page.locator('button:has-text("Incassato")').click({ timeout: ACTION_TIMEOUT })
        }
        stats.cassa.incassati++
        await sleep(400)
      } catch (e) {
        stats.cassa.errori++
        logErr('Cassa', e)
        try {
          await page.goto(APP_URL, { waitUntil: 'domcontentloaded' })
          await page.waitForSelector('h1:has-text("Cassa")', { timeout: ACTION_TIMEOUT })
        } catch {}
        await sleep(1500)
      }
    }
  } catch (e) {
    logErr('Cassa fatal', e)
  } finally {
    await context.close().catch(() => {})
    await browser.close().catch(() => {})
    log(`🏁 Cassa terminata: ${stats.cassa.incassati} incassati`)
  }
}

// =============================================================
// STRESS — STAZIONE WORKER (cucina/bar)
// =============================================================

async function workerStazione(ruolo) {
  const counter = ruolo === 'cucina' ? stats.cucina[0] : stats.bar[0]
  const pin = PINS[ruolo]
  const tempoPrep = ruolo === 'cucina' ? 2500 : 1500

  const browser = await chromium.launch({ headless: false, slowMo: SLOW_MO })
  const context = await browser.newContext({ viewport: VIEWPORT, userAgent: UA_MOBILE })
  context.on('dialog', async d => { try { await d.accept() } catch {} })
  const page = await context.newPage()
  page.setDefaultTimeout(ACTION_TIMEOUT)
  page.setDefaultNavigationTimeout(30000)

  try {
    await loginCon(page, pin, ruolo)
    log(`🟢 ${ruolo} PIN[${pin}]: pronto`)

    while (!stats.stopRequested) {
      try {
        const daPrep = page.locator('button').filter({ hasText: /Da preparare/ })
        const n = await daPrep.count()
        if (n === 0) {
          const inPrep = page.locator('button').filter({ hasText: /In preparazione/ })
          const m = await inPrep.count()
          if (m === 0) { await sleep(2000); continue }
          await inPrep.first().click({ timeout: ACTION_TIMEOUT })
          counter.mandate++
          await sleep(300)
          continue
        }
        await daPrep.first().click({ timeout: ACTION_TIMEOUT })
        await sleep(tempoPrep)
        const inPrep = page.locator('button').filter({ hasText: /In preparazione/ }).first()
        await inPrep.click({ timeout: ACTION_TIMEOUT })
        counter.mandate++

        if (ruolo === 'bar') {
          await sleep(300)
          try {
            const xBtn = page.locator('button[aria-label="Rimuovi card"]').first()
            if (await xBtn.count() > 0) await xBtn.click({ timeout: 2000 })
          } catch {}
        }
        await sleep(300)
      } catch (e) {
        counter.errori++
        logErr(`${ruolo}`, e)
        try {
          await page.goto(APP_URL, { waitUntil: 'domcontentloaded' })
          await page.waitForSelector(`h1:has-text("${ruolo === 'cucina' ? 'Cucina' : 'Bar'}")`, { timeout: ACTION_TIMEOUT })
        } catch {}
        await sleep(1500)
      }
    }
  } catch (e) {
    logErr(`${ruolo} fatal`, e)
  } finally {
    await context.close().catch(() => {})
    await browser.close().catch(() => {})
    log(`🏁 ${ruolo} terminato: ${counter.mandate} mandate`)
  }
}

// =============================================================
// RIEPILOGO FINALE
// =============================================================

function stampaRiepilogo() {
  const dur = Math.floor((Date.now() - stats.startTime) / 1000)
  const dm = Math.floor(dur / 60), ds = dur % 60
  const cucTot = stats.cucina.reduce((s, c) => s + c.mandate, 0)
  const barTot = stats.bar.reduce((s, b) => s + b.mandate, 0)
  const copertiTot = totCoperti()
  const tavoliTot = totTavoli()
  const eff = tavoliTot + totFallito() > 0
    ? Math.round(100 * tavoliTot / (tavoliTot + totFallito()))
    : 0
  const snapTot = stats.screenshot.catturati.length + stats.screenshot.falliti.length
  const guidaPath = path.join('docs', 'GUIDA_UTENTE.md')
  const guidaOk = fs.existsSync(guidaPath)

  const out = []
  out.push('')
  out.push('╔══════════════════════════════════════════════╗')
  out.push('║  STRESS + GUIDA — FESTA MANAGER v5           ║')
  out.push('║  24 ordini · 4 camerieri · 8 tavoli          ║')
  out.push('╚══════════════════════════════════════════════╝')
  out.push('')
  out.push(`⏱️  Durata totale: ${dm}m ${ds}s`)
  out.push('')
  out.push('👨‍🍳 CAMERIERI:')
  for (const c of stats.camerieri) {
    out.push(`  ${c.label.padEnd(7)} PIN[${c.pin}]: ${c.tavoli} tavoli ✅  ${c.fallito} ❌  ${c.coperti} coperti  (${c.bancomat}💳 ${c.contanti}💵)`)
  }
  out.push(`  TOTALE: ${tavoliTot} tavoli · ${copertiTot} coperti`)
  out.push('')
  out.push('💰 CASSA:')
  out.push(`  Ordini incassati:    ${stats.cassa.incassati}`)
  out.push(`  Errori cassa:        ${stats.cassa.errori}`)
  out.push('')
  out.push('🍳 CUCINA:')
  out.push(`  Mandate processate:  ${cucTot}`)
  out.push('')
  out.push('🍺 BAR:')
  out.push(`  Mandate processate:  ${barTot}`)
  out.push('')
  out.push('📸 SCREENSHOT GUIDA:')
  out.push(`  Catturati: ${stats.screenshot.catturati.length}/${snapTot}`)
  out.push(`  Falliti:   ${stats.screenshot.falliti.length}`)
  if (stats.screenshot.falliti.length) {
    out.push('  Lista falliti:')
    for (const f of stats.screenshot.falliti) out.push(`    - ${f}`)
  }
  out.push('')
  out.push('📖 GUIDA UTENTE:')
  out.push(`  ${guidaPath}: ${guidaOk ? '✅' : '❌ (da generare dopo)'}`)
  out.push('')
  out.push('❌ ERRORI:')
  out.push(`  Timeout:  ${stats.errori.timeout}`)
  out.push(`  Selector: ${stats.errori.selector}`)
  out.push(`  Rete:     ${stats.errori.rete}`)
  out.push(`  Altro:    ${stats.errori.altro}`)
  out.push(`  TOTALE:   ${stats.errori.totali}`)
  out.push('')
  out.push(`📊 EFFICIENZA STRESS: ${eff}% ordini completati`)
  out.push('')
  console.log(out.join('\n'))
}

// =============================================================
// TEST PRINCIPALE
// =============================================================

test.setTimeout(TOTAL_TIMEOUT)

test('stress + cattura guida — Festa Manager v5', async () => {
  log('🚀 Avvio test')
  log(`   Target: ${APP_URL}`)
  log(`   Fase 1: cattura ~45 screenshot per docs/GUIDA_UTENTE.md`)
  log(`   Fase 2: stress ridotto 4 cam · 8 tav · 24 ord`)

  const menu = await scoutMenu()
  const cucinaOk = ['antipasti','primi','secondi','contorni'].every(k => menu[k].length > 0)
  if (!cucinaOk) log('⚠️  Menu cucina incompleto — proseguo con ciò che è disponibile')

  startStatsPrinter()

  // ===== FASE 1: CATTURA GUIDA =====
  await captureGuide(menu)

  // ===== FASE 2: STRESS =====
  log('🚀 Inizio fase stress (4 cam × 6 ord = 24 ordini)')
  const camPromises = PARAMETRI_CAMERIERI.map((p, i) => (async () => {
    await sleep(i * 800)
    return workerCameriere(p, menu)
  })())

  const cassaPromise   = workerCassa()
  const cucinaPromise  = workerStazione('cucina')
  const barPromise     = workerStazione('bar')

  await Promise.allSettled(camPromises)
  log('✅ Tutti i camerieri hanno finito')

  log('⏳ Attendo 90s per backlog cassa/cucina/bar...')
  for (let s = 0; s < 90 && !stats.stopRequested; s++) await sleep(1000)

  stats.stopRequested = true
  log('🛑 Stop richiesto')

  await Promise.allSettled([cassaPromise, cucinaPromise, barPromise])

  stopStatsPrinter()
  stampaRiepilogo()
})

// Cattura screenshot per la sezione "Riordino Rapido" della guida utente.
// Genera 6 screenshot: cam-13..17 + bar-06.

import { test, chromium } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'

const APP_URL = 'https://sagra-app-coral.vercel.app'

const PINS = {
  cam:  '1111',
  bar:  '3333',
}

const VIEWPORT = { width: 390, height: 844 }
const UA_MOBILE = 'Mozilla/5.0 (Linux; Android 12; Pixel 6) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Mobile Safari/537.36'
const ACTION_TIMEOUT = 15000
const SLOW_MO = 150

const GUIDA_DIR = path.join('tests', 'guida-screenshots')
const TAVOLO = 1

const captured = []
const failed   = []

function tsHHMM() { return new Date().toISOString().slice(11, 19) }
function log(msg) { console.log(`[${tsHHMM()}] ${msg}`) }
function sleep(ms) { return new Promise(r => setTimeout(r, ms)) }
function escapeRe(s) { return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&') }

async function snap(page, relPath, descr) {
  try {
    const full = path.join(GUIDA_DIR, relPath)
    fs.mkdirSync(path.dirname(full), { recursive: true })
    await page.screenshot({ path: full, fullPage: false })
    captured.push(relPath)
    log(`📸 ${relPath} — ${descr}`)
    return true
  } catch (e) {
    failed.push(relPath)
    log(`⚠️  Snap fallito: ${relPath} (${e.message?.slice(0, 80)})`)
    return false
  }
}

async function pressPin(page, pin) {
  for (const c of pin) {
    await page.getByRole('button', { name: c, exact: true }).first().click({ timeout: ACTION_TIMEOUT })
  }
  await page.getByRole('button', { name: 'Entra', exact: true }).click({ timeout: ACTION_TIMEOUT })
}

async function loginCon(page, pin, ruolo) {
  await page.goto(APP_URL, { waitUntil: 'domcontentloaded', timeout: 30000 })
  await page.waitForSelector('button:has-text("Entra")', { timeout: ACTION_TIMEOUT })
  await pressPin(page, pin)
  const sel = ruolo === 'cameriere' ? 'button:has-text("Nuovo Tavolo")'
            : ruolo === 'bar'       ? 'h1:has-text("Bar")'
            :                          'h1:has-text("Cassa")'
  await page.waitForSelector(sel, { timeout: ACTION_TIMEOUT })
}

async function selezionaPiatto(page, nome, qty) {
  const row = page.locator('li.card').filter({
    has: page.locator('p', { hasText: new RegExp(`^${escapeRe(nome)}$`) }),
  }).first()
  await row.waitFor({ state: 'visible', timeout: ACTION_TIMEOUT })
  const plus = row.locator('button').filter({ hasText: /^\+$/ }).first()
  for (let i = 0; i < qty; i++) await plus.click({ timeout: ACTION_TIMEOUT })
}
async function selezionaTabMandata(page, n) {
  await page.locator('button').filter({ hasText: new RegExp(`^M${n}($|\\s|·)`) }).first().click()
  await sleep(150)
}
async function selezionaTabCategoria(page, cat) {
  await page.getByRole('button', { name: cat, exact: true }).first().click()
  await sleep(150)
}

async function scoutMenu(page) {
  await page.locator('button:has-text("Nuovo Tavolo")').click()
  await page.waitForSelector('input[placeholder*="capotavola" i]')
  const result = { cucina: {}, bar: {} }
  for (const cat of ['Cucina', 'Bar']) {
    await page.getByRole('button', { name: cat, exact: true }).first().click()
    await sleep(400)
    const raw = await page.$$eval('ul > li', els => els.map(li => ({
      text: (li.textContent || '').trim(),
      isCard: li.classList.contains('card'),
      nome: li.querySelector('p')?.textContent?.trim() || null,
    })))
    const groups = {}
    let cur = null
    for (const li of raw) {
      const m = li.text.match(/^—\s*(.+?)\s*—$/)
      if (m && !li.isCard) { cur = m[1].trim(); if (!groups[cur]) groups[cur] = []; continue }
      if (cur && li.isCard && li.nome) groups[cur].push(li.nome)
    }
    result[cat.toLowerCase()] = groups
  }
  return {
    antipasti: result.cucina['Antipasti'] || [],
    primi:     result.cucina['Primi']     || [],
    secondi:   result.cucina['Secondi']   || [],
    contorni:  result.cucina['Contorni']  || [],
    acque:     result.bar['Acqua']        || [],
    vini: [
      ...(result.bar['Vino sfuso']              || []),
      ...(result.bar['Verdicchio']              || []),
      ...(result.bar["Lacrima di Morro d'Alba"] || []),
    ],
  }
}

async function make() {
  const browser = await chromium.launch({ headless: false, slowMo: SLOW_MO })
  const ctx = await browser.newContext({ viewport: VIEWPORT, userAgent: UA_MOBILE })
  ctx.on('dialog', async d => { try { await d.accept() } catch {} })
  const page = await ctx.newPage()
  page.setDefaultTimeout(ACTION_TIMEOUT)
  page.setDefaultNavigationTimeout(30000)
  return { browser, ctx, page }
}
async function chiudi(b) {
  if (!b) return
  await b.ctx.close().catch(() => {})
  await b.browser.close().catch(() => {})
}

test.setTimeout(600_000)

test('cattura screenshot Riordino Rapido', async () => {
  log('🚀 Inizio cattura 6 screenshot riordino')

  let cam = null, bar = null
  try {
    cam = await make()
    await loginCon(cam.page, PINS.cam, 'cameriere')
    log('✓ Login cameriere')

    // Leggo il menu dal form nuovo ordine (poi torno alla lista)
    const menu = await scoutMenu(cam.page)
    log(`✓ Menu letto: antipasti(${menu.antipasti.length}) primi(${menu.primi.length}) acque(${menu.acque.length}) vini(${menu.vini.length})`)

    // Crea un ordine base su T1 con M1+M2+M3 bancomat (per avere una card attiva)
    log('📝 Crea ordine base su T1 (bancomat)')
    const inputs = cam.page.locator('input[type="number"]')
    await inputs.nth(0).fill(String(TAVOLO))
    await inputs.nth(1).fill('4')
    await cam.page.locator('input[placeholder*="capotavola" i]').fill('Mario')

    // M1
    await selezionaTabMandata(cam.page, 1)
    await selezionaTabCategoria(cam.page, 'Cucina')
    if (menu.antipasti.length) await selezionaPiatto(cam.page, menu.antipasti[0], 4)
    await selezionaTabCategoria(cam.page, 'Bar')
    if (menu.acque.length) await selezionaPiatto(cam.page, menu.acque[0], 4)
    if (menu.vini.length)  await selezionaPiatto(cam.page, menu.vini[0],  4)
    // M2
    await selezionaTabMandata(cam.page, 2)
    await selezionaTabCategoria(cam.page, 'Cucina')
    if (menu.primi.length) await selezionaPiatto(cam.page, menu.primi[0], 4)
    // M3
    await selezionaTabMandata(cam.page, 3)
    await selezionaTabCategoria(cam.page, 'Cucina')
    if (menu.secondi.length)  await selezionaPiatto(cam.page, menu.secondi[0],  4)
    if (menu.contorni.length) await selezionaPiatto(cam.page, menu.contorni[0], 4)

    const avanti = cam.page.locator('button:has-text("Avanti")').first()
    await avanti.scrollIntoViewIfNeeded()
    await avanti.click()
    await cam.page.waitForSelector('button:has-text("BANCOMAT")')
    await cam.page.locator('button:has-text("BANCOMAT")').click()
    await cam.page.waitForSelector('button:has-text("Nuovo Tavolo")')
    log('✓ Ordine T1 creato')

    // Forza refresh per vedere la card subito
    await cam.page.reload({ waitUntil: 'domcontentloaded' })
    await cam.page.waitForSelector('button:has-text("Nuovo Tavolo")')
    await sleep(2500)

    // ===== cam-13: card con pulsante Riordino =====
    const card = cam.page.locator('div.card').filter({
      has: cam.page.locator('button:has-text("+ Riordino")'),
    }).filter({ hasText: new RegExp(`Tav\\.?\\s*${TAVOLO}\\b`) }).first()
    await card.waitFor({ state: 'visible', timeout: 10000 })
    await card.scrollIntoViewIfNeeded()
    await sleep(500)
    await snap(cam.page, 'cam/13-card-pulsante-riordino.png', 'Card T1 con pulsante azzurro + Riordino in basso a destra')

    // ===== cam-14: schermata riordino, lista unica =====
    const riordinoBtn = card.locator('button:has-text("+ Riordino")').first()
    await riordinoBtn.click({ timeout: ACTION_TIMEOUT })
    await cam.page.waitForSelector('h2:has-text("Riordino")', { timeout: ACTION_TIMEOUT })
    await sleep(800)
    await snap(cam.page, 'cam/14-riordino-lista-menu.png', 'Schermata riordino con lista unica + barra cerca')

    // ===== cam-15: cerca "acqua" =====
    const cercaInput = cam.page.locator('input[placeholder*="Cerca per nome" i]').first()
    await cercaInput.fill('acqua')
    await sleep(800)
    await snap(cam.page, 'cam/15-riordino-cerca.png', 'Cerca "acqua" con risultati filtrati')

    // ===== Seleziona 2 acque e 1 vino =====
    if (menu.acque.length) {
      const acquaRow = cam.page.locator('li.card').filter({
        has: cam.page.locator('p', { hasText: new RegExp(`^${escapeRe(menu.acque[0])}$`) }),
      }).first()
      const plusA = acquaRow.locator('button').filter({ hasText: /^\+$/ }).first()
      await plusA.click()
      await plusA.click()
    }
    // Pulisci cerca per trovare il vino
    await cercaInput.fill('')
    await sleep(500)
    if (menu.vini.length) {
      const vinoRow = cam.page.locator('li.card').filter({
        has: cam.page.locator('p', { hasText: new RegExp(`^${escapeRe(menu.vini[0])}$`) }),
      }).first()
      await vinoRow.scrollIntoViewIfNeeded()
      const plusV = vinoRow.locator('button').filter({ hasText: /^\+$/ }).first()
      await plusV.click()
    }
    await sleep(500)

    // Vai al pagamento
    const avantiPagamento = cam.page.locator('button:has-text("Avanti → Pagamento")').first()
    await avantiPagamento.scrollIntoViewIfNeeded()
    await avantiPagamento.click({ timeout: ACTION_TIMEOUT })

    // ===== cam-16: scelta pagamento riordino =====
    await cam.page.waitForSelector('button:has-text("BANCOMAT")', { timeout: ACTION_TIMEOUT })
    await sleep(500)
    await snap(cam.page, 'cam/16-riordino-pagamento.png', 'Schermata scelta pagamento del riordino con totale')

    // Conferma bancomat
    await cam.page.locator('button:has-text("BANCOMAT")').click()
    await cam.page.waitForSelector('button:has-text("Nuovo Tavolo")', { timeout: ACTION_TIMEOUT })
    await sleep(1500)
    // Forza refresh per vedere subito la nuova card
    await cam.page.reload({ waitUntil: 'domcontentloaded' })
    await cam.page.waitForSelector('button:has-text("Nuovo Tavolo")')
    await sleep(2000)

    // ===== cam-17: conferma → lista con i 2 ordini =====
    await snap(cam.page, 'cam/17-riordino-confermato.png', 'Lista tavoli dopo riordino inviato')

    // ===== bar-06: il riordino appare al bar =====
    bar = await make()
    await loginCon(bar.page, PINS.bar, 'bar')
    await sleep(2500)
    // Cerca la card con "(riordino)" nel nome
    try {
      const riordinoCard = bar.page.locator('li').filter({ hasText: /\(riordino\)/i }).first()
      await riordinoCard.waitFor({ state: 'visible', timeout: 10000 })
      await riordinoCard.scrollIntoViewIfNeeded()
      await sleep(500)
      await snap(bar.page, 'bar/06-riordino-al-bar.png', 'Riordino visibile al bar con "(riordino)" nel nome')
    } catch (e) {
      // Fallback: cattura comunque la lista bar
      log(`⚠️ Card "(riordino)" non visibile, screenshot lista bar generica: ${e.message?.slice(0, 80)}`)
      await snap(bar.page, 'bar/06-riordino-al-bar.png', 'Lista bar (cerca il tavolo con suffisso (riordino) nel nome)')
    }

    log(`📸 ════════ FINE — ${captured.length} OK · ${failed.length} KO ════════`)
    if (failed.length) for (const f of failed) log(`  ✗ ${f}`)
  } finally {
    await chiudi(cam)
    await chiudi(bar)
  }
})

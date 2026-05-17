// One-shot: login admin → tab Impostazioni → "Azzera tutti gli ordini" → CONFERMO.
// Cancella TUTTI gli ordini di produzione. Menu/staff/impostazioni restano.

import { test, chromium } from '@playwright/test'

const APP_URL = 'https://sagra-app-coral.vercel.app'
const PIN_ADMIN = '999999'

const VIEWPORT = { width: 390, height: 844 }
const UA_MOBILE = 'Mozilla/5.0 (Linux; Android 12; Pixel 6) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Mobile Safari/537.36'
const ACTION_TIMEOUT = 15000
const SLOW_MO = 200

function log(msg) { console.log(`[${new Date().toISOString().slice(11, 19)}] ${msg}`) }
function sleep(ms) { return new Promise(r => setTimeout(r, ms)) }

test.setTimeout(120_000)

test('reset ordini admin', async () => {
  log('🚀 Avvio reset ordini admin')
  const browser = await chromium.launch({ headless: false, slowMo: SLOW_MO })
  const ctx = await browser.newContext({ viewport: VIEWPORT, userAgent: UA_MOBILE })
  ctx.on('dialog', async d => {
    log(`💬 Dialog: ${d.message().replace(/\n/g, ' | ').slice(0, 120)}`)
    try { await d.accept() } catch {}
  })
  const page = await ctx.newPage()
  page.setDefaultTimeout(ACTION_TIMEOUT)
  page.setDefaultNavigationTimeout(30000)

  try {
    // Login admin
    await page.goto(APP_URL, { waitUntil: 'domcontentloaded' })
    await page.waitForSelector('button:has-text("Entra")')
    for (const c of PIN_ADMIN) {
      await page.getByRole('button', { name: c, exact: true }).first().click()
    }
    await page.getByRole('button', { name: 'Entra', exact: true }).click()
    await page.waitForSelector('h1:has-text("Admin")')
    log('✓ Login admin OK')

    // Tab Impostazioni (icona ⚙️)
    await page.locator('button:has-text("⚙️")').first().click()
    await sleep(1500)
    log('✓ Tab Impostazioni aperto')

    // Scroll giù fino alla sezione Reset
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight))
    await sleep(800)

    // Riquadro "Azzera tutti gli ordini" → pulsante "Avvia"
    const cardOrdini = page.locator('div').filter({
      hasText: /^🗑️ Azzera tutti gli ordini/,
    }).first()
    await cardOrdini.waitFor({ state: 'visible', timeout: 10000 })
    await cardOrdini.scrollIntoViewIfNeeded()
    const avvia = cardOrdini.locator('button:has-text("Avvia")').first()
    await avvia.click({ timeout: ACTION_TIMEOUT })
    log('✓ Premuto "Avvia" — dialog di conferma accettato')

    // Dopo OK al dialog, compare un input dove scrivere "CONFERMO"
    await sleep(800)
    const inputConferma = cardOrdini.locator('input[type="text"]').first()
    await inputConferma.waitFor({ state: 'visible', timeout: 5000 })
    await inputConferma.fill('CONFERMO')
    log('✓ Scritto "CONFERMO" nell\'input')
    await sleep(300)

    // Pulsante finale "Esegui ora"
    const eseguiBtn = cardOrdini.locator('button:has-text("Esegui ora")').first()
    await eseguiBtn.waitFor({ state: 'visible', timeout: 5000 })
    await eseguiBtn.click({ timeout: ACTION_TIMEOUT })
    log('✓ Premuto pulsante esegui')

    // Attendi toast / completamento
    await page.waitForSelector('text=/eliminati|completato|✅/i', { timeout: 30000 })
    log('✅ Reset completato — ordini cancellati')
    await sleep(2000)
  } finally {
    await ctx.close().catch(() => {})
    await browser.close().catch(() => {})
  }
})

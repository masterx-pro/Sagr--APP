// Test del tutorial interattivo.
// Copre: primo accesso, navigazione, skip, "Ho capito", FAB, persistenza flag.

import { test, expect, chromium } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'

const APP_URL = 'https://sagra-app-coral.vercel.app'

const PINS = {
  cameriere: '1111',
  bar:       '3333',
  cucina:    '4444',
  cassa:     '0000',
  admin:     '999999',
}

const VIEWPORT = { width: 390, height: 844 }
const UA_MOBILE = 'Mozilla/5.0 (Linux; Android 12; Pixel 6) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Mobile Safari/537.36'
const ACTION_TIMEOUT = 15000
const SLOW_MO = 120

const SHOT_DIR = path.join('tests', 'screenshots')
if (!fs.existsSync(SHOT_DIR)) fs.mkdirSync(SHOT_DIR, { recursive: true })

function log(msg) { console.log(`[${new Date().toISOString().slice(11, 19)}] ${msg}`) }
function sleep(ms) { return new Promise(r => setTimeout(r, ms)) }

async function snap(page, name) {
  const f = path.join(SHOT_DIR, `tutorial-${name}.png`)
  await page.screenshot({ path: f, fullPage: false })
  log(`📸 ${name}`)
}

async function pressPin(page, pin) {
  for (const c of pin) {
    await page.getByRole('button', { name: c, exact: true }).first().click({ timeout: ACTION_TIMEOUT })
  }
  await page.getByRole('button', { name: 'Entra', exact: true }).click({ timeout: ACTION_TIMEOUT })
}

// Verifica che il tutorial sia VISIBILE
async function tutorialVisible(page) {
  return await page.locator('[role="dialog"][aria-modal="true"]').count() > 0
}

// Conta le slide totali leggendo "N / M"
async function getSlideTotale(page) {
  const txt = await page.locator('[role="dialog"] >> text=/^\\d+\\s*\\/\\s*\\d+$/').first().textContent({ timeout: 5000 })
  const m = txt?.match(/(\d+)\s*\/\s*(\d+)/)
  return m ? { cur: parseInt(m[1], 10), tot: parseInt(m[2], 10) } : null
}

test.setTimeout(180_000)

test('tutorial interattivo — cameriere', async () => {
  log('🚀 Test tutorial cameriere')
  const browser = await chromium.launch({ headless: false, slowMo: SLOW_MO })
  const ctx = await browser.newContext({ viewport: VIEWPORT, userAgent: UA_MOBILE })
  ctx.on('dialog', async d => { try { await d.accept() } catch {} })
  const page = await ctx.newPage()
  page.setDefaultTimeout(ACTION_TIMEOUT)
  page.setDefaultNavigationTimeout(30000)

  try {
    // ===== PRIMO ACCESSO =====
    log('▶ Step 1: primo accesso — clear localStorage')
    await page.goto(APP_URL, { waitUntil: 'domcontentloaded' })
    // Cancella eventuali flag/sessioni precedenti
    await page.evaluate(() => {
      try { localStorage.clear() } catch {}
    })
    await page.reload({ waitUntil: 'domcontentloaded' })
    await page.waitForSelector('button:has-text("Entra")')

    log('▶ Step 2: login cameriere PIN 1111')
    await pressPin(page, PINS.cameriere)

    // Il tutorial deve apparire automaticamente
    log('▶ Step 3: verifica tutorial visibile dopo login')
    await page.waitForSelector('[role="dialog"][aria-modal="true"]', { timeout: 10000 })
    expect(await tutorialVisible(page)).toBe(true)
    await sleep(800)
    await snap(page, '01-aperto-slide-1')

    // Verifico contatore slide
    const info = await getSlideTotale(page)
    expect(info).not.toBeNull()
    expect(info.cur).toBe(1)
    expect(info.tot).toBeGreaterThan(10) // cameriere ha 17 slide
    log(`   Slide totali rilevate: ${info.tot}`)

    // ===== NAVIGAZIONE AVANTI =====
    log('▶ Step 4: 3 click "Avanti →"')
    for (let i = 0; i < 3; i++) {
      await page.locator('button:has-text("Avanti →")').first().click()
      await sleep(400)
    }
    const info4 = await getSlideTotale(page)
    expect(info4.cur).toBe(4)
    await snap(page, '02-slide-4')

    // ===== INDIETRO =====
    log('▶ Step 5: 2 click "← Indietro"')
    for (let i = 0; i < 2; i++) {
      await page.locator('button:has-text("← Indietro")').first().click()
      await sleep(400)
    }
    const info6 = await getSlideTotale(page)
    expect(info6.cur).toBe(2)

    // ===== TAP IMMAGINE (avanza) =====
    log('▶ Step 6: tap sull\'immagine per avanzare')
    await sleep(400) // attendi fine transizione
    // Le slide sono tutte renderizzate affiancate; solo quella attiva è in viewport.
    // Prendo la img all'indice (cur-1).
    const slideImage = page.locator('[role="dialog"] img').nth(info6.cur - 1)
    await slideImage.click({ timeout: 5000, force: true })
    await sleep(400)
    const info7 = await getSlideTotale(page)
    expect(info7.cur).toBe(3)

    // ===== TASTIERA: freccia destra =====
    log('▶ Step 7: tasto freccia destra')
    await page.keyboard.press('ArrowRight')
    await sleep(400)
    const info8 = await getSlideTotale(page)
    expect(info8.cur).toBe(4)

    // ===== PALLINO: salta alla slide 10 =====
    log('▶ Step 8: click sul 10° pallino')
    const pallini = page.locator('[role="dialog"] button[aria-label^="Vai alla slide"]')
    const tot = info8.tot
    await pallini.nth(9).click({ timeout: 5000 })
    await sleep(400)
    const info9 = await getSlideTotale(page)
    expect(info9.cur).toBe(10)

    // ===== VAI ALL'ULTIMA SLIDE =====
    log(`▶ Step 9: vai all'ultima slide (${tot})`)
    await pallini.nth(tot - 1).click()
    await sleep(500)
    const infoLast = await getSlideTotale(page)
    expect(infoLast.cur).toBe(tot)
    // L'ultima slide deve avere il bottone "Ho capito! Inizia →"
    await expect(page.locator('button:has-text("Ho capito! Inizia →")')).toBeVisible()
    await snap(page, '03-ultima-slide-ho-capito')

    // ===== CLICK "Ho capito!" =====
    log('▶ Step 10: click "Ho capito! Inizia →" — chiude e salva flag')
    await page.locator('button:has-text("Ho capito! Inizia →")').click()
    await page.waitForSelector('[role="dialog"][aria-modal="true"]', { state: 'detached', timeout: 5000 })
    expect(await tutorialVisible(page)).toBe(false)

    // Verifica flag salvato
    const flag = await page.evaluate(() => localStorage.getItem('tutorial_visto_cameriere'))
    expect(flag).toBe('true')
    log(`   ✓ flag localStorage salvato: ${flag}`)

    // ===== FAB ? VISIBILE =====
    log('▶ Step 11: FAB "?" visibile in basso a destra')
    const fab = page.locator('button[aria-label="Apri tutorial"]')
    await expect(fab).toBeVisible()
    await snap(page, '04-fab-presente')

    // ===== TAP FAB → tutorial riappare =====
    log('▶ Step 12: tap FAB → tutorial riapre dalla slide 1')
    await fab.click()
    await page.waitForSelector('[role="dialog"][aria-modal="true"]', { timeout: 5000 })
    const infoReopen = await getSlideTotale(page)
    expect(infoReopen.cur).toBe(1)
    await snap(page, '05-fab-tap-riapre')

    // ===== Skip → flag invariato =====
    log('▶ Step 13: click "Salta" — chiude SENZA cambiare il flag')
    await page.locator('button:has-text("Salta")').click()
    await page.waitForSelector('[role="dialog"][aria-modal="true"]', { state: 'detached', timeout: 5000 })
    const flagDopo = await page.evaluate(() => localStorage.getItem('tutorial_visto_cameriere'))
    expect(flagDopo).toBe('true') // resta true (non cambiato)
    log(`   ✓ flag invariato: ${flagDopo}`)

    // ===== Reload → tutorial NON deve riapparire =====
    log('▶ Step 14: reload → tutorial NON deve aprirsi (flag attivo)')
    await page.reload({ waitUntil: 'domcontentloaded' })
    await page.waitForSelector('button:has-text("Nuovo Tavolo")', { timeout: 10000 })
    await sleep(2000)
    expect(await tutorialVisible(page)).toBe(false)
    log('   ✓ Tutorial non riappare')

    log('✅ Tutti i 14 step passati per il cameriere')
  } finally {
    await ctx.close().catch(() => {})
    await browser.close().catch(() => {})
  }
})

test('tutorial — cross-ruolo cucina', async () => {
  log('🚀 Test tutorial cross-ruolo (cucina)')
  const browser = await chromium.launch({ headless: false, slowMo: SLOW_MO })
  const ctx = await browser.newContext({ viewport: VIEWPORT, userAgent: UA_MOBILE })
  ctx.on('dialog', async d => { try { await d.accept() } catch {} })
  const page = await ctx.newPage()
  page.setDefaultTimeout(ACTION_TIMEOUT)
  page.setDefaultNavigationTimeout(30000)

  try {
    await page.goto(APP_URL, { waitUntil: 'domcontentloaded' })
    await page.evaluate(() => { try { localStorage.clear() } catch {} })
    await page.reload({ waitUntil: 'domcontentloaded' })
    await page.waitForSelector('button:has-text("Entra")')

    log('▶ Login cucina PIN 4444')
    await pressPin(page, PINS.cucina)

    await page.waitForSelector('[role="dialog"][aria-modal="true"]', { timeout: 10000 })
    const info = await getSlideTotale(page)
    expect(info.cur).toBe(1)
    expect(info.tot).toBeGreaterThanOrEqual(6) // cucina ha 8 slide
    log(`   ✓ Tutorial cucina aperto: 1/${info.tot}`)
    await snap(page, '06-cucina-slide-1')

    // Vai all'ultima slide via pallini
    const pallini = page.locator('[role="dialog"] button[aria-label^="Vai alla slide"]')
    await pallini.nth(info.tot - 1).click()
    await sleep(500)
    await snap(page, '07-cucina-ultima')

    // Chiudi con "Ho capito"
    await page.locator('button:has-text("Ho capito! Inizia →")').click()
    await page.waitForSelector('[role="dialog"][aria-modal="true"]', { state: 'detached' })

    const flag = await page.evaluate(() => localStorage.getItem('tutorial_visto_cucina'))
    expect(flag).toBe('true')
    log('   ✓ Flag cucina salvato')

    // Verifica FAB color cucina (rosso): contiene la classe bg-cucina
    const fab = page.locator('button[aria-label="Apri tutorial"]')
    const hasCucinaClass = await fab.evaluate(el => el.className.includes('bg-cucina'))
    expect(hasCucinaClass).toBe(true)
    log('   ✓ FAB ha classe bg-cucina (rosso)')

    log('✅ Test cross-ruolo cucina OK')
  } finally {
    await ctx.close().catch(() => {})
    await browser.close().catch(() => {})
  }
})

// Cattura mirata dei 7 screenshot mancanti dal run principale:
//   cam/09, cam/10, cam/11, cam/12, cas/03, cas/04, adm/03

import { test, chromium } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'

const APP_URL = 'https://sagra-app-coral.vercel.app'

const PINS = {
  cam:    '1111',
  cucina: '4444',
  bar:    '3333',
  cassa:  '0000',
  admin:  '999999',
}

const VIEWPORT = { width: 390, height: 844 }
const UA_MOBILE = 'Mozilla/5.0 (Linux; Android 12; Pixel 6) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Mobile Safari/537.36'
const ACTION_TIMEOUT = 15000
const SLOW_MO = 150

const GUIDA_DIR = path.join('tests', 'guida-screenshots')

const TAVOLO_BANCOMAT = 99
const TAVOLO_STORNO   = 97

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
            : ruolo === 'cassa'     ? 'h1:has-text("Cassa")'
            : ruolo === 'cucina'    ? 'h1:has-text("Cucina")'
            : ruolo === 'bar'       ? 'h1:has-text("Bar")'
            :                          'h1:has-text("Admin")'
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

async function scoutMenu() {
  log('🔍 Scout menu...')
  const browser = await chromium.launch({ headless: false, slowMo: SLOW_MO })
  const ctx = await browser.newContext({ viewport: VIEWPORT, userAgent: UA_MOBILE })
  ctx.on('dialog', async d => { try { await d.accept() } catch {} })
  const page = await ctx.newPage()
  page.setDefaultTimeout(ACTION_TIMEOUT)
  try {
    await loginCon(page, PINS.cam, 'cameriere')
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
      dolci:     result.cucina['Dolci']     || [],
      acque:     result.bar['Acqua']        || [],
      vini: [
        ...(result.bar['Vino sfuso']              || []),
        ...(result.bar['Verdicchio']              || []),
        ...(result.bar["Lacrima di Morro d'Alba"] || []),
      ],
      caffe:     result.bar['Caffè']        || [],
      amari:     result.bar['Amari']        || [],
    }
  } finally {
    await ctx.close().catch(() => {})
    await browser.close().catch(() => {})
  }
}

async function creaOrdine(page, tavoloNum, menu, opts) {
  await page.locator('button:has-text("Nuovo Tavolo")').click()
  await page.waitForSelector('input[placeholder*="capotavola" i]')
  const inputs = page.locator('input[type="number"]')
  await inputs.nth(0).fill(String(tavoloNum))
  await inputs.nth(1).fill(String(opts.persone))
  await page.locator('input[placeholder*="capotavola" i]').fill(opts.nome)

  // M1
  await selezionaTabMandata(page, 1)
  await selezionaTabCategoria(page, 'Cucina')
  if (menu.antipasti.length) await selezionaPiatto(page, menu.antipasti[0], opts.persone)
  await selezionaTabCategoria(page, 'Bar')
  if (menu.acque.length) await selezionaPiatto(page, menu.acque[0], opts.persone)
  if (menu.vini.length)  await selezionaPiatto(page, menu.vini[0],  opts.persone)

  // M2
  await selezionaTabMandata(page, 2)
  await selezionaTabCategoria(page, 'Cucina')
  if (menu.primi.length) await selezionaPiatto(page, menu.primi[0], opts.persone)

  // M3
  await selezionaTabMandata(page, 3)
  await selezionaTabCategoria(page, 'Cucina')
  if (menu.secondi.length)  await selezionaPiatto(page, menu.secondi[0],  opts.persone)
  if (menu.contorni.length) await selezionaPiatto(page, menu.contorni[0], opts.persone)

  // M4
  if (opts.includeM4) {
    await selezionaTabMandata(page, 4)
    await selezionaTabCategoria(page, 'Cucina')
    if (menu.dolci.length) await selezionaPiatto(page, menu.dolci[0], opts.persone)
    await selezionaTabCategoria(page, 'Bar')
    if (menu.caffe.length) await selezionaPiatto(page, menu.caffe[0], opts.persone)
    if (menu.amari.length) await selezionaPiatto(page, menu.amari[0], opts.persone)
  }

  const avanti = page.locator('button:has-text("Avanti")').first()
  await avanti.scrollIntoViewIfNeeded()
  await avanti.click()
  await page.waitForSelector('button:has-text("BANCOMAT")')
  await page.locator(opts.isBancomat ? 'button:has-text("BANCOMAT")' : 'button:has-text("CONTANTI")').click()
  await page.waitForSelector('button:has-text("Nuovo Tavolo")')
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

test.setTimeout(900_000) // 15 min

test('cattura screenshot mancanti', async () => {
  log('🚀 Inizio cattura mirata 7 screenshot mancanti')
  const menu = await scoutMenu()
  log('✓ Menu letto')

  let cam = null, cuc = null, bar = null, cas = null, adm = null

  try {
    // ===== CAMERIERE — T99 con M4 (bancomat) =====
    cam = await make()
    await loginCon(cam.page, PINS.cam, 'cameriere')

    log('📝 Crea T99 con M4 (bancomat)')
    await creaOrdine(cam.page, TAVOLO_BANCOMAT, menu, {
      persone: 6, nome: 'Mario', isBancomat: true, includeM4: true,
    })
    // Forza refresh: il realtime non triggera per insert fatto dal client stesso
    await cam.page.reload({ waitUntil: 'domcontentloaded' })
    await cam.page.waitForSelector('button:has-text("Nuovo Tavolo")', { timeout: ACTION_TIMEOUT })
    await sleep(3000)

    // DEBUG: dump dei testi visibili
    const debug = await cam.page.evaluate(() => {
      const lis = Array.from(document.querySelectorAll('li'))
      return lis.slice(0, 20).map(li => (li.textContent || '').slice(0, 120).replace(/\s+/g, ' ').trim()).filter(Boolean)
    })
    log(`🔍 Liste visibili (${debug.length}):`)
    for (const d of debug) log(`   • ${d}`)

    // cam/09 — card in preparazione (subito dopo invio)
    const card99 = cam.page.locator('div.card').filter({ hasText: new RegExp(`Tav\\.?\\s*${TAVOLO_BANCOMAT}\\b`) }).first()
    try {
      await card99.waitFor({ state: 'visible', timeout: 10000 })
      await card99.scrollIntoViewIfNeeded()
      await sleep(500)
      await snap(cam.page, 'cam/09-card-in-preparazione.png', 'Card T99 appena creata, mandate in attesa')
    } catch (e) {
      failed.push('cam/09-card-in-preparazione.png')
      log(`⚠️ card T99 non trovata: ${e.message?.slice(0, 100)}`)
    }

    // cam/11 e cam/12 — apri dettaglio e cattura pulsante Invia M4
    try {
      await card99.click({ timeout: ACTION_TIMEOUT })
      await cam.page.waitForSelector('button:has-text("Invia M4")', { timeout: ACTION_TIMEOUT })
      await sleep(500)
      // Scroll all'inizio per il dettaglio
      await cam.page.evaluate(() => window.scrollTo(0, 0))
      await sleep(400)
      await snap(cam.page, 'cam/11-dettaglio-ordine.png', 'Dettaglio ordine: mandate cucina+bar con stati')

      // Scroll al pulsante Invia M4
      const m4Btn = cam.page.locator('button:has-text("Invia M4")').first()
      await m4Btn.scrollIntoViewIfNeeded()
      await sleep(400)
      await snap(cam.page, 'cam/12-pulsante-invia-m4.png', 'Pulsante "Invia M4" giallo, pulsa')

      // Torna indietro
      await cam.page.getByRole('button', { name: /Indietro/ }).first().click({ timeout: 5000 }).catch(() => {})
      await cam.page.waitForSelector('button:has-text("Nuovo Tavolo")', { timeout: ACTION_TIMEOUT })
    } catch (e) {
      log(`⚠️ Dettaglio T99/Invia M4 fallito: ${e.message?.slice(0, 100)}`)
    }

    // ===== CUCINA + BAR — avanza T99 fino a pronto =====
    cuc = await make()
    bar = await make()
    await loginCon(cuc.page, PINS.cucina, 'cucina')
    await loginCon(bar.page, PINS.bar, 'bar')
    await sleep(1500)

    const advance = async (page, label, max = 14) => {
      for (let i = 0; i < max; i++) {
        const daPrep = page.locator('button').filter({ hasText: /Da preparare/ })
        const inPrep = page.locator('button').filter({ hasText: /In preparazione/ })
        if (await daPrep.count() > 0) {
          try { await daPrep.first().click({ timeout: 8000 }) } catch { break }
          await sleep(600)
        } else if (await inPrep.count() > 0) {
          try { await inPrep.first().click({ timeout: 8000 }) } catch { break }
          await sleep(600)
        } else break
      }
      log(`✓ ${label} avanzato`)
    }

    log('🍳 Cucina + Bar avanzano stati T99')
    await advance(cuc.page, 'Cucina', 10)
    await advance(bar.page, 'Bar', 8)
    await sleep(2000)

    // cam/10 — card pronta (refresh cameriere)
    try {
      await cam.page.reload()
      await cam.page.waitForSelector('button:has-text("Nuovo Tavolo")', { timeout: ACTION_TIMEOUT })
      await sleep(1500)
      const card99p = cam.page.locator('div.card').filter({ hasText: new RegExp(`Tav\\.?\\s*${TAVOLO_BANCOMAT}\\b`) }).first()
      if (await card99p.count() > 0) {
        await card99p.scrollIntoViewIfNeeded()
        await sleep(500)
        await snap(cam.page, 'cam/10-card-pronta.png', 'Card T99 con mandate pronte/in preparazione')
      } else {
        failed.push('cam/10-card-pronta.png')
        log('⚠️ card T99 sparita dalla lista cameriere')
      }
    } catch (e) {
      log(`⚠️ Card pronta cameriere: ${e.message?.slice(0, 100)}`)
    }

    // ===== STORNO — T97 (bancomat) =====
    log('📝 Crea T97 bancomat (per storno)')
    await creaOrdine(cam.page, TAVOLO_STORNO, menu, {
      persone: 4, nome: 'Luca', isBancomat: true, includeM4: false,
    })
    await cam.page.reload({ waitUntil: 'domcontentloaded' })
    await cam.page.waitForSelector('button:has-text("Nuovo Tavolo")', { timeout: ACTION_TIMEOUT })
    await sleep(2000)

    const card97 = cam.page.locator('div.card').filter({ hasText: new RegExp(`Tav\\.?\\s*${TAVOLO_STORNO}\\b`) }).first()
    try {
      await card97.waitFor({ state: 'visible', timeout: 10000 })
      await card97.scrollIntoViewIfNeeded()
      await card97.click({ timeout: ACTION_TIMEOUT })
      // Selettore corretto: "Storna ordine" (testo completo del bottone, senza emoji match)
      const stornaBtn = cam.page.locator('button:has-text("Storna ordine")').first()
      await stornaBtn.waitFor({ state: 'visible', timeout: ACTION_TIMEOUT })
      await stornaBtn.scrollIntoViewIfNeeded()
      await sleep(300)
      await stornaBtn.click({ timeout: ACTION_TIMEOUT })
      // dialog accept gestito da context
      await sleep(2500)
      log('✓ T97 stornato')
    } catch (e) {
      log(`⚠️ Storno T97 fallito: ${e.message?.slice(0, 100)}`)
    }

    // ===== CASSA — cattura stornato e ri-conferma =====
    cas = await make()
    await loginCon(cas.page, PINS.cassa, 'cassa')
    await sleep(2000)

    try {
      const cardStor = cas.page.locator('main li').filter({ hasText: new RegExp(`Tav\\.?\\s*${TAVOLO_STORNO}`) }).first()
      await cardStor.waitFor({ state: 'visible', timeout: 10000 })
      await cardStor.scrollIntoViewIfNeeded()
      await cardStor.click({ timeout: ACTION_TIMEOUT })
      await cas.page.waitForSelector('button:has-text("Ri-conferma Bancomat")', { timeout: ACTION_TIMEOUT })
      await sleep(500)
      await snap(cas.page, 'cas/03-storno-due-pulsanti.png', 'Ordine stornato in cassa: scelta Bancomat / Contanti')

      // Ri-conferma con CONTANTI
      await cas.page.locator('button:has-text("Ri-conferma Contanti")').first().click({ timeout: ACTION_TIMEOUT })
      await sleep(2500)
      await snap(cas.page, 'cas/04-incassato.png', 'Cassa: dopo ri-conferma, lista aggiornata')
    } catch (e) {
      log(`⚠️ Storno cassa: ${e.message?.slice(0, 100)}`)
    }

    // ===== ADMIN — tab Menu, scroll alla sezione Bar =====
    adm = await make()
    await loginCon(adm.page, PINS.admin, 'admin')
    await sleep(1500)

    try {
      await adm.page.locator('button:has-text("Menu")').first().click({ timeout: 5000 })
      await sleep(1500)
      // Cerca header "Bar" nel tab menu (è un h2 o h3 con titolo "Bar")
      await adm.page.evaluate(() => {
        const els = Array.from(document.querySelectorAll('h2, h3, p, span'))
        const bar = els.find(el => (el.textContent || '').trim() === 'Bar' && !el.closest('button'))
        if (bar) bar.scrollIntoView({ block: 'start', behavior: 'instant' })
        else window.scrollTo(0, document.body.scrollHeight) // fallback: scroll giù
      })
      await sleep(800)
      await snap(adm.page, 'adm/03-tab-menu-bar.png', 'Gestione menu — sezione Bar (sotto cucina)')
    } catch (e) {
      log(`⚠️ Admin menu bar: ${e.message?.slice(0, 100)}`)
    }

    log(`📸 ════════ FINE — ${captured.length} OK · ${failed.length} KO ════════`)
    if (failed.length) for (const f of failed) log(`  ✗ ${f}`)
  } finally {
    await chiudi(cam)
    await chiudi(cuc)
    await chiudi(bar)
    await chiudi(cas)
    await chiudi(adm)
  }
})

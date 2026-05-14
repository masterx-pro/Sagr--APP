// Stress test serata completa — Festa Manager v2
// 10 camerieri + 1 cassa + 2 cucine + 2 bar paralleli su produzione.

import { test, chromium } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'

const APP_URL = 'https://sagra-app-coral.vercel.app'

// 10 camerieri (10 worker, 20 tavoli a testa = 200 ordini totali)
const PINS = ['1111', '2222', '1234', '5678', '9123', '4567', '1111', '2222', '1234', '5678']
const PINS_FALLBACK = ['1111', '2222', '1234', '5678', '9123', '4567']

const NOMI = ['Mattia','Marco','Sara','Luca','Anna','Paolo','Giulia','Roberto','Elena','Francesco',
              'Chiara','Davide','Martina','Andrea','Sofia','Lorenzo','Alice','Stefano','Valentina','Riccardo']

const PIN_CASSA  = '0000'
const PIN_CUCINA = '4444'
const PIN_BAR    = '3333'

const TAVOLI_PER_CAMERIERE = 20
const TAVOLI_TOT = 20
const PERSONE_MIN = 4
const PERSONE_MAX = 8

const VIEWPORT = { width: 390, height: 844 }
const UA_MOBILE = 'Mozilla/5.0 (Linux; Android 12; Pixel 6) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Mobile Safari/537.36'

const ACTION_TIMEOUT = 15000
const TOTAL_TIMEOUT = 1800000 // 30 min
const SLOW_MO = 50

const SCREENSHOTS_DIR = path.join('tests', 'screenshots')
if (!fs.existsSync(SCREENSHOTS_DIR)) fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true })

// =============================================================
// STATS GLOBALI
// =============================================================

const stats = {
  startTime: Date.now(),
  camerieri: PINS.map((p, i) => ({
    idx: i, pin: p,
    successo: 0, fallito: 0,
    bancomat: 0, contanti: 0,
  })),
  cassa: { incassati: 0, errori: 0 },
  cucina: [
    { idx: 0, prontoCount: 0, errori: 0 },
    { idx: 1, prontoCount: 0, errori: 0 },
  ],
  consegnatoCount: 0,
  bar: [
    { idx: 0, m1Pronto: 0, m2Pronto: 0, errori: 0 },
    { idx: 1, m1Pronto: 0, m2Pronto: 0, errori: 0 },
  ],
  m2Sbloccate: 0,
  errori: { timeout: 0, selector: 0, rete: 0, altro: 0, totali: 0 },
  stopRequested: false,
}

// =============================================================
// HELPERS
// =============================================================

function ts() {
  return new Date().toISOString().slice(11, 19)
}

function log(msg) {
  console.log(`[${ts()}] ${msg}`)
}

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

async function screenshot(page, tag) {
  try {
    const f = path.join(SCREENSHOTS_DIR, `err-${Date.now()}-${tag}.png`)
    await page.screenshot({ path: f, fullPage: false })
  } catch {}
}

function rand(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min }
function pick(arr) { return arr && arr.length ? arr[Math.floor(Math.random() * arr.length)] : null }
function sleep(ms) { return new Promise(r => setTimeout(r, ms)) }
function escapeRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') }

function totSuccessCamerieri() {
  return stats.camerieri.reduce((s, c) => s + c.successo, 0)
}
function totFailedCamerieri() {
  return stats.camerieri.reduce((s, c) => s + c.fallito, 0)
}

// =============================================================
// STATS PRINTER
// =============================================================

let statsTimer = null
function startStatsPrinter() {
  statsTimer = setInterval(() => {
    const elapsed = Math.floor((Date.now() - stats.startTime) / 1000)
    const cucPronte = stats.cucina.reduce((s, c) => s + c.prontoCount, 0)
    const barM1 = stats.bar.reduce((s, b) => s + b.m1Pronto, 0)
    const barM2 = stats.bar.reduce((s, b) => s + b.m2Pronto, 0)
    log(`📊 [${elapsed}s] Ordini: ${totSuccessCamerieri()}✅ ${totFailedCamerieri()}❌ · Cassa: ${stats.cassa.incassati} · Cuc: ${cucPronte}P/${stats.consegnatoCount}C · Bar: ${barM1}M1/${barM2}M2 · Errori: ${stats.errori.totali}`)
  }, 30000)
}

function stopStatsPrinter() {
  if (statsTimer) clearInterval(statsTimer)
}

// =============================================================
// LOGIN
// =============================================================

async function pressPin(page, pin) {
  for (const c of pin) {
    await page.locator('button').filter({ hasText: new RegExp(`^${c}$`) }).first().click({ timeout: ACTION_TIMEOUT })
  }
  await page.locator('button', { hasText: 'Entra' }).first().click({ timeout: ACTION_TIMEOUT })
}

async function loginConFallback(page, pinIniziale, ruolo) {
  const candidatePins = ruolo === 'cameriere'
    ? [pinIniziale, ...PINS_FALLBACK.filter(p => p !== pinIniziale)]
    : [pinIniziale]
  for (const pin of candidatePins) {
    try {
      await page.goto(APP_URL, { waitUntil: 'domcontentloaded', timeout: 30000 })
      await page.waitForSelector('button:has-text("Entra")', { timeout: ACTION_TIMEOUT })
      await pressPin(page, pin)
      const sel = ruolo === 'cameriere' ? 'button:has-text("Nuovo Tavolo")'
                : ruolo === 'cassa'     ? 'h1:has-text("Cassa")'
                : ruolo === 'cucina'    ? 'h1:has-text("Cucina")'
                :                          'h1:has-text("Bar")'
      await page.waitForSelector(sel, { timeout: ACTION_TIMEOUT })
      return pin
    } catch (e) {
      log(`⚠️  Login PIN ${pin} fallito per ${ruolo}: ${String(e.message || e).slice(0, 100)}`)
    }
  }
  throw new Error(`Login fallito definitivamente per ruolo ${ruolo}`)
}

// =============================================================
// SCOUT: leggo il menu dal DOM
// =============================================================

async function scoutMenu(page) {
  const result = { cucina: {}, bar: {} }
  await page.locator('button:has-text("Nuovo Tavolo")').click()
  await page.waitForSelector('input[placeholder*="capotavola" i]', { timeout: ACTION_TIMEOUT })

  for (const cat of ['Cucina', 'Bar']) {
    const key = cat.toLowerCase()
    await page.locator('button').filter({ hasText: new RegExp(`^${cat}$`) }).first().click()
    await sleep(400)

    const lis = await page.locator('ul > li').all()
    let currentGroup = null
    for (const li of lis) {
      let txt = ''
      try { txt = (await li.innerText({ timeout: 1500 })).trim() } catch { continue }
      const m = txt.match(/^—\s*(.+?)\s*—$/m)
      if (m) {
        currentGroup = m[1]
        if (!result[key][currentGroup]) result[key][currentGroup] = []
        continue
      }
      if (!currentGroup) continue
      let nome = null
      try { nome = (await li.locator('p').first().innerText({ timeout: 800 })).trim() } catch {}
      if (nome) result[key][currentGroup].push(nome)
    }
  }

  // Torna alla lista
  try { await page.goBack({ waitUntil: 'domcontentloaded' }) } catch {}
  const inLista = await page.locator('button:has-text("Nuovo Tavolo")').count()
  if (!inLista) {
    await page.goto(APP_URL, { waitUntil: 'domcontentloaded' })
    await page.waitForSelector('button:has-text("Nuovo Tavolo")', { timeout: ACTION_TIMEOUT })
  }
  return result
}

// =============================================================
// CAMERIERE WORKER
// =============================================================

async function selezionaQty(page, nome, qty) {
  const row = page.locator('li').filter({
    has: page.locator('p', { hasText: new RegExp(`^${escapeRe(nome)}$`) }),
  }).first()
  await row.waitFor({ state: 'visible', timeout: ACTION_TIMEOUT })
  const plus = row.locator('button', { hasText: '+' }).first()
  for (let i = 0; i < qty; i++) {
    await plus.click({ timeout: ACTION_TIMEOUT })
  }
}

async function creaOrdineCameriere(page, camIdx, tavoloNum, menu) {
  const persone = rand(PERSONE_MIN, PERSONE_MAX)
  const nome = pick(NOMI)
  const isBancomat = Math.random() < 0.5

  await page.locator('button:has-text("Nuovo Tavolo")').click({ timeout: ACTION_TIMEOUT })
  await page.waitForSelector('input[placeholder*="capotavola" i]', { timeout: ACTION_TIMEOUT })

  const inputs = page.locator('input[type="number"]')
  await inputs.nth(0).fill(String(tavoloNum))
  await inputs.nth(1).fill(String(persone))
  await page.locator('input[placeholder*="capotavola" i]').fill(nome)

  // === M1 ===
  await page.locator('button').filter({ hasText: /^M1(\s|$)/ }).first().click()
  await sleep(80)
  await page.locator('button').filter({ hasText: /^Cucina$/ }).first().click()
  await sleep(80)
  const antipasto = pick(menu.cucina['Antipasti'])
  const primo     = pick(menu.cucina['Primi'])
  if (antipasto) await selezionaQty(page, antipasto, persone)
  if (primo)     await selezionaQty(page, primo, persone)

  await page.locator('button').filter({ hasText: /^Bar$/ }).first().click()
  await sleep(80)
  const acqua = pick(menu.bar['Acqua'])
  const vinoGroups = ['Vino sfuso', 'Verdicchio', "Lacrima di Morro d'Alba"]
  let vino = null
  for (const g of vinoGroups) {
    if (menu.bar[g] && menu.bar[g].length) { vino = pick(menu.bar[g]); break }
  }
  if (acqua) await selezionaQty(page, acqua, persone)
  if (vino)  await selezionaQty(page, vino, persone)

  // === M2 ===
  await page.locator('button').filter({ hasText: /^M2(\s|$|\s·|\s+\d)/ }).first().click()
  await sleep(80)
  await page.locator('button').filter({ hasText: /^Cucina$/ }).first().click()
  await sleep(80)
  const secondo = pick(menu.cucina['Secondi'])
  if (secondo) await selezionaQty(page, secondo, persone)

  // === M3 ===
  await page.locator('button').filter({ hasText: /^M3(\s|$|\s·|\s+\d)/ }).first().click()
  await sleep(80)
  await page.locator('button').filter({ hasText: /^Cucina$/ }).first().click()
  await sleep(80)
  const dolce = pick(menu.cucina['Dolci'])
  if (dolce) await selezionaQty(page, dolce, persone)

  // === PAGAMENTO ===
  await page.locator('button:has-text("Avanti")').click({ timeout: ACTION_TIMEOUT })
  await page.waitForSelector('button:has-text("BANCOMAT")', { timeout: ACTION_TIMEOUT })

  if (isBancomat) {
    await page.locator('button:has-text("BANCOMAT")').click()
  } else {
    await page.locator('button:has-text("CONTANTI")').click()
  }

  await page.waitForSelector('button:has-text("Nuovo Tavolo")', { timeout: ACTION_TIMEOUT })
  return { bancomat: isBancomat }
}

async function workerCameriere(camIdx, scoutMenuData) {
  const browser = await chromium.launch({ headless: true, slowMo: SLOW_MO })
  const context = await browser.newContext({ viewport: VIEWPORT, userAgent: UA_MOBILE })
  context.on('dialog', async d => { try { await d.accept() } catch {} })
  const page = await context.newPage()
  page.setDefaultTimeout(ACTION_TIMEOUT)
  page.setDefaultNavigationTimeout(30000)
  const cam = stats.camerieri[camIdx]

  try {
    const usedPin = await loginConFallback(page, cam.pin, 'cameriere')
    if (usedPin !== cam.pin) {
      log(`ℹ️  Cam[${camIdx}] fallback su PIN ${usedPin}`)
      cam.pin = usedPin
    }
    log(`🟢 Cam[${camIdx}] PIN ${cam.pin}: pronto`)

    for (let t = 1; t <= TAVOLI_PER_CAMERIERE; t++) {
      if (stats.stopRequested) break
      const tavoloNum = ((t - 1) % TAVOLI_TOT) + 1
      let attempt = 0
      let ok = false
      while (attempt < 3 && !ok) {
        attempt++
        try {
          const r = await creaOrdineCameriere(page, camIdx, tavoloNum, scoutMenuData)
          cam.successo++
          if (r.bancomat) cam.bancomat++; else cam.contanti++
          ok = true
        } catch (e) {
          logErr(`Cam[${camIdx}] T${tavoloNum} tentativo ${attempt}`, e)
          await screenshot(page, `cam${camIdx}-t${tavoloNum}`)
          try {
            await page.goto(APP_URL, { waitUntil: 'domcontentloaded' })
            await page.waitForSelector('button:has-text("Nuovo Tavolo")', { timeout: ACTION_TIMEOUT })
          } catch {
            try {
              const re = await loginConFallback(page, cam.pin, 'cameriere')
              cam.pin = re
            } catch {}
          }
        }
      }
      if (!ok) {
        cam.fallito++
        log(`⏭️  Cam[${camIdx}] skip T${tavoloNum} dopo 3 tentativi`)
      }
      await sleep(300)
    }
  } catch (e) {
    logErr(`Cam[${camIdx}] fatal`, e)
  } finally {
    await context.close().catch(() => {})
    await browser.close().catch(() => {})
    log(`🏁 Cam[${camIdx}] terminato: ${cam.successo}✅ / ${cam.fallito}❌`)
  }
}

// =============================================================
// CASSA WORKER
// =============================================================

async function workerCassa() {
  const browser = await chromium.launch({ headless: true, slowMo: SLOW_MO })
  const context = await browser.newContext({ viewport: VIEWPORT, userAgent: UA_MOBILE })
  context.on('dialog', async d => { try { await d.accept() } catch {} })
  const page = await context.newPage()
  page.setDefaultTimeout(ACTION_TIMEOUT)
  page.setDefaultNavigationTimeout(30000)

  try {
    await loginConFallback(page, PIN_CASSA, 'cassa')
    log(`🟢 Cassa: pronta`)

    while (!stats.stopRequested) {
      try {
        const cards = page.locator('main li').filter({ hasText: /Tav\./ })
        const n = await cards.count()
        if (n === 0) { await sleep(2000); continue }
        await cards.first().click({ timeout: ACTION_TIMEOUT })
        await page.locator('button:has-text("Incassato")').click({ timeout: ACTION_TIMEOUT })
        stats.cassa.incassati++
        await sleep(300)
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
// STAZIONE WORKER (cucina / bar)
// =============================================================

async function workerStazione(ruolo, idx) {
  const browser = await chromium.launch({ headless: true, slowMo: SLOW_MO })
  const context = await browser.newContext({ viewport: VIEWPORT, userAgent: UA_MOBILE })
  context.on('dialog', async d => { try { await d.accept() } catch {} })
  const page = await context.newPage()
  page.setDefaultTimeout(ACTION_TIMEOUT)
  page.setDefaultNavigationTimeout(30000)
  const counter = ruolo === 'cucina' ? stats.cucina[idx] : stats.bar[idx]

  try {
    const pin = ruolo === 'cucina' ? PIN_CUCINA : PIN_BAR
    await loginConFallback(page, pin, ruolo)
    log(`🟢 ${ruolo}[${idx}]: pronto`)

    while (!stats.stopRequested) {
      try {
        const btns = page.locator('button').filter({ hasText: /Pronta M\d+/ })
        const n = await btns.count()
        if (n === 0) { await sleep(2000); continue }

        const first = btns.first()
        const txt = (await first.innerText({ timeout: 2000 })).trim()
        await first.click({ timeout: ACTION_TIMEOUT })

        const mn = txt.match(/M(\d+)/)
        const mandataN = mn ? parseInt(mn[1], 10) : 1
        if (ruolo === 'cucina') counter.prontoCount++
        else {
          if (mandataN === 2) counter.m2Pronto++
          else counter.m1Pronto++
        }
        await sleep(300)
      } catch (e) {
        counter.errori++
        logErr(`${ruolo}[${idx}]`, e)
        try {
          await page.goto(APP_URL, { waitUntil: 'domcontentloaded' })
          await page.waitForSelector(`h1:has-text("${ruolo === 'cucina' ? 'Cucina' : 'Bar'}")`, { timeout: ACTION_TIMEOUT })
        } catch {}
        await sleep(1500)
      }
    }
  } catch (e) {
    logErr(`${ruolo}[${idx}] fatal`, e)
  } finally {
    await context.close().catch(() => {})
    await browser.close().catch(() => {})
    log(`🏁 ${ruolo}[${idx}] terminato`)
  }
}

// =============================================================
// RIEPILOGO FINALE
// =============================================================

function stampaRiepilogo() {
  const dur = Math.floor((Date.now() - stats.startTime) / 1000)
  const min = Math.floor(dur / 60)
  const sec = dur % 60

  const totSuccesso = totSuccessCamerieri()
  const totFallito  = totFailedCamerieri()
  const stimaClienti = stats.camerieri.reduce((s, c) => s + c.successo * 6, 0)
  const pctSuccesso = totSuccesso + totFallito > 0
    ? Math.round(100 * totSuccesso / (totSuccesso + totFallito))
    : 0

  const cucPronte = stats.cucina.reduce((s, c) => s + c.prontoCount, 0)
  const barM1 = stats.bar.reduce((s, b) => s + b.m1Pronto, 0)
  const barM2 = stats.bar.reduce((s, b) => s + b.m2Pronto, 0)

  const out = []
  out.push('')
  out.push('╔══════════════════════════════════════╗')
  out.push('║   STRESS TEST - SERATA COMPLETA     ║')
  out.push('║   1000 clienti · 20 tavoli · 10 cam ║')
  out.push('╚══════════════════════════════════════╝')
  out.push('')
  out.push(`⏱️  Durata totale: ${dur}s (${min}m ${sec}s)`)
  out.push('')
  out.push('CAMERIERI (10):')
  for (const c of stats.camerieri) {
    out.push(`  Cam[${c.idx}] PIN[${c.pin}]: ${c.successo}/${TAVOLI_PER_CAMERIERE} tavoli ✅  ${c.fallito} ❌  (${c.bancomat} bancomat, ${c.contanti} contanti)`)
  }
  out.push('')
  out.push('CASSA:')
  out.push(`  Ordini incassati: ${stats.cassa.incassati}`)
  out.push(`  Errori cassa: ${stats.cassa.errori}`)
  out.push('')
  out.push('CUCINA:')
  out.push(`  Mandate marcate pronte: ${cucPronte}`)
  out.push(`  Mandate marcate consegnate: ${stats.consegnatoCount}`)
  out.push('')
  out.push('BAR:')
  out.push(`  Mandate M1 pronte: ${barM1}`)
  out.push(`  Mandate M2 sbloccate: ${stats.m2Sbloccate}`)
  out.push(`  Mandate M2 pronte: ${barM2}`)
  out.push('')
  out.push(`ERRORI TOTALI: ${stats.errori.totali}`)
  out.push(`  - Timeout: ${stats.errori.timeout}`)
  out.push(`  - Selector: ${stats.errori.selector}`)
  out.push(`  - Rete: ${stats.errori.rete}`)
  out.push(`  - Altri: ${stats.errori.altro}`)
  out.push('')
  out.push(`STIMA CLIENTI SERVITI: ${stimaClienti} (${pctSuccesso}%)`)
  out.push('╔══════════════════════════════════════╗')
  out.push('║  CHECK ADMIN - verifica su:         ║')
  out.push('║  https://sagra-app-coral.vercel.app ║')
  out.push('║  PIN 999999 → tab Riepilogo         ║')
  out.push('╚══════════════════════════════════════╝')
  console.log(out.join('\n'))
}

// =============================================================
// TEST PRINCIPALE
// =============================================================

test.setTimeout(TOTAL_TIMEOUT)

test('stress test serata completa', async () => {
  log('🚀 Avvio stress test')
  log(`   Target: ${APP_URL}`)
  log(`   Camerieri: 10  ·  Cassa: 1  ·  Cucina: 2  ·  Bar: 2`)
  log(`   Tavoli per cameriere: ${TAVOLI_PER_CAMERIERE} (≈ 200 ordini totali)`)

  // SCOUT
  log('🔍 Scout del menu disponibile...')
  let scoutData
  {
    const browser = await chromium.launch({ headless: true })
    const ctx = await browser.newContext({ viewport: VIEWPORT, userAgent: UA_MOBILE })
    ctx.on('dialog', async d => { try { await d.accept() } catch {} })
    const p = await ctx.newPage()
    try {
      await loginConFallback(p, PINS[0], 'cameriere')
      scoutData = await scoutMenu(p)
      log(`   Cucina: ${Object.entries(scoutData.cucina).map(([k, v]) => `${k}(${v.length})`).join(' ')}`)
      log(`   Bar:    ${Object.entries(scoutData.bar).map(([k, v]) => `${k}(${v.length})`).join(' ')}`)
    } finally {
      await ctx.close()
      await browser.close()
    }
  }

  startStatsPrinter()

  const camPromises = []
  for (let i = 0; i < PINS.length; i++) {
    camPromises.push((async (idx) => {
      await sleep(idx * 500)
      await workerCameriere(idx, scoutData)
    })(i))
  }

  const cassaPromise = workerCassa()
  const cucinaPromises = [workerStazione('cucina', 0), workerStazione('cucina', 1)]
  const barPromises    = [workerStazione('bar', 0),    workerStazione('bar', 1)]

  await Promise.allSettled(camPromises)
  log('✅ Tutti i camerieri hanno finito')

  log('⏳ Attendo 60s per cassa/stazioni di processare il backlog...')
  for (let s = 0; s < 60; s++) await sleep(1000)

  stats.stopRequested = true
  log('🛑 Stop richiesto a cassa/cucina/bar')

  await Promise.allSettled([cassaPromise, ...cucinaPromises, ...barPromises])

  stopStatsPrinter()
  stampaRiepilogo()
})

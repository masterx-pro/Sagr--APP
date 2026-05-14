import { test, chromium } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const APP_URL = 'https://sagra-app-coral.vercel.app';
const STEP_DELAY = 300;
const ACTION_TIMEOUT = 30_000;
const SCREENSHOT_DIR = path.join(process.cwd(), 'tests', 'screenshots');
fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });

const CAMERIERI = [
  { id: 0, pin: '1234', from: 1,   to: 63  },
  { id: 1, pin: '5678', from: 64,  to: 126 },
  { id: 2, pin: '9123', from: 127, to: 189 },
  { id: 3, pin: '4567', from: 190, to: 252 },
];

const STATIONS = [
  { role: 'bar',    pin: '3333', idx: 0 },
  { role: 'bar',    pin: '3333', idx: 1 },
  { role: 'cucina', pin: '4444', idx: 0 },
  { role: 'cucina', pin: '4444', idx: 1 },
];

const log = (prefix, msg) => console.log(`[${prefix}] ${msg}`);

function shuffleAndTake(arr, n) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a.slice(0, Math.min(n, a.length));
}

async function snapshot(page, name) {
  try {
    await page.screenshot({
      path: path.join(SCREENSHOT_DIR, `${name}.png`),
      fullPage: true,
    });
  } catch {}
}

// -------------------- LOGIN --------------------

async function login(page, pin) {
  await page.goto(APP_URL, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('button:has-text("Entra")', { timeout: ACTION_TIMEOUT });
  for (const d of pin.split('')) {
    await page.getByRole('button', { name: d, exact: true }).click({ timeout: ACTION_TIMEOUT });
    await page.waitForTimeout(120);
  }
  await page.getByRole('button', { name: 'Entra', exact: true }).click({ timeout: ACTION_TIMEOUT });
}

// -------------------- INSPECT MENU --------------------

async function getCategorieIndices(page) {
  // Per la tab attualmente attiva, restituisce
  // { 'ANTIPASTI': [0,1,2], 'PRIMI': [3,4], ... } dove i numeri
  // sono indici nell'array di li.card visibili (ordine DOM).
  return await page.evaluate(() => {
    const groups = {};
    const lis = Array.from(document.querySelectorAll('ul > li'));
    let current = null;
    let itemIdx = 0;
    for (const li of lis) {
      const text = (li.textContent || '').trim();
      const sepMatch = text.match(/^—\s*(.+?)\s*—$/);
      const isItem = li.classList.contains('card');
      if (sepMatch && !isItem) {
        current = sepMatch[1].trim().toUpperCase();
        if (!groups[current]) groups[current] = [];
        continue;
      }
      if (isItem) {
        if (current) groups[current].push(itemIdx);
        itemIdx++;
      }
    }
    return groups;
  });
}

async function clickRandomFromCategoria(page, groups, label, n, logFn) {
  const indices = groups[label.toUpperCase()] || [];
  if (indices.length === 0) {
    logFn(`   ⚠ nessun item in "${label}"`);
    return 0;
  }
  const chosen = shuffleAndTake(indices, n);
  const rows = page.locator('li.card').filter({
    has: page.getByRole('button', { name: '+', exact: true }),
  });
  let clicked = 0;
  for (const realIdx of chosen) {
    try {
      await rows.nth(realIdx)
        .getByRole('button', { name: '+', exact: true })
        .click({ timeout: ACTION_TIMEOUT });
      await page.waitForTimeout(STEP_DELAY);
      clicked++;
    } catch (e) {
      logFn(`   ⚠ click + fallito (idx ${realIdx}): ${e.message.slice(0, 60)}`);
    }
  }
  return clicked;
}

// -------------------- CAMERIERE --------------------

async function placeOrder(page, numeroTavolo, logFn) {
  await page.getByRole('button', { name: /\+\s*Nuovo Tavolo/ })
    .click({ timeout: ACTION_TIMEOUT });
  await page.waitForSelector('input[placeholder="es. 12"]', { timeout: ACTION_TIMEOUT });
  await page.waitForTimeout(STEP_DELAY);

  await page.getByLabel('N. Tavolo').fill(String(numeroTavolo));
  await page.waitForTimeout(STEP_DELAY);
  await page.getByLabel('N. Persone').fill('4');
  await page.waitForTimeout(STEP_DELAY);

  // Tab Cucina
  await page.getByRole('button', { name: 'Cucina', exact: true })
    .click({ timeout: ACTION_TIMEOUT });
  await page.waitForTimeout(STEP_DELAY);
  const cucinaGroups = await getCategorieIndices(page);
  const nAnti = 1 + Math.floor(Math.random() * 2);  // 1 o 2
  const cAnti = await clickRandomFromCategoria(page, cucinaGroups, 'ANTIPASTI', nAnti, logFn);
  const cPrim = await clickRandomFromCategoria(page, cucinaGroups, 'PRIMI', 4, logFn);
  const cSec  = await clickRandomFromCategoria(page, cucinaGroups, 'SECONDI', 4, logFn);
  const cDol  = await clickRandomFromCategoria(page, cucinaGroups, 'DOLCI', 2, logFn);

  // Tab Bar
  await page.getByRole('button', { name: 'Bar', exact: true })
    .click({ timeout: ACTION_TIMEOUT });
  await page.waitForTimeout(STEP_DELAY);
  const barGroups = await getCategorieIndices(page);
  const cAcq = await clickRandomFromCategoria(page, barGroups, 'ACQUA', 4, logFn);
  const cVin = await clickRandomFromCategoria(page, barGroups, 'VINO SFUSO', 2, logFn);

  logFn(`   t${numeroTavolo}: cucina(A${cAnti}/P${cPrim}/S${cSec}/D${cDol}) bar(W${cAcq}/V${cVin})`);

  await page.getByRole('button', { name: 'Invia Ordine', exact: true })
    .click({ timeout: ACTION_TIMEOUT });
  // confirm pagamento auto-accettato dal dialog handler
  await page.waitForSelector('button:has-text("+ Nuovo Tavolo")', { timeout: ACTION_TIMEOUT });
  await page.waitForTimeout(STEP_DELAY);
}

async function runCameriere(browser, cam, errors) {
  const logFn = (msg) => log(`C${cam.id} PIN ${cam.pin}`, msg);
  const context = await browser.newContext();
  const page = await context.newPage();
  page.on('dialog', d => d.accept());
  page.on('pageerror', err => logFn(`[pageerror] ${err.message.slice(0, 100)}`));

  let success = 0;
  const total = cam.to - cam.from + 1;
  const t0 = Date.now();

  try {
    logFn(`login...`);
    await login(page, cam.pin);
    await page.waitForSelector('button:has-text("+ Nuovo Tavolo")', { timeout: ACTION_TIMEOUT });
    logFn(`logged in, ${total} ordini da fare`);

    for (let tavolo = cam.from; tavolo <= cam.to; tavolo++) {
      try {
        await placeOrder(page, tavolo, logFn);
        success++;
        if (success % 10 === 0) {
          const elapsed = ((Date.now() - t0) / 1000).toFixed(0);
          logFn(`progress ${success}/${total} (${elapsed}s)`);
        }
      } catch (err) {
        const short = err.message.slice(0, 100);
        logFn(`❌ tavolo ${tavolo}: ${short}`);
        errors.push({ who: `C${cam.id}`, tavolo, msg: short });
        await snapshot(page, `err-c${cam.id}-t${tavolo}`);
        // Recovery: torna alla lista o re-login
        try {
          await page.goto(APP_URL, { waitUntil: 'domcontentloaded', timeout: 15000 });
          if (await page.getByRole('button', { name: 'Entra', exact: true }).count()) {
            await login(page, cam.pin);
          }
          await page.waitForSelector('button:has-text("+ Nuovo Tavolo")', { timeout: 15000 });
        } catch (e) {
          logFn(`recovery fallita: ${e.message.slice(0, 80)}`);
        }
      }
    }
  } catch (err) {
    logFn(`❌ FATAL: ${err.message}`);
    errors.push({ who: `C${cam.id}`, fatal: err.message });
  } finally {
    await context.close();
  }

  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
  logFn(`✅ done ${success}/${total} in ${elapsed}s`);
  return { id: cam.id, pin: cam.pin, success, total };
}

// -------------------- STATION (BAR/CUCINA) --------------------

async function runStation(browser, station, getCamerieriDone, errors) {
  const tag = `${station.role.toUpperCase()}-${station.idx}`;
  const logFn = (msg) => log(tag, msg);
  const context = await browser.newContext();
  const page = await context.newPage();
  page.on('dialog', d => d.accept());
  page.on('pageerror', err => logFn(`[pageerror] ${err.message.slice(0, 100)}`));

  let confirmed = 0;

  try {
    logFn(`login...`);
    await login(page, station.pin);
    await page.waitForSelector('button:has-text("Esci")', { timeout: ACTION_TIMEOUT });
    await page.waitForTimeout(1000);
    logFn(`logged in, in ascolto`);

    while (true) {
      try {
        const buttons = page.getByRole('button', { name: 'Tutto Pronto', exact: true });
        let clickedThisRound = 0;
        // Clicco sempre nth(0): la lista si accorcia ad ogni click
        let safety = 50;
        while (safety-- > 0) {
          const c = await buttons.count();
          if (c === 0) break;
          try {
            await buttons.first().click({ timeout: 5000 });
            confirmed++;
            clickedThisRound++;
            await page.waitForTimeout(STEP_DELAY);
          } catch {
            // Race con altro worker sullo stesso click — esco e ricontrollo
            break;
          }
        }
        if (clickedThisRound > 0) logFn(`+${clickedThisRound} (totale ${confirmed})`);
      } catch (e) {
        logFn(`loop err: ${e.message.slice(0, 80)}`);
      }

      if (getCamerieriDone()) {
        // Camerieri finiti: aspetto un po' (eventuali lag realtime) e controllo
        await page.waitForTimeout(2500);
        const remaining = await page.getByRole('button', { name: 'Tutto Pronto', exact: true }).count();
        if (remaining === 0) {
          logFn(`✅ done (${confirmed} confermati)`);
          break;
        }
        logFn(`camerieri done, ma ancora ${remaining} card visibili`);
      }

      await page.waitForTimeout(3000);
    }
  } catch (err) {
    logFn(`❌ FATAL: ${err.message}`);
    errors.push({ who: tag, fatal: err.message });
  } finally {
    await context.close();
  }

  return { role: station.role, idx: station.idx, confirmed };
}

// -------------------- TEST --------------------

test('stress: 1000 persone (4 cam + 2 bar + 2 cucina)', async () => {
  const browser = await chromium.launch({ headless: false });
  const errors = [];
  let camerieriDone = false;
  const t0 = Date.now();

  // Avvio camerieri
  const camPromises = CAMERIERI.map(c => runCameriere(browser, c, errors));
  // Quando tutti finiscono, attivo il flag per le stations
  Promise.all(camPromises).finally(() => { camerieriDone = true; });

  // Avvio stations
  const stPromises = STATIONS.map(s =>
    runStation(browser, s, () => camerieriDone, errors)
  );

  // Aspetto tutto
  const [camResults, stResults] = await Promise.all([
    Promise.all(camPromises),
    Promise.all(stPromises),
  ]);

  await browser.close();

  const duration = ((Date.now() - t0) / 1000).toFixed(1);

  console.log('\n=== STRESS TEST 1000 PERSONE ===');
  console.log(`Durata totale: ${duration}s`);
  let totSucc = 0;
  let totAll = 0;
  for (const r of camResults.sort((a, b) => a.id - b.id)) {
    console.log(`Cameriere ${r.id} (PIN ${r.pin}): ${r.success}/${r.total} ordini riusciti`);
    totSucc += r.success;
    totAll += r.total;
  }
  const barConf = stResults.filter(r => r.role === 'bar').reduce((s, r) => s + r.confirmed, 0);
  const cucConf = stResults.filter(r => r.role === 'cucina').reduce((s, r) => s + r.confirmed, 0);
  console.log(`Bar: ${barConf} ordini confermati`);
  console.log(`Cucina: ${cucConf} ordini confermati`);
  console.log(`TOTALE ORDINI: ${totSucc}/${totAll}`);
  console.log(`TOTALE PERSONE SIMULATE: ${totSucc * 4}`);
  console.log(`Errori: ${errors.length}`);
  if (errors.length > 0 && errors.length < 30) {
    console.log('\nDettaglio errori:');
    for (const e of errors) console.log(`  ${e.who}${e.tavolo ? ` t${e.tavolo}` : ''}: ${e.msg || e.fatal}`);
  }
});

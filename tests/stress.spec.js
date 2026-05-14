import { test, chromium } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const APP_URL = 'https://sagra-app-coral.vercel.app';
const STEP_DELAY = 300;
const ACTION_TIMEOUT = 30_000;
const POST_TAVOLO_DELAY = 500;
const SCREENSHOT_DIR = path.join(process.cwd(), 'tests', 'screenshots');
fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });

// -------------------- CONFIG --------------------

const TOT_TAVOLI = 60;
const TOT_PERSONE = 400;

const CAMERIERI = [
  { id: 0, pin: '1234', from: 1,  to: 15 },
  { id: 1, pin: '5678', from: 16, to: 30 },
  { id: 2, pin: '9123', from: 31, to: 45 },
  { id: 3, pin: '4567', from: 46, to: 60 },
];

const PRIMI    = ['Vincisgrassi al ragù', 'Tagliatelle al ragù di cinghiale',
                  'Passatelli in brodo', 'Maccheroncini di Campofilone al pomodoro'];
const SECONDI  = ['Porchetta arrosto', 'Coniglio in porchetta',
                  'Scottadito di agnello alla brace', 'Pollo arrosto con patate'];
const CONTORNI = ['Antipasto misto del contadino', 'Olive ascolane fritte'];
const DOLCI    = ['Tiramisù della nonna', 'Crostata di visciole',
                  'Zuppa inglese', 'Ciambellone marchigiano'];
const BEVANDE  = ['Acqua naturale 1L', 'Acqua frizzante 1L'];
const VINI     = ['Vino rosso 1L', 'Vino bianco 1L'];
const CAFFE    = ['Caffè'];

const CUCINA_NOMI = new Set([...PRIMI, ...SECONDI, ...CONTORNI, ...DOLCI]);
const BAR_NOMI    = new Set([...BEVANDE, ...VINI, ...CAFFE]);

// -------------------- HELPER --------------------

const log = (prefix, msg) => console.log(`[${prefix}] ${msg}`);
const rand = (arr) => arr[Math.floor(Math.random() * arr.length)];

function generaTavoli(n, totale) {
  // Crea n tavoli con persone in [4,8] che sommano esattamente a totale (se possibile).
  const min = 4, max = 8;
  if (totale < n * min || totale > n * max) {
    throw new Error(`Impossibile generare ${n} tavoli sommando ${totale} con range [${min},${max}]`);
  }
  const t = new Array(n).fill(min);
  let extra = totale - n * min;
  const maxIncr = max - min;
  while (extra > 0) {
    const i = Math.floor(Math.random() * n);
    if (t[i] - min < maxIncr) {
      t[i]++;
      extra--;
    }
  }
  return t;
}

function generaCountsTavolo(persone) {
  const c = new Map();
  const add = (nome) => c.set(nome, (c.get(nome) || 0) + 1);
  for (let i = 0; i < persone; i++) {
    add(rand(PRIMI));
    add(rand(SECONDI));
    add(rand(CONTORNI));
    add(rand(DOLCI));
    add(rand(BEVANDE));
    add(rand(VINI));
    add(rand(CAFFE));
  }
  return c;
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
    await page.waitForTimeout(100);
  }
  await page.getByRole('button', { name: 'Entra', exact: true }).click({ timeout: ACTION_TIMEOUT });
}

// -------------------- CAMERIERE --------------------

async function clickPlusN(page, nome, n, logFn) {
  if (n <= 0) return 0;
  const row = page.locator('li.card').filter({
    has: page.getByText(nome, { exact: true }),
  });
  const btn = row.getByRole('button', { name: '+', exact: true });
  let clicked = 0;
  for (let i = 0; i < n; i++) {
    try {
      await btn.click({ timeout: 5_000 });
      clicked++;
      await page.waitForTimeout(50);
    } catch (e) {
      logFn(`     ⚠ click + fallito su "${nome}" (${i+1}/${n}): ${e.message.slice(0, 60)}`);
    }
  }
  return clicked;
}

async function placeOrder(page, numeroTavolo, persone, logFn) {
  await page.getByRole('button', { name: /\+\s*Nuovo Tavolo/ }).click({ timeout: ACTION_TIMEOUT });
  await page.waitForSelector('input[placeholder="es. 12"]', { timeout: ACTION_TIMEOUT });
  await page.waitForTimeout(STEP_DELAY);

  await page.getByLabel('N. Tavolo').fill(String(numeroTavolo));
  await page.waitForTimeout(200);
  await page.getByLabel('N. Persone').fill(String(persone));
  await page.waitForTimeout(200);

  const counts = generaCountsTavolo(persone);

  // Tab Cucina
  await page.getByRole('button', { name: 'Cucina', exact: true }).click({ timeout: ACTION_TIMEOUT });
  await page.waitForTimeout(STEP_DELAY);
  for (const [nome, qty] of counts) {
    if (CUCINA_NOMI.has(nome)) await clickPlusN(page, nome, qty, logFn);
  }

  // Tab Bar
  await page.getByRole('button', { name: 'Bar', exact: true }).click({ timeout: ACTION_TIMEOUT });
  await page.waitForTimeout(STEP_DELAY);
  for (const [nome, qty] of counts) {
    if (BAR_NOMI.has(nome)) await clickPlusN(page, nome, qty, logFn);
  }

  // Invia (dialog handler accetta turno + pagamento)
  await page.getByRole('button', { name: 'Invia Ordine', exact: true }).click({ timeout: ACTION_TIMEOUT });
  await page.waitForSelector('button:has-text("+ Nuovo Tavolo")', { timeout: ACTION_TIMEOUT });
  await page.waitForTimeout(POST_TAVOLO_DELAY);
}

async function runCameriere(browser, cam, listaTavoli, errors) {
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
    logFn(`logged in, ${total} tavoli da gestire`);

    for (let tavolo = cam.from; tavolo <= cam.to; tavolo++) {
      const persone = listaTavoli[tavolo - 1];
      try {
        logFn(`→ tavolo ${tavolo} (${persone} pers.)`);
        await placeOrder(page, tavolo, persone, logFn);
        success++;
        const elapsed = ((Date.now() - t0) / 1000).toFixed(0);
        logFn(`  ✅ tavolo ${tavolo} OK [${success}/${total}] (${elapsed}s)`);
      } catch (err) {
        const short = err.message.slice(0, 120);
        logFn(`  ❌ Cameriere ${cam.id} - Tavolo ${tavolo}: ${short}`);
        errors.push({ who: `C${cam.id}`, tavolo, msg: short });
        await snapshot(page, `errore-tav-${tavolo}`);
        try {
          await page.goto(APP_URL, { waitUntil: 'domcontentloaded', timeout: 15000 });
          if (await page.getByRole('button', { name: 'Entra', exact: true }).count()) {
            await login(page, cam.pin);
          }
          await page.waitForSelector('button:has-text("+ Nuovo Tavolo")', { timeout: 15000 });
        } catch (e) {
          logFn(`     recovery fallita: ${e.message.slice(0, 80)}`);
        }
      }
    }
  } catch (err) {
    logFn(`❌ FATAL: ${err.message}`);
    errors.push({ who: `C${cam.id}`, fatal: err.message });
  } finally {
    await context.close();
  }

  return { id: cam.id, pin: cam.pin, success, total };
}

// -------------------- STATION (BAR/CUCINA) --------------------

async function runStation(browser, role, pin, getDoneFlag, errors) {
  const tag = role.toUpperCase();
  const logFn = (msg) => log(tag, msg);
  const context = await browser.newContext();
  const page = await context.newPage();
  page.on('dialog', d => d.accept());
  page.on('pageerror', err => logFn(`[pageerror] ${err.message.slice(0, 100)}`));

  let confirmed = 0;
  const t0 = Date.now();
  const maxRuntimeMs = 10 * 60 * 1000;

  try {
    logFn(`login...`);
    await login(page, pin);
    await page.waitForSelector('button:has-text("Esci")', { timeout: ACTION_TIMEOUT });
    await page.waitForTimeout(1000);
    logFn(`logged in, in ascolto`);

    while (true) {
      if (Date.now() - t0 > maxRuntimeMs) {
        logFn(`⏰ timeout 10 min, esco`);
        break;
      }

      try {
        const buttons = page.getByRole('button', { name: 'Tutto Pronto', exact: true });
        let clickedThisRound = 0;
        let safety = 200;
        while (safety-- > 0) {
          const c = await buttons.count();
          if (c === 0) break;
          try {
            await buttons.first().click({ timeout: 5000 });
            confirmed++;
            clickedThisRound++;
            await page.waitForTimeout(150);
          } catch {
            break; // race con altro worker o card sparita
          }
        }
        if (clickedThisRound > 0) logFn(`+${clickedThisRound} (totale ${confirmed})`);
      } catch (e) {
        logFn(`loop err: ${e.message.slice(0, 80)}`);
      }

      if (getDoneFlag()) {
        await page.waitForTimeout(2500);
        const remaining = await page.getByRole('button', { name: 'Tutto Pronto', exact: true }).count();
        if (remaining === 0) {
          logFn(`✅ done (${confirmed} confermati)`);
          break;
        }
      }

      await page.waitForTimeout(2000);
    }
  } catch (err) {
    logFn(`❌ FATAL: ${err.message}`);
    errors.push({ who: tag, fatal: err.message });
  } finally {
    await context.close();
  }

  return { role, confirmed };
}

// -------------------- TEST --------------------

test('stress: 400 persone su 60 tavoli', async () => {
  const browser = await chromium.launch({ headless: false });
  const errors = [];
  let camerieriDone = false;
  const t0 = Date.now();

  // Genera tavoli con persone variabili (4-8) sommando ~400
  const listaTavoli = generaTavoli(TOT_TAVOLI, TOT_PERSONE);
  const totaleEffettivo = listaTavoli.reduce((s, x) => s + x, 0);
  console.log(`\nGenerati ${TOT_TAVOLI} tavoli, totale persone: ${totaleEffettivo}`);
  console.log(`Distribuzione: ${listaTavoli.join(',')}\n`);

  // Camerieri
  const camPromises = CAMERIERI.map(c => runCameriere(browser, c, listaTavoli, errors));
  Promise.all(camPromises).finally(() => { camerieriDone = true; });

  // Stations (1 cucina + 1 bar)
  const stationPromises = [
    runStation(browser, 'cucina', '4444', () => camerieriDone, errors),
    runStation(browser, 'bar',    '3333', () => camerieriDone, errors),
  ];

  const [camResults, stResults] = await Promise.all([
    Promise.all(camPromises),
    Promise.all(stationPromises),
  ]);

  await browser.close();

  const duration = ((Date.now() - t0) / 1000).toFixed(1);

  console.log('\n════════════════════════════════');
  console.log('   STRESS TEST - 400 PERSONE   ');
  console.log('════════════════════════════════');
  console.log(`Durata totale: ${duration}s`);
  console.log(`Tavoli simulati: ${TOT_TAVOLI}`);
  console.log(`Persone simulate: ${totaleEffettivo}`);
  console.log('');
  console.log('CAMERIERI:');
  let totSucc = 0;
  let totAll = 0;
  for (const r of camResults.sort((a, b) => a.id - b.id)) {
    const icon = r.success === r.total ? '✅' : (r.success > 0 ? '⚠️' : '❌');
    console.log(`  Cameriere ${r.id} (PIN ${r.pin}): ${r.success}/${r.total} tavoli ${icon}`);
    totSucc += r.success;
    totAll += r.total;
  }
  const cucConf = stResults.find(r => r.role === 'cucina')?.confirmed ?? 0;
  const barConf = stResults.find(r => r.role === 'bar')?.confirmed ?? 0;
  console.log('');
  console.log(`CUCINA: ${cucConf} ordini confermati`);
  console.log(`BAR: ${barConf} ordini confermati`);
  console.log('');
  console.log(`Ordini riusciti: ${totSucc}/${totAll}`);
  console.log(`Ordini falliti: ${totAll - totSucc}`);
  console.log('════════════════════════════════');
  if (errors.length > 0 && errors.length < 30) {
    console.log('\nDettaglio errori:');
    for (const e of errors) {
      console.log(`  ${e.who}${e.tavolo ? ` t${e.tavolo}` : ''}: ${e.msg || e.fatal}`);
    }
  }
});

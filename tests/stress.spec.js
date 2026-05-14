import { test, chromium } from '@playwright/test';

const APP_URL = 'https://sagra-app-coral.vercel.app';
const STEP_DELAY = 400;

const CAMERIERI = [
  { id: 0, pin: '1234', tavoli: [1, 2, 3, 4, 5] },
  { id: 1, pin: '5678', tavoli: [6, 7, 8, 9, 10] },
  { id: 2, pin: '9123', tavoli: [11, 12, 13, 14, 15] },
  { id: 3, pin: '4567', tavoli: [16, 17, 18, 19, 20] },
];

const log = (id, pin, msg) => console.log(`[C${id} PIN ${pin}] ${msg}`);

function pickRandomIndices(total, n) {
  const all = Array.from({ length: total }, (_, i) => i);
  for (let i = all.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [all[i], all[j]] = [all[j], all[i]];
  }
  return all.slice(0, Math.min(n, all.length));
}

async function login(page, pin) {
  await page.goto(APP_URL, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('button:has-text("Entra")', { timeout: 20000 });
  for (const d of pin.split('')) {
    await page.getByRole('button', { name: d, exact: true }).click();
    await page.waitForTimeout(120);
  }
  await page.getByRole('button', { name: 'Entra', exact: true }).click();
  await page.waitForSelector('button:has-text("+ Nuovo Tavolo")', { timeout: 20000 });
}

async function logout(page) {
  await page.getByRole('button', { name: 'Esci', exact: true }).click();
  await page.waitForSelector('button:has-text("Entra")', { timeout: 15000 });
}

async function placeOrder(page, numeroTavolo, logFn) {
  logFn(`→ + Nuovo Tavolo (#${numeroTavolo})`);
  await page.getByRole('button', { name: /\+\s*Nuovo Tavolo/ }).click();
  await page.waitForSelector('input[placeholder="es. 12"]', { timeout: 15000 });
  await page.waitForTimeout(STEP_DELAY);

  await page.getByLabel('N. Tavolo').fill(String(numeroTavolo));
  await page.waitForTimeout(STEP_DELAY);
  const persone = 2 + Math.floor(Math.random() * 4);
  await page.getByLabel('N. Persone').fill(String(persone));
  await page.waitForTimeout(STEP_DELAY);

  // Tab Cucina (default già attiva — clicco per sicurezza)
  await page.getByRole('button', { name: 'Cucina', exact: true }).click();
  await page.waitForTimeout(STEP_DELAY);

  const cucinaRows = page.locator('li.card').filter({
    has: page.getByRole('button', { name: '+', exact: true }),
  });
  const totCucina = await cucinaRows.count();
  if (totCucina === 0) throw new Error('Nessun piatto disponibile in tab Cucina');

  const nPiattiCucina = 2 + Math.floor(Math.random() * 2); // 2 o 3
  const idxCucina = pickRandomIndices(totCucina, nPiattiCucina);
  for (const i of idxCucina) {
    await cucinaRows.nth(i).getByRole('button', { name: '+', exact: true }).click();
    await page.waitForTimeout(STEP_DELAY);
  }
  logFn(`   cucina: ${idxCucina.length} piatti, persone=${persone}`);

  // Tab Bar
  await page.getByRole('button', { name: 'Bar', exact: true }).click();
  await page.waitForTimeout(STEP_DELAY);

  const barRows = page.locator('li.card').filter({
    has: page.getByRole('button', { name: '+', exact: true }),
  });
  const totBar = await barRows.count();
  if (totBar === 0) throw new Error('Nessuna bevanda disponibile in tab Bar');

  const idxBar = Math.floor(Math.random() * totBar);
  await barRows.nth(idxBar).getByRole('button', { name: '+', exact: true }).click();
  await page.waitForTimeout(STEP_DELAY);
  logFn(`   bar: 1 bevanda`);

  await page.getByRole('button', { name: 'Invia Ordine', exact: true }).click();
  await page.waitForSelector('button:has-text("+ Nuovo Tavolo")', { timeout: 20000 });
  await page.waitForTimeout(STEP_DELAY);
}

async function runCameriere(browser, cam) {
  const logFn = (msg) => log(cam.id, cam.pin, msg);
  const context = await browser.newContext();
  const page = await context.newPage();
  page.on('pageerror', err => logFn(`[pageerror] ${err.message}`));

  let success = 0;

  for (const tavolo of cam.tavoli) {
    try {
      logFn(`=== Inizio ordine tavolo ${tavolo} ===`);
      await login(page, cam.pin);
      await placeOrder(page, tavolo, logFn);
      await logout(page);
      success++;
      logFn(`✅ Tavolo ${tavolo} completato (${success}/${cam.tavoli.length})`);
    } catch (err) {
      logFn(`❌ Tavolo ${tavolo} FAIL: ${err.message}`);
      // Reset stato per il prossimo ordine: pulisco storage e ricarico
      try {
        await page.evaluate(() => localStorage.clear()).catch(() => {});
        await page.goto(APP_URL, { waitUntil: 'domcontentloaded' });
      } catch (e) {
        logFn(`   recovery fallita: ${e.message}`);
      }
    }
  }

  await context.close();
  return { id: cam.id, pin: cam.pin, success, total: cam.tavoli.length };
}

test('stress: 4 camerieri × 5 ordini sequenziali', async () => {
  const browser = await chromium.launch({ headless: false });

  const results = await Promise.all(
    CAMERIERI.map(cam => runCameriere(browser, cam))
  );

  await browser.close();

  let totSucc = 0;
  let totAll = 0;
  console.log('\n=== RIEPILOGO ===');
  for (const r of results.sort((a, b) => a.id - b.id)) {
    console.log(`Cameriere ${r.id} (PIN ${r.pin}): ${r.success}/${r.total} ordini riusciti`);
    totSucc += r.success;
    totAll += r.total;
  }
  console.log(`TOTALE: ${totSucc}/${totAll} ordini riusciti`);
});

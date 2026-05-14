import { test, chromium } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const APP_URL = 'https://sagra-app-coral.vercel.app';
const LOGIN_PIN = ['1', '1', '1', '1'];   // PIN cameriere
const N_CAMERIERI = 5;
const N_PIATTI_CUCINA = 2;                 // quanti piatti scegliere dalla tab Cucina
const STEP_DELAY = 500;                    // ms tra ogni azione
const SCREENSHOT_DIR = path.join(process.cwd(), 'tests', 'screenshots');

fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });

const log = (id, msg) => console.log(`[Cameriere ${id}] ${msg}`);

async function shot(page, id, step) {
  try {
    await page.screenshot({
      path: path.join(SCREENSHOT_DIR, `c${id}-${step}.png`),
      fullPage: true,
    });
  } catch (e) {
    log(id, `screenshot ${step} fallito: ${e.message}`);
  }
}

async function simulaCameriere(browser, id) {
  const context = await browser.newContext();
  const page = await context.newPage();
  page.on('pageerror', (err) => log(id, `[pageerror] ${err.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error') log(id, `[console.error] ${m.text()}`);
  });

  try {
    log(id, `→ apro ${APP_URL}`);
    await page.goto(APP_URL, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('button:has-text("Entra")', { timeout: 15000 });
    await shot(page, id, '01-login');

    log(id, `→ digito PIN ${LOGIN_PIN.join('')}`);
    for (const d of LOGIN_PIN) {
      await page.getByRole('button', { name: d, exact: true }).click();
      await page.waitForTimeout(200);
    }
    await shot(page, id, '02-pin');

    log(id, '→ click Entra');
    await page.getByRole('button', { name: 'Entra', exact: true }).click();

    log(id, '→ attendo schermata Lista Tavoli');
    await page.waitForSelector('button:has-text("+ Nuovo Tavolo")', { timeout: 15000 });
    await page.waitForTimeout(STEP_DELAY);
    await shot(page, id, '03-list');

    log(id, '→ click + Nuovo Tavolo');
    await page.getByRole('button', { name: /\+\s*Nuovo Tavolo/ }).click();

    log(id, '→ attendo form nuovo ordine');
    await page.waitForSelector('input[placeholder="es. 12"]', { timeout: 10000 });
    await page.waitForTimeout(STEP_DELAY);
    await shot(page, id, '04-form');

    const numeroTavolo = String(id + 50);   // 50..54 per non collidere
    log(id, `→ compilo N. Tavolo=${numeroTavolo}, N. Persone=4`);
    await page.getByLabel('N. Tavolo').fill(numeroTavolo);
    await page.waitForTimeout(STEP_DELAY);
    await page.getByLabel('N. Persone').fill('4');
    await page.waitForTimeout(STEP_DELAY);
    await shot(page, id, '05-tavolo-persone');

    log(id, '→ verifico tab Cucina attiva');
    const cucinaTab = page.getByRole('button', { name: 'Cucina', exact: true });
    await cucinaTab.click();
    await page.waitForTimeout(STEP_DELAY);

    log(id, `→ aggiungo ${N_PIATTI_CUCINA} piatti dalla cucina`);
    // Cerco le righe-piatto: <li class="card ..."> contiene <button>+</button>
    const righePiatti = page.locator('li.card').filter({
      has: page.getByRole('button', { name: '+', exact: true }),
    });
    const totRighe = await righePiatti.count();
    log(id, `   ${totRighe} righe piatto trovate in tab Cucina`);
    if (totRighe === 0) {
      throw new Error('Nessun piatto disponibile nella tab Cucina');
    }

    const nPiatti = Math.min(N_PIATTI_CUCINA, totRighe);
    for (let i = 0; i < nPiatti; i++) {
      const riga = righePiatti.nth(i);
      const nome = (await riga.locator('p.font-semibold').first().textContent()) || '???';
      log(id, `   → +1 "${nome.trim()}"`);
      await riga.getByRole('button', { name: '+', exact: true }).click();
      await page.waitForTimeout(STEP_DELAY);
    }
    await shot(page, id, '06-piatti-aggiunti');

    log(id, '→ click Invia Ordine');
    const inviaBtn = page.getByRole('button', { name: 'Invia Ordine', exact: true });
    await inviaBtn.waitFor({ state: 'visible', timeout: 5000 });
    await inviaBtn.click();

    log(id, '→ attendo ritorno alla Lista Tavoli');
    await page.waitForSelector('button:has-text("+ Nuovo Tavolo")', { timeout: 15000 });
    await page.waitForTimeout(STEP_DELAY);
    await shot(page, id, '07-after-submit');

    log(id, '✅ ordine inviato');
  } catch (err) {
    log(id, `❌ errore: ${err.message}`);
    await shot(page, id, '99-error');
    throw err;
  } finally {
    await context.close();
  }
}

test('stress test - camerieri simultanei', async () => {
  test.setTimeout(180_000);

  const browser = await chromium.launch({ headless: false });

  const promises = Array.from({ length: N_CAMERIERI }, (_, i) =>
    simulaCameriere(browser, i)
  );

  const results = await Promise.allSettled(promises);
  await browser.close();

  const ok = results.filter(r => r.status === 'fulfilled').length;
  const ko = results.length - ok;
  console.log(`\n=== Risultato: ${ok}/${results.length} OK, ${ko} falliti ===`);

  if (ko > 0) {
    const errs = results
      .map((r, i) => r.status === 'rejected' ? `  - cameriere ${i}: ${r.reason.message}` : null)
      .filter(Boolean)
      .join('\n');
    throw new Error(`Test fallito per ${ko} camerieri:\n${errs}`);
  }
});

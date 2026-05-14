import { test, chromium } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const SCREENSHOT_DIR = path.join(process.cwd(), 'tests', 'screenshots');
fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });

async function dumpControls(page, label) {
  console.log(`\n========== ${label} ==========`);
  const url = page.url();
  console.log(`URL: ${url}`);

  const buttons = await page.locator('button:visible').all();
  console.log(`Buttons visibili (${buttons.length}):`);
  for (const b of buttons) {
    try {
      const text = ((await b.textContent()) || '').replace(/\s+/g, ' ').trim();
      const aria = (await b.getAttribute('aria-label')) || '';
      const cls  = ((await b.getAttribute('class')) || '').slice(0, 60);
      console.log(`  • text="${text.slice(0, 50)}"  aria="${aria}"  class="${cls}…"`);
    } catch {}
  }

  const inputs = await page.locator('input:visible').all();
  console.log(`Inputs visibili (${inputs.length}):`);
  for (const i of inputs) {
    try {
      const type = (await i.getAttribute('type')) || '';
      const ph   = (await i.getAttribute('placeholder')) || '';
      const inputMode = (await i.getAttribute('inputmode')) || '';
      const value = (await i.inputValue()) || '';
      console.log(`  • type="${type}"  placeholder="${ph}"  inputmode="${inputMode}"  value="${value}"`);
    } catch {}
  }

  const labels = await page.locator('label').all();
  console.log(`Labels (${labels.length}):`);
  for (const l of labels) {
    try {
      const text = ((await l.textContent()) || '').replace(/\s+/g, ' ').trim();
      if (text) console.log(`  • "${text.slice(0, 70)}"`);
    } catch {}
  }
}

test('inspect dom flow', async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  page.on('console', m => console.log(`[BROWSER ${m.type()}] ${m.text()}`));

  console.log('→ goto login');
  await page.goto('https://sagra-app-coral.vercel.app', { waitUntil: 'networkidle' });
  await page.waitForTimeout(800);
  await page.screenshot({ path: path.join(SCREENSHOT_DIR, '01-login.png'), fullPage: true });
  await dumpControls(page, '01 LOGIN');

  console.log('\n→ digito PIN 1111');
  for (const d of ['1','1','1','1']) {
    await page.getByRole('button', { name: d, exact: true }).click();
    await page.waitForTimeout(150);
  }
  await page.screenshot({ path: path.join(SCREENSHOT_DIR, '02-pin-entered.png'), fullPage: true });

  console.log('→ click Entra');
  await page.getByRole('button', { name: 'Entra', exact: true }).click();
  await page.waitForTimeout(2500);
  await page.screenshot({ path: path.join(SCREENSHOT_DIR, '03-after-login.png'), fullPage: true });
  await dumpControls(page, '03 AFTER LOGIN');

  console.log('\n→ click Nuovo Tavolo');
  await page.getByRole('button', { name: /Nuovo Tavolo/i }).click();
  await page.waitForTimeout(1500);
  await page.screenshot({ path: path.join(SCREENSHOT_DIR, '04-nuovo-ordine.png'), fullPage: true });
  await dumpControls(page, '04 NUOVO ORDINE');

  // ispeziono la struttura di una riga di menu (per capire come cliccare il +)
  console.log('\n→ struttura prima riga lista cucina');
  const firstLi = page.locator('ul li.card').first();
  if (await firstLi.count()) {
    const html = await firstLi.evaluate(el => el.outerHTML.slice(0, 500));
    console.log(`HTML: ${html}`);
  } else {
    console.log('Nessun li.card trovato — la lista cucina potrebbe non essere visibile');
  }

  await context.close();
  await browser.close();
  console.log('\n✅ Ispezione completata. Screenshots in tests/screenshots/');
});

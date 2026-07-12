/**
 * Stacking Plan Generator — headless regression tests (Playwright).
 *
 * Covers the QA-confirmed defects fixed in public/stacking.html. Requires Playwright
 * with a Chromium binary available. Run from the repo root:
 *
 *     npm i -D playwright && npx playwright install chromium
 *     node tests/stacking.smoke.mjs
 *
 * Exit code is non-zero if any assertion fails.
 */
import { chromium } from 'playwright';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PAGE_URL = pathToFileURL(resolve(__dirname, '../public/stacking.html')).href;

let failures = 0;
const assert = (cond, msg) => {
  if (!cond) { failures++; console.log('FAIL: ' + msg); }
  else console.log('ok:   ' + msg);
};

const browser = await chromium.launch();

async function freshPage() {
  const page = await browser.newPage();
  const errs = [];
  page.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
  page.on('pageerror', e => errs.push('PAGEERROR: ' + e.message));
  await page.goto(PAGE_URL);
  await page.waitForTimeout(150);
  page._errs = errs;
  return page;
}

// ---------------------------------------------------------------- load + sample
{
  const page = await freshPage();
  assert(page._errs.length === 0, 'loads with no console/page errors (' + JSON.stringify(page._errs) + ')');
  const r = await page.evaluate(() => {
    document.querySelector('#sampleBtn').click();
    return { n: S.rows.length, warn: S.warnings };
  });
  assert(r.n === 17, 'sample building parses 17 rows (got ' + r.n + ')');
  assert(r.warn.length === 0, 'sample building produces no warnings');
  await page.close();
}

// ---------------------------------------- [Stacking-01] totals / subtotal filter
{
  const page = await freshPage();
  const csv = [
    'Suite,Tenant,Floor,RSF,Lease Start,Lease Expiration',
    '100,Acme Corp,1,10000,1/1/2022,12/31/2028',
    '110,Total Wine & More,1,5000,3/1/2021,2/28/2030', // legit tenant containing "total" — must be kept
    'Floor 1 Subtotal,,1,15000,,',                     // subtotal row — must be excluded
    '200,Globex,2,8000,6/1/2023,5/31/2029',
    '210,VACANT,2,4000,,',
    'Grand Total,,,27000,,',                           // grand total row — must be excluded
  ].join('\n');
  const r = await page.evaluate((c) => {
    handlePaste(c, 'Totals Test');
    const tot = S.rows.reduce((a, x) => a + (x.sf || 0), 0);
    const occ = S.rows.filter(x => x.status !== 'vacant').reduce((a, x) => a + (x.sf || 0), 0);
    return { n: S.rows.length, tenants: S.rows.map(x => x.tenant), tot, occ, warn: S.warnings };
  }, csv);
  assert(r.n === 4, 'totals: keeps 4 real rows incl vacant (got ' + r.n + ' -> ' + JSON.stringify(r.tenants) + ')');
  assert(r.tenants.includes('Total Wine & More'), 'totals: legit "Total Wine & More" not dropped');
  assert(r.tot === 27000, 'totals: RSF excludes summary rows = 27000 (got ' + r.tot + ')');
  assert(r.occ === 23000, 'totals: occupied SF = 23000 (got ' + r.occ + ')');
  assert(r.warn.some(w => /2 summary\/total rows/.test(w)), 'totals: exclusion warning surfaced');
  await page.close();
}

// -------------------------------------------------- [C-STK-01] ISO-8601 dates
{
  const page = await freshPage();
  const csv = [
    'Suite,Tenant,Floor,RSF,Lease Expiration',
    '100,Alpha,1,10000,2027-05-31',
    '110,Beta,1,6000,2031-01-15',
    '200,Gamma,2,4000,2029-12-01',
  ].join('\n');
  const r = await page.evaluate((c) => {
    handlePaste(c, 'ISO Test');
    return {
      years: S.rows.map(x => x.end ? x.end.getFullYear() : null),
      months: S.rows.map(x => x.end ? x.end.getMonth() + 1 : null),
      days: S.rows.map(x => x.end ? x.end.getDate() : null),
      warn: S.warnings,
    };
  }, csv);
  assert(JSON.stringify(r.years) === '[2027,2031,2029]', 'ISO: correct year buckets (got ' + JSON.stringify(r.years) + ')');
  assert(JSON.stringify(r.months) === '[5,1,12]', 'ISO: correct months');
  assert(JSON.stringify(r.days) === '[31,15,1]', 'ISO: correct days');
  assert(r.warn.length === 0, 'ISO: no false warnings');
  await page.close();
}

// --------------------------------- [C-STK-01] ambiguous vs inferred D/M/Y
{
  const page = await freshPage();
  // all day<=12, no decisive evidence -> default US M/D but warn
  let r = await page.evaluate(() => {
    handlePaste('Suite,Tenant,RSF,Lease Expiration\n100,Alpha,1000,05/06/2028', 'Amb');
    return { warn: S.warnings, mo: S.rows[0].end.getMonth() + 1 };
  });
  assert(r.warn.some(w => /ambiguous/.test(w)), 'ambiguous: warning surfaced');
  assert(r.mo === 5, 'ambiguous: defaults to US M/D (month 5)');

  // a sibling row with day>12 lets the whole column be inferred D/M/Y, no warning
  r = await page.evaluate(() => {
    handlePaste('Suite,Tenant,RSF,Lease Expiration\n100,A,1000,25/12/2028\n110,B,1000,06/07/2029', 'DMY');
    return { m0: S.rows[0].end.getMonth() + 1, d0: S.rows[0].end.getDate(), m1: S.rows[1].end.getMonth() + 1, d1: S.rows[1].end.getDate() };
  });
  assert(r.m0 === 12 && r.d0 === 25, 'dmy: 25/12 -> Dec 25');
  assert(r.m1 === 7 && r.d1 === 6, 'dmy: sibling infers D/M -> Jul 6 (got m=' + r.m1 + ' d=' + r.d1 + ')');
  await page.close();
}

// --------------------------- [Stacking-02] Excel serial date timezone safety
{
  const page = await freshPage();
  const r = await page.evaluate(() => {
    const d = excelSerialToDate(46388); // 2027-01-01
    return { y: d.getFullYear(), m: d.getMonth() + 1, day: d.getDate() };
  });
  assert(r.y === 2027 && r.m === 1 && r.day === 1, 'serial 46388 -> 2027-01-01 in local time (got ' + JSON.stringify(r) + ')');
  await page.close();
}

// ------------- [Stacking-03 / B-STK-02 / C-STK-05] portrait-phone toolbar smoke
{
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await page.goto(PAGE_URL);
  await page.evaluate(() => document.querySelector('#sampleBtn').click());
  await page.waitForTimeout(100);
  const boxes = await page.evaluate(() => {
    const out = [];
    document.querySelectorAll('#toolbar > .tb-select, #toolbar > .tb-btn, #toolbar .menu-wrap > .tb-btn')
      .forEach(el => { const b = el.getBoundingClientRect(); out.push({ id: el.id || el.textContent.trim(), x: b.x, right: b.right, y: b.y, h: b.height }); });
    return out;
  });
  assert(boxes.length >= 5, 'phone: found all 5 toolbar controls (got ' + boxes.length + ')');
  for (const b of boxes) {
    assert(b.h > 0 && b.x >= 0 && b.right <= 390 && b.y >= 0,
      `phone: control "${b.id}" fully on-screen (x=${Math.round(b.x)} right=${Math.round(b.right)} y=${Math.round(b.y)} h=${Math.round(b.h)})`);
  }
  // the Color selector must actually be operable at phone width
  await page.selectOption('#colorMode', 'tenant');
  const mode = await page.evaluate(() => S.colorMode);
  assert(mode === 'tenant', 'phone: Color selector reachable and functional');
  await page.close();
}

// ---- [Stacking-04/12 / B-STK-14 / C-STK-03] keyboard-only: suite edit, legend, title
{
  const page = await freshPage();
  await page.evaluate(() => document.querySelector('#sampleBtn').click());
  await page.waitForTimeout(100);

  // all interactive SVG targets are in the tab order
  const tabbable = await page.evaluate(() => ({
    suites: document.querySelectorAll('.suite-block[tabindex="0"][role="button"]').length,
    chips: document.querySelectorAll('.legend-chip[tabindex="0"][role="button"]').length,
    title: !!document.querySelector('#planTitle[tabindex="0"]'),
    labeled: [...document.querySelectorAll('.suite-block')].every(g => g.getAttribute('aria-label')),
  }));
  assert(tabbable.suites === 17, 'kb: all 17 suite blocks tabbable (got ' + tabbable.suites + ')');
  assert(tabbable.chips > 0, 'kb: legend chips tabbable');
  assert(tabbable.title, 'kb: plan title tabbable');
  assert(tabbable.labeled, 'kb: every suite block has an aria-label');

  // suite edit: focus block -> Enter opens popover with focus in tenant field
  await page.focus('.suite-block[data-i="0"]');
  await page.keyboard.press('Enter');
  let st = await page.evaluate(() => ({
    open: document.querySelector('#popover').style.display === 'block',
    focused: document.activeElement && document.activeElement.id,
  }));
  assert(st.open, 'kb: Enter on suite block opens editor');
  assert(st.focused === 'po_t', 'kb: editor focuses tenant field (got ' + st.focused + ')');

  // Escape cancels and returns focus to the suite block
  await page.keyboard.press('Escape');
  st = await page.evaluate(() => ({
    open: document.querySelector('#popover').style.display === 'block',
    back: document.activeElement && document.activeElement.classList.contains('suite-block'),
  }));
  assert(!st.open, 'kb: Escape closes editor');
  assert(st.back, 'kb: Escape returns focus to suite block');

  // keyboard save: reopen, retype tenant, tab to Save, Enter
  await page.keyboard.press('Enter');
  await page.fill('#po_t', 'Keyboard Tenant Inc');
  await page.focus('#poSave');
  await page.keyboard.press('Enter');
  st = await page.evaluate(() => ({
    tenant: S.rows[0].tenant,
    back: document.activeElement && document.activeElement.classList.contains('suite-block'),
  }));
  assert(st.tenant === 'Keyboard Tenant Inc', 'kb: save applies edit (got "' + st.tenant + '")');
  assert(st.back, 'kb: focus restored to suite block after save/re-render');

  // legend recolor: Enter on a chip must invoke the color picker
  await page.evaluate(() => {
    window.__pickerOpened = false;
    document.querySelector('#hiddenColor').click = () => { window.__pickerOpened = true; };
  });
  await page.focus('.legend-chip');
  await page.keyboard.press('Enter');
  const picker = await page.evaluate(() => window.__pickerOpened);
  assert(picker, 'kb: Enter on legend chip opens color picker');

  // title rename via keyboard (prompt stubbed)
  await page.evaluate(() => { window.prompt = () => 'Renamed Via Keyboard'; });
  await page.focus('#planTitle');
  await page.keyboard.press('Enter');
  const title = await page.evaluate(() => S.title);
  assert(title === 'Renamed Via Keyboard', 'kb: Enter on title renames plan (got "' + title + '")');
  await page.close();
}

await browser.close();
console.log(failures ? `\n=== ${failures} TEST(S) FAILED ===` : '\n=== ALL STACKING TESTS PASS ===');
process.exit(failures ? 1 : 0);

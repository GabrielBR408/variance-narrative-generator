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

// ------------------------------ [C-STK-02] basement/parking floor sort order
{
  const page = await freshPage();
  const csv = [
    'Suite,Tenant,Floor,RSF',
    '201,Alpha,2,1000',
    '101,Beta,1,1000',
    'G1,Gamma,G,1000',
    'LL1,Delta,LL,1000',
    'B101,Echo,B1,1000',
    'P201,Foxtrot,P2,1000',
  ].join('\n');
  const r = await page.evaluate((c) => {
    handlePaste(c, 'Floors');
    return getFloors().map(f => f.name);
  }, csv);
  assert(JSON.stringify(r) === '["2","1","G","LL","B1","P2"]',
    'floors: B/P/LL sort below ground, top-down [2,1,G,LL,B1,P2] (got ' + JSON.stringify(r) + ')');
  await page.close();
}

// -------------------------- [C-STK-04] tenant-column detection validation
{
  const page = await freshPage();
  // no tenant column at all -> must warn, not silently render all-vacant
  let r = await page.evaluate(() => {
    handlePaste('Suite,RSF,Lease Expiration\n100,1000,1/1/2028\n110,2000,6/30/2029\n200,1500,3/31/2030', 'NoTenantCol');
    return { warn: S.warnings, allVacant: S.rows.every(x => x.status === 'vacant') };
  });
  assert(r.allVacant, 'tenantcol: rows render vacant when no tenant column (precondition)');
  assert(r.warn.some(w => /No Tenant column/i.test(w)), 'tenantcol: missing-column warning surfaced');

  // tenant column exists but every cell is blank -> suspicious all-vacant warning
  r = await page.evaluate(() => {
    handlePaste('Suite,Tenant,RSF\n100,,1000\n110,,2000\n200,,1500', 'BlankTenants');
    return { warn: S.warnings };
  });
  assert(r.warn.some(w => /Every suite parsed as vacant/i.test(w)), 'tenantcol: all-vacant warning surfaced');
  await page.close();
}

// ------------------- [Stacking-06 / B-STK-03] mapbar selects: accessible names
{
  const page = await freshPage();
  await page.evaluate(() => document.querySelector('#sampleBtn').click());
  await page.waitForTimeout(100);
  const r = await page.evaluate(() => {
    const sels = [...document.querySelectorAll('#mapbar select')];
    return {
      n: sels.length,
      named: sels.every(s => (s.getAttribute('aria-label') || '').length > 0 &&
                             document.getElementById(s.getAttribute('aria-labelledby') || '')),
    };
  });
  assert(r.n === 8, 'mapbar: 8 column selectors rendered incl Building (got ' + r.n + ')');
  assert(r.named, 'mapbar: every selector has aria-label + valid aria-labelledby');
  await page.close();
}

// ---------------- [B-STK-16 / C-STK-06/15] legend in "Color: Tenant" mode
{
  const page = await freshPage();
  await page.evaluate(() => document.querySelector('#sampleBtn').click());
  await page.selectOption('#colorMode', 'tenant');
  await page.waitForTimeout(50);
  const r = await page.evaluate(() => ({
    tenantChips: document.querySelectorAll('.legend-chip[data-key^="t:"]').length,
    hasVacant: !!document.querySelector('.legend-chip[data-key="vacant"]'),
    keyLabel: [...document.querySelectorAll('#svgWrap svg text')].some(t => t.textContent === 'TENANTS'),
  }));
  assert(r.tenantChips === 13, 'legend: tenant mode shows a chip per unique tenant (got ' + r.tenantChips + ')');
  assert(r.hasVacant, 'legend: tenant mode keeps Vacant key');
  assert(r.keyLabel, 'legend: tenant mode labeled TENANTS');
  await page.close();
}

// -------- [B-STK-10 / C-STK-07/10/12/14] blank/MTM expirations: legend + status
{
  const page = await freshPage();
  const csv = [
    'Suite,Tenant,Floor,RSF,Lease Expiration',
    '100,Alpha,1,1000,12/31/2028',
    '110,NoDate Co,1,1000,',        // occupied, no expiration -> "No exp. date" key
    '200,Monthly LLC,2,1000,MTM',   // MTM text in expiration column -> MTM status
    '210,VACANT,2,1000,',
  ].join('\n');
  const r = await page.evaluate((c) => {
    handlePaste(c, 'NoDates');
    return {
      statuses: S.rows.map(x => x.status),
      nodateChip: !!document.querySelector('.legend-chip[data-key="nodate"]'),
      mtmChip: !!document.querySelector('.legend-chip[data-key="mtm"]'),
      warn: S.warnings,
    };
  }, csv);
  assert(JSON.stringify(r.statuses) === '["occupied","occupied","mtm","vacant"]',
    'nodate: statuses correct, MTM text honored (got ' + JSON.stringify(r.statuses) + ')');
  assert(r.nodateChip, 'nodate: "No exp. date" legend key present');
  assert(r.mtmChip, 'nodate: MTM legend key present');
  assert(!r.warn.some(w => /couldn't be read/.test(w)), 'nodate: MTM text not counted as unparsed date');
  await page.close();
}

// ------------------------- [B-STK-04 / C-STK-08] XLSX occupancy % formatting
{
  const page = await freshPage();
  await page.evaluate(() => document.querySelector('#sampleBtn').click());
  const r = await page.evaluate(() => {
    let captured = null;
    const orig = XLSX.writeFile;
    XLSX.writeFile = (wb) => { captured = wb; };
    document.querySelector('#ex_xlsx').onclick();
    XLSX.writeFile = orig;
    const cell = captured.Sheets.Summary.B5;
    return { v: cell.v, z: cell.z, label: captured.Sheets.Summary.A5.v };
  });
  assert(r.label === 'Occupancy %', 'xlsx: B5 is the Occupancy % cell');
  assert(typeof r.v === 'number' && r.v > 0 && r.v < 1, 'xlsx: stays a real number (' + r.v + ')');
  assert(r.z === '0.00%', 'xlsx: percentage number format applied, two decimals [QA2-P2-2] (z=' + r.z + ')');
  await page.close();
}

// ------------------------------- [C-STK-09] multi-building rent roll separation
{
  const page = await freshPage();
  const csv = [
    'Building,Suite,Tenant,Floor,RSF,Lease Expiration',
    'North Tower,100,Alpha,1,1000,12/31/2028',
    'North Tower,200,Beta,2,1200,6/30/2029',
    'South Tower,100,Gamma,1,900,3/31/2030',
    'South Tower,110,VACANT,1,800,',
  ].join('\n');
  const r = await page.evaluate((c) => {
    handlePaste(c, 'Two Towers');
    const bl = getBuildings();
    let captured = null;
    const orig = XLSX.writeFile; XLSX.writeFile = wb => { captured = wb; };
    document.querySelector('#ex_xlsx').onclick();
    XLSX.writeFile = orig;
    return {
      n: bl.length, names: bl.map(b => b.name),
      floorsPer: bl.map(b => b.floors.length),
      hdrs: [...document.querySelectorAll('#svgWrap svg text')].map(t => t.textContent)
              .filter(t => t === 'North Tower' || t === 'South Tower'),
      xlsxA1: captured.Sheets['Rent Roll'].A1.v,
    };
  }, csv);
  assert(r.n === 2, 'multibldg: 2 separate stacks (got ' + r.n + ')');
  assert(JSON.stringify(r.names) === '["North Tower","South Tower"]', 'multibldg: building names kept');
  assert(JSON.stringify(r.floorsPer) === '[2,1]', 'multibldg: floors grouped per building (got ' + JSON.stringify(r.floorsPer) + ')');
  assert(r.hdrs.length === 2, 'multibldg: SVG renders a header per building');
  assert(r.xlsxA1 === 'Building', 'multibldg: XLSX export gains Building column');
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

  // title rename via keyboard — inline editor, no blocking prompt()
  await page.focus('#planTitle');
  await page.keyboard.press('Enter');
  let ed = await page.evaluate(() => ({
    open: !!document.querySelector('#titleEditor'),
    focused: document.activeElement && document.activeElement.id === 'titleEditor',
  }));
  assert(ed.open, 'kb: Enter on title opens inline editor');
  assert(ed.focused, 'kb: inline title editor receives focus');
  await page.fill('#titleEditor', 'Renamed Via Keyboard');
  await page.keyboard.press('Enter');
  ed = await page.evaluate(() => ({
    title: S.title,
    closed: !document.querySelector('#titleEditor'),
    back: document.activeElement && document.activeElement.id === 'planTitle',
  }));
  assert(ed.title === 'Renamed Via Keyboard', 'kb: inline editor commits rename (got "' + ed.title + '")');
  assert(ed.closed, 'kb: inline editor removed after commit');
  assert(ed.back, 'kb: focus returns to title after rename');
  // Escape cancels without changing the title
  await page.keyboard.press('Enter');
  await page.fill('#titleEditor', 'Should Not Stick');
  await page.keyboard.press('Escape');
  const cancelled = await page.evaluate(() => ({ title: S.title, closed: !document.querySelector('#titleEditor') }));
  assert(cancelled.title === 'Renamed Via Keyboard' && cancelled.closed, 'kb: Escape cancels rename');
  await page.close();
}

// -------------- [Stacking-19 / B-STK-01 / C-STK-13] negative / zero SF clamp
{
  const page = await freshPage();
  const csv = [
    'Suite,Tenant,Floor,RSF,Lease Expiration',
    '100,Alpha,1,10000,12/31/2028',
    '110,Beta,1,-500,6/30/2029',   // negative -> ignored + warning
    '200,Gamma,2,0,3/31/2030',     // zero -> excluded from math + warning
    '210,Delta,2,4000,9/30/2031',
  ].join('\n');
  const r = await page.evaluate((c) => {
    handlePaste(c, 'BadSF');
    return {
      sfs: S.rows.map(x => x.sf),
      tot: S.rows.reduce((a, x) => a + (x.sf || 0), 0),
      warn: S.warnings,
    };
  }, csv);
  assert(JSON.stringify(r.sfs) === '[10000,null,null,4000]', 'sf: negative and zero SF nulled (got ' + JSON.stringify(r.sfs) + ')');
  assert(r.tot === 14000, 'sf: headline RSF = 14000, unskewed (got ' + r.tot + ')');
  assert(r.warn.some(w => /negative square-footage/.test(w)), 'sf: negative-SF warning surfaced');
  assert(r.warn.some(w => /0 SF/.test(w)), 'sf: zero-SF warning surfaced');
  // parseNum lower bound is also live in the suite editor path
  const clamp = await page.evaluate(() => parseNum('-250', 0));
  assert(clamp === null, 'sf: parseNum("-250", 0) -> null');
  await page.close();
}

// -------------------- [C-STK-11] paste box works without a paste event
{
  const page = await freshPage();
  await page.click('#pasteBtn');
  await page.fill('#pasteArea', 'Suite,Tenant,Floor,RSF\n100,TypedIn Co,1,5000');
  await page.click('#parseGoBtn');
  const r = await page.evaluate(() => ({
    n: S.rows.length,
    plan: document.querySelector('#planScreen').style.display === 'block',
  }));
  assert(r.n === 1 && r.plan, 'pastebox: typed input parses via Generate button');
  await page.close();
}

// ------------- enhancements: New-file full clear + confirm-before-discard
{
  const page = await freshPage();
  await page.evaluate(() => document.querySelector('#sampleBtn').click());
  await page.waitForTimeout(100);
  // no manual edits -> no confirm needed, and everything clears
  let r = await page.evaluate(() => {
    document.querySelector('#newBtn').click();
    return {
      svg: document.querySelector('#svgWrap').innerHTML,
      map: document.querySelector('#mapbar').innerHTML,
      warnShown: document.querySelector('#warnbar').style.display,
      rows: S.rows.length, grid: S.grid, title: S.title,
      drop: document.querySelector('#dropScreen').style.display !== 'none',
    };
  });
  assert(r.svg === '' && r.map === '', 'newfile: SVG and mapbar fully cleared');
  assert(r.warnShown === 'none' && r.rows === 0 && r.grid === null, 'newfile: state cleared');
  assert(r.title === 'Stacking Plan' && r.drop, 'newfile: title reset, back on drop screen');

  // with manual edits: confirm=false keeps the plan, confirm=true discards
  await page.evaluate(() => document.querySelector('#sampleBtn').click());
  await page.waitForTimeout(100);
  r = await page.evaluate(() => {
    S.rows[0].tenant = 'Edited Co'; S.dirty = true;
    window.confirm = () => false;
    document.querySelector('#newBtn').click();
    const kept = document.querySelector('#planScreen').style.display === 'block' && S.rows.length > 0;
    window.confirm = () => true;
    document.querySelector('#newBtn').click();
    const discarded = document.querySelector('#planScreen').style.display === 'none' && S.rows.length === 0;
    return { kept, discarded };
  });
  assert(r.kept, 'newfile: declining confirm keeps edited plan');
  assert(r.discarded, 'newfile: accepting confirm discards and resets');
  await page.close();
}

// --------------------------- inline title rename via mouse (no prompt())
{
  const page = await freshPage();
  await page.evaluate(() => document.querySelector('#sampleBtn').click());
  await page.waitForTimeout(100);
  const usesPrompt = await page.evaluate(() => {
    let called = false;
    window.prompt = () => { called = true; return 'x'; };
    document.querySelector('#planTitle').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    return { called, editor: !!document.querySelector('#titleEditor') };
  });
  assert(!usesPrompt.called, 'title: click does not call blocking prompt()');
  assert(usesPrompt.editor, 'title: click opens inline editor');
  await page.fill('#titleEditor', 'Clicked Rename');
  await page.keyboard.press('Enter');
  const t = await page.evaluate(() => S.title);
  assert(t === 'Clicked Rename', 'title: mouse rename commits (got "' + t + '")');
  await page.close();
}

// --------------------------- [QA2-P0-1] decorated vacancy labels count as vacant
{
  const page = await freshPage();
  const r = await page.evaluate(() => {
    const c = [
      'Suite\tTenant\tRSF\tLease Start\tLease Exp\tMonthly Base Rent',
      '100\tAlpha Co\t1000\t01/01/2022\t12/31/2028\t2500',
      '110\t*** VACANT ***\t1000\t-\t-\t0.00',
      '120\tVACANT - Available\t1000\t-\t-\t-',
      '130\tVACANT (retail)\t1000\t—\t—\t',
      '140\tAvailable Storage Inc.\t1000\t01/01/2023\t12/31/2029\t2100',
    ].join('\n');
    handlePaste(c, 'VacLabels');
    const st = {}; S.rows.forEach(x => st[x.suite] = x.status);
    const totalSF = S.rows.reduce((a, x) => a + (x.sf || 0), 0);
    const occSF = S.rows.filter(x => x.status !== 'vacant').reduce((a, x) => a + (x.sf || 0), 0);
    return { st, occPct: Math.round(occSF / totalSF * 1000) / 10 };
  });
  assert(r.st['110'] === 'vacant', 'vacancy: "*** VACANT ***" is vacant');
  assert(r.st['120'] === 'vacant', 'vacancy: "VACANT - Available" is vacant');
  assert(r.st['130'] === 'vacant', 'vacancy: "VACANT (retail)" is vacant');
  assert(r.st['140'] === 'occupied', 'vacancy: real tenant containing "Available" (with lease) stays occupied');
  assert(r.occPct === 40, 'vacancy: occupancy reflects decorated vacants (got ' + r.occPct + '%)');
  await page.close();
}

// --------------------------- [QA2-P0-2] non-suite rows never become blocks/floors
{
  const page = await freshPage();
  const r = await page.evaluate(() => {
    const c = [
      'Suite\tTenant\tRSF\tLease Exp',
      '100\tAlpha Co\t1000\t12/31/2028',
      '110\tVACANT\t500\t-',
      'OCCUPANCY SUMMARY\t\t\t',
      'Leased SF\t1000\t\t',
      'Physical Occupancy\t66.7%\t\t',
      'Suite 110 (500 SF) has been vacant since 12/31/2025. Marketing underway.\t\t\t',
      '&8FICTIONAL SAMPLE\t&8Page &P of &N\t\t',
    ].join('\n');
    handlePaste(c, 'Phantoms');
    return {
      rows: S.rows.map(x => x.suite),
      floors: [...new Set(S.rows.map(x => x.floor))],
      warns: S.warnings.join(' | '),
    };
  });
  assert(r.rows.length === 2 && r.rows.includes('100') && r.rows.includes('110'),
    'phantoms: only real suites survive (got ' + JSON.stringify(r.rows) + ')');
  assert(r.floors.every(f => f === '1'), 'phantoms: no garbage floors (got ' + JSON.stringify(r.floors) + ')');
  assert(/non-suite row/.test(r.warns), 'phantoms: ignored rows are surfaced in the warnbar');
  await page.close();
}

// --------------------------- [QA2-P0-2] options-block duplicates of real suites are dropped
{
  const page = await freshPage();
  const r = await page.evaluate(() => {
    const c = [
      'Suite\tTenant\tRSF\tLease Exp',
      '100\tAlpha Co\t1000\t12/31/2028',
      '200\tBeta LLC\t2000\t6/30/2029',
      'RENEWAL / EXPANSION OPTIONS\t\t\t',
      '100\tOne 5-yr option\t\t',
      '200\tOne 3-yr option @ FMV\t\t',
    ].join('\n');
    handlePaste(c, 'Dupes');
    return { n: S.rows.length, tenants: S.rows.map(x => x.tenant).sort(), warns: S.warnings.join(' | ') };
  });
  assert(r.n === 2, 'dupes: options block does not duplicate suites (got ' + r.n + ' rows)');
  assert(r.tenants.join(',') === 'Alpha Co,Beta LLC', 'dupes: the real rows are the ones kept');
  assert(/duplicate suite row/.test(r.warns), 'dupes: dropped duplicates are surfaced in the warnbar');
  await page.close();
}

// --------------------------- [QA2-P1-1] "% of Bldg" must not map to Building
{
  const page = await freshPage();
  const r = await page.evaluate(() => {
    const c = [
      'Suite\tTenant\tRSF\t% of Bldg\tLease Exp',
      '100\tAlpha Co\t1000\t33.3%\t12/31/2028',
      '200\tBeta LLC\t1000\t33.3%\t6/30/2029',
      '300\tGamma Inc\t1000\t33.4%\t3/31/2030',
    ].join('\n');
    handlePaste(c, 'PctBldg');
    return {
      buildingMapped: S.mapping.map.building != null,
      stacks: getBuildings().length,
    };
  });
  assert(!r.buildingMapped, 'building: "% of Bldg" header is not mapped to Building');
  assert(r.stacks === 1, 'building: plan renders as a single stack (got ' + r.stacks + ')');
  await page.close();
}

// --------------------------- [QA2-P1-1] wrong Building mapping self-heals via cardinality check
{
  const page = await freshPage();
  const r = await page.evaluate(() => {
    const c = [
      'Suite\tTenant\tRSF\tShare Code\tLease Exp',
      '100\tAlpha Co\t1000\tX1\t12/31/2028',
      '200\tBeta LLC\t1000\tX2\t6/30/2029',
      '300\tGamma Inc\t1000\tX3\t3/31/2030',
      '400\tDelta LP\t1000\tX4\t3/31/2031',
      '500\tEps Co\t1000\tX5\t3/31/2031',
      '600\tZeta Co\t1000\tX6\t3/31/2031',
    ].join('\n');
    handlePaste(c, 'CardCheck');
    S.mapping.map.building = 3;                 // force a bad mapping (per-row-unique column)
    S.rows = buildRows(S.grid, S.mapping);
    return {
      buildings: [...new Set(S.rows.map(x => x.building))],
      warns: S.warnings.join(' | '),
    };
  });
  assert(r.buildings.length === 1 && r.buildings[0] === '', 'building: per-row-unique column is unmapped (cardinality check)');
  assert(/Building column/.test(r.warns), 'building: cardinality unmap is surfaced in the warnbar');
  await page.close();
}

// --------------------------- [QA2-P1-2] "as of" comes from the file, and drives MTM
{
  const page = await freshPage();
  const r = await page.evaluate(() => {
    const c = [
      'Kestrel Commercial Real Estate Services\t\t\t',
      'RENT ROLL\t\t\t',
      'As of June 30, 2026\t\t\t',
      'Suite\tTenant\tRSF\tLease Exp',
      '100\tAlpha Co\t1000\t07/05/2026',   // after the roll date: occupied, not MTM
      '200\tBeta LLC\t2000\t6/30/2029',
    ].join('\n');
    handlePaste(c, 'AsOf');
    return {
      asOf: (S.asOf.getMonth() + 1) + '/' + S.asOf.getDate() + '/' + S.asOf.getFullYear(),
      st100: S.rows.find(x => x.suite === '100').status,
    };
  });
  assert(r.asOf === '6/30/2026', 'asof: date read from the file title rows (got ' + r.asOf + ')');
  assert(r.st100 === 'occupied', 'asof: lease expiring after the roll date is not MTM/holdover');

  // no as-of in the file -> falls back to today
  const fb = await page.evaluate(() => {
    document.querySelector('#newBtn').click();
    handlePaste('Suite\tTenant\tRSF\tLease Exp\n100\tAlpha\t1000\t12/31/2028', 'NoAsOf');
    const now = new Date();
    return S.asOf.getFullYear() === now.getFullYear() && S.asOf.getMonth() === now.getMonth() && S.asOf.getDate() === now.getDate();
  });
  assert(fb, 'asof: falls back to today when the file states no date');
  await page.close();
}

await browser.close();
console.log(failures ? `\n=== ${failures} TEST(S) FAILED ===` : '\n=== ALL STACKING TESTS PASS ===');
process.exit(failures ? 1 : 0);

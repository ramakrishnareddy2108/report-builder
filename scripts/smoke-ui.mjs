// Browser smoke test: opens the built app in a real (headless) Chrome or Edge and clicks through it.
// It fails if any page shows "Something went wrong" or throws, which is how a React render loop shows up.
//
//   npm run build && npx vite preview --port 4173     (in one terminal)
//   npm run smoke                                      (in another; or: node scripts/smoke-ui.mjs <url>)
//
// Steps: add the starter recipes -> open every page and every recipe-builder tab -> open the dashboard.
// If samples/2026-10/ exists (real files, git-ignored) it also generates the DRR from them and loads the
// result into the dashboard. Without samples/ it still runs the first part. No libraries needed: it talks to
// the browser over the DevTools protocol (Node 22+ has WebSocket and fetch built in).

import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const URL_ = process.argv[2] ?? 'http://localhost:4173/';
const PORT = 9341;
const BROWSERS = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
];
const exe = process.env.BROWSER ?? BROWSERS.find((p) => existsSync(p));
if (!exe) {
  console.error('No Chrome or Edge found. Set BROWSER=<path to the executable>.');
  process.exit(2);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const profile = mkdtempSync(join(tmpdir(), 'smoke-'));
const proc = spawn(exe, ['--headless=new', '--disable-gpu', '--window-size=1400,900', `--user-data-dir=${profile}`, `--remote-debugging-port=${PORT}`, 'about:blank'], { stdio: 'ignore' });

let ws;
let nextId = 0;
const waiting = new Map();
const problems = [];
let steps = 0;

function finish(code) {
  try { ws?.close(); } catch { /* already closed */ }
  proc.kill();
  setTimeout(() => { try { rmSync(profile, { recursive: true, force: true }); } catch { /* browser still releasing files */ } process.exit(code); }, 500);
}

async function connect() {
  for (let i = 0; i < 60; i++) {
    try {
      const targets = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
      const page = targets.find((t) => t.type === 'page');
      if (page) return page.webSocketDebuggerUrl;
    } catch { /* browser still starting */ }
    await sleep(250);
  }
  throw new Error('The browser did not start.');
}

const send = (method, params = {}) => new Promise((resolve_) => { const id = ++nextId; waiting.set(id, resolve_); ws.send(JSON.stringify({ id, method, params })); });
const run = async (expression) => (await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })).result?.result?.value;
const pageText = () => run(`document.querySelector('main')?.innerText ?? ''`);

async function check(label) {
  steps++;
  const text = await pageText();
  if (/Something went wrong while showing this page/.test(text)) {
    const msg = text.split('\n').find((l) => /error|depth|exceeded/i.test(l)) ?? '';
    problems.push(`${label}: the page crashed. ${msg}`);
  }
  console.log(`${/Something went wrong/.test(text) ? 'FAIL' : 'ok  '} ${label}`);
}

async function go(hash, label = hash) {
  await run(`location.hash = ${JSON.stringify(hash)}`);
  await sleep(1500);
  await check(label);
}
const click = (text) => run(`(() => { const bs = [...document.querySelectorAll('main button')]; const b = bs.find((x) => x.innerText.trim() === ${JSON.stringify(text)}) ?? bs.find((x) => x.innerText.includes(${JSON.stringify(text)})); if (!b || b.disabled) return false; b.click(); return true; })()`);
const openTab = (text) => run(`(() => { const b = [...document.querySelectorAll('[role=tab]')].find((x) => x.innerText.includes(${JSON.stringify(text)})); if (!b) return false; b.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 })); return true; })()`);
async function chooseFiles(index, paths) {
  const root = (await send('DOM.getDocument')).result.root.nodeId;
  const inputs = (await send('DOM.querySelectorAll', { nodeId: root, selector: 'input[type=file]' })).result.nodeIds;
  await send('DOM.setFileInputFiles', { nodeId: inputs[index], files: paths });
}

try {
  ws = new WebSocket(await connect());
  await new Promise((r) => (ws.onopen = r));
  ws.onmessage = (m) => {
    const d = JSON.parse(m.data);
    if (d.id && waiting.has(d.id)) { waiting.get(d.id)(d); waiting.delete(d.id); }
    else if (d.method === 'Runtime.exceptionThrown') problems.push(`script error: ${(d.params.exceptionDetails.exception?.description ?? d.params.exceptionDetails.text).slice(0, 200)}`);
  };
  await send('Runtime.enable');
  await send('DOM.enable');
  await send('Page.navigate', { url: URL_ });
  await sleep(3000);

  await go('#/home');
  if (!(await click('Add starter recipes: DRR, Sponsor-wise'))) problems.push('Home: the "Add starter recipes" button was not found.');
  await sleep(2000);
  await check('home (with starters)');

  for (const id of ['starter-drr', 'starter-sponsor-wise']) {
    await go(`#/recipe/${id}`);
    for (const tab of ['Prepare', 'Report', 'Output', 'Test', 'Sources']) {
      await openTab(tab);
      await sleep(1200);
      await check(`recipe ${id} · ${tab} tab`);
    }
  }

  await go('#/generate');
  await go('#/dashboards');
  await go('#/help');

  const SAMPLES = resolve('samples/2026-10');
  if (existsSync(SAMPLES)) {
    const template = join(SAMPLES, 'expected', 'DRR Format.xlsx');
    const exports = readdirSync(SAMPLES).filter((n) => n.endsWith('.xlsx') && !/sponsor-wise revenue report/i.test(n)).map((n) => join(SAMPLES, n));
    await go('#/generate');
    await click('DRR (Doctor-wise Revenue Report)');
    await sleep(1500);
    if (existsSync(template)) { await chooseFiles(0, [template]); await sleep(3000); }
    await chooseFiles(0, exports);
    await sleep(6000);
    await check('generate · files added');
    if (!(await click('Generate'))) problems.push('Generate: the Generate button was disabled after adding the sample files.');
    await sleep(15000);
    await check('generate · result');
    const text = await pageText();
    if (!/Checks|Total/i.test(text)) problems.push('Generate: no result was shown after Generate.');
    await go('#/dashboards');
    await click('DRR Monthly Review');
    await sleep(1500);
    await check('dashboard · opened');
    await click('Use the last generated report');
    await sleep(3000);
    await check('dashboard · with the generated report');
    if (!/rows loaded/.test(await pageText())) problems.push('Dashboard: the generated report was not loaded.');
  } else {
    console.log('samples/2026-10 not found: the generate-and-dashboard part is skipped.');
  }
} catch (err) {
  problems.push(`smoke test stopped: ${err instanceof Error ? err.message : err}`);
}

console.log(`\n${steps} checks, ${problems.length} problem${problems.length === 1 ? '' : 's'}.`);
for (const p of problems) console.log(` - ${p}`);
finish(problems.length ? 1 : 0);

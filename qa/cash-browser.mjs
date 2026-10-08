import assert from 'node:assert/strict';
import fs from 'node:fs';
import {spawn} from 'node:child_process';
import {pathToFileURL} from 'node:url';
const {chromium}=await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE).href);
const executablePath=['/usr/bin/google-chrome','/usr/bin/google-chrome-stable','/usr/bin/chromium'].find(p=>fs.existsSync(p));
assert.ok(executablePath);
const server=spawn(process.execPath,['scripts/serve.cjs'],{env:{...process.env,PORT:'4175'},stdio:'inherit'});
let browser;
try {
 await new Promise(r=>setTimeout(r,800));
 browser=await chromium.launch({headless:true,executablePath,args:['--no-sandbox']});
 const context=await browser.newContext({viewport:{width:1440,height:1000},timezoneId:'Asia/Seoul',serviceWorkers:'block'});
 await context.route(/supabase\.co/,r=>r.abort());
 const page=await context.newPage(), errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('http://127.0.0.1:4175/',{waitUntil:'networkidle'});
 const dates=await page.evaluate(async()=>{
  const {emptyState}=await import('./data/defaults.js'),{Repository}=await import('./js/db.js');
  const s=emptyState();s.configured=true;s.settings.privacy=false;s.settings.income=4000000;s.settings.sharedBudget=2000000;
  const r=new Repository();await r.replace(s);r.close();
  const date=n=>new Date(Date.now()+9*3600000-n*86400000).toISOString().slice(0,10);
  return {start:date(3)+'T23:59:59',movement:date(2)+'T10:23:00',check:date(1)+'T18:00:00'};
 });
 await page.reload({waitUntil:'networkidle'});await page.waitForSelector('.cash-home');
 const read=()=>page.evaluate(async()=>{const {Repository}=await import('./js/db.js'),{cashSummary}=await import('./js/cash.js');const r=new Repository(),s=await r.read();r.close();return {state:s,cash:cashSummary(s)};});
 const submit=async()=>{await page.locator('#dialog [type=submit]').click();await page.waitForTimeout(120);assert.equal(await page.locator('#dialog[open]').count(),0,await page.locator('#dialog').innerText());};
 await page.locator('[data-action="cash-account"]').first().click();
 for(const [n,v]of [['name','QA 생활비 계좌'],['openingBalance','1000000'],['openingAt',dates.start],['reserved','100000']])await page.locator(`#dialog [name=${n}]`).fill(v);
 await submit();
 let d=await read();const a=d.cash.accounts[0].id;assert.equal(d.cash.accounts[0].difference,null);assert.equal(d.state.transactions.length,0);assert.equal(d.cash.usable,900000);
 await page.goto('http://127.0.0.1:4175/#cash');await page.waitForSelector('.cash-page');
 assert.equal(await page.locator('#month-picker').isVisible(),false);
 await page.locator('[data-action="cash-entry"]').first().click();
 await page.locator('#dialog [name=kind]').selectOption('expense');
 await page.locator('#dialog [name=category]').selectOption('work');
 for(const[n,v]of[['merchant','QA 업무경비'],['amount','12000'],['at',dates.movement]])await page.locator(`#dialog [name=${n}]`).fill(v);
 await page.locator('#dialog [name=checked]').check();await submit();
 d=await read();assert.equal(d.cash.expected,988000);assert.equal(d.state.transactions.length,1);assert.equal(d.state.transactions[0].category,'work');
 await page.locator('.cash-account [data-action="cash-check"]').click();
 await page.locator('#dialog [name=actual]').fill('985000');await page.locator('#dialog [name=at]').fill(dates.check);await page.locator('#dialog [name=checked]').check();await submit();
 d=await read();assert.equal(d.cash.accounts[0].difference,-3000);assert.equal(d.state.transactions.length,1);
 assert.ok((await page.locator('.cash-result').innerText()).includes('실제가 3,000원 적음'));
 // An existing bank movement is linked without creating another household expense.
 await page.evaluate(async({movement})=>{const {Repository}=await import('./js/db.js');const r=new Repository();await r.mutate(s=>{s.transactions.push({...s.transactions[0],id:'cash-existing',sourceId:'cash-existing',merchantRaw:'QA 기존 환불',merchantNormalized:'qa 기존 환불',amount:5000,direction:'refund',datetime:movement,date:movement.slice(0,10),categoryConfirmed:false});});r.close();},dates);
 await page.reload({waitUntil:'networkidle'});
 await page.locator('[data-action="cash-link"][data-id="cash-existing"]').click();
 await page.locator('#dialog [name=mode]').selectOption('in');await page.locator('#dialog [name=accountId]').selectOption(a);await page.locator('#dialog [name=checked]').check();await submit();
 d=await read();assert.equal(d.cash.expected,993000);assert.equal(d.state.transactions.length,2);assert.equal(d.cash.accounts[0].difference,-8000);assert.equal(d.cash.accounts[0].recalculated,true);
 await page.locator('[data-action="cash-account"]').first().click();
 for(const[n,v]of[['name','QA 두번째 계좌'],['openingBalance','100000'],['openingAt',dates.start]])await page.locator(`#dialog [name=${n}]`).fill(v);await submit();
 d=await read();const b=d.cash.accounts.find(x=>x.id!==a).id;
 await page.locator(`[data-action="cash-entry"][data-id="${a}"]`).click();
 await page.locator('#dialog [name=kind]').selectOption('transfer');await page.locator('#dialog [name=toAccountId]').selectOption(b);
 for(const[n,v]of[['merchant','QA 계좌이체'],['amount','20000'],['at',dates.movement]])await page.locator(`#dialog [name=${n}]`).fill(v);await page.locator('#dialog [name=checked]').check();await submit();
 d=await read();assert.equal(d.cash.expected,1093000);assert.equal(d.cash.accounts.find(x=>x.id===a).now.expected,973000);assert.equal(d.cash.accounts.find(x=>x.id===b).now.expected,120000);
 // Void just the mistaken balance observation, not financial records.
 await page.locator('[data-action="cash-void"]').click();await submit();d=await read();assert.equal(d.state.transactions.length,3);assert.equal(d.cash.accounts.find(x=>x.id===a).difference,null);
 await page.locator('[name=cash-status]').selectOption('linked');await page.locator('[name=cash-search]').fill('QA 계좌이체');assert.equal(await page.locator('.cash-link-row').count(),1);await page.locator('[name=cash-search]').fill('');
 fs.mkdirSync('qa-results',{recursive:true});const layouts=[];
 for(const[width,height]of[[1440,1000],[1024,768],[768,1024],[390,844],[375,812],[320,720]]){
  await page.setViewportSize({width,height});
  for(const route of ['home','cash','recurring','review','transactions','budget','analytics','settings','import']){
   await page.goto('http://127.0.0.1:4175/#'+route);await page.waitForTimeout(70);
   const m=await page.evaluate(()=>({viewport:innerWidth,width:document.documentElement.scrollWidth}));layouts.push({route,...m});assert.ok(m.width<=m.viewport+1,JSON.stringify({route,...m}));
   if([390,1440].includes(width)&&['home','cash'].includes(route))await page.screenshot({path:`qa-results/cash-${route}-${width}.png`,fullPage:true});
  }
 }
 await page.reload({waitUntil:'networkidle'});d=await read();assert.equal(d.state.cashAccounts.length,2);assert.equal(d.state.cashLinks.length,3);assert.equal(d.state.cashChecks.length,1);assert.equal(d.cash.expected,1093000);assert.deepEqual(errors,[]);
 fs.writeFileSync('qa-results/cash-browser.json',JSON.stringify({result:'PASS',layouts,errors,checks:['baseline-not-income','work-category-save','cash-expense','actual-balance-difference','link-existing-no-new-expense','history-recalculation','transfer-no-double-count','void-observation-only','search','reload-preservation','54-responsive-pages']},null,2));
 console.log('PASS cash account forms, entries, reconciliation, transfer, reload and 54 responsive page combinations');
}finally{await browser?.close();server.kill();}

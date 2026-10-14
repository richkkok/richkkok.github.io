import assert from 'node:assert/strict';
import fs from 'node:fs';
import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';
const {chromium}=await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE).href);
const executablePath=['/usr/bin/google-chrome','/usr/bin/google-chrome-stable','/usr/bin/chromium'].find(p=>fs.existsSync(p));
const server=spawn(process.execPath,['scripts/serve.cjs'],{env:{...process.env,PORT:'4177'},stdio:'inherit'});
let browser;
try{
 await new Promise(r=>setTimeout(r,600));browser=await chromium.launch({headless:true,executablePath,args:['--no-sandbox']});
 const context=await browser.newContext({viewport:{width:1440,height:1000},timezoneId:'Asia/Seoul',serviceWorkers:'block'});
 await context.route(/supabase\.co/,r=>r.abort());const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));page.setDefaultTimeout(6000);
 await page.goto('http://127.0.0.1:4177/',{waitUntil:'networkidle'});
 await page.evaluate(async()=>{const {emptyState}=await import('./data/defaults.js'),{Repository}=await import('./js/db.js'),{cashNow}=await import('./js/cash.js');const s=emptyState();s.configured=true;s.settings.privacy=false;Object.assign(s.settings,{income:6000000,sharedBudget:2000000,personalBudgets:{p1:250000,p2:250000},savingsTarget:1000000});const now=cashNow();s.transactions=[{id:'qa-expense',sourceId:'qa-expense',date:now.slice(0,10),datetime:now.slice(0,10)+'T10:00:00',amount:500000,direction:'expense',scope:'shared',owner:'p1',category:'groceries',merchantRaw:'QA 장보기',merchantNormalized:'qa 장보기',paymentMethod:'QA 카드',costKind:'variable',sourceType:'manual',categoryConfirmed:true}];s.recurring=[{id:'qa-fixed',name:'QA 월 고정비',day:15,amount:1200000,owner:'joint',scope:'fixed',category:'housing',paymentMethod:'QA 계좌',start:'2026-01-01',end:'',changes:[]}];s.cashAccounts=[{id:'qa-account',name:'QA 생활비',owner:'p1',openingBalance:950000,openingAt:now,reserved:150000,paymentMethod:'',autoMatch:false}];const r=new Repository();await r.replace(s);r.close();});
 await page.reload({waitUntil:'networkidle'});await page.waitForSelector('.focus-board');
 const read=()=>page.evaluate(async()=>{const {Repository}=await import('./js/db.js');const r=new Repository(),s=await r.read();r.close();return s;});
 assert.equal(await page.locator('.focus-board>.focus-card').count(),3);assert.equal(await page.locator('.focus-details details[open]').count(),0);assert.equal(await page.locator('#navigation a').count(),5);
 assert.equal(await page.locator('[data-focus-value=remaining]').innerText(),'2,000,000원');assert.equal(await page.locator('[data-focus-value=used]').innerText(),'50만원');assert.equal(await page.locator('[data-focus-value=limit]').innerText(),'250만원');
 assert.equal(await page.locator('[data-focus-value=cash]').innerText(),'80만원');assert.equal(await page.locator('[data-focus-value=cash-income]').innerText(),'0원');
 assert.equal(await page.locator('[data-focus-value=fixed-spent]').innerText(),'0원');assert.equal(await page.locator('[data-focus-value=fixed]').innerText(),'120만원');
 assert.equal(await page.locator('.focus-budget .focus-ratio').getAttribute('aria-label'),'실제 소비 사용액 500,000원, 설정한 소비한도 2,500,000원');
 assert.match(await page.locator('.focus-cash .focus-note').first().innerText(),/귀속월 기준/);
 assert.match(await page.locator('.focus-fixed .focus-label').innerText(),/실제 고정비 지출/);assert.equal(await page.locator('.income-schedule-panel').isVisible(),false);
 assert.equal(await page.locator('.focus-cash-entry-actions > .focus-cash-entry-group').count(),2);
 assert.equal(await page.locator('.focus-cash-entry-actions [data-action=cash-check]').count(),1);
 assert.equal(await page.locator('.focus-cash-entry-actions [data-action=money-income]').count(),1);
 assert.equal(await page.locator('.focus-cash-entry-links [data-action=cash-account]').count(),1);
 assert.equal(await page.locator('.focus-cash-entry-links [data-action=money-add-income]').count(),1);
 await page.locator('.focus-cash-entry-actions [data-action=cash-check]').click();
 assert.match(await page.locator('#dialog h2').innerText(),/현재 현금잔액 입력/);
 assert.equal(await page.locator('#dialog [name=actual]').count(),1);
 await page.locator('#dialog [data-close]').first().click();
 await page.locator('.focus-cash-entry-actions [data-action=money-income]').click();
 assert.match(await page.locator('#dialog h2').innerText(),/실제 입금 내역/);
 assert.equal(await page.locator('#dialog .income-ledger-head [data-action=money-add-income]').count(),1);
 await page.locator('#dialog [data-close]').first().click();
 await page.locator('.focus-cash-entry-links [data-action=cash-account]').click();
 assert.match(await page.locator('#dialog h2').innerText(),/첫 기준잔액 입력/);
 assert.equal(await page.locator('#dialog [name=openingBalance]').count(),1);
 await page.locator('#dialog [data-close]').first().click();
 const before=await read();await page.locator('.focus-budget [data-action=focus-plan]').click();await page.locator('[data-focus-cut="100000"]').click();assert.match(await page.locator('#focus-preview-remaining').innerText(),/1,900,000/);await page.locator('#dialog [data-close]').first().click();assert.deepEqual(await read(),before);
 await page.locator('.focus-budget [data-action=focus-plan]').click();await page.locator('[data-focus-cut="100000"]').click();await page.locator('#dialog [type=submit]').click();await page.waitForSelector('#dialog[open]',{state:'hidden'});assert.equal(await page.locator('[data-focus-value=remaining]').innerText(),'1,900,000원');
 const after=await read();assert.deepEqual(after.transactions,before.transactions);assert.deepEqual(after.cashAccounts,before.cashAccounts);assert.equal(after.settings.income,before.settings.income);assert.equal(after.settings.sharedBudget,before.settings.sharedBudget);
 await page.locator('.focus-budget [data-action=focus-plan]').click();await page.locator('[name=focus-total]').fill('100');await page.locator('#dialog [type=submit]').click();assert.equal(await page.locator('#dialog[open]').count(),1);assert.match(await page.locator('#dialog .form-error').innerText(),/용돈/);await page.locator('#dialog [data-close]').first().click();
 await page.locator('[data-focus-fold=income]>summary').click();assert.equal(await page.locator('.income-schedule-panel').isVisible(),true);await page.locator('[data-action=month-income]').first().click();assert.equal(await page.locator('#dialog [name=income-day-0]').inputValue(),'10');await page.locator('#dialog [data-close]').first().click();await page.locator('[data-focus-fold=income]>summary').click();
 await page.locator('#navigation [href="#more"]').click();await page.waitForSelector('.focus-more');await page.locator('[data-action=go-review]').click();await page.waitForSelector('.review-cards');assert.equal(await page.locator('#navigation [href="#more"][aria-current=page]').count(),1);
 fs.mkdirSync('qa-results',{recursive:true});const layouts=[];
 for(const width of [1440,1024,768,390,375,320]){
  await page.setViewportSize({width,height:900});
  for(const route of ['home','cash','recurring','more','transactions','review','analytics','budget','settings','import']){
   await page.goto('http://127.0.0.1:4177/#'+route);await page.waitForTimeout(80);const m=await page.evaluate(()=>({viewport:innerWidth,width:document.documentElement.scrollWidth}));assert.ok(m.width<=m.viewport+1,JSON.stringify({route,...m}));layouts.push({route,...m});
   if([390,1440].includes(width)&&['home','more','recurring'].includes(route))await page.screenshot({path:`qa-results/focus-${route}-${width}.png`,fullPage:true});
  }
  await page.goto('http://127.0.0.1:4177/#home');
  const summaryLayout=await page.locator('.focus-board').evaluate(board=>({
   boardOverflow: board.scrollWidth-board.clientWidth,
   pairOverflow:[...board.querySelectorAll('.focus-ratio')].map(pair=>pair.scrollWidth-pair.clientWidth)
  }));
  assert.ok(summaryLayout.boardOverflow<=1,JSON.stringify({width,summaryLayout}));
  assert.ok(summaryLayout.pairOverflow.every(n=>n<=1),JSON.stringify({width,summaryLayout}));
  const cashEntries=await page.locator('.focus-cash-entry').evaluate(box=>{
   const bounds=box.getBoundingClientRect();
   const buttons=[...box.querySelectorAll('button')].map(b=>{
     const rect=b.getBoundingClientRect();return {label:b.textContent.trim(),width:rect.width,height:rect.height,left:rect.left,right:rect.right}
   });
   return {overflow:box.scrollWidth-box.clientWidth,boxLeft:bounds.left,boxRight:bounds.right,buttons};
  });
  assert.ok(cashEntries.overflow<=1,JSON.stringify({width,cashEntries}));
  for(const b of cashEntries.buttons){
   assert.ok(b.height>=30,JSON.stringify({width,b}));
   assert.ok(b.left>=cashEntries.boxLeft-1&&b.right<=cashEntries.boxRight+1,JSON.stringify({width,b,cashEntries}));
  }
  await page.locator('.focus-budget [data-action=focus-plan]').click();const d=await page.locator('#dialog').evaluate(el=>({width:el.clientWidth,scroll:el.scrollWidth}));assert.ok(d.scroll<=d.width+1,JSON.stringify(d));if(width===390)await page.screenshot({path:'qa-results/focus-editor-390.png'});await page.locator('#dialog [data-close]').first().click();
 }
 // Synthetic fixed-bank-payment regression: a payment after the measured
 // balance must lower home cash, but must not overwrite that bank observation.
 await page.evaluate(async()=>{
  const {Repository}=await import('./js/db.js');
  const {cashNow}=await import('./js/cash.js');
  const {addDays,periodKey}=await import('./js/period.js');
  const now=cashNow(), date=addDays(now.slice(0,10),-1), start=addDays(date,-1);
  const r=new Repository(),s=await r.read();
  s.cashAccounts[0].openingAt=start+'T10:00:00';
  s.transactions.push({
   id:'qa-fixed-cash-after-check',sourceId:'qa-fixed-cash-after-check',
   date,datetime:date+'T14:00:00',amount:200000,
   direction:'expense',scope:'fixed',costKind:'fixed',recurringId:'qa-fixed',
   owner:'joint',category:'housing',categoryConfirmed:true,
   merchantRaw:'QA 실제 고정비 출금',merchantNormalized:'qa 실제 고정비 출금',
   paymentMethod:'QA 은행계좌',operatingMonth:periodKey(now.slice(0,10),10),
   sourceType:'manual',deletedAt:null
  });
  await r.replace(s);r.close();
 });
 await page.reload({waitUntil:'networkidle'});
 assert.equal(await page.locator('[data-focus-value=cash]').innerText(),'60만원');
 assert.equal(await page.locator('[data-focus-value=fixed-spent]').innerText(),'20만원');
 assert.match(await page.locator('.focus-cash .focus-status').innerText(),/고정비 출금 추정 반영/);
 await page.setViewportSize({width:390,height:900});
 assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'Paid fixed cash status must not overflow iPhone width');
 assert.equal(await page.locator('[data-focus-value=remaining]').innerText(),'1,900,000원');
 assert.equal(await page.locator('.focus-details details[open]').count(),0);
 assert.deepEqual(errors,[]);
 fs.writeFileSync('qa-results/focus-browser.json',JSON.stringify({result:'PASS',layouts,errors,checks:['3 primary regions','5 navigation items','hidden secondary detail','planned limit distinct from cash','cancel-no-write','preview-save','invalid plan rejected','income-settings-reachable','more-menu-routes','reload-preservation','60 responsive pages','three compact ratios','ratio labels distinguish actual income','no ratio overflow','cash baseline/income direct actions','cash action touch targets at six viewport widths']},null,2));console.log('PASS focus dashboard, preview/edit/cancel, all routes and 60 responsive page combinations');
}finally{await browser?.close();server.kill();}

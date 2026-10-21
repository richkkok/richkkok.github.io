import assert from 'node:assert/strict';
import fs from 'node:fs';
import {spawn} from 'node:child_process';
import {pathToFileURL} from 'node:url';
const {chromium,webkit,devices}=await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE).href);
const base=process.env.QA_URL||'http://127.0.0.1:4195';
const server=process.env.QA_URL?null:spawn(process.execPath,['scripts/serve.cjs'],{env:{...process.env,PORT:'4195'},stdio:'ignore'});
const folder=process.env.QA_OUTPUT||'qa-results';fs.mkdirSync(folder,{recursive:true});
const results=[];
async function seed(page){
 await page.evaluate(async()=>{
  const {emptyState}=await import('./data/defaults.js'),{Repository}=await import('./js/db.js'),{savePaymentProfile}=await import('./js/payment-channels.js');
  const s=emptyState();s.configured=true;s.settings.privacy=false;s.settings.periodStartDay=1;s.settings.variableBudget=2500000;s.transactions=[];s.recurring=[];
  savePaymentProfile(s,'검증 신한카드','credit',3,17,0);
  const t=(id,date,amount,extra={})=>({id,sourceId:id,date,datetime:date+'T10:01:00',amount,direction:'expense',owner:'p1',scope:'shared',category:'groceries',categoryConfirmed:true,merchantRaw:'검증 '+id,merchantNormalized:'검증 '+id,paymentMethod:'검증 신한카드',sourceType:'manual',...extra});
  s.transactions=[t('sep8','2026-09-08',50000),t('sep25','2026-09-25',100000),t('oct2','2026-10-02',20000),t('oct4','2026-10-04',40000)];
  s.cashAccounts=[{id:'qa-bank',name:'검증 은행',owner:'p1',openingAt:'2026-09-01T00:00:00',openingBalance:1000000,reserved:0,paymentMethod:'검증 은행',autoMatch:false}];
  const r=new Repository();await r.replace(s);r.close();
 });
 await page.reload({waitUntil:'networkidle'});
 await page.locator('#month-picker').fill('2026-10');await page.locator('#month-picker').dispatchEvent('change');
}
async function read(page){return page.evaluate(async()=>{const {Repository}=await import('./js/db.js');const r=new Repository();const s=await r.read();r.close();return s;});}
async function close(page){await page.locator('#dialog [data-close]').first().click();}
try{
 if(server)await new Promise(r=>setTimeout(r,500));
 for(const [name,engine,options] of [['desktop',chromium,{viewport:{width:1440,height:1000}}],['iphone-webkit',webkit,{...devices['iPhone 13']}]] ){
  const browser=await engine.launch({headless:true});
  try{
   const context=await browser.newContext({...options,timezoneId:'Asia/Seoul',serviceWorkers:'block'});
   await context.route(/supabase\.co/,r=>r.abort());
   const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));page.setDefaultTimeout(9000);
   await page.clock.install({time:new Date('2026-10-21T03:00:00Z')});await page.goto(base+'/',{waitUntil:'networkidle'});await seed(page);
   assert.equal(await page.locator('[data-control-value=used]').innerText(),'170,000원');
   assert.match(await page.locator('.control-home').innerText(),/결제 예정월 기준/);
   assert.ok(await page.locator('.control-next-preview').isVisible());
   assert.match(await page.locator('.control-next-preview h3').innerText(),/2026년 11월/);
   assert.equal(await page.locator('[data-next-value=used]').innerText(),'40,000원');
   assert.equal(await page.locator('[data-next-value=limit]').innerText(),'2,500,000원');
   assert.equal(await page.locator('[data-next-value=remaining]').innerText(),'2,460,000원');
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
   const beforeLimit=await read(page);
   await page.locator('.control-next-preview [data-action=control-limit]').click();
   assert.equal(await page.locator('#dialog [name=month]').inputValue(),'2026-11');
   assert.equal(await page.locator('#dialog [name=amount]').inputValue(),'2500000');
   await page.locator('#dialog [name=amount]').fill('1800000');
   await page.locator('#dialog [type=submit]').click();await page.locator('#dialog[open]').waitFor({state:'hidden'});
   assert.equal(await page.locator('[data-next-value=limit]').innerText(),'1,800,000원');
   assert.equal(await page.locator('[data-next-value=remaining]').innerText(),'1,760,000원');
   assert.equal(await page.locator('[data-control-value=limit]').innerText(),'2,500,000원');
   assert.deepEqual((await read(page)).transactions,beforeLimit.transactions);
   await page.reload({waitUntil:'networkidle'});
   assert.equal(await page.locator('[data-next-value=limit]').innerText(),'1,800,000원');
   await page.locator('#month-picker').fill('2026-11');await page.locator('#month-picker').dispatchEvent('change');
   assert.equal(await page.locator('[data-control-value=limit]').innerText(),'1,800,000원');
   await page.locator('#month-picker').fill('2026-10');await page.locator('#month-picker').dispatchEvent('change');
   await page.screenshot({path:`${folder}/next-month-home-${name}.png`,fullPage:true});
   await page.locator('.control-spending-trigger').click();await page.locator('#dialog [data-edit=sep8]').click();
   assert.match(await page.locator('[data-card-allocation]').innerText(),/2026-09-08/);
   assert.match(await page.locator('[data-card-allocation]').innerText(),/2026-10-17/);
   assert.match(await page.locator('[data-card-allocation]').innerText(),/2026년 10월/);
   await page.screenshot({path:`${folder}/card-cycle-detail-${name}.png`,fullPage:true});await close(page);
   await page.goto(base+'/#cash');await page.waitForSelector('.instrument-directory');
   const open=()=>page.locator('.instrument-directory-open[data-method="검증 신한카드"]').click();
   await open();assert.equal(await page.locator('#dialog [name=startDay]').inputValue(),'4');
   const original=await read(page);
   await page.locator('#dialog [name=closingDay]').fill('4');
   assert.match(await page.locator('[data-cycle-preview]').innerText(),/겹치거나 빠지는/);
   await page.locator('#dialog [type=submit]').click();await page.waitForFunction(()=>document.querySelector('#dialog .form-error')?.textContent.includes('겹치거나'));assert.match(await page.locator('#dialog .form-error').innerText(),/겹치거나/);
   assert.deepEqual(await read(page),original);
   await page.locator('#dialog [name=startDay]').fill('21');await page.locator('#dialog [name=closingDay]').fill('20');await page.locator('#dialog [name=paymentDay]').fill('25');await page.locator('#dialog [name=lagMonths]').selectOption('0');await page.locator('#dialog [name=billingEffective]').fill('2026-09-01');
   assert.match(await page.locator('[data-cycle-preview]').innerText(),/2026-10-21 ~ 2026-11-20/);
   assert.match(await page.locator('[data-cycle-preview]').innerText(),/2026-11-25/);
   assert.match(await page.locator('[data-cycle-preview]').innerText(),/기존 거래 변경 미리보기/);
   assert.deepEqual(await read(page),original,'Preview does not persist');
   await page.locator('#dialog [type=submit]').click();await page.waitForFunction(()=>document.querySelector('#dialog .form-error')?.textContent.includes('변경 전후'));assert.match(await page.locator('#dialog .form-error').innerText(),/확인/);
   const size=await page.locator('#dialog').evaluate(el=>({width:el.clientWidth,scroll:el.scrollWidth}));assert.ok(size.scroll<=size.width+1,JSON.stringify(size));
   await page.screenshot({path:`${folder}/card-cycle-settings-${name}.png`,fullPage:true});
   await page.locator('#dialog [name=cycleChangeConfirmed]').check();await page.locator('#dialog [type=submit]').click();await page.locator('#dialog[open]').waitFor({state:'hidden'});
   const saved=await read(page);assert.deepEqual(saved.transactions,original.transactions);assert.equal(saved.settings.paymentProfiles['검증신한카드'].startDay,21);assert.equal(saved.settings.paymentProfiles['검증신한카드'].closingDay,20);
   await open();assert.equal(await page.locator('#dialog [name=startDay]').inputValue(),'21');assert.equal(await page.locator('#dialog [name=paymentDay]').inputValue(),'25');await page.locator('.card-cycle-history summary').click();assert.match(await page.locator('.card-cycle-history').innerText(),/2026-09-01/);await close(page);
   await page.goto(base+'/#home');await page.waitForSelector('.control-home');assert.equal(await page.locator('[data-control-value=used]').innerText(),'160,000원');
   await page.clock.setSystemTime(new Date('2026-11-01T03:00:00Z'));
   await page.evaluate(()=>document.dispatchEvent(new Event('visibilitychange')));
   assert.equal(await page.locator('#month-picker').inputValue(),'2026-11');
   assert.equal(await page.locator('[data-control-value=limit]').innerText(),'1,800,000원');
   await page.reload({waitUntil:'networkidle'});
   assert.equal(await page.locator('[data-control-value=limit]').innerText(),'1,800,000원');
   await page.locator('#month-picker').fill('2026-09');await page.locator('#month-picker').dispatchEvent('change');
   await page.clock.setSystemTime(new Date('2026-12-01T03:00:00Z'));
   await page.evaluate(()=>document.dispatchEvent(new Event('visibilitychange')));
   assert.equal(await page.locator('#month-picker').inputValue(),'2026-09','Preserve manually selected historical month');
   assert.deepEqual(errors,[]);results.push({engine:name,cycleSettings:true,previewReadOnly:true,impactConfirmation:true,sep8October:true,originalPreserved:true,pass:true});
   await context.close();
  }finally{await browser.close();}
 }
 const browser=await chromium.launch({headless:true});
 try{
  const context=await browser.newContext({timezoneId:'Asia/Seoul'});await context.route(/supabase\.co/,r=>r.abort());const page=await context.newPage();await page.clock.install({time:new Date('2026-10-21T03:00:00Z')});await page.goto(base+'/');await seed(page);
  await page.evaluate(async()=>{await navigator.serviceWorker.register('./sw.js');await navigator.serviceWorker.ready;});await page.reload({waitUntil:'networkidle'});await context.setOffline(true);await page.reload({waitUntil:'domcontentloaded'});await page.waitForSelector('.control-home');assert.equal(await page.locator('[data-control-value=used]').innerText(),'170,000원');
  await page.goto(base+'/#cash');await page.locator('.instrument-directory-open[data-method="검증 신한카드"]').click();assert.equal(await page.locator('#dialog [name=startDay]').inputValue(),'4');results.push({engine:'chromium-pwa',offlineSettings:true,pass:true});await context.close();
 }finally{await browser.close();}
 fs.writeFileSync(`${folder}/card-cycle-browser.json`,JSON.stringify(results,null,2));console.log(JSON.stringify(results));
}finally{server?.kill();}

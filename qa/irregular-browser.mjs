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
  const {emptyState}=await import('./data/defaults.js'),{Repository}=await import('./js/db.js'),{saveIrregular}=await import('./js/irregular.js');
  const s=emptyState();s.configured=true;s.settings.privacy=false;s.settings.periodStartDay=1;s.settings.members={p1:'박태영',p2:'김은영'};
  const tx=(id,amount,extra={})=>({id,sourceId:id,date:'2026-10-15',datetime:'2026-10-15T10:00:00',amount,direction:'expense',owner:'p2',scope:'shared',category:'tax',merchantRaw:'검증용 세금',merchantNormalized:'검증용 세금',paymentMethod:'검증 은행',sourceType:'manual',...extra});
  s.transactions=[tx('income',1000000,{direction:'income',merchantRaw:'급여'}),tx('existing-tax',280000)];
  for(const [id,name,dueDate] of [['far','가상 자동차세','2026-10-28'],['soon','가상 보험료','2026-10-27'],['today','가상 당일세금','2026-10-20'],['late','가상 미납세금','2026-10-19']])saveIrregular(s,{id,name,dueDate,amount:10000,payer:'unknown',note:''},null,null,'2026-10-20');
  const repo=new Repository();await repo.replace(s);repo.close();
 });
 await page.reload({waitUntil:'networkidle'});await page.waitForSelector('.irregular-card');
 await page.locator('#month-picker').fill('2026-10');await page.locator('#month-picker').dispatchEvent('change');
}
async function save(page){await page.locator('#dialog [type=submit]').click();try{await page.waitForSelector('#dialog[open]',{state:'hidden'});}catch{throw Error(await page.locator('#dialog').innerText());}}
async function read(page){return page.evaluate(async()=>{const {Repository}=await import('./js/db.js');const r=new Repository();const s=await r.read();r.close();return s;});}
async function layout(page){const size=await page.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth,dialog:document.querySelector('#dialog').getBoundingClientRect().toJSON()}));assert.ok(size.scroll<=size.width+1,JSON.stringify(size));if(size.dialog.width)assert.ok(size.dialog.x>=0&&size.dialog.right<=size.width+1,JSON.stringify(size));}
try{
 if(server)await new Promise(r=>setTimeout(r,600));
 for(const [name,engine,options] of [['desktop',chromium,{viewport:{width:1440,height:1000}}],['iphone',webkit,{...devices['iPhone 13']}],['small-mobile',chromium,{viewport:{width:360,height:740},isMobile:true,hasTouch:true}]]){
  const browser=await engine.launch({headless:true});
  try{
   const context=await browser.newContext({...options,timezoneId:'Asia/Seoul',serviceWorkers:'block'});await context.route(/supabase\.co/,r=>r.abort());
   const page=await context.newPage();page.setDefaultTimeout(8000);await page.clock.install({time:new Date('2026-10-20T03:00:00Z')});const errors=[];page.on('pageerror',e=>errors.push(e.message));
   await page.goto(base+'/',{waitUntil:'networkidle'});await seed(page);
   assert.equal(await page.locator('.control-home > :last-child').getAttribute('aria-label'),'비정기 고정지출');
   assert.deepEqual(await page.locator('[data-irregular-status=pending] [data-id]').evaluateAll(xs=>xs.map(x=>x.dataset.id)),['late','today','soon','far']);
   for(const id of ['late','today','soon'])assert.equal(await page.locator(`.irregular-row[data-id=${id}] .control-warning`).count(),1);
   assert.equal(await page.locator('.irregular-row[data-id=far] .control-warning').count(),0);
   await page.locator('[data-action=irregular-add]').click();
   await page.locator('#dialog [name=name]').fill('가상 재산세');await page.locator('#dialog [name=dueDate]').fill('2027-07-16');await page.locator('#dialog [name=amount]').fill('300000');await page.locator('#dialog [name=payer]').selectOption('p2');await page.locator('#dialog [name=note]').fill('검증 전용');
   await page.locator('#dialog [name=name]').focus();assert.equal(await page.locator('#dialog [name=amount]').inputValue(),'300,000');await layout(page);await page.screenshot({path:`${folder}/irregular-add-${name}.png`,fullPage:true});await save(page);
   assert.equal((await read(page)).transactions.length,2);assert.equal(await page.locator('[data-control-value=used]').innerText(),'280,000원');
   await page.locator('[name=irregularYear]').selectOption('2027');assert.equal(await page.locator('.irregular-row').count(),1);
   await page.locator('.irregular-row').click();await page.locator('#dialog [name=status]').selectOption('paid');await page.locator('#dialog [name=txId]').selectOption('existing-tax');await save(page);
   await page.locator('[name=irregularYear]').selectOption('all');assert.equal(await page.locator('[data-irregular-status=paid] .irregular-row').count(),1);
   assert.equal(await page.locator('[data-control-value=used]').innerText(),'0원');assert.equal(await page.locator('[data-control-value=fixedPaid]').innerText(),'0원');assert.equal(await page.locator('[data-control-value=irregularPaid]').textContent(),'280,000원');assert.equal(await page.locator('[data-control-value=free]').innerText(),'720,000원');assert.equal((await read(page)).transactions.length,2);
   await page.locator('[data-action=irregular-add]').click();await page.locator('#dialog [name=name]').fill('가상 자동차보험');await page.locator('#dialog [name=dueDate]').fill('2026-10-20');await page.locator('#dialog [name=amount]').fill('100000');await page.locator('#dialog [name=payer]').selectOption('p1');await page.locator('#dialog [name=status]').selectOption('paid');await page.locator('#dialog [name=txId]').selectOption('manual');await page.locator('#dialog [name=paidAmount]').fill('90000');await page.locator('#dialog [name=paymentMethod]').fill('검증 은행');await page.locator('#dialog [name=confirmManual]').check();await layout(page);await page.screenshot({path:`${folder}/irregular-payment-${name}.png`,fullPage:true});await save(page);
   let state=await read(page);assert.equal(state.transactions.length,3);const manual=state.irregularExpenses.find(r=>r.name==='가상 자동차보험');assert.ok(manual.txId);assert.equal(await page.locator('[data-control-value=irregularPaid]').textContent(),'370,000원');
   await page.reload({waitUntil:'networkidle'});await page.waitForSelector('.irregular-card');assert.equal(await page.locator('[data-irregular-status=paid] .irregular-row').count(),2);await layout(page);await page.screenshot({path:`${folder}/irregular-home-${name}.png`,fullPage:true});
   await page.locator(`.irregular-row[data-id="${manual.id}"]`).click();await page.locator('#dialog [name=name]').fill('가상 자동차보험 수정');await save(page);assert.equal((await read(page)).transactions.length,3);
   await page.locator(`.irregular-row[data-id="${manual.id}"]`).click();await page.locator('[data-action=irregular-delete]').click();await save(page);state=await read(page);assert.equal(state.transactions.length,3);assert.ok(state.irregularExpenses.find(r=>r.id===manual.id).deletedAt);assert.equal(await page.locator('[data-control-value=irregularPaid]').textContent(),'370,000원');
   assert.deepEqual(errors,[]);results.push({name,pass:true,flows:'due boundaries, add, edit, existing link, manual completion, duplicate count, delete preserves expense, year, reload, responsive'});await context.close();
  }finally{await browser.close();}
 }
 const browser=await chromium.launch({headless:true});
 try{
  const context=await browser.newContext({timezoneId:'Asia/Seoul'});await context.route(/supabase\.co/,r=>r.abort());const page=await context.newPage();await page.clock.install({time:new Date('2026-10-20T03:00:00Z')});await page.goto(base+'/');await seed(page);await page.evaluate(async()=>{await navigator.serviceWorker.register('./sw.js');await navigator.serviceWorker.ready;});await page.reload({waitUntil:'networkidle'});await context.setOffline(true);await page.reload({waitUntil:'domcontentloaded'});await page.waitForSelector('.irregular-card');await page.locator('[data-action=irregular-add]').click();await page.locator('#dialog [name=name]').fill('가상 오프라인 세금');await page.locator('#dialog [name=amount]').fill('10000');await save(page);await page.reload({waitUntil:'domcontentloaded'});await page.waitForSelector('.irregular-card');assert.match(await page.locator('.irregular-card').innerText(),/가상 오프라인 세금/);results.push({name:'PWA',pass:true,offlineCreateAndReload:true});await context.close();
 }finally{await browser.close();}
 fs.writeFileSync(`${folder}/irregular-browser.json`,JSON.stringify(results,null,2));console.log(JSON.stringify(results));
}finally{server?.kill();}

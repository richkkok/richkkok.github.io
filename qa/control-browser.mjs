import assert from 'node:assert/strict';
import fs from 'node:fs';
import {spawn} from 'node:child_process';
import {pathToFileURL} from 'node:url';
const {chromium,webkit,devices}=await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE).href);
const base=process.env.QA_URL || 'http://127.0.0.1:4192';
const server=process.env.QA_URL?null:spawn(process.execPath,['scripts/serve.cjs'],{env:{...process.env,PORT:'4192'},stdio:'ignore'});
const folder=process.env.QA_OUTPUT || 'qa-results';fs.mkdirSync(folder,{recursive:true});
const results=[];
async function seed(page){
 await page.evaluate(async()=>{
  const {emptyState}=await import('./data/defaults.js'),{Repository}=await import('./js/db.js'),{savePaymentProfile}=await import('./js/payment-channels.js');
  const s=emptyState();s.configured=true;s.settings.privacy=false;s.settings.periodStartDay=1;s.settings.variableBudget=2500000;s.recurring=[];s.transactions=[];
  const t=(id,amount,date,extra={})=>({id,sourceId:id,date,datetime:date+'T10:00:00',amount,direction:'expense',owner:'p1',scope:'shared',category:'groceries',categoryConfirmed:true,merchantRaw:'검증용 거래',merchantNormalized:'검증용 거래',paymentMethod:'검증 카드',sourceType:'manual',...extra});
  savePaymentProfile(s,'검증 카드','credit',3,17,0);
  s.transactions=[t('salary',6500000,'2026-10-10',{direction:'income',paymentMethod:'검증 은행',merchantRaw:'가상 급여'}),t('variable',1200000,'2026-10-01'),t('fixed',1500000,'2026-10-15',{scope:'fixed',costKind:'fixed',paymentMethod:'검증 은행'})];
  s.recurring=[{id:'insurance',name:'검증 보험',amount:1200000,day:16,category:'finance',paymentMethod:'검증 은행',owner:'joint',scope:'fixed',start:'2026-01-01',end:'',changes:[]}];
  s.cashAccounts=[{id:'bank',name:'검증 은행',paymentMethod:'검증 은행',owner:'p1',openingAt:'2026-10-01T00:00:00',openingBalance:0,reserved:0,autoMatch:true}];
  const r=new Repository();await r.replace(s);r.close();
 });
 await page.reload({waitUntil:'networkidle'});await page.waitForSelector('.control-home');
 await page.locator('#month-picker').fill('2026-10');await page.locator('#month-picker').dispatchEvent('change');
}
async function save(page){await page.locator('#dialog [type=submit]').click();try{await page.waitForSelector('#dialog[open]',{state:'hidden'});}catch(error){throw Error(await page.locator('#dialog').innerText()+'\n'+await page.locator('#dialog :invalid').evaluateAll(xs=>xs.map(x=>x.name+': '+x.validationMessage).join('\n')));}}
async function close(page){if(await page.locator('#dialog[open]').count())await page.locator('#dialog [data-close]').first().click();}
try {
 if(server)await new Promise(r=>setTimeout(r,500));
 for(const [name,engine,options] of [['desktop',chromium,{viewport:{width:1440,height:1000}}],['iphone-webkit',webkit,{...devices['iPhone 13']}]] ){
  const browser=await engine.launch({headless:true});
  try{
   const context=await browser.newContext({...options,timezoneId:'Asia/Seoul',serviceWorkers:'block'});
   await context.route(/supabase\.co/,r=>r.abort());
   const page=await context.newPage(),errors=[];await page.clock.install({time:new Date('2026-10-19T03:00:00Z')});page.on('pageerror',e=>errors.push(e.message));page.setDefaultTimeout(7000);
   await page.goto(base+'/',{waitUntil:'networkidle'});await seed(page);
   assert.equal(await page.locator('#navigation a').count(),4);
   assert.equal(await page.locator('[data-control-value=used]').innerText(),'1,200,000원');
   assert.equal(await page.locator('[data-control-value=free]').innerText(),'3,800,000원');
   assert.equal(await page.locator('[data-control-value=income]').innerText(),'6,500,000원');
   assert.equal(await page.locator('[data-control-value=fixedPaid]').innerText(),'1,500,000원');
   assert.equal(await page.locator('[data-control-value=fixedPlanned]').innerText(),'1,200,000원');
   assert.equal(await page.locator('[data-control-value=fixedRemaining]').innerText(),'1,200,000원');
   assert.equal(await page.locator('.fixed-insurance-group[open]').count(),0);
   assert.equal(await page.locator('[role=progressbar][aria-label="여유자금 잔여 비율"]').getAttribute('aria-valuenow'),'58');
   assert.equal(await page.locator('[role=progressbar][aria-label="월 고정지출 납부 진행률"]').getAttribute('aria-valuenow'),'100');
   await page.locator('.control-title-button').click();
   await page.waitForSelector('#dialog.dialog-spending[open]');
   assert.deepEqual(await page.locator('#dialog .spending-category').evaluateAll(xs=>xs.map(x=>x.getAttribute('aria-label'))),['신용카드']);
   assert.equal(await page.locator('#dialog .spending-group[open]').count(),1);
   assert.match(await page.locator('#dialog').innerText(),/2026-09-04 ~ 2026-10-03/);
   assert.equal(await page.locator('#dialog [data-edit]').count(),1);
   assert.equal(await page.locator('#dialog [data-edit=fixed]').count(),0);
   assert.doesNotMatch(await page.locator('#dialog').innerText(),/2,700,000원|1,500,000원/);
   const detailSize=await page.locator('#dialog').evaluate(el=>({width:el.clientWidth,scroll:el.scrollWidth}));
   assert.ok(detailSize.scroll<=detailSize.width+1,JSON.stringify(detailSize));
   await page.screenshot({path:`${folder}/spending-${name}.png`,fullPage:true});
   await page.locator('#dialog [data-edit=variable]').click();
   await page.waitForSelector('#dialog [name=amount]');
   assert.equal(await page.locator('#dialog [name=amount]').inputValue(),'1200000');
   await close(page);
   await page.locator('.control-spending-trigger').click();
   await page.waitForSelector('#dialog.dialog-spending[open]');
   await close(page);
   await page.screenshot({path:`${folder}/control-${name}.png`,fullPage:true});
   await page.locator('[data-action=control-limit]').first().click();await page.locator('[name=amount]').fill('2400000');await page.locator('[name=repeat]').check();await save(page);
   assert.equal(await page.locator('[data-control-value=limit]').innerText(),'2,400,000원');
   await page.reload({waitUntil:'networkidle'});await page.waitForSelector('.control-home');assert.equal(await page.locator('[data-control-value=limit]').innerText(),'2,400,000원');
   await page.locator('.fixed-insurance-group > summary').first().click();
   await page.locator('[data-action=control-fixed][data-id=insurance]').first().click();await page.locator('#dialog [name=amount]').fill('1180000');await page.locator('#dialog [name=confirm]').check();await save(page);
   assert.equal(await page.locator('[data-control-value=fixedRemaining]').innerText(),'0원');
   assert.equal(await page.locator('[data-fixed-status=paid] [data-id=insurance]').count(),1);
   assert.match(await page.locator('.control-list').innerText(),/납부완료/);
   assert.equal(await page.locator('[data-control-value=fixedPaid]').innerText(),'2,680,000원');
   await page.locator('#month-picker').fill('2026-11');await page.locator('#month-picker').dispatchEvent('change');assert.match(await page.locator('.control-list').innerText(),/1,180,000원/);assert.match(await page.locator('.control-list').innerText(),/납부예정/);
   assert.equal(await page.locator('[data-control-value=fixedPaid]').innerText(),'0원');
   assert.equal(await page.locator('[data-control-value=fixedPlanned]').innerText(),'1,180,000원');
   await page.locator('#month-picker').fill('2026-10');await page.locator('#month-picker').dispatchEvent('change');
   await page.locator('#navigation [href="#cash"]').click();await page.locator('[data-action=control-bill]').first().click();await page.locator('#dialog [data-action=control-pay]').click();await page.locator('#dialog [name=amount]').fill('1180000');await page.locator('#dialog [name=account]').selectOption('bank');await page.locator('#dialog [name=confirm]').check();await save(page);
   await page.locator('[data-action=control-bill]').first().click();assert.match(await page.locator('#dialog').innerText(),/-20,000원/);await page.locator('#dialog [data-action=control-adjust]').click();await page.locator('#dialog [name=amount]').fill('-20000');await save(page);
   assert.match(await page.locator('[data-action=control-bill]').first().innerText(),/금액 일치/);
   await page.locator('#navigation [href="#home"]').click();assert.equal(await page.locator('[data-control-value=used]').innerText(),'1,180,000원');
   await page.locator('[data-action=add-transaction]').first().click();
   for(const key of ['direction','date','time','paymentMethod','owner'])assert.equal(await page.locator(`#dialog [name=${key}]`).isVisible(),true);
   await page.locator('#dialog [name=amount]').fill('4500');await page.locator('#dialog [name=merchant]').fill('스타벅스');await page.locator('#dialog [name=paymentMethod]').fill('현금');assert.match(await page.locator('#auto-entry-summary').innerText(),/카페/);await save(page);
   await page.locator('#navigation [href="#transactions"]').click();await page.locator('.transaction-row').filter({hasText:'스타벅스'}).click();
   for(const key of ['datetime','direction','owner','paymentMethod','amount'])assert.equal(await page.locator(`#dialog [name=${key}]`).isVisible(),true);
   await page.locator('#dialog [name=amount]').fill('5000');await save(page);await page.reload({waitUntil:'networkidle'});assert.match(await page.locator('.transaction-row').filter({hasText:'스타벅스'}).innerText(),/5,000원/);
   await page.locator('.transaction-row').filter({hasText:'스타벅스'}).click();await page.locator('#dialog [data-delete-transaction]').click();await save(page);
   for(const route of ['home','transactions','cash','settings','recurring','review','import']){
    await page.goto(base+'/#'+route);await page.waitForTimeout(100);const size=await page.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth}));assert.ok(size.scroll<=size.width+1,JSON.stringify({name,route,...size}));
   }
   // Directly exercise classification confirmation and no-spend badge without touching the server.
   await page.goto(base+'/#home');await close(page);await page.locator('[data-action=control-zero]').first().click();await page.locator('#dialog [name=confirm]').check();await save(page);assert.equal(await page.locator('[data-action=control-zero]').count(),0);
   await page.evaluate(async()=>{
    const {emptyState}=await import('./data/defaults.js'),{Repository}=await import('./js/db.js');
    const s=emptyState();s.configured=true;s.settings.privacy=false;s.settings.periodStartDay=1;s.settings.members={p1:'박태영',p2:'김은영'};s.transactions=[];
    const bill=(id,name,day,amount)=>({id,name,day,amount,scope:'fixed',category:'finance',changes:[]});
    s.recurring=[bill('ta','태영 보험 A',5,100),bill('tb','태영 보험 B',25,200),bill('e','은영 보험',10,300),bill('child','서우 보험',15,400),bill('rent','월세',8,500),bill('done','태영 보험 완료',1,50)];
    s.transactions=[{id:'paid',sourceId:'paid',date:'2026-10-01',datetime:'2026-10-01T10:00:00',direction:'expense',owner:'joint',scope:'fixed',recurringId:'done',amount:50,paymentMethod:'은행',merchantRaw:'보험 납부',merchantNormalized:'보험 납부',category:'finance',sourceType:'manual'}];
    const r=new Repository();await r.replace(s);r.close();
   });
   await page.reload({waitUntil:'networkidle'});await page.waitForSelector('.control-home');
   await page.locator('#month-picker').fill('2026-10');await page.locator('#month-picker').dispatchEvent('change');
   assert.equal(await page.locator('[data-control-value=fixedRemaining]').innerText(),'1,500원');
   assert.equal(await page.locator('.fixed-insurance-group[open]').count(),0);
   for(const person of ['박태영','김은영','박서우'])assert.equal(await page.locator('[data-fixed-status=pending] summary').filter({hasText:person}).count(),1);
   assert.equal(await page.locator('[data-fixed-status=paid] [data-id=done]').count(),1);
   await page.locator('[data-fixed-status=pending] summary').filter({hasText:'박태영'}).click();
   assert.equal(await page.locator('.fixed-insurance-group[open] [data-action=control-fixed]').count(),2);
   assert.equal(await page.locator('.fixed-insurance-group[open] [data-id=ta]').isVisible(),true);
   await page.screenshot({path:`${folder}/fixed-groups-${name}.png`,fullPage:true});
   // Card labels never classify every purchase as fixed; include other spending.
   await page.evaluate(async()=>{
    const {emptyState}=await import('./data/defaults.js'),{Repository}=await import('./js/db.js'),{savePaymentProfile}=await import('./js/payment-channels.js');
    const s=emptyState();s.configured=true;s.settings.privacy=false;s.settings.periodStartDay=1;s.transactions=[];s.recurring=[];
    savePaymentProfile(s,'국민카드 생활비','credit',3,17,0);savePaymentProfile(s,'우리카드 생활비','credit',25,10,1);
    const t=(id,amount,date,paymentMethod,extra={})=>({id,sourceId:id,date,datetime:date+'T10:00:00',amount,paymentMethod,direction:'expense',owner:'joint',scope:'shared',category:'other',merchantRaw:id,merchantNormalized:id,sourceType:'manual',...extra});
    s.transactions=[t('국민 생활비 구매',120000,'2026-10-01','국민카드 생활비'),t('우리 생활비 구매',230000,'2026-09-24','우리카드 생활비'),t('기타 구매',50000,'2026-10-11','미지정'),t('보험',1000000,'2026-10-01','국민카드 생활비',{scope:'fixed',costKind:'fixed'})];
    const r=new Repository();await r.replace(s);r.close();
   });
   await page.reload({waitUntil:'networkidle'});await page.waitForSelector('.control-home');
   await page.locator('#month-picker').fill('2026-10');await page.locator('#month-picker').dispatchEvent('change');
   assert.equal(await page.locator('[data-control-value=used]').innerText(),'400,000원');
   await page.locator('.control-spending-trigger').click();
   assert.equal(await page.locator('#dialog [data-edit]').count(),3);
   for(const label of ['국민카드 생활비','우리카드 생활비','기타소비'])assert.match(await page.locator('#dialog').innerText(),new RegExp(label));
   assert.doesNotMatch(await page.locator('#dialog').innerText(),/1,000,000원/);
   await page.screenshot({path:`${folder}/living-and-other-${name}.png`,fullPage:true});await close(page);
   assert.deepEqual(errors,[]);results.push({engine:name,flows:'limits, surplus, fixed carry, statement reconciliation, entry, edit, persisted reload, badges, responsive',pass:true});
   await context.close();
  }finally{await browser.close();}
 }
 // Install the generated service worker and check stored data across an offline reload.
 const browser=await chromium.launch({headless:true});
 try{const context=await browser.newContext({timezoneId:'Asia/Seoul'});await context.route(/supabase\.co/,r=>r.abort());const page=await context.newPage();await page.clock.install({time:new Date('2026-10-19T03:00:00Z')});await page.goto(base+'/');await seed(page);await page.evaluate(async()=>{const r=await navigator.serviceWorker.register('./sw.js');await navigator.serviceWorker.ready;});await page.reload({waitUntil:'networkidle'});await context.setOffline(true);await page.reload({waitUntil:'domcontentloaded'});await page.waitForSelector('[data-control-value=free]');assert.equal(await page.locator('[data-control-value=free]').innerText(),'3,800,000원');results.push({engine:'chromium-pwa',offlineReload:true,pass:true});await context.close();}finally{await browser.close();}
 fs.writeFileSync(`${folder}/control-browser.json`,JSON.stringify(results,null,2));console.log(JSON.stringify(results));
}finally{server?.kill();}

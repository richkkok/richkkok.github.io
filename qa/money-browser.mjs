import assert from 'node:assert/strict';
import fs from 'node:fs';
import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';
const {chromium}=await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE).href);
const executablePath=['/usr/bin/google-chrome','/usr/bin/google-chrome-stable','/usr/bin/chromium'].find(p=>fs.existsSync(p));
assert.ok(executablePath,'A Chromium browser must be installed for the browser regression suite');
const server=spawn(process.execPath,['scripts/serve.cjs'],{env:{...process.env,PORT:'4174'},stdio:'inherit'});
let browser;
try {
 await new Promise(r=>setTimeout(r,800));
 browser=await chromium.launch({headless:true,executablePath,args:['--no-sandbox']});
 const context=await browser.newContext({viewport:{width:1440,height:1000},timezoneId:'Asia/Seoul',serviceWorkers:'block'});
 // All assertions run against synthetic data in a temporary browser, never the shared service.
 await context.route(/supabase\.co/,r=>r.abort());
 const page=await context.newPage(), errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 await page.goto('http://127.0.0.1:4174/',{waitUntil:'networkidle'});
 await page.evaluate(async()=>{
  const {sampleState}=await import('./data/sample.js'), {Repository}=await import('./js/db.js'), {today}=await import('./js/format.js');
  const s=sampleState();s.demo=false;s.settings.privacy=false;
  const t=s.transactions.find(t=>t.direction==='expense'&&t.scope==='shared');
  for(const [id,name,category,amount]of [['qa-unknown','QA 용도 확인','other',12700],['qa-pg','네이버페이','shopping',35000]])
   s.transactions.push({...t,id,sourceId:id,date:today(),datetime:today()+'T12:00:00',merchantRaw:name,merchantNormalized:name,category,categoryConfirmed:false,recurringId:null,costKind:'variable',amount});
  s.recurring.push({id:'qa-fixed',name:'QA 정기요금',amount:54321,day:Number(today().slice(8)),start:'2020-01-01',end:'',owner:'joint',scope:'fixed',category:'subscription',paymentMethod:'QA 계좌',merchantPattern:'QA 정기요금',changes:[]});
  const r=new Repository();await r.replace(s);r.close();
 });
 await page.reload({waitUntil:'networkidle'});
 await page.waitForSelector('.money-big');
 const overview=()=>page.evaluate(async()=>{const {Repository}=await import('./js/db.js');const {moneyOverview}=await import('./js/money.js');const {periodKey,startDay}=await import('./js/period.js');const r=new Repository(),s=await r.read();r.close();return moneyOverview(s,periodKey(undefined,startDay(s)));});
 const routes=['home','recurring','review','transactions','budget','analytics','settings','import'];
 for(const route of routes){await page.goto('http://127.0.0.1:4174/#'+route);await page.waitForTimeout(80);assert.equal(await page.locator('.cycle-strip').count(),1,route);}
 await page.goto('http://127.0.0.1:4174/#review');
 await page.locator('[data-action="money-review"][data-id="qa-unknown"]').click();
 await page.locator('#dialog [name=category]').selectOption('groceries');
 await page.locator('#dialog [name=note]').fill('QA 장보기');
 await page.locator('#dialog [type=submit]').click();await page.waitForTimeout(150);
 assert.equal(await page.locator('[data-action="money-review"][data-id="qa-unknown"]').count(),0);
 await page.locator('[data-action="money-review"][data-id="qa-pg"]').click();
 assert.equal(await page.locator('#dialog [name=learn]').count(),0);
 await page.locator('#dialog [name=category]').selectOption('other');await page.locator('#dialog [type=submit]').click();await page.waitForTimeout(150);
 assert.equal(await page.locator('[data-action="money-review"][data-id="qa-pg"]').count(),0);
 await page.goto('http://127.0.0.1:4174/#home');await page.locator('[data-action="money-plan"]').first().click();
 for(const [name,value]of [['shared','1800000'],['p1','350000'],['p2','350000']])await page.locator(`#dialog [name=${name}]`).fill(value);
 await page.locator('#dialog [type=submit]').click();await page.waitForTimeout(150);
 assert.ok((await page.locator('.money-summary').innerText()).includes('2,500,000원'));
 const incomeBefore=(await overview()).d.b.actualIncome;
 await page.locator('[data-action="money-income"]').click();await page.locator('[data-action="money-add-income"]').click();
 for(const [name,value]of [['amount','123456'],['merchant','QA 급여'],['payment','QA 계좌']])await page.locator(`#dialog [name=${name}]`).fill(value);
 await page.locator('#dialog [type=submit]').click();await page.waitForTimeout(150);
 assert.equal((await overview()).d.b.actualIncome,incomeBefore+123456);
 await page.goto('http://127.0.0.1:4174/#recurring');
 const beforePayment=await overview();
 await page.locator('[data-action="money-payment"][data-id="qa-fixed"]').click();
 await page.locator('#dialog [name=confirmed]').check();
 await page.locator('#dialog [type=submit]').click();await page.waitForTimeout(150);
 assert.equal(await page.locator('#dialog[open]').count(),0);
 const afterPayment=await overview();
 assert.equal(afterPayment.d.remaining,beforePayment.d.remaining);
 assert.equal(afterPayment.d.b.spent,beforePayment.d.b.spent+54321);
 assert.equal(afterPayment.unpaid,beforePayment.unpaid-54321);
 assert.equal(await page.locator('[data-action="money-payment"][data-id="qa-fixed"]').count(),0);
 await page.locator('[name=recurring-mode]').selectOption('all');
 await page.locator('[name=recurring-search]').fill('건강');
 assert.equal(await page.locator('.recurring-item').count(),1);
 await page.locator('[name=recurring-search]').fill('');
 await page.locator('[data-recurring]').first().click();
 await page.locator('#dialog [name=amount]').fill('1100000');
 await page.locator('#dialog [type=submit]').click();await page.waitForTimeout(150);
 assert.equal(await page.locator('#dialog[open]').count(),0);
 await page.locator('#month-picker').fill('2027-01');
 assert.ok((await page.locator('.cycle-strip').innerText()).includes('2027.01.10 ~ 2027.02.09'));
 await page.locator('[data-action="money-current"]').click();
 fs.mkdirSync('qa-results',{recursive:true});
 const layouts=[];
 for(const [width,height]of [[1440,1000],[1024,768],[768,1024],[390,844],[375,812],[320,720]]){
  await page.setViewportSize({width,height});
  for(const route of routes){
   await page.goto('http://127.0.0.1:4174/#'+route);await page.waitForTimeout(60);
   const m=await page.evaluate(()=>({viewport:innerWidth,width:document.documentElement.scrollWidth}));
   layouts.push({route,...m});assert.ok(m.width<=m.viewport+1,JSON.stringify({route,...m}));
   if([390,1440].includes(width)&&['home','recurring','review'].includes(route))await page.screenshot({path:`qa-results/${route}-${width}.png`,fullPage:true});
  }
 }
 await page.reload({waitUntil:'networkidle'});
 const stored=await page.evaluate(async()=>{const {Repository}=await import('./js/db.js');const r=new Repository();const s=await r.read();r.close();return {unknown:s.transactions.find(t=>t.id==='qa-unknown'),pg:s.transactions.find(t=>t.id==='qa-pg')};});
 assert.equal(stored.unknown.category,'groceries');assert.equal(stored.unknown.amount,12700);assert.equal(stored.pg.category,'other');assert.equal(stored.pg.categoryConfirmed,true);
 assert.deepEqual(errors,[]);
 fs.writeFileSync('qa-results/browser.json',JSON.stringify({result:'PASS',layouts,errors,checks:['review-confirmation','generic-merchant-no-learning','allowance-plan','actual-income','recurring-search','recurring-edit','actual-payment-no-double-count','period-picker','reload-preservation','48-responsive-pages','8-routes']},null,2));
 console.log('PASS browser actions, reload preservation, 8 routes and 48 viewport/route combinations');
} finally {await browser?.close();server.kill();}

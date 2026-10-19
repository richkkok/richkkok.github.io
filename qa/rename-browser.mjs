import assert from 'node:assert/strict';
import fs from 'node:fs';
import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const {chromium} = await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE).href);
const executablePath=['/usr/bin/google-chrome','/usr/bin/google-chrome-stable','/usr/bin/chromium']
  .find(p=>fs.existsSync(p));
assert.ok(executablePath,'Chrome is required for browser regression');
const server=spawn(process.execPath,['scripts/serve.cjs'],{env:{...process.env,PORT:'4189'},stdio:'inherit'});
let browser;
try {
  await new Promise(r=>setTimeout(r,650));
  browser=await chromium.launch({headless:true,executablePath,args:['--no-sandbox']});
  const context=await browser.newContext({viewport:{width:1440,height:950},timezoneId:'Asia/Seoul',serviceWorkers:'block'});
  await context.route(/supabase\.co/,route=>route.abort());
  const page=await context.newPage(),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  page.setDefaultTimeout(9500);
  await page.goto('http://127.0.0.1:4189/#settings',{waitUntil:'networkidle'});
  await page.evaluate(async()=>{
    const {emptyState}=await import('./data/defaults.js');
    const {Repository}=await import('./js/db.js');
    const {cashNow,saveCashLink,saveCashCheck}=await import('./js/cash.js');
    const {addDays}=await import('./js/period.js');
    const {savePaymentProfile}=await import('./js/payment-channels.js');
    const s=emptyState(),today=cashNow().slice(0,10),d=addDays(today,-2);
    s.configured=true;s.settings.privacy=false;
    s.settings.members={p1:'태영',p2:'은영'};
    s.settings.cardName='M107';
    s.cashAccounts=[{
      id:'qa-bank',name:'계좌 107',owner:'p1',
      openingBalance:1000000,openingAt:addDays(today,-6)+'T10:00:00',
      reserved:100000,paymentMethod:'BANK107',autoMatch:false,archived:false,
    }];
    s.transactions=[
      {id:'qa-card-1',sourceId:'raw-card-1',date:d,datetime:d+'T10:40:00',
       amount:70000,direction:'expense',owner:'p1',scope:'shared',costKind:'variable',
       paymentMethod:'M107',merchantRaw:'카드 소비',merchantNormalized:'카드 소비',category:'groceries',
       sourceType:'card-original',deletedAt:null},
      {id:'qa-card-2',sourceId:'raw-card-2',date:d,datetime:d+'T10:50:00',
       amount:30000,direction:'expense',owner:'p2',scope:'shared',costKind:'variable',
       paymentMethod:'M107',merchantRaw:'가족 카드 소비',merchantNormalized:'가족 카드 소비',category:'groceries',
       sourceType:'card-original',deletedAt:null},
      {id:'qa-card-deleted',sourceId:'raw-card-deleted',date:d,datetime:d+'T11:00:00',
       amount:5000,direction:'expense',owner:'p1',scope:'shared',costKind:'variable',
       paymentMethod:'M107',merchantRaw:'삭제된 거래',merchantNormalized:'삭제된 거래',category:'groceries',
       sourceType:'manual',deletedAt:today+'T00:00:00Z'},
      {id:'qa-cash',sourceId:'raw-cash',date:d,datetime:d+'T11:20:00',
       amount:20000,direction:'expense',owner:'p1',scope:'shared',costKind:'variable',
       paymentMethod:'BANK107',merchantRaw:'은행 이체',merchantNormalized:'은행 이체',category:'groceries',
       sourceType:'manual',deletedAt:null},
    ];
    s.recurring=[{id:'qa-r',name:'QA 보험',amount:30000,day:14,start:'2026-01-01',
      owner:'p1',scope:'fixed',category:'finance',paymentMethod:'M107',changes:[]}];
    savePaymentProfile(s,'M107','credit',25,14,1);
    saveCashLink(s,'qa-cash',[{accountId:'qa-bank',direction:'out',at:d+'T11:20:00'}],false,'',cashNow());
    saveCashCheck(s,{id:'qa-check',accountId:'qa-bank',at:addDays(today,-1)+'T12:00:00',
      actual:980000,note:''},cashNow());
    const r=new Repository();await r.replace(s);r.close();
    localStorage.setItem('richkkok-payment-p1','M107');
  });
  await page.reload({waitUntil:'networkidle'});
  const read=()=>page.evaluate(async()=>{
    const {Repository}=await import('./js/db.js');
    const {cashSummary}=await import('./js/cash.js');
    const r=new Repository(),s=await r.read(),cash=cashSummary(s);
    r.close();return {s,cash};
  });
  const original=await read();
  await page.locator('[data-action=payment-settings]').click();
  assert.match(await page.locator('#dialog h2').innerText(),/카드·계좌 이름 일괄 관리/);
  assert.equal(await page.locator('#dialog [data-action=instrument-profile][data-method="M107"]').count(),1);
  await page.locator('#dialog [data-action=instrument-profile][data-method="M107"]').click();
  assert.match(await page.locator('#dialog h2').innerText(),/청구주기/);
  assert.equal(await page.locator('#dialog [name=methodName]').inputValue(),'M107');
  assert.match(await page.locator('.instrument-rename-preview').innerText(),/전체 저장된 거래 3건/);
  assert.match(await page.locator('.instrument-rename-preview').innerText(),/태영 2건/);
  assert.match(await page.locator('.instrument-rename-preview').innerText(),/은영 1건/);
  await page.locator('#dialog [name=methodName]').fill('태영 신한카드');
  await page.locator('#dialog [type=submit]').click();
  assert.match(await page.locator('#dialog .form-error').innerText(),/확인란/);
  assert.equal((await read()).s.transactions[0].paymentMethod,'M107');
  await page.locator('#dialog [name=bulkRenameConfirmed]').check();
  await page.locator('#dialog [type=submit]').click();
  await page.locator('#dialog[open]').waitFor({state:'hidden'});
  let changed=await read();
  assert.deepEqual(changed.s.transactions.slice(0,3).map(t=>t.paymentMethod),
    ['태영 신한카드','태영 신한카드','태영 신한카드']);
  assert.equal(changed.s.transactions[2].deletedAt,original.s.transactions[2].deletedAt);
  assert.deepEqual(changed.s.transactions.map(t=>[t.id,t.sourceId,t.amount,t.owner]),
    original.s.transactions.map(t=>[t.id,t.sourceId,t.amount,t.owner]));
  assert.equal(changed.s.settings.cardName,'태영 신한카드');
  assert.equal(changed.s.settings.paymentProfiles['태영신한카드'].closingDay,25);
  assert.equal(changed.s.recurring[0].paymentMethod,'태영 신한카드');
  assert.equal(changed.s.settings.paymentAliases.m107,'태영 신한카드');
  await page.locator('[data-action=payment-settings]').click();
  assert.match(await page.locator('#dialog').innerText(),/태영 신한카드/);
  await page.locator('#dialog [data-action=cash-account][data-id=qa-bank]').click();
  assert.match(await page.locator('#dialog h2').innerText(),/계좌 설정/);
  assert.match(await page.locator('.instrument-rename-preview').innerText(),/1건/);
  await page.locator('#dialog [name=name]').fill('태영 생활비 계좌');
  assert.equal(await page.locator('#dialog [name=syncAccountAlias]').isChecked(),true);
  await page.locator('#dialog [name=bulkRenameConfirmed]').check();
  // A prior dialog's delayed close event used to reset this newly filled
  // bank name. Assert it stays edited across the asynchronous event turn.
  await page.waitForTimeout(180);
  assert.equal(await page.locator('#dialog [name=name]').inputValue(),'태영 생활비 계좌');
  await page.locator('#dialog [type=submit]').click();
  await page.locator('#dialog[open]').waitFor({state:'hidden'});
  changed=await read();
  assert.equal(changed.s.cashAccounts[0].name,'태영 생활비 계좌');
  assert.equal(changed.s.cashAccounts[0].paymentMethod,'태영 생활비 계좌');
  assert.equal(changed.s.transactions[3].paymentMethod,'태영 생활비 계좌');
  assert.equal(changed.s.cashLinks[0].id,original.s.cashLinks[0].id);
  assert.notEqual(changed.s.cashLinks[0].basis,original.s.cashLinks[0].basis);
  assert.deepEqual(changed.s.cashLinks[0].legs,original.s.cashLinks[0].legs);
  assert.equal(changed.cash.expected,original.cash.expected);
  assert.equal(changed.cash.actual,original.cash.actual);
  assert.equal(changed.cash.usable,original.cash.usable);
  assert.deepEqual(changed.s.cashChecks,original.s.cashChecks);
  assert.equal(changed.s.settings.paymentAliases.bank107,'태영 생활비 계좌');
  await page.goto('http://127.0.0.1:4189/#cash');
  await page.waitForSelector('.instrument-panel');
  assert.equal(await page.locator('.instrument-directory-name strong').filter({hasText:'태영 신한카드'}).count(),1);
  assert.equal(await page.locator('.instrument-directory-name strong').filter({hasText:'태영 생활비 계좌'}).count(),1);
  await page.goto('http://127.0.0.1:4189/#home');
  await page.locator('.focus-quick [data-action=quick-expense]').click();
  assert.equal(await page.locator('#dialog [name=paymentMethod]').inputValue(),'태영 신한카드');
  await page.locator('#dialog [data-close]').first().click();
  // All UI and latest settings must survive reload without disturbing history.
  await page.reload({waitUntil:'networkidle'});
  const persisted=await read();
  assert.deepEqual(persisted.s.transactions,changed.s.transactions);
  assert.deepEqual(persisted.s.cashLinks,changed.s.cashLinks);
  assert.equal(persisted.cash.expected,original.cash.expected);
  fs.mkdirSync('qa-results',{recursive:true});
  const layouts=[];
  for(const width of [320,375,390,768,1024,1440]){
    await page.setViewportSize({width,height:900});
    await page.goto('http://127.0.0.1:4189/#settings');
    await page.locator('[data-action=payment-settings]').click();
    const measure=await page.evaluate(()=>({
      viewport:innerWidth,page:document.documentElement.scrollWidth,
      dialog:document.querySelector('#dialog').scrollWidth,
      dialogClient:document.querySelector('#dialog').clientWidth
    }));
    assert.ok(measure.page<=width+1,JSON.stringify({width,measure}));
    assert.ok(measure.dialog<=measure.dialogClient+2,JSON.stringify({width,measure}));
    layouts.push({width,...measure});
    if([390,1440].includes(width))
      await page.screenshot({path:'qa-results/payment-rename-'+width+'.png'});
    await page.locator('#dialog [data-close]').first().click();
  }
  assert.deepEqual(errors,[]);
  fs.writeFileSync('qa-results/rename-browser.json',JSON.stringify({
    result:'PASS',layouts,errors,
    checks:['existing M107 rename','owner counts','explicit approval','all historical and deleted records',
      'billing profile re-key','account alias rename','cash link preserved','cash check preserved',
      'reload','quick-entry former alias','six viewport sizes']
  },null,2));
  console.log('PASS bulk card/account names, historic records, ledger links and responsive dialogs');
} finally {
  await browser?.close();server.kill();
}

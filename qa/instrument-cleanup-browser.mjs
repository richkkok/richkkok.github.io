import assert from "node:assert/strict";
import fs from "node:fs";
import { spawn } from "node:child_process";
import { pathToFileURL } from "node:url";

const { chromium } = await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE).href);
const executablePath=["/usr/bin/google-chrome","/usr/bin/google-chrome-stable","/usr/bin/chromium"]
  .find(path=>fs.existsSync(path));
assert.ok(executablePath,"Chromium required");
const server=spawn(process.execPath,["scripts/serve.cjs"],{
  env:{...process.env,PORT:"4196"},stdio:"inherit"
});
let browser;
try{
  await new Promise(resolve=>setTimeout(resolve,750));
  browser=await chromium.launch({headless:true,executablePath,args:["--no-sandbox"]});
  const context=await browser.newContext({viewport:{width:1440,height:920},
    timezoneId:"Asia/Seoul",serviceWorkers:"block"});
  await context.route(/supabase\.co/,r=>r.abort());
  const page=await context.newPage(), errors=[];
  page.on("pageerror",e=>errors.push(e.message));
  page.setDefaultTimeout(12000);
  await page.goto("http://127.0.0.1:4196/#cash",{waitUntil:"networkidle"});
  await page.evaluate(async()=>{
    const {emptyState}=await import("./data/defaults.js");
    const {Repository}=await import("./js/db.js");
    const {cashNow,cashFingerprint}=await import("./js/cash.js");
    const {addDays}=await import("./js/period.js");
    const s=emptyState(),now=cashNow().slice(0,10),day=addDays(now,-3);
    s.configured=true;s.settings.privacy=false;
    s.settings.cardName="M107";
    s.settings.paymentMethods=["M107","태영 신한카드","미사용 카드","은영 우리카드"];
    s.settings.members={p1:"태영",p2:"은영"};
    s.cashAccounts=[{id:"qa-bank",name:"생활비 통장",paymentMethod:"BANK107",owner:"p1",
      openingBalance:1000000,openingAt:addDays(now,-16)+"T10:00:00",
      reserved:300000,autoMatch:false,archived:false}];
    s.transactions=[
      {id:"qa-legacy",sourceId:"qa-legacy",date:day,datetime:day+"T12:10:00",
       amount:50000,direction:"expense",owner:"p1",scope:"shared",costKind:"variable",
       paymentMethod:"M107",merchantRaw:"오래된 코드 카드",merchantNormalized:"오래된 코드 카드",
       category:"groceries",sourceType:"manual",deletedAt:null},
      {id:"qa-bank-tx",sourceId:"qa-bank-tx",date:day,datetime:day+"T13:20:00",
       amount:20000,direction:"expense",owner:"p1",scope:"shared",costKind:"variable",
       paymentMethod:"BANK107",merchantRaw:"계좌 지출",merchantNormalized:"계좌 지출",
       category:"groceries",sourceType:"manual",deletedAt:null},
    ];
    s.cashLinks=[{id:"qa-bank-tx",basis:cashFingerprint(s.transactions[1]),ignored:false,
      legs:[{accountId:"qa-bank",direction:"out",at:s.transactions[1].datetime}]}];
    const r=new Repository();await r.replace(s);r.close();
  });
  await page.reload({waitUntil:"networkidle"});
  const read=()=>page.evaluate(async()=>{
    const {Repository}=await import("./js/db.js");const r=new Repository(),s=await r.read();
    r.close();return s;
  });
  const save=async()=>{await page.locator("#dialog [type=submit]").click();
    await page.locator("#dialog[open]").waitFor({state:"hidden"});};
  // Set the non-sensitive identifier for a nicer named card. The old M107
  // historical transactions must be merged under the new card automatically.
  const newCard="태영 신한카드";
  await page.locator(`.instrument-directory-history[data-key="m:${encodeURIComponent(newCard)}"]`).click();
  await page.locator('.instrument-selected [data-action="instrument-profile"]').click();
  await page.locator("#dialog .instrument-identity>summary").click();
  await page.locator("#dialog [name=identifier]").fill("M107");
  await page.locator("#dialog [name=identityOwner]").selectOption("p1");
  await save();
  let s=await read();
  assert.equal(s.transactions[0].paymentMethod,newCard);
  assert.equal(s.transactions[0].amount,50000);
  assert.equal(s.transactions.length,2);
  assert.equal(s.settings.paymentProfiles["태영신한카드"].identifier,"M107");
  assert.equal(await page.locator('.instrument-directory-name strong').allTextContents()
    .then(rows=>rows.some(name=>name.includes("M107"))),false);
  assert.ok(await page.locator('.instrument-row-main[data-edit="qa-legacy"]').isVisible());

  // Remove a card with history: it must disappear from active selectors,
  // but existing transactions and card-billing profile remain unchanged.
  await page.locator('.instrument-selected [data-action="instrument-remove"]').click();
  assert.match(await page.locator("#dialog").innerText(),/기존 데이터|그대로 유지|과거 거래/);
  await page.locator("#dialog [name=confirmed]").check();await save();
  s=await read();
  assert.deepEqual(s.settings.hiddenPaymentMethods,["태영신한카드"]);
  assert.equal(s.transactions[0].paymentMethod,newCard);
  assert.ok(s.settings.paymentProfiles["태영신한카드"]);
  assert.equal(await page.locator('.instrument-directory-name strong').allTextContents()
    .then(rows=>rows.some(name=>name.includes(newCard))),false);

  // Menu can restore a hidden card and also delete a truly unused card.
  await page.goto("http://127.0.0.1:4196/#settings");
  await page.locator('[data-action=payment-settings]').click();
  assert.equal(await page.locator('#dialog [data-action=instrument-dedupe]').count(),1);
  await page.locator('#dialog [data-action=instrument-restore][data-key="m:'+encodeURIComponent(newCard)+'"]').click();
  s=await read();
  assert.deepEqual(s.settings.hiddenPaymentMethods,[]);
  assert.ok(s.settings.paymentProfiles["태영신한카드"]);
  await page.locator('[data-action=payment-settings]').click();
  await page.locator('#dialog [data-action=instrument-remove][data-key="m:'+encodeURIComponent("미사용 카드")+'"]').click();
  await page.locator("#dialog [name=confirmed]").check();await save();
  s=await read();
  assert.equal(s.settings.paymentMethods.includes("미사용 카드"),false);

  // Closing a bank must preserve link fingerprint and reference balances,
  // remove it from primary pickers and allow restoration without reactivation.
  await page.goto("http://127.0.0.1:4196/#cash");
  await page.locator('.instrument-directory-history[data-key="a:qa-bank"]').click();
  const previous=await read();
  await page.locator('.instrument-selected [data-action="instrument-remove"]').click();
  await page.locator("#dialog [name=confirmed]").check();await save();
  s=await read();
  assert.equal(s.cashAccounts[0].archived,true);
  assert.equal(s.cashAccounts[0].openingBalance,1000000);
  assert.deepEqual(s.cashLinks,previous.cashLinks);
  assert.deepEqual(s.transactions,previous.transactions);
  assert.ok(s.settings.hiddenCashAccounts.includes("qa-bank"));
  await page.goto("http://127.0.0.1:4196/#settings");
  await page.locator('[data-action=payment-settings]').click();
  await page.locator('#dialog [data-action=instrument-restore][data-key="a:qa-bank"]').click();
  s=await read();
  assert.equal(s.cashAccounts[0].archived,true);
  assert.deepEqual(s.settings.hiddenCashAccounts,[]);

  // Whole card number must be rejected, without saving any risky metadata.
  await page.goto("http://127.0.0.1:4196/#cash");
  await page.locator(`.instrument-directory-history[data-key="m:${encodeURIComponent(newCard)}"]`).click();
  await page.locator('.instrument-selected [data-action="instrument-profile"]').click();
  await page.locator("#dialog .instrument-identity>summary").click();
  await page.locator("#dialog [name=identifier]").fill("4111111111111111");
  await page.locator("#dialog [type=submit]").click();
  assert.match(await page.locator("#dialog .form-error").innerText(),/카드번호 전체/);
  assert.equal((await read()).settings.paymentProfiles["태영신한카드"].identifier,"M107");
  await page.locator("#dialog [data-close]").first().click();

  const layouts=[];
  for(const width of [1440,768,390,320]){
    await page.setViewportSize({width,height:900});
    const v=await page.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth}));
    assert.ok(v.scroll<=v.width+1,JSON.stringify(v));layouts.push(v);
  }
  assert.deepEqual(errors,[]);
  fs.mkdirSync("qa-results",{recursive:true});
  fs.writeFileSync("qa-results/instrument-cleanup-browser.json",
    JSON.stringify({result:"PASS",layouts,checks:[
      "automatic M107 to friendly card merge","history retained","safe card remove/restore",
      "unused card deletion","account archive with link preservation",
      "account restore without cash reactivation","PAN input rejection",
      "mobile overflow 320-1440px",
    ]},null,2));
  console.log("PASS safe card identity merge and reversible cleanup browser");
}finally{
  await browser?.close();server.kill();
}

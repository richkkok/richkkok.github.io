import assert from "node:assert/strict";
import fs from "node:fs";
import { spawn } from "node:child_process";
import { pathToFileURL } from "node:url";
const { chromium } = await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE).href);
const exe = ["/usr/bin/google-chrome","/usr/bin/google-chrome-stable","/usr/bin/chromium"].find(p=>fs.existsSync(p));
assert.ok(exe, "Chrome is required for browser QA");
const server=spawn(process.execPath,["scripts/serve.cjs"],{env:{...process.env,PORT:"4183"},stdio:"inherit"});
let browser;
try {
  await new Promise(r=>setTimeout(r,750));
  browser=await chromium.launch({headless:true,executablePath:exe,args:["--no-sandbox"]});
  const context=await browser.newContext({viewport:{width:1440,height:900},serviceWorkers:"block",timezoneId:"Asia/Seoul"});
  await context.route(/supabase\.co/, route=>route.abort());
  const page=await context.newPage(),errors=[];
  page.on("pageerror",e=>errors.push(e.message));
  page.setDefaultTimeout(8500);
  await page.goto("http://127.0.0.1:4183/#home",{waitUntil:"networkidle"});
  const preset=await page.evaluate(async()=>{
    const {emptyState}=await import("./data/defaults.js");
    const {Repository}=await import("./js/db.js");
    const {period,periodKey,addDays}=await import("./js/period.js");
    const {shiftMonth,today}=await import("./js/format.js");
    const s=emptyState();s.configured=true;s.settings.privacy=false;
    s.settings.income=6500000;s.settings.sharedBudget=2000000;
    const month=periodKey(today(),10);
    const date=addDays(period(month,10).start,-2);
    s.transactions=[{
      id:"qa-early-income",sourceId:"qa-early-income",date,datetime:date+"T09:00:00",
      amount:3000000,direction:"income",owner:"p1",scope:"shared",
      category:"other",merchantRaw:"급여",merchantNormalized:"급여",
      paymentMethod:"QA 계좌",excluded:false,operatingMonth:shiftMonth(month,-1),
      sourceType:"manual",createdAt:"2026-10-01T00:00:00.000Z",updatedAt:"2026-10-01T00:00:00.000Z"
    }];
    const repo=new Repository();await repo.replace(s);repo.close();return {month,date,previous:shiftMonth(month,-1)};
  });
  await page.reload({waitUntil:"networkidle"});
  await page.waitForSelector(".focus-board");
  const read=()=>page.evaluate(async()=>{
    const {Repository}=await import("./js/db.js");
    const repo=new Repository(),s=await repo.read();repo.close();return s;
  });
  const initial=await read();
  assert.equal(initial.transactions.length,1);
  assert.equal(await page.locator('[data-focus-value="cash-income"]').innerText(),"0원");
  assert.match(await page.locator(".focus-income-alert").innerText(),/3,000,000원/);
  // Trying to register exactly the same receipt must show an existing-record route.
  await page.locator(".focus-cash-entry-links [data-action=money-add-income]").click();
  await page.locator("#dialog [name=date]").fill(preset.date);
  await page.locator("#dialog [name=amount]").fill("3000000");
  await page.locator("#dialog [name=merchant]").fill("급여");
  await page.locator("#dialog [name=owner]").selectOption("p1");
  await page.locator("#dialog [name=payment]").fill("QA 계좌");
  await page.locator("#dialog [name=month]").fill(preset.month);
  await page.locator("#dialog [type=submit]").click();
  assert.match(await page.locator("#dialog .form-error").innerText(),/기존 입금/);
  assert.equal((await read()).transactions.length,1);
  await page.locator("#dialog [data-action=money-income]").click();
  await page.waitForSelector("#dialog .income-record-row");
  assert.equal(await page.locator("#dialog .income-record-row").count(),1);
  assert.match(await page.locator("#dialog .income-record-row").innerText(),/다른 달로 반영/);
  assert.match(await page.locator("#dialog .income-ledger-attention").innerText(),/선입금/);
  assert.equal(await page.locator('#dialog .income-record-row [data-edit="qa-early-income"]').count(),1);
  await page.locator('#dialog [data-action=money-income-move][data-id=qa-early-income]').click();
  await page.waitForSelector("#dialog [name=assignedMonth]");
  assert.equal(await page.locator("#dialog [name=assignedMonth]").inputValue(),preset.month);
  assert.match(await page.locator("#dialog").innerText(),/현재/);
  await page.locator("#dialog [name=confirm]").check();
  await page.locator("#dialog [type=submit]").click();
  await page.waitForSelector("#dialog[open]",{state:"hidden"});
  const after=await read();
  assert.equal(after.transactions.length,1);
  assert.equal(after.transactions[0].id,initial.transactions[0].id);
  assert.equal(after.transactions[0].date,initial.transactions[0].date);
  assert.equal(after.transactions[0].amount,initial.transactions[0].amount);
  assert.equal(after.transactions[0].operatingMonth,preset.month);
  assert.equal(await page.locator('[data-focus-value="cash-income"]').innerText(),"300만원");
  assert.equal(await page.locator(".focus-income-alert").count(),0);
  // The record remains editable and viewable without adding a new transaction.
  await page.locator(".focus-cash-entry-actions [data-action=money-income]").click();
  assert.match(await page.locator("#dialog .income-record-row").innerText(),/이번 달 반영/);
  await page.locator("#dialog [data-close]").first().click();
  const widths=[320,375,390,768,1024,1440],layouts=[];
  fs.mkdirSync("qa-results",{recursive:true});
  for(const width of widths) {
    await page.setViewportSize({width,height:900});
    await page.goto("http://127.0.0.1:4183/#home");
    await page.waitForSelector(".focus-board");
    const m=await page.evaluate(()=>({
      viewport:innerWidth,scrollWidth:document.documentElement.scrollWidth,
      home:document.querySelector(".focus-board").scrollWidth,
      homeClient:document.querySelector(".focus-board").clientWidth,
      cash:document.querySelector(".focus-cash").scrollWidth,
      cashClient:document.querySelector(".focus-cash").clientWidth
    }));
    assert.ok(m.scrollWidth<=width+1,JSON.stringify({width,m}));
    assert.ok(m.home<=m.homeClient+2,JSON.stringify({width,m}));
    assert.ok(m.cash<=m.cashClient+2,JSON.stringify({width,m}));
    layouts.push(m);
    if(width===390||width===1440)await page.screenshot({path:`qa-results/income-ledger-home-${width}.png`,fullPage:true});
  }
  await page.reload({waitUntil:"networkidle"});
  assert.equal(await page.locator('[data-focus-value="cash-income"]').innerText(),"300만원");
  assert.equal((await read()).transactions.length,1);
  assert.deepEqual(errors,[]);
  fs.writeFileSync("qa-results/income-reconcile-browser.json",JSON.stringify({result:"PASS",preset,layouts,checks:["early deposited actual stays in prior period until review","duplicate blocked with existing record link","existing income listed across operating months","reassignment retains amount and date","cash income updates immediately","six widths no overflow","reload preserved","no production data"],errors},null,2));
  console.log("PASS income reconciliation, duplicate prevention, reassignment and six responsive home layouts");
}finally{await browser?.close();server.kill();}

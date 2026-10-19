import assert from "node:assert/strict";
import fs from "node:fs";
import { spawn } from "node:child_process";
import { pathToFileURL } from "node:url";
import { emptyState } from "../data/defaults.js";

const { chromium } = await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE).href);
const executablePath = ["/usr/bin/google-chrome", "/usr/bin/google-chrome-stable", "/usr/bin/chromium"].find(p => fs.existsSync(p));
const server = spawn(process.execPath, ["scripts/serve.cjs"], {env:{...process.env,PORT:"4179"},stdio:"inherit"});
const token = "A".repeat(43);
const household = {id:"qa-local-household",name:"QA 공동가계부",syncTopic:"qa-fake-channel"};
const baseState = emptyState();
baseState.configured = true;
baseState.settings.privacy = false;
baseState.settings.income = 5300000;
baseState.transactions.push({
  id:"qa-invite-transaction",sourceId:"qa-invite-transaction",date:"2026-10-11",
  datetime:"2026-10-11T11:00:00",amount:21000,direction:"expense",owner:"p1",
  merchantRaw:"QA 공동 마트",merchantNormalized:"qa 공동 마트",scope:"shared",
  paymentMethod:"우리카드",category:"groceries",sourceType:"manual",deletedAt:null,
});
let browser;
try {
  await new Promise(r => setTimeout(r,750));
  browser = await chromium.launch({headless:true,executablePath,args:["--no-sandbox"]});
  const context = await browser.newContext({viewport:{width:390,height:844},timezoneId:"Asia/Seoul",serviceWorkers:"block"});
  const calls = [];
  const cors = {"access-control-allow-origin":"*","access-control-allow-methods":"POST, OPTIONS","access-control-allow-headers":"*","content-type":"application/json"};
  await context.route("https://wjelumpbjklfrdjxbesj.supabase.co/functions/v1/richkkok-sync", async route => {
    const request = route.request();
    if (request.method() === "OPTIONS") return route.fulfill({status:200,headers:cors,body:""});
    const body=JSON.parse(request.postData()||"{}");
    calls.push(body.action);
    let response={ok:false,code:"invalid_client"},status=400;
    if (body.action === "preview_invite") {
      if (body.inviteToken === token) {response={ok:true,householdName:household.name,inviterName:"QA 초대자",expiresAt:"2026-10-18T00:00:00Z"};status=200;}
      else {response={ok:false,code:"invite_not_found"};status=404;}
    } else if (body.action === "join_invite") {
      if (body.inviteToken === token && body.displayName === "QA 배우자") {
        response={ok:true,state:structuredClone(baseState),sessionToken:"qa-session-synthetic",household,
          member:{id:"qa-member2",role:"member",displayName:"QA 배우자"},revision:1};status=200;
      }
    } else if (body.action === "members") {
      response={ok:true,members:[{member_id:"qa-member1",role:"owner",display_name:"QA 초대자"},
         {member_id:"qa-member2",role:"member",display_name:"QA 배우자"}]};status=200;
    } else if (body.action === "pull") {
      response={ok:true,state:structuredClone(baseState),household,
        member:{id:"qa-member2",role:"member",displayName:"QA 배우자"},revision:1,
        members:[{member_id:"qa-member1",role:"owner",display_name:"QA 초대자"},
                 {member_id:"qa-member2",role:"member",display_name:"QA 배우자"}]};status=200;
    }
    await route.fulfill({status,headers:cors,body:JSON.stringify(response)});
  });
  const page = await context.newPage(), errors=[];
  page.on("pageerror", e=>errors.push(e.message));
  page.setDefaultTimeout(9000);
  await page.goto("http://127.0.0.1:4179/#home",{waitUntil:"networkidle"});
  await page.waitForSelector(".onboarding-invite-entry");
  assert.equal(await page.locator("[data-action=cloud-join]").count(),1);
  const localBefore = await page.evaluate(async()=>{
    const {Repository}=await import("./js/db.js");const r=new Repository(),s=await r.read();r.close();return s;
  });
  assert.equal(localBefore.configured,false);
  await page.locator("[data-action=cloud-join]").click();
  await page.locator("#dialog [name=inviteUrl]").fill("https://fake.example/#invite=" + token);
  await page.locator("#dialog [type=submit]").click();
  assert.equal(await page.locator("#dialog[open]").count(),1);
  assert.match(await page.locator("#dialog .form-error").innerText(),/공식 주소/);
  assert.equal(calls.length,0);
  await page.locator("#dialog [name=inviteUrl]").fill("https://richkkok.github.io/#invite=" + token);
  await page.locator("#dialog [type=submit]").click();
  await page.waitForSelector("#dialog[open] [name=displayName]");
  assert.match(await page.locator("#dialog h2").innerText(),/QA 공동가계부/);
  await page.locator("#dialog [name=displayName]").fill("QA 배우자");
  await page.locator("#dialog [type=submit]").click();
  try {
    await page.waitForSelector(".control-home", {timeout:12000});
  } catch (error) {
    console.error("INVITE QA DEBUG", JSON.stringify({
      actions: calls,
      dialog: await page.locator("#dialog").innerText(),
      page: (await page.locator("#main").innerText()).slice(0,900),
      errors,
    }));
    throw error;
  }
  await page.waitForFunction(()=>document.querySelector("#household-status")?.textContent?.includes("공동가계부 사용 중"));
  assert.deepEqual(calls.slice(0,2),["preview_invite","join_invite"]);
  assert.match(await page.locator("#household-status").innerText(),/2명/);
  const joined=await page.evaluate(async()=>{
    const {Repository}=await import("./js/db.js");const r=new Repository(),s=await r.read();
    const m=await r.readKey("cloudMeta"),previous=await r.readKey("before-household-join");
    r.close();return {s,member:m.member?.displayName,connected:!!m.sessionToken,previousConfigured:previous?.configured};
  });
  assert.equal(joined.s.transactions.length,1);
  assert.equal(joined.s.transactions[0].merchantRaw,"QA 공동 마트");
  assert.equal(joined.member,"QA 배우자");
  assert.equal(joined.connected,true);
  assert.equal(joined.previousConfigured,false);
  await page.reload({waitUntil:"networkidle"});
  await page.waitForSelector(".control-home");
  assert.match(await page.locator("#household-status").innerText(),/공동가계부 사용 중/);
  // Mobile header status is visually collapsed; the member list is reachable
  // through the existing More → Settings navigation instead.
  await page.locator('#navigation [href="#settings"]').click();
  await page.waitForSelector(".settings-simple-grid");
  await page.locator('.settings-simple-grid [data-action="cloud-members"]').click();
  await page.waitForSelector("#dialog .cloud-member-list");
  assert.match(await page.locator("#dialog").innerText(),/QA 초대자/);
  assert.match(await page.locator("#dialog").innerText(),/QA 배우자/);
  await page.locator("#dialog [data-close]").first().click();
  const sizes=[];
  for (const width of [320,375,390,768,1024]) {
    await page.setViewportSize({width,height:900});
    await page.goto("http://127.0.0.1:4179/#home");await page.waitForSelector(".control-home");
    const m=await page.evaluate(()=>({width:document.documentElement.scrollWidth,viewport:innerWidth}));
    assert.ok(m.width<=m.viewport+1,JSON.stringify({width,...m}));sizes.push({width,...m});
  }
  assert.deepEqual(errors,[]);
  fs.mkdirSync("qa-results",{recursive:true});
  fs.writeFileSync("qa-results/invite-browser.json",JSON.stringify({result:"PASS",checks:["fresh-install-join-control","invalid-link-no-network","valid-link-preview","name-confirmation","shared-state-loaded","reload-session","member-list-two","five-responsive-widths"],sizes,errors},null,2));
  console.log("PASS first-install invite join, CORS-safe mocked API, reload and responsive UI; no production data touched");
} finally { await browser?.close();server.kill(); }

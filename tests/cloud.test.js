import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { IDBFactory } from "fake-indexeddb";
import { Repository } from "../js/db.js";
import { CloudSync } from "../js/cloud.js";

test("공유 저장의 느린 서버 응답은 두 번째 로컬 입력을 막거나 덮어쓰지 않음", async () => {
  const dom = new JSDOM('<dialog id="dialog"></dialog>');
  globalThis.document = dom.window.document;
  Object.defineProperty(globalThis.navigator, "onLine", {
    value: true,
    configurable: true,
  });
  const repo = new Repository("cloud-inflight", new IDBFactory());
  await repo.mutate((s) => {
    s.configured = true;
  });
  await repo.writeKey("cloudMeta", {
    sessionToken: "dummy",
    revision: 1,
    dirty: false,
  });
  let remote = await repo.read(),
    revision = 1;
  await repo.writeKey("cloudBase", remote);
  let startPush, releasePush;
  const started = new Promise((r) => (startPush = r)),
    hold = new Promise((r) => (releasePush = r));
  let count = 0;
  const original = globalThis.fetch;
  globalThis.fetch = async (_, options) => {
    const body = JSON.parse(options.body);
    if (body.action === "pull")
      return {
        ok: true,
        json: async () => ({
          ok: true,
          state: structuredClone(remote),
          revision,
          household: { id: "dummy" },
          member: { id: "a" },
          members: [],
        }),
      };
    if (body.action === "push") {
      if (count++ === 0) {
        startPush();
        await hold;
      }
      assert.equal(body.expectedRevision, revision);
      remote = structuredClone(body.state);
      revision++;
      return { ok: true, json: async () => ({ ok: true, revision }) };
    }
    throw Error("unexpected request");
  };
  const app = { repo, mode: "real", state: await repo.read(), render() {} };
  const cloud = new CloudSync(app);
  await cloud.loadMeta();
  try {
    await cloud.mutate((s) => {
      s.settings.income = 4000000;
    });
    await started;
    await Promise.race([
      cloud.mutate((s) => {
        s.settings.savingsTarget = 1500000;
      }),
      new Promise((_, reject) =>
        setTimeout(() => reject(Error("Local edit waited on network")), 1000),
      ),
    ]);
    assert.equal((await repo.read()).settings.savingsTarget, 1500000);
    releasePush();
    await cloud.queue;
    assert.equal(remote.settings.income, 4000000);
    assert.equal(remote.settings.savingsTarget, 1500000);
    assert.equal((await repo.readKey("cloudMeta")).dirty, false);
  } finally {
    releasePush();
    await cloud.queue;
    globalThis.fetch = original;
    repo.close();
    dom.window.close();
  }
});

test("공동가계부 저장 revision을 배우자 기기에 즉시 broadcast", () => {
  const app = { mode: "real" };
  const cloud = new CloudSync(app);
  cloud.meta = { household: { syncTopic: "richkkok:test-household" } };
  let message = null;
  cloud.socket = {
    readyState: 1,
    send(value) {
      message = JSON.parse(value);
    },
  };

  cloud.broadcastRevision(7);

  assert.equal(message.topic, "realtime:richkkok:test-household");
  assert.equal(message.event, "broadcast");
  assert.equal(message.payload.event, "state_changed");
  assert.equal(message.payload.payload.revision, 7);
});

function mockInviteDialog(dom) {
  const dialog = dom.window.document.querySelector("#dialog");
  dialog.showModal = () => { dialog.open = true; };
  dialog.close = () => { dialog.open = false; };
}

test("초대 버튼 1회 탭으로 API 응답 전 iOS 클립보드 쓰기를 시작하고 유효한 초대링크를 복사", async () => {
  const dom = new JSDOM('<dialog id="dialog"></dialog><div id="toast" hidden></div>');
  mockInviteDialog(dom);
  const originals = {
    document: globalThis.document,
    fetch: globalThis.fetch,
    clipboard: Object.getOwnPropertyDescriptor(globalThis.navigator, "clipboard"),
    clipboardItem: Object.getOwnPropertyDescriptor(globalThis, "ClipboardItem"),
  };
  const url = "https://richkkok.github.io/#invite=unique-once-only-token";
  let started = 0, copied = "";
  globalThis.document = dom.window.document;
  Object.defineProperty(globalThis, "ClipboardItem", {
    configurable: true,
    value: class FakeClipboardItem {
      constructor(entries) { this.entries = entries; }
    },
  });
  Object.defineProperty(globalThis.navigator, "clipboard", {
    configurable: true,
    value: {
      async write(items) {
        started++;
        copied = await (await items[0].entries["text/plain"]).text();
      },
      async writeText() {
        assert.fail("Safari async ClipboardItem already copied: no secondary writeText call");
      },
    },
  });
  globalThis.fetch = async (_, options) => {
    assert.equal(started, 1, "Clipboard access must start inside original click before network");
    const body = JSON.parse(options.body);
    assert.equal(body.action, "create_invite");
    assert.equal(body.sessionToken, "owner-session");
    return { ok: true, json: async () => ({ ok: true, inviteUrl: url }) };
  };
  const cloud = new CloudSync({ mode: "real" });
  cloud.meta = { sessionToken: "owner-session", member: { role: "owner" } };
  try {
    await cloud.createInvite();
    assert.equal(started, 1);
    assert.equal(copied, url);
    assert.equal(document.querySelector("#invite-url").value, url);
    assert.ok(document.querySelector("#share-invite"), "Keep existing share action");
    assert.match(document.querySelector("#toast").textContent, /자동 복사/);
  } finally {
    globalThis.document = originals.document;
    globalThis.fetch = originals.fetch;
    if (originals.clipboard) Object.defineProperty(globalThis.navigator, "clipboard", originals.clipboard);
    else delete globalThis.navigator.clipboard;
    if (originals.clipboardItem) Object.defineProperty(globalThis, "ClipboardItem", originals.clipboardItem);
    else delete globalThis.ClipboardItem;
    dom.window.close();
  }
});

test("클립보드 권한이 없으면 초대링크를 선택해 직접 복사 가능하고 중복 초대를 만들지 않음", async () => {
  const dom = new JSDOM('<dialog id="dialog"></dialog><div id="toast" hidden></div>');
  mockInviteDialog(dom);
  const originalDocument = globalThis.document;
  const originalFetch = globalThis.fetch;
  const clipboard = Object.getOwnPropertyDescriptor(globalThis.navigator, "clipboard");
  const clipboardItem = Object.getOwnPropertyDescriptor(globalThis, "ClipboardItem");
  globalThis.document = dom.window.document;
  delete globalThis.ClipboardItem;
  Object.defineProperty(globalThis.navigator, "clipboard", {
    configurable: true,
    value: { async writeText() { throw Error("permission denied"); } },
  });
  document.execCommand = () => false;
  const url = "https://richkkok.github.io/#invite=fallback-token";
  let requests = 0;
  globalThis.fetch = async () => {
    requests++;
    return { ok: true, json: async () => ({ ok: true, inviteUrl: url }) };
  };
  const cloud = new CloudSync({ mode: "real" });
  cloud.meta = { sessionToken: "owner-session", member: { role: "owner" } };
  try {
    await cloud.createInvite();
    assert.equal(requests, 1);
    assert.equal(document.querySelector("#invite-url").value, url);
    assert.match(document.querySelector("#toast").textContent, /직접 복사/);
    assert.equal(document.activeElement.id, "invite-url");
    cloud.meta.member.role = "member";
    await cloud.createInvite();
    assert.equal(requests, 1, "Non-owner must not request a new token");
  } finally {
    globalThis.document = originalDocument;
    globalThis.fetch = originalFetch;
    if (clipboard) Object.defineProperty(globalThis.navigator, "clipboard", clipboard);
    else delete globalThis.navigator.clipboard;
    if (clipboardItem) Object.defineProperty(globalThis, "ClipboardItem", clipboardItem);
    else delete globalThis.ClipboardItem;
    dom.window.close();
  }
});

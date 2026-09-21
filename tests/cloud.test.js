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

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

function worker(failInstall = false) {
  const events = {},
    stores = new Map([
      ["unrelated-cache", new Map()],
      ["richkkok-v1-old", new Map()],
    ]);
  let claimed = 0,
    skipped = 0;
  const caches = {
    async open(name) {
      if (!stores.has(name)) stores.set(name, new Map());
      const data = stores.get(name);
      return {
        async addAll(requests) {
          for (const req of requests)
            data.set(
              new URL(req.url).pathname,
              "cached:" + new URL(req.url).pathname,
            );
          if (failInstall) throw Error("offline install");
        },
        async match(path) {
          return data.get(
            new URL(
              typeof path === "string" ? path : path.url,
              "https://richkkok.github.io/",
            ).pathname,
          );
        },
      };
    },
    async keys() {
      return [...stores.keys()];
    },
    async delete(name) {
      return stores.delete(name);
    },
  };
  const self = {
    registration: { scope: "https://richkkok.github.io/" },
    location: { origin: "https://richkkok.github.io" },
    clients: {
      async claim() {
        claimed++;
      },
    },
    async skipWaiting() {
      skipped++;
    },
    addEventListener(name, fn) {
      events[name] = fn;
    },
  };
  vm.runInNewContext(fs.readFileSync("sw.js", "utf8"), {
    self,
    caches,
    URL,
    Set,
    Request: class {
      constructor(path) {
        this.url = new URL(path, self.registration.scope).href;
      }
    },
    fetch: async () => {
      throw Error("network unavailable");
    },
  });
  return {
    stores,
    get claimed() {
      return claimed;
    },
    get skipped() {
      return skipped;
    },
    async fire(name, data = {}) {
      let result;
      events[name]({
        ...data,
        waitUntil(p) {
          result = p;
        },
        respondWith(p) {
          result = p;
        },
      });
      return await result;
    },
  };
}
test("PWA caches the shell and parser, serves offline and activates only on explicit update", async () => {
  const w = worker();
  await w.fire("install");
  assert.equal(w.skipped, 0);
  for (const [path, mode] of [
    ["/", "navigate"],
    ["/js/app.js", "cors"],
    ["/vendor/xlsx.full.min.js", "cors"],
  ])
    assert.match(
      await w.fire("fetch", {
        request: {
          url: "https://richkkok.github.io" + path,
          method: "GET",
          mode,
        },
      }),
      /^cached:/,
    );
  await w.fire("activate");
  assert.equal(w.claimed, 1);
  assert(w.stores.has("unrelated-cache"));
  assert(!w.stores.has("richkkok-v1-old"));
  await w.fire("message", { data: { type: "SKIP_WAITING" } });
  assert.equal(w.skipped, 1);
  assert.equal(
    await w.fire("fetch", {
      request: { url: "https://other.example/a", method: "GET", mode: "cors" },
    }),
    undefined,
  );
  assert.equal(
    await w.fire("fetch", {
      request: {
        url: "https://richkkok.github.io/private",
        method: "POST",
        mode: "cors",
      },
    }),
    undefined,
  );
});
test("PWA failed precache never leaves a partial release cache", async () => {
  const w = worker(true);
  await assert.rejects(w.fire("install"), /offline install/);
  assert.deepEqual(
    [...w.stores.keys()],
    ["unrelated-cache", "richkkok-v1-old"],
  );
});

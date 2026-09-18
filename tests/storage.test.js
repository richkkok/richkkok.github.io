import test from "node:test";
import assert from "node:assert/strict";
import { IDBFactory } from "fake-indexeddb";
import { Repository } from "../js/db.js";
import { emptyState } from "../data/defaults.js";
import { encryptBackup, decryptBackup } from "../js/backup.js";
test("IndexedDB durable reload, atomic concurrent writes, isolated demo and full clear", async () => {
  const factory = new IDBFactory(),
    repo = new Repository("real", factory);
  await repo.mutate((s) => {
    s.settings.income = 100;
  });
  await Promise.all([
    repo.mutate((s) => {
      s.settings.income += 10;
    }),
    repo.mutate((s) => {
      s.settings.income += 20;
    }),
  ]);
  repo.close();
  assert.equal(
    (await new Repository("real", factory).read()).settings.income,
    130,
  );
  assert.equal(
    (await new Repository("demo", factory).read()).settings.income,
    0,
  );
  await repo.clear();
  assert.equal((await repo.read()).settings.income, 0);
  repo.close();
});
test("AES-GCM encrypted backup roundtrip; wrong password/tamper rejected; plain restore supported", async () => {
  const s = emptyState();
  s.settings.income = 123456;
  const json = await encryptBackup(s, "test-only-password");
  assert.ok(!json.includes("123456"));
  assert.deepEqual((await decryptBackup(json, "test-only-password")).state, s);
  await assert.rejects(decryptBackup(json, "wrong-password"));
  const corrupt = JSON.parse(json);
  const corruptedBytes = Buffer.from(corrupt.ciphertext, "base64");
  corruptedBytes[0] ^= 1;
  corrupt.ciphertext = corruptedBytes.toString("base64");
  await assert.rejects(
    decryptBackup(JSON.stringify(corrupt), "test-only-password"),
  );
  const plain = await decryptBackup(
    JSON.stringify({ format: "richkkok-backup", version: 1, state: s }),
  );
  assert.equal(plain.encrypted, false);
  assert.equal(plain.state.settings.income, 123456);
  await assert.rejects(encryptBackup(s, "short"));
});
test("Restore validates before replacing current state", async () => {
  const repo = new Repository("restore", new IDBFactory());
  await repo.mutate((s) => {
    s.settings.income = 200;
  });
  await assert.rejects(repo.replace({ schemaVersion: 8 }));
  assert.equal((await repo.read()).settings.income, 200);
  repo.close();
});

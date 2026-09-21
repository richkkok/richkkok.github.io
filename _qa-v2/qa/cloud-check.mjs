import fs from "node:fs/promises";
import assert from "node:assert/strict";
import { emptyState } from "../data/defaults.js";
const API =
  "https://wjelumpbjklfrdjxbesj.supabase.co/functions/v1/richkkok-sync";
const api = async (body) => {
  const r = await fetch(API, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-richkkok-app": "richkkok-household-v1",
      origin: "https://richkkok.github.io",
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(25000),
  });
  const data = await r.json();
  console.log(body.action, r.status);
  return { status: r.status, ...data };
};
const report = [];
const state = emptyState();
state.configured = true;
state.settings.income = 4000000;
state.settings.variableBudget = 1500000;
state.settings.savingsTarget = 1500000;
state.settings.trackingSince = "2026-09-21";
const owner = await api({
  action: "create_household",
  displayName: "QA 가상 사용자 A",
  householdName: "QA-RICHKKOK-20260921-V2",
  state,
});
assert(owner.ok, owner.code);
await fs.appendFile(
  "/tmp/richkkok-qa/created-ids.txt",
  owner.household.id + "\n",
);
await fs.writeFile(
  "/tmp/richkkok-qa/cloud.private.json",
  JSON.stringify({ owner }),
  { mode: 0o600 },
);
report.push("더미 공동가계부 생성");
const invite = await api({
  action: "create_invite",
  sessionToken: owner.sessionToken,
});
assert(invite.ok);
const token = new URL(invite.inviteUrl).hash.slice("#invite=".length);
const guest = await api({
  action: "join_invite",
  inviteToken: decodeURIComponent(token),
  displayName: "QA 가상 사용자 B",
});
assert(guest.ok, guest.code);
assert.equal(typeof guest.state, "object");
await fs.writeFile(
  "/tmp/richkkok-qa/cloud.private.json",
  JSON.stringify({ owner, guest }),
  { mode: 0o600 },
);
report.push("1회용 초대 참여");
const reused = await api({
  action: "join_invite",
  inviteToken: decodeURIComponent(token),
  displayName: "QA 재사용",
});
assert.equal(reused.status, 410);
report.push("초대 재사용 거절");
const p1 = await api({ action: "pull", sessionToken: owner.sessionToken }),
  p2 = await api({ action: "pull", sessionToken: guest.sessionToken });
assert.equal(p1.revision, p2.revision);
assert.equal(typeof p1.state, "object");
report.push("부부 동일 상태 조회");
const a = structuredClone(state),
  b = structuredClone(state);
a.dailyCloses = {
  "2026-09-20": {
    mode: "zero",
    by: "p1",
    signature: "[]",
    updatedAt: new Date().toISOString(),
  },
};
b.settings.variableBudget = 1300000;
const pushes = await Promise.all([
  api({
    action: "push",
    sessionToken: owner.sessionToken,
    expectedRevision: p1.revision,
    state: a,
  }),
  api({
    action: "push",
    sessionToken: guest.sessionToken,
    expectedRevision: p2.revision,
    state: b,
  }),
]);
assert.equal(pushes.filter((r) => r.ok).length, 1);
assert.equal(pushes.filter((r) => r.status === 409).length, 1);
report.push("동시 쓰기 한 건 성공·다른 건 revision 충돌 방지");
const remote = await api({ action: "pull", sessionToken: owner.sessionToken });
const { mergeValue } = await import("../js/sync-merge.js");
const merged = mergeValue(state, a, b);
const saved = await api({
  action: "push",
  sessionToken: owner.sessionToken,
  expectedRevision: remote.revision,
  state: merged,
});
assert(saved.ok);
const final = await api({ action: "pull", sessionToken: guest.sessionToken });
assert.equal(final.state.settings.variableBudget, 1300000);
assert.equal(final.state.dailyCloses["2026-09-20"].mode, "zero");
report.push("새 운영월 목표·마감 필드 공동 저장 및 재조회");
const bad = await api({ action: "pull", sessionToken: "qa-invalid-token" });
assert.equal(bad.status, 401);
report.push("유효하지 않은 세션 거절");
await fs.writeFile(
  "/tmp/richkkok-qa/cloud-results.json",
  JSON.stringify(
    {
      passed: report,
      householdId: owner.household.id,
      revision: final.revision,
    },
    null,
    2,
  ),
);
console.log(
  JSON.stringify({ passed: report, householdId: owner.household.id }),
);

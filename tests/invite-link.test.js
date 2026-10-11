import test from "node:test";
import assert from "node:assert/strict";
import { inviteTokenFromUrl } from "../js/invite-link.js";
import { onboardingView } from "../js/views/onboarding.js";
import { settingsView } from "../js/views/settings.js";
import { emptyState } from "../data/defaults.js";
const token = "A".repeat(43);
const valid = "https://richkkok.github.io/#invite=" + token;

test("official invitation URLs are accepted for fragment and query form", () => {
  assert.equal(inviteTokenFromUrl(valid), token);
  assert.equal(inviteTokenFromUrl(" https://richkkok.github.io/?invite=" + token + " "), token);
  assert.equal(inviteTokenFromUrl("https://richkkok.github.io/index.html#invite=" + token), token);
  assert.equal(inviteTokenFromUrl("https://richkkok.github.io/#invite=" + encodeURIComponent(token)), token);
});
test("fake hosts, insecure URLs, userinfo, other paths and missing tokens are rejected", () => {
  for (const url of [
    "http://richkkok.github.io/#invite=" + token,
    "https://richkkok.github.io.evil.example/#invite=" + token,
    "https://evil.example/#invite=" + token,
    "https://attacker@richkkok.github.io/#invite=" + token,
    "https://richkkok.github.io/unknown#invite=" + token,
    "https://richkkok.github.io/#home",
    "https://richkkok.github.io/#invite=a",
    "https://richkkok.github.io/#invite=%ZZ",
    "",
    "https://richkkok.github.io/?invite=" + token + "#invite=" + "Z".repeat(43),
  ]) assert.throws(() => inviteTokenFromUrl(url), Error, url);
});
test("first install and unconnected settings both offer invite joining without creating a new household", () => {
  const s = emptyState();
  assert.match(onboardingView(s), /data-action="cloud-join"/);
  assert.match(onboardingView(s), /초대받은 우리집 가계부 연결/);
  const initial = settingsView(s, { connected: false });
  assert.match(initial, /data-action="cloud-join"/);
  assert.match(initial, /data-action="cloud-start"/);
  const connected = settingsView(s, { connected: true, role:"member", householdName:"QA" });
  assert.doesNotMatch(connected, /data-action="cloud-join"/);
  assert.match(connected, /공동가계부 사용 중/);
});

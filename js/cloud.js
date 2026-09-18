import { openDialog, field, toast, icon } from "./ui.js";
import { escape as e } from "./format.js";

const API =
  "https://wjelumpbjklfrdjxbesj.supabase.co/functions/v1/richkkok-sync";
const REALTIME =
  "wss://wjelumpbjklfrdjxbesj.supabase.co/realtime/v1/websocket";
const PUBLISHABLE_KEY = "sb_publishable_pT145ZSd7qC5L7QGl-P4AA_fg3mMlJA";
const APP_HEADER = "richkkok-household-v1";
const META_KEY = "cloudMeta";
const BASE_KEY = "cloudBase";

const clone = (v) => (v === undefined ? undefined : structuredClone(v));
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const isObject = (v) =>
  !!v && typeof v === "object" && !Array.isArray(v);

function mergeById(base = [], local = [], remote = []) {
  const map = (rows) =>
    new Map(
      rows
        .filter((x) => x && typeof x === "object" && "id" in x)
        .map((x) => [String(x.id), x]),
    );
  const b = map(base),
    l = map(local),
    r = map(remote);
  const ids = new Set([...b.keys(), ...l.keys(), ...r.keys()]);
  const out = [];
  for (const id of ids) {
    const bv = b.get(id),
      lv = l.get(id),
      rv = r.get(id);
    if (lv === undefined && rv === undefined) continue;
    if (same(lv, bv)) {
      if (rv !== undefined) out.push(clone(rv));
      continue;
    }
    if (same(rv, bv)) {
      if (lv !== undefined) out.push(clone(lv));
      continue;
    }
    if (lv === undefined) {
      if (rv !== undefined) out.push(clone(rv));
      continue;
    }
    if (rv === undefined) {
      out.push(clone(lv));
      continue;
    }
    out.push(mergeValue(bv, lv, rv));
  }
  return out;
}

function mergeValue(base, local, remote) {
  if (same(local, base)) return clone(remote);
  if (same(remote, base)) return clone(local);
  if (same(local, remote)) return clone(local);

  if (Array.isArray(local) && Array.isArray(remote)) {
    const all = [...(base || []), ...local, ...remote];
    if (
      all.length &&
      all.every(
        (x) =>
          x &&
          typeof x === "object" &&
          !Array.isArray(x) &&
          typeof x.id === "string",
      )
    )
      return mergeById(Array.isArray(base) ? base : [], local, remote);
    return clone(local);
  }

  if (isObject(local) && isObject(remote)) {
    const out = {};
    const keys = new Set([
      ...Object.keys(isObject(base) ? base : {}),
      ...Object.keys(local),
      ...Object.keys(remote),
    ]);
    for (const key of keys) {
      const value = mergeValue(
        isObject(base) ? base[key] : undefined,
        local[key],
        remote[key],
      );
      if (value !== undefined) out[key] = value;
    }
    return out;
  }

  return clone(local);
}

function errorMessage(code) {
  return (
    {
      invalid_session: "이 기기의 공동가계부 연결정보가 만료됐어요.",
      session_required: "공동가계부 연결정보가 없어요.",
      invite_required: "초대링크가 올바르지 않아요.",
      invite_not_found: "유효한 초대링크를 찾지 못했어요.",
      invite_used: "이미 사용한 초대링크예요. 새 링크를 받아 주세요.",
      invite_expired: "초대링크가 만료됐어요. 새 링크를 받아 주세요.",
      member_limit: "우리집 구성원 수가 최대치에 도달했어요.",
      owner_only: "우리집 관리자만 할 수 있어요.",
      revision_conflict: "다른 기기의 변경사항과 합치는 중이에요.",
      invalid_state: "공유할 가계부 데이터 형식을 확인해 주세요.",
      state_too_large: "공동가계부 데이터가 너무 커서 동기화하지 못했어요.",
      origin_not_allowed: "허용된 리치콕 주소에서 다시 열어 주세요.",
      server_not_configured: "공동가계부 서버 설정을 확인해 주세요.",
      server_error: "공동가계부 서버에서 처리하지 못했어요.",
    }[code] || "공동가계부 연결 중 문제가 생겼어요."
  );
}

async function api(body) {
  let response;
  try {
    response = await fetch(API, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: PUBLISHABLE_KEY,
        "x-richkkok-app": APP_HEADER,
      },
      body: JSON.stringify(body),
    });
  } catch {
    const error = Error("네트워크에 연결되면 자동으로 다시 동기화할게요.");
    error.offline = true;
    throw error;
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.ok) {
    const error = Error(errorMessage(data.code));
    error.code = data.code;
    error.status = response.status;
    error.payload = data;
    throw error;
  }
  return data;
}

export class CloudSync {
  constructor(app) {
    this.app = app;
    this.meta = null;
    this.socket = null;
    this.heartbeat = null;
    this.reconnect = null;
    this.queue = Promise.resolve();
    this.initialized = false;
    this.stopped = false;
    this.pullTimer = null;
  }

  get connected() {
    return !!this.meta?.sessionToken && this.app.mode === "real";
  }

  summary() {
    if (!this.connected)
      return {
        connected: false,
        status: "이 기기에만 저장 중",
        memberCount: 1,
      };
    return {
      connected: true,
      householdName: this.meta.household?.name || "우리집 가계부",
      memberName: this.meta.member?.displayName || "구성원",
      role: this.meta.member?.role || "member",
      revision: this.meta.revision || 0,
      memberCount: this.meta.memberCount || 1,
      dirty: !!this.meta.dirty,
      status: this.meta.dirty ? "동기화 대기" : "실시간 동기화",
    };
  }

  async loadMeta() {
    this.meta = await this.app.repo.readKey(META_KEY, null);
    return this.meta;
  }

  async saveMeta() {
    if (!this.meta) {
      await this.app.repo.deleteKey(META_KEY);
      return;
    }
    await this.app.repo.writeKey(META_KEY, this.meta);
  }

  async saveBase(state) {
    await this.app.repo.writeKey(BASE_KEY, state);
  }

  async loadBase() {
    return await this.app.repo.readKey(BASE_KEY, null);
  }

  async init() {
    if (this.app.mode !== "real") return;
    this.initialized = true;
    this.stopped = false;
    await this.loadMeta();

    const params = new URLSearchParams(location.search);
    const invite = params.get("invite");

    if (this.connected) {
      try {
        await this.flushPending();
      } catch (error) {
        if (!error.offline) console.error(error);
      }
      this.startRealtime();
      this.startFallbackPull();
    }

    if (invite) {
      if (this.connected) {
        this.clearInviteFromUrl();
        openDialog(
          "이미 공동가계부를 사용 중이에요",
          "<p>이 기기는 이미 다른 우리집 가계부와 연결되어 있어요. 현재 연결을 유지했어요.</p>",
        );
      } else {
        await this.handleInvite(invite);
      }
    }

    window.addEventListener("online", this.onOnline);
    window.addEventListener("offline", this.onOffline);
    document.addEventListener("visibilitychange", this.onVisibility);
  }

  onOnline = () => {
    if (!this.connected) return;
    this.flushPending().catch(() => {});
    this.startRealtime();
  };

  onOffline = () => {
    if (this.connected) {
      this.meta.dirty ||= false;
      this.saveMeta().catch(() => {});
      this.renderIfSafe();
    }
  };

  onVisibility = () => {
    if (!document.hidden && this.connected)
      this.pullLatest().catch(() => {});
  };

  async setMode(mode) {
    if (mode === "demo") {
      this.stopRealtime();
      return;
    }
    this.stopped = false;
    await this.loadMeta();
    if (this.connected) {
      await this.flushPending().catch(() => {});
      this.startRealtime();
      this.startFallbackPull();
    }
  }

  enqueue(task) {
    const next = this.queue.then(task, task);
    this.queue = next.catch(() => {});
    return next;
  }

  async mutate(change) {
    if (!this.connected) return this.app.repo.mutate(change);
    return this.enqueue(async () => {
      if (navigator.onLine) await this.flushPending().catch(() => {});
      const next = await this.app.repo.mutate(change);
      this.meta.dirty = true;
      await this.saveMeta();
      try {
        await this.flushPending();
        return await this.app.repo.read();
      } catch (error) {
        this.renderIfSafe();
        if (!error.offline) toast(error.message);
        return next;
      }
    });
  }

  async pullLatest({ render = true } = {}) {
    if (!this.connected || !navigator.onLine) return null;
    return this.enqueue(async () => {
      const remote = await api({
        action: "pull",
        sessionToken: this.meta.sessionToken,
      });
      this.meta.memberCount = remote.members?.length || this.meta.memberCount || 1;

      if (this.meta.dirty) {
        await this.flushWithRemote(remote);
        return remote;
      }

      if (Number(remote.revision) > Number(this.meta.revision || 0)) {
        await this.app.repo.replace(remote.state);
        this.app.state = await this.app.repo.read();
        this.meta.revision = Number(remote.revision);
        this.meta.household = remote.household;
        this.meta.member = remote.member;
        this.meta.dirty = false;
        await this.saveMeta();
        await this.saveBase(remote.state);
        if (render) this.renderIfSafe();
      } else {
        this.meta.revision = Number(remote.revision);
        this.meta.household = remote.household;
        this.meta.member = remote.member;
        await this.saveMeta();
      }
      return remote;
    });
  }

  async flushPending() {
    if (!this.connected || !navigator.onLine) return null;
    const remote = await api({
      action: "pull",
      sessionToken: this.meta.sessionToken,
    });
    this.meta.memberCount = remote.members?.length || this.meta.memberCount || 1;
    return await this.flushWithRemote(remote);
  }

  async flushWithRemote(remote) {
    let local = await this.app.repo.read();
    const remoteRevision = Number(remote.revision);
    if (!this.meta.dirty) {
      if (remoteRevision > Number(this.meta.revision || 0)) {
        await this.app.repo.replace(remote.state);
        local = await this.app.repo.read();
        this.app.state = local;
      }
      this.meta.revision = remoteRevision;
      this.meta.household = remote.household;
      this.meta.member = remote.member;
      this.meta.dirty = false;
      await this.saveMeta();
      await this.saveBase(remote.state);
      return remote;
    }

    const base = (await this.loadBase()) || remote.state;
    let candidate =
      remoteRevision === Number(this.meta.revision || 0)
        ? local
        : mergeValue(base, local, remote.state);

    if (!same(candidate, local)) {
      await this.app.repo.replace(candidate);
      candidate = await this.app.repo.read();
      this.app.state = candidate;
    }

    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const pushed = await api({
          action: "push",
          sessionToken: this.meta.sessionToken,
          expectedRevision: remoteRevision,
          state: candidate,
        });
        this.meta.revision = Number(pushed.revision);
        this.meta.household = remote.household;
        this.meta.member = remote.member;
        this.meta.dirty = false;
        await this.saveMeta();
        await this.saveBase(candidate);
        this.renderIfSafe();
        return pushed;
      } catch (error) {
        if (error.code !== "revision_conflict" || attempt === 1) throw error;
        const newest = error.payload;
        const newerState = newest?.state;
        const newerRevision = Number(newest?.revision || 0);
        if (!newerState || !newerRevision) throw error;
        candidate = mergeValue(remote.state, candidate, newerState);
        await this.app.repo.replace(candidate);
        this.app.state = await this.app.repo.read();
        remote = { ...remote, state: newerState, revision: newerRevision };
      }
    }
    return null;
  }

  async startSharing() {
    if (this.connected) {
      await this.showMembers();
      return;
    }
    if (this.app.mode !== "real") {
      toast("샘플 공간에서는 공동가계부를 만들 수 없어요.");
      return;
    }
    const suggested =
      this.app.state?.settings?.members?.p1 &&
      !/^구성원\s*1$/.test(this.app.state.settings.members.p1)
        ? this.app.state.settings.members.p1
        : "";
    openDialog(
      "우리집 공동가계부 시작",
      `<p>현재 이 기기의 가계부를 기준으로 공동가계부를 만들어요. 이후 아내를 초대하면 같은 내용을 함께 수정하고 거의 실시간으로 볼 수 있어요.</p><div class="form-grid">${field("내 이름", "displayName", suggested, "text", 'required maxlength="30"')}${field("가계부 이름", "householdName", "우리집 가계부", "text", 'required maxlength="40"')}</div><div class="notice"><strong>현재 기록은 그대로 유지돼요</strong><p class="small muted">금융파일 원본은 전송하지 않고, 리치콕에 저장된 정규화된 가계부 데이터만 공동 저장소와 동기화해요.</p></div>`,
      async (form) => {
        const created = await api({
          action: "create_household",
          displayName: String(form.get("displayName") || "").trim(),
          householdName: String(form.get("householdName") || "").trim(),
          state: this.app.state,
        });
        this.meta = {
          sessionToken: created.sessionToken,
          household: created.household,
          member: created.member,
          revision: Number(created.revision),
          memberCount: 1,
          dirty: false,
        };
        await this.saveMeta();
        await this.saveBase(created.state);
        this.startRealtime();
        this.startFallbackPull();
        this.renderIfSafe();
        toast("우리집 공동가계부를 만들었어요.");
      },
      "공동가계부 만들기",
    );
  }

  async createInvite() {
    if (!this.connected) return this.startSharing();
    if (this.meta.member?.role !== "owner") {
      toast("우리집 관리자만 초대링크를 만들 수 있어요.");
      return;
    }
    const result = await api({
      action: "create_invite",
      sessionToken: this.meta.sessionToken,
    });
    const url = result.inviteUrl;
    const dialog = openDialog(
      "아내 초대하기",
      `<p>아래 링크를 아내에게 보내면 같은 우리집 가계부에 참여할 수 있어요. 링크는 한 번만 사용할 수 있고 7일 뒤 만료돼요.</p><label class="field"><span>초대링크</span><input id="invite-url" value="${e(url)}" readonly></label><div class="invite-actions"><button class="btn primary" type="button" id="share-invite">${icon("heart")}카카오톡 · 공유하기</button><button class="btn secondary" type="button" id="copy-invite">링크 복사</button></div><p class="small muted">초대받은 기기에서 이름을 한 번 입력하면 바로 공동가계부가 열려요.</p>`,
    );
    dialog.querySelector("#share-invite")?.addEventListener("click", async () => {
      try {
        if (navigator.share) {
          await navigator.share({
            title: "리치콕 우리집 가계부 초대",
            text: "우리집 가계부 같이 쓰자.",
            url,
          });
        } else {
          await this.copyInvite(url);
        }
      } catch {}
    });
    dialog.querySelector("#copy-invite")?.addEventListener("click", () =>
      this.copyInvite(url),
    );
  }

  async copyInvite(url) {
    try {
      await navigator.clipboard.writeText(url);
      toast("초대링크를 복사했어요.");
    } catch {
      const input = document.querySelector("#invite-url");
      input?.focus();
      input?.select();
      toast("초대링크를 선택했어요. 복사해 주세요.");
    }
  }

  async showMembers() {
    if (!this.connected) return this.startSharing();
    const result = await api({
      action: "members",
      sessionToken: this.meta.sessionToken,
    });
    this.meta.memberCount = result.members.length;
    await this.saveMeta();
    const rows = result.members
      .map(
        (m) =>
          `<div class="cloud-member-row"><span class="avatar">${e(
            m.display_name.slice(0, 1),
          )}</span><span><strong>${e(m.display_name)}</strong><small>${
            m.role === "owner" ? "우리집 관리자" : "공동 구성원"
          }</small></span><span class="status-pill">${
            m.role === "owner" ? "관리자" : "참여중"
          }</span></div>`,
      )
      .join("");
    openDialog(
      this.meta.household?.name || "우리집 공동가계부",
      `<div class="cloud-status-card"><span class="sync-dot"></span><div><strong>${this.meta.dirty ? "동기화 대기 중" : "실시간 동기화 중"}</strong><small>온라인 상태에서는 서로의 변경사항이 자동으로 반영돼요.</small></div></div><div class="cloud-member-list">${rows}</div>${
        this.meta.member?.role === "owner"
          ? '<button type="button" class="btn primary" data-close id="members-invite">아내 · 가족 초대하기</button>'
          : ""
      }`,
    );
    const invite = document.querySelector("#members-invite");
    if (invite)
      invite.onclick = () => {
        document.querySelector("#dialog")?.close();
        this.createInvite().catch((error) => toast(error.message));
      };
    this.renderIfSafe();
  }

  async handleInvite(token) {
    let preview;
    try {
      preview = await api({ action: "preview_invite", inviteToken: token });
    } catch (error) {
      this.clearInviteFromUrl();
      openDialog("초대링크를 확인해 주세요", `<p>${e(error.message)}</p>`);
      return;
    }
    openDialog(
      `${e(preview.householdName)} 참여`,
      `<p><strong>${e(preview.inviterName)}</strong>님이 우리집 공동가계부에 초대했어요.</p><p class="muted">참여하면 이 기기의 현재 로컬 가계부 대신 초대한 우리집 가계부가 열려요.</p>${field("내 이름", "displayName", "", "text", 'required maxlength="30"')}`,
      async (form) => {
        const joined = await api({
          action: "join_invite",
          inviteToken: token,
          displayName: String(form.get("displayName") || "").trim(),
        });
        await this.app.repo.replace(joined.state);
        this.app.state = await this.app.repo.read();
        this.meta = {
          sessionToken: joined.sessionToken,
          household: joined.household,
          member: joined.member,
          revision: Number(joined.revision),
          memberCount: 2,
          dirty: false,
        };
        await this.saveMeta();
        await this.saveBase(joined.state);
        this.clearInviteFromUrl();
        this.startRealtime();
        this.startFallbackPull();
        this.app.render();
        toast("우리집 가계부에 참여했어요.");
      },
      "우리집 가계부 참여",
    );
  }

  clearInviteFromUrl() {
    const url = new URL(location.href);
    url.searchParams.delete("invite");
    history.replaceState(null, "", url.pathname + url.search + url.hash);
  }

  startFallbackPull() {
    clearInterval(this.pullTimer);
    if (!this.connected) return;
    this.pullTimer = setInterval(() => {
      if (!document.hidden && navigator.onLine)
        this.pullLatest().catch(() => {});
    }, 30000);
  }

  startRealtime() {
    if (!this.connected || !navigator.onLine || this.socket) return;
    this.stopped = false;
    const topicName = this.meta.household?.syncTopic;
    if (!topicName) return;
    const url = `${REALTIME}?apikey=${encodeURIComponent(
      PUBLISHABLE_KEY,
    )}&vsn=1.0.0`;
    const ws = new WebSocket(url);
    this.socket = ws;
    let ref = 1;
    const topic = `realtime:${topicName}`;

    ws.onopen = () => {
      ws.send(
        JSON.stringify({
          topic,
          event: "phx_join",
          payload: {
            config: {
              broadcast: { ack: false, self: false },
              presence: { enabled: false },
              postgres_changes: [],
              private: false,
            },
          },
          ref: String(ref++),
          join_ref: "1",
        }),
      );
      clearInterval(this.heartbeat);
      this.heartbeat = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN)
          ws.send(
            JSON.stringify({
              topic: "phoenix",
              event: "heartbeat",
              payload: {},
              ref: String(ref++),
              join_ref: null,
            }),
          );
      }, 20000);
    };

    ws.onmessage = (event) => {
      let msg;
      try {
        msg = JSON.parse(event.data);
      } catch {
        return;
      }
      if (
        msg?.event === "broadcast" &&
        msg?.payload?.event === "state_changed"
      ) {
        const incoming = Number(msg.payload?.payload?.revision || 0);
        if (incoming > Number(this.meta?.revision || 0))
          this.pullLatest().catch(() => {});
      }
    };

    ws.onclose = () => {
      if (this.socket === ws) this.socket = null;
      clearInterval(this.heartbeat);
      this.heartbeat = null;
      if (!this.stopped && this.connected && navigator.onLine) {
        clearTimeout(this.reconnect);
        this.reconnect = setTimeout(() => this.startRealtime(), 3000);
      }
    };

    ws.onerror = () => ws.close();
  }

  stopRealtime() {
    this.stopped = true;
    clearTimeout(this.reconnect);
    clearInterval(this.heartbeat);
    clearInterval(this.pullTimer);
    this.reconnect = null;
    this.heartbeat = null;
    this.pullTimer = null;
    const ws = this.socket;
    this.socket = null;
    if (ws && ws.readyState < WebSocket.CLOSING) ws.close();
  }

  renderIfSafe() {
    if (!document.querySelector("#dialog")?.open) this.app.render();
  }
}

import { mergeValue, mergeStates } from "./sync-merge.js";
import { openDialog, field, select, toast, icon } from "./ui.js";
import { escape as e } from "./format.js";

const API =
  "https://wjelumpbjklfrdjxbesj.supabase.co/functions/v1/richkkok-sync";
const REALTIME = "wss://wjelumpbjklfrdjxbesj.supabase.co/realtime/v1/websocket";
const PUBLISHABLE_KEY = "sb_publishable_pT145ZSd7qC5L7QGl-P4AA_fg3mMlJA";
const APP_HEADER = "richkkok-household-v1";
const META_KEY = "cloudMeta";
const BASE_KEY = "cloudBase";

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

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
      status: !navigator.onLine
        ? "오프라인 · 이 기기에 저장"
        : this.meta.dirty
          ? "동기화 대기"
          : "공동 기록 동기화됨",
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
    this.renderIfSafe();

    const params = new URLSearchParams(location.search);
    const hashInvite = location.hash.startsWith("#invite=")
      ? decodeURIComponent(location.hash.slice("#invite=".length))
      : "";
    const invite = params.get("invite") || hashInvite;

    if (this.connected) {
      try {
        await this.enqueue(() => this.flushPending());
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
    this.enqueue(() => this.flushPending()).catch(() => {});
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
    if (!document.hidden && this.connected) this.pullLatest().catch(() => {});
  };

  async setMode(mode) {
    if (mode === "demo") {
      this.stopRealtime();
      return;
    }
    this.stopped = false;
    await this.loadMeta();
    if (this.connected) {
      await this.enqueue(() => this.flushPending()).catch(() => {});
      this.startRealtime();
      this.startFallbackPull();
    }
  }

  enqueue(task) {
    const run = async () => {
      await this.loadMeta();
      return task();
    };
    const locked = () =>
      globalThis.navigator?.locks
        ? navigator.locks.request("richkkok-cloud-" + this.app.repo.name, run)
        : run();
    const next = this.queue.then(locked, locked);
    this.queue = next.catch(() => {});
    return next;
  }

  async mutate(change) {
    if (!this.connected) return this.app.repo.mutate(change);
    const next = await this.app.repo.mutate(change);
    await this.loadMeta();
    this.enqueue(() => this.flushPending()).catch((error) => {
      if (!error.offline) toast(error.message);
    });
    return next;
  }

  async resolveConflicts() {
    if (!this.connected) return;
    const remote = await api({
      action: "pull",
      sessionToken: this.meta.sessionToken,
    });
    const local = await this.app.repo.read(),
      base = (await this.loadBase()) || remote.state;
    const result = mergeStates(base, local, remote.state);
    if (!result.conflicts.length) {
      await this.enqueue(() => this.flushPending());
      toast("동기화 충돌이 없어요.");
      return;
    }
    const display = (v) =>
      typeof v === "object" && v?.merchantRaw
        ? `${v.merchantRaw} · ${v.amount}원 · ${v.deletedAt ? "삭제됨" : v.category}`
        : JSON.stringify(v ?? "삭제됨").slice(0, 180);
    openDialog(
      "동시수정 확인",
      `<p>같은 기록을 두 기기에서 수정했어. 유지할 내용을 선택해 줘. 선택 전 두 버전은 이 기기에 보관해.</p>${result.conflicts
        .map((c, i) =>
          select(
            c.path.startsWith("transactions") ? "거래 변경" : c.path,
            "conflict-" + i,
            [
              ["local", "이 기기: " + display(c.local)],
              ["remote", "다른 기기: " + display(c.remote)],
            ],
            "local",
          ),
        )
        .join("")}`,
      async (f) => {
        await this.enqueue(async () => {
          const current = await this.app.repo.read();
          if (!same(current, local))
            throw Error(
              "그 사이 이 기기 기록이 바뀌었어. 닫고 다시 확인해 줘.",
            );
          const choices = Object.fromEntries(
            result.conflicts.map((c, i) => [
              c.path,
              String(f.get("conflict-" + i)),
            ]),
          );
          await this.app.repo.writeKey("sync-conflict-backup", {
            local,
            remote: remote.state,
            at: new Date().toISOString(),
          });
          const accepted = await this.app.repo.acceptRemote(
            local,
            mergeStates(base, local, remote.state, choices).state,
            { revision: Number(remote.revision) },
            { base: remote.state, dirty: true },
          );
          this.meta = accepted.meta;
          this.app.state = accepted.state;
          await this.flushPending();
          this.app.state = await this.app.repo.read();
          this.app.render();
        });
      },
      "선택한 내용으로 동기화",
    );
  }

  async pullLatest() {
    if (!this.connected || !navigator.onLine) return null;
    return this.enqueue(() => this.flushPending());
  }

  async flushPending() {
    if (!this.connected || !navigator.onLine) return null;
    const remote = await api({
      action: "pull",
      sessionToken: this.meta.sessionToken,
    });
    return this.flushWithRemote(remote);
  }

  async flushWithRemote(remote) {
    // Network never holds the local write path. Commit the response atomically
    // against the snapshot, preserving edits made while the request was in flight.
    await this.loadMeta();
    const local = await this.app.repo.read();
    const metadata = {
      revision: Number(remote.revision),
      household: remote.household,
      member: remote.member,
      memberCount: remote.members?.length || this.meta.memberCount || 1,
    };
    if (!this.meta.dirty) {
      if (Number(remote.revision) < Number(this.meta.revision || 0))
        return remote;
      const accepted = await this.app.repo.acceptRemote(
        local,
        remote.state,
        metadata,
      );
      this.meta = accepted.meta;
      this.app.state = accepted.state;
      this.renderIfSafe();
      return remote;
    }
    const base = (await this.loadBase()) || remote.state;
    let candidate =
      Number(remote.revision) === Number(this.meta.revision || 0)
        ? local
        : mergeValue(base, local, remote.state);
    let revision = Number(remote.revision);
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const pushed = await api({
          action: "push",
          sessionToken: this.meta.sessionToken,
          expectedRevision: revision,
          state: candidate,
        });
        const accepted = await this.app.repo.acceptRemote(local, candidate, {
          ...metadata,
          revision: Number(pushed.revision),
        });
        this.meta = accepted.meta;
        this.app.state = accepted.state;
        this.renderIfSafe();
        this.broadcastRevision(Number(pushed.revision));
        return pushed;
      } catch (error) {
        if (error.code !== "revision_conflict" || attempt === 1) throw error;
        const latest = error.payload;
        candidate = mergeValue(remote.state, candidate, latest.state);
        remote = { ...remote, state: latest.state };
        revision = Number(latest.revision);
      }
    }
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
      `<p>현재 이 기기의 가계부를 기준으로 공동가계부를 만들어요. 이후 아내를 초대하면 같은 내용을 함께 수정하고 온라인에서 바로 반영해 볼 수 있어요.</p><div class="form-grid">${field("내 이름", "displayName", suggested, "text", 'required maxlength="30"')}${field("가계부 이름", "householdName", "우리집 가계부", "text", 'required maxlength="40"')}</div><div class="notice"><strong>현재 기록은 그대로 유지돼요</strong><p class="small muted">금융파일 원본은 전송하지 않고, 리치콕에 저장된 정규화된 가계부 데이터만 공동 저장소와 동기화해요.</p></div>`,
      async (form) => {
        const snapshot = await this.app.repo.read();
        const created = await api({
          action: "create_household",
          displayName: String(form.get("displayName") || "").trim(),
          householdName: String(form.get("householdName") || "").trim(),
          state: snapshot,
        });
        this.meta = {
          sessionToken: created.sessionToken,
          household: created.household,
          member: created.member,
          revision: Number(created.revision),
          memberCount: 1,
          dirty: false,
        };
        const accepted = await this.app.repo.acceptRemote(
          snapshot,
          created.state,
          this.meta,
        );
        this.meta = accepted.meta;
        this.app.state = accepted.state;
        this.startRealtime();
        this.startFallbackPull();
        setTimeout(() => {
          this.app.render();
          this.createInvite().catch((error) => toast(error.message));
        }, 0);
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
    dialog
      .querySelector("#share-invite")
      ?.addEventListener("click", async () => {
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
    dialog
      .querySelector("#copy-invite")
      ?.addEventListener("click", () => this.copyInvite(url));
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
        await this.app.repo.writeKey(
          "before-household-join",
          await this.app.repo.read(),
        );
        await this.app.repo.replaceExact(joined.state);
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
    history.replaceState(null, "", url.pathname + url.search + "#home");
  }

  broadcastRevision(revision) {
    const ws = this.socket;
    const topicName = this.meta?.household?.syncTopic;
    const nextRevision = Number(revision);
    if (
      !ws ||
      ws.readyState !== 1 ||
      !topicName ||
      !Number.isSafeInteger(nextRevision) ||
      nextRevision < 1
    )
      return;
    try {
      ws.send(
        JSON.stringify({
          topic: `realtime:${topicName}`,
          event: "broadcast",
          payload: {
            type: "broadcast",
            event: "state_changed",
            payload: { revision: nextRevision },
          },
          ref: null,
          join_ref: "1",
        }),
      );
    } catch {}
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

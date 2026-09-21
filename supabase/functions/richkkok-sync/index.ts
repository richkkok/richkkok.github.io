import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import postgres from "npm:postgres@3.4.5";

const ORIGIN = "https://richkkok.github.io";
const APP = "richkkok-household-v1";
const MAX_STATE_BYTES = 8 * 1024 * 1024;
const MAX_MEMBERS = 6;

const cors = {
  "Access-Control-Allow-Origin": ORIGIN,
  "Access-Control-Allow-Headers":
    "content-type, x-client-info, apikey, authorization, x-richkkok-app",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-store",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: cors });
const clean = (v: unknown, max = 200) =>
  String(v ?? "")
    .trim()
    .slice(0, max);

class HttpError extends Error {
  status: number;
  code: string;
  payload?: Record<string, unknown>;
  constructor(status: number, code: string, payload?: Record<string, unknown>) {
    super(code);
    this.status = status;
    this.code = code;
    this.payload = payload;
  }
}
function b64url(bytes: Uint8Array) {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}
function randomToken(bytes = 32) {
  return b64url(crypto.getRandomValues(new Uint8Array(bytes)));
}
async function sha256(value: string) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
function stateJson(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new HttpError(400, "invalid_state");
  const text = JSON.stringify(value);
  if (new TextEncoder().encode(text).byteLength > MAX_STATE_BYTES)
    throw new HttpError(413, "state_too_large");
  const state = value as Record<string, unknown>;
  if (state.schemaVersion !== 1 || !Array.isArray(state.transactions))
    throw new HttpError(400, "invalid_state");
  return text;
}
function storedState(value: unknown) {
  // Read legacy JSON strings without rewriting or dropping original records.
  let state = value;
  for (let i = 0; i < 3 && typeof state === "string"; i++) {
    try {
      state = JSON.parse(state);
    } catch {
      throw new HttpError(500, "invalid_stored_state");
    }
  }
  stateJson(state);
  return state as Record<string, unknown>;
}
async function session(sql: postgres.Sql, rawToken: unknown) {
  const token = clean(rawToken, 300);
  if (!token) throw new HttpError(401, "session_required");
  const hash = await sha256(token);
  const rows = await sql`
    select
      m.member_id,
      m.household_id,
      m.display_name,
      m.role,
      h.name as household_name,
      h.sync_topic,
      s.data,
      s.revision,
      s.updated_at
    from public.richkkok_members m
    join public.richkkok_households h on h.household_id = m.household_id
    join public.richkkok_state s on s.household_id = m.household_id
    where m.session_hash = ${hash}
    limit 1
  `;
  const row = rows[0];
  if (!row) throw new HttpError(401, "invalid_session");
  await sql`
    update public.richkkok_members
    set last_seen_at = now()
    where member_id = ${row.member_id}
  `;
  return row;
}
async function members(sql: postgres.Sql, householdId: string) {
  return await sql`
    select member_id, display_name, role, created_at, last_seen_at
    from public.richkkok_members
    where household_id = ${householdId}
    order by case when role='owner' then 0 else 1 end, created_at
  `;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST")
    return json({ ok: false, code: "method_not_allowed" }, 405);

  const origin = req.headers.get("origin") || "";
  if (origin && origin !== ORIGIN)
    return json({ ok: false, code: "origin_not_allowed" }, 403);
  if (req.headers.get("x-richkkok-app") !== APP)
    return json({ ok: false, code: "invalid_client" }, 403);

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ ok: false, code: "invalid_json" }, 400);
  }

  const dbUrl = Deno.env.get("SUPABASE_DB_URL") || "";
  if (!dbUrl) return json({ ok: false, code: "server_not_configured" }, 500);

  const sql = postgres(dbUrl, {
    prepare: false,
    max: 4,
    connect_timeout: 5,
    idle_timeout: 2,
  });

  try {
    const action = clean(body.action, 60);

    if (action === "create_household") {
      const displayName = clean(body.displayName, 30);
      const householdName = clean(body.householdName, 40) || "우리집 가계부";
      if (!displayName) throw new HttpError(400, "display_name_required");
      const data = stateJson(body.state);
      const householdId = crypto.randomUUID();
      const memberId = crypto.randomUUID();
      const syncTopic = "richkkok:" + randomToken(24);
      const rawSession = randomToken();
      const sessionHash = await sha256(rawSession);

      await sql.begin(async (tx) => {
        await tx`
          insert into public.richkkok_households(household_id, name, sync_topic)
          values(${householdId}, ${householdName}, ${syncTopic})
        `;
        await tx`
          insert into public.richkkok_members(member_id, household_id, display_name, role, session_hash)
          values(${memberId}, ${householdId}, ${displayName}, 'owner', ${sessionHash})
        `;
        await tx`
          insert into public.richkkok_state(household_id, data, revision, updated_by_member_id)
          values(${householdId}, ${tx.json(JSON.parse(data))}, 1, ${memberId})
        `;
      });

      return json({
        ok: true,
        sessionToken: rawSession,
        household: { id: householdId, name: householdName, syncTopic },
        member: { id: memberId, displayName, role: "owner" },
        revision: 1,
        state: JSON.parse(data),
      });
    }

    if (action === "pull") {
      const auth = await session(sql, body.sessionToken);
      return json({
        ok: true,
        household: {
          id: auth.household_id,
          name: auth.household_name,
          syncTopic: auth.sync_topic,
        },
        member: {
          id: auth.member_id,
          displayName: auth.display_name,
          role: auth.role,
        },
        revision: Number(auth.revision),
        updatedAt: auth.updated_at,
        state: storedState(auth.data),
        members: await members(sql, auth.household_id),
      });
    }

    if (action === "push") {
      const auth = await session(sql, body.sessionToken);
      const expectedRevision = Number(body.expectedRevision);
      if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 1)
        throw new HttpError(400, "invalid_revision");
      const data = stateJson(body.state);

      const saved = await sql`
        update public.richkkok_state
        set
          data = ${sql.json(JSON.parse(data))},
          revision = revision + 1,
          updated_at = now(),
          updated_by_member_id = ${auth.member_id}
        where household_id = ${auth.household_id}
          and revision = ${expectedRevision}
        returning revision, updated_at
      `;

      if (!saved.length) {
        const latest = await sql`
          select data, revision, updated_at
          from public.richkkok_state
          where household_id = ${auth.household_id}
          limit 1
        `;
        throw new HttpError(409, "revision_conflict", {
          revision: Number(latest[0]?.revision || 0),
          updatedAt: latest[0]?.updated_at,
          state: storedState(latest[0]?.data),
        });
      }

      return json({
        ok: true,
        revision: Number(saved[0].revision),
        updatedAt: saved[0].updated_at,
      });
    }

    if (action === "create_invite") {
      const auth = await session(sql, body.sessionToken);
      if (auth.role !== "owner") throw new HttpError(403, "owner_only");

      const rawInvite = randomToken();
      const inviteHash = await sha256(rawInvite);
      const inviteId = crypto.randomUUID();

      await sql`
        delete from public.richkkok_invites
        where household_id = ${auth.household_id}
          and claimed_at is null
      `;

      await sql`
        insert into public.richkkok_invites(
          invite_id, household_id, token_hash, created_by_member_id, expires_at
        )
        values(
          ${inviteId}, ${auth.household_id}, ${inviteHash}, ${auth.member_id},
          now() + interval '7 days'
        )
      `;

      return json({
        ok: true,
        inviteUrl: `${ORIGIN}/#invite=${encodeURIComponent(rawInvite)}`,
        expiresInDays: 7,
      });
    }

    if (action === "preview_invite") {
      const token = clean(body.inviteToken, 300);
      if (!token) throw new HttpError(400, "invite_required");
      const hash = await sha256(token);
      const rows = await sql`
        select
          i.invite_id,
          i.claimed_at,
          i.expires_at,
          h.household_id,
          h.name as household_name,
          m.display_name as inviter_name
        from public.richkkok_invites i
        join public.richkkok_households h on h.household_id = i.household_id
        join public.richkkok_members m on m.member_id = i.created_by_member_id
        where i.token_hash = ${hash}
        limit 1
      `;
      const invite = rows[0];
      if (!invite) throw new HttpError(404, "invite_not_found");
      if (invite.claimed_at) throw new HttpError(410, "invite_used");
      if (new Date(invite.expires_at).getTime() <= Date.now())
        throw new HttpError(410, "invite_expired");

      return json({
        ok: true,
        householdName: invite.household_name,
        inviterName: invite.inviter_name,
        expiresAt: invite.expires_at,
      });
    }

    if (action === "join_invite") {
      const token = clean(body.inviteToken, 300);
      const displayName = clean(body.displayName, 30);
      if (!token) throw new HttpError(400, "invite_required");
      if (!displayName) throw new HttpError(400, "display_name_required");
      const hash = await sha256(token);
      const rawSession = randomToken();
      const sessionHash = await sha256(rawSession);
      const memberId = crypto.randomUUID();

      const result = await sql.begin(async (tx) => {
        const rows = await tx`
          select i.*, h.name as household_name, h.sync_topic
          from public.richkkok_invites i
          join public.richkkok_households h on h.household_id = i.household_id
          where i.token_hash = ${hash}
          limit 1
          for update of i
        `;
        const invite = rows[0];
        if (!invite) throw new HttpError(404, "invite_not_found");
        if (invite.claimed_at) throw new HttpError(410, "invite_used");
        if (new Date(invite.expires_at).getTime() <= Date.now())
          throw new HttpError(410, "invite_expired");

        const counts = await tx`
          select count(*)::int as count
          from public.richkkok_members
          where household_id = ${invite.household_id}
        `;
        if (Number(counts[0]?.count || 0) >= MAX_MEMBERS)
          throw new HttpError(409, "member_limit");

        await tx`
          insert into public.richkkok_members(
            member_id, household_id, display_name, role, session_hash
          )
          values(
            ${memberId}, ${invite.household_id}, ${displayName}, 'member', ${sessionHash}
          )
        `;
        await tx`
          update public.richkkok_invites
          set claimed_at = now(), claimed_by_member_id = ${memberId}
          where invite_id = ${invite.invite_id}
        `;
        const states = await tx`
          select data, revision, updated_at
          from public.richkkok_state
          where household_id = ${invite.household_id}
          limit 1
        `;
        return { invite, state: states[0] };
      });

      return json({
        ok: true,
        sessionToken: rawSession,
        household: {
          id: result.invite.household_id,
          name: result.invite.household_name,
          syncTopic: result.invite.sync_topic,
        },
        member: { id: memberId, displayName, role: "member" },
        revision: Number(result.state.revision),
        updatedAt: result.state.updated_at,
        state: storedState(result.state.data),
      });
    }

    if (action === "members") {
      const auth = await session(sql, body.sessionToken);
      return json({ ok: true, members: await members(sql, auth.household_id) });
    }

    if (action === "revoke_invites") {
      const auth = await session(sql, body.sessionToken);
      if (auth.role !== "owner") throw new HttpError(403, "owner_only");
      const rows = await sql`
        delete from public.richkkok_invites
        where household_id = ${auth.household_id}
          and claimed_at is null
        returning invite_id
      `;
      return json({ ok: true, revoked: rows.length });
    }

    return json({ ok: false, code: "invalid_action" }, 400);
  } catch (error) {
    if (error instanceof HttpError)
      return json(
        { ok: false, code: error.code, ...(error.payload || {}) },
        error.status,
      );
    console.error(error);
    return json({ ok: false, code: "server_error" }, 500);
  } finally {
    await sql.end({ timeout: 1 }).catch(() => {});
  }
});

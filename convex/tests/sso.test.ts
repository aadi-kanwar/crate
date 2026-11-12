import { exportSPKI, generateKeyPair, SignJWT, type CryptoKey, type JWTPayload } from "jose";
import { beforeAll, describe, expect, test } from "vitest";
import { api, internal } from "../_generated/api";
import { SSO_SESSION_MS } from "../lib/ssoTicket";
import {
  createAdmin,
  createMember,
  addProperty,
  errorCode,
  PASSWORD,
  setupTest,
  type T,
} from "./harness.test-utils";

const HUB = "https://admin.example.test";
const PHONE = "+919812345678";

let hubKey: CryptoKey;
let otherKey: CryptoKey;

beforeAll(async () => {
  const hub = await generateKeyPair("EdDSA", { extractable: true });
  hubKey = hub.privateKey;
  otherKey = (await generateKeyPair("EdDSA", { extractable: true })).privateKey;
  // Stored the way it is on the real deployment: one line, "\n" written out.
  process.env.HUB_SSO_PUBLIC_KEY = (await exportSPKI(hub.publicKey)).trim().replace(/\n/g, "\\n");
  process.env.HUB_ORIGIN = HUB;
});

let jtiCounter = 0;

/** A ticket as the hub issues it; `overrides` changes claims (undefined removes one). */
async function ticket(overrides: JWTPayload = {}, key: CryptoKey = hubKey) {
  const now = Math.floor(Date.now() / 1000);
  jtiCounter += 1;
  const claims: JWTPayload = {
    iss: HUB,
    aud: "crate",
    sub: "hubAdmin123",
    phone: PHONE,
    name: "Meera Kapoor",
    role: "master_admin",
    jti: `nonce-${jtiCounter}`,
    iat: now,
    exp: now + 60,
    ...overrides,
  };
  for (const [k, value] of Object.entries(claims)) if (value === undefined) delete claims[k];
  return await new SignJWT(claims).setProtectedHeader({ alg: "EdDSA" }).sign(key);
}

const ssoSignIn = (t: T, value: string) =>
  t.action(api.auth.signIn, { provider: "hub-sso", params: { ticket: value } });

async function setup() {
  const t = await setupTest();
  const admin = await createAdmin(t);
  return { t, admin };
}

const userByPhone = (t: T, phone: string) =>
  t.run((ctx) => ctx.db.query("users").withIndex("phone", (q) => q.eq("phone", phone)).first());

describe("Admin Hub sign-in (hub-sso)", () => {
  test("a valid ticket creates an admin of the organisation and signs in for 12 hours", async () => {
    const { t, admin } = await setup();
    const result = await ssoSignIn(t, await ticket());
    expect(result.tokens?.token).toBeTruthy();

    const user = (await userByPhone(t, PHONE))!;
    expect(user).toMatchObject({
      phone: PHONE,
      name: "Meera Kapoor",
      role: "admin",
      organizationId: admin.organizationId,
      ssoManaged: true,
    });
    expect(user.mustChangePassword).toBeUndefined();

    const sessions = await t.run((ctx) =>
      ctx.db.query("authSessions").withIndex("userId", (q) => q.eq("userId", user._id)).collect(),
    );
    expect(sessions).toHaveLength(1);
    expect(sessions[0].expirationTime - Date.now()).toBeLessThanOrEqual(SSO_SESSION_MS + 1000);
    expect(sessions[0].expirationTime - Date.now()).toBeGreaterThan(SSO_SESSION_MS - 60_000);

    const audit = (await t.run((ctx) => ctx.db.query("auditLog").collect())).filter((a) => a.action === "sso.signed_in");
    expect(audit).toHaveLength(1);
    expect(audit[0].metadata).toMatchObject({ hubAdminId: "hubAdmin123", accountCreated: true, roleGranted: true });

    // The new admin can use admin screens straight away.
    const as = t.withIdentity({ subject: `${user._id}|${sessions[0]._id}` });
    const me = await as.query(api.users.me, {});
    expect(me).not.toBeNull();
  });

  test("the login ends after 12 hours", async () => {
    const { t } = await setup();
    await ssoSignIn(t, await ticket());
    const user = (await userByPhone(t, PHONE))!;
    const session = (await t.run((ctx) =>
      ctx.db.query("authSessions").withIndex("userId", (q) => q.eq("userId", user._id)).first(),
    ))!;
    const as = t.withIdentity({ subject: `${user._id}|${session._id}` });
    expect(await as.query(api.users.me, {})).not.toBeNull();
    await t.run((ctx) => ctx.db.patch(session._id, { expirationTime: Date.now() - 1 }));
    expect(await as.query(api.users.me, {})).toBeNull();
  });

  test("an existing admin signs in unchanged apart from the hub mark", async () => {
    const { t, admin } = await setup();
    const before = (await t.run((ctx) => ctx.db.get(admin.userId)))!;
    await ssoSignIn(t, await ticket({ phone: admin.phone, name: "Different Name" }));
    const after = (await t.run((ctx) => ctx.db.get(admin.userId)))!;
    expect(after).toEqual({ ...before, ssoManaged: true });
  });

  test("a manager or kitchen staff number gets Admin added, keeps its properties, and is never downgraded", async () => {
    const { t, admin } = await setup();
    const south = await addProperty(t, admin, "South PG");
    for (const role of ["manager", "kitchen_staff"] as const) {
      const member = await createMember(t, admin, { role, propertyIds: [admin.propertyId, south] });
      const before = (await t.run((ctx) => ctx.db.get(member.userId)))!;
      expect((await ssoSignIn(t, await ticket({ phone: member.phone }))).tokens?.token).toBeTruthy();
      const after = (await t.run((ctx) => ctx.db.get(member.userId)))!;
      expect(after).toEqual({ ...before, role: "admin", roleBeforeSso: role, ssoManaged: true });
      // Their own password login still works.
      const result = await t.action(api.auth.signIn, { provider: "phone-password", params: { phone: member.phone, password: PASSWORD } });
      expect(result.tokens?.token).toBeTruthy();
      // Revoke gives back exactly the role they had.
      const response = await callRevoke(t, await revokeToken({ phone: member.phone }));
      expect(await response.json()).toEqual({ ok: true, sessionsEnded: 1, adminRemoved: true });
      const restored = (await t.run((ctx) => ctx.db.get(member.userId)))!;
      expect(restored.role).toBe(role);
      expect(restored.propertyIds).toEqual(before.propertyIds);
      expect(restored.roleBeforeSso).toBeUndefined();
    }
  });

  test("revoke keeps an Admin role that a Crate admin set after the hub sign-in", async () => {
    const { t, admin } = await setup();
    const member = await createMember(t, admin, { role: "manager" });
    await ssoSignIn(t, await ticket({ phone: member.phone }));
    await admin.as.mutation(api.accounts.update, { userId: member.userId, name: "Promoted", role: "admin", assignedPropertyIds: [] });
    const response = await callRevoke(t, await revokeToken({ phone: member.phone }));
    expect(await response.json()).toEqual({ ok: true, sessionsEnded: 1, adminRemoved: false });
    expect((await t.run((ctx) => ctx.db.get(member.userId)))?.role).toBe("admin");
  });

  test("a switched-off admin is refused and stays switched off", async () => {
    const { t, admin } = await setup();
    await t.run((ctx) => ctx.db.patch(admin.userId, { disabled: true }));
    expect(await errorCode(ssoSignIn(t, await ticket({ phone: admin.phone })))).toBe("SSO_LINK_EXPIRED");
    const user = (await t.run((ctx) => ctx.db.get(admin.userId)))!;
    expect(user.disabled).toBe(true);
    expect(user.ssoManaged).toBeUndefined();
  });

  test("expired, wrong-audience, wrong-issuer, tampered, wrong-role and foreign-key tickets are refused", async () => {
    const { t } = await setup();
    const now = Math.floor(Date.now() / 1000);
    const valid = await ticket();
    const [header, payload, signature] = valid.split(".");
    const forged = JSON.parse(atob(payload.replace(/-/g, "+").replace(/_/g, "/")));
    forged.phone = "+919800000000";
    const tamperedPayload = btoa(JSON.stringify(forged)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

    const bad: Record<string, string> = {
      expired: await ticket({ iat: now - 100, exp: now - 40 }),
      wrongAudience: await ticket({ aud: "staff" }),
      wrongIssuer: await ticket({ iss: "https://evil.example.test" }),
      tampered: `${header}.${tamperedPayload}.${signature}`,
      wrongRole: await ticket({ role: "admin" }),
      noRole: await ticket({ role: undefined }),
      foreignKey: await ticket({}, otherKey),
      noJti: await ticket({ jti: undefined }),
      empty: "",
      garbage: "not-a-ticket",
    };
    const usersBefore = await t.run((ctx) => ctx.db.query("users").collect());
    for (const [name, value] of Object.entries(bad)) {
      expect(await errorCode(ssoSignIn(t, value)), name).toBe("SSO_LINK_EXPIRED");
    }
    expect(await t.run((ctx) => ctx.db.query("users").collect())).toEqual(usersBefore);
  });

  test("a ticket only 20 seconds past its expiry is still accepted (clock allowance)", async () => {
    const { t } = await setup();
    const now = Math.floor(Date.now() / 1000);
    const result = await ssoSignIn(t, await ticket({ iat: now - 80, exp: now - 20 }));
    expect(result.tokens?.token).toBeTruthy();
  });

  test("a ticket can be used only once", async () => {
    const { t } = await setup();
    const value = await ticket();
    expect((await ssoSignIn(t, value)).tokens?.token).toBeTruthy();
    expect(await errorCode(ssoSignIn(t, value))).toBe("SSO_LINK_EXPIRED");
  });

  test("used tickets are forgotten after 10 minutes", async () => {
    const { t } = await setup();
    await t.run(async (ctx) => {
      await ctx.db.insert("ssoUsedTickets", { jti: "old", usedAt: Date.now() - 11 * 60_000 });
      await ctx.db.insert("ssoUsedTickets", { jti: "recent", usedAt: Date.now() - 60_000 });
    });
    await t.mutation(internal.sso.deleteOldTickets, {});
    const left = await t.run((ctx) => ctx.db.query("ssoUsedTickets").collect());
    expect(left.map((r) => r.jti)).toEqual(["recent"]);
  });

  test("without the hub's settings every ticket is refused", async () => {
    const { t } = await setup();
    const saved = process.env.HUB_SSO_PUBLIC_KEY;
    delete process.env.HUB_SSO_PUBLIC_KEY;
    try {
      expect(await errorCode(ssoSignIn(t, await ticket()))).toBe("SSO_LINK_EXPIRED");
    } finally {
      process.env.HUB_SSO_PUBLIC_KEY = saved;
    }
  });

  test("password sign-in for other accounts still works as before", async () => {
    const { t, admin } = await setup();
    const member = await createMember(t, admin);
    await ssoSignIn(t, await ticket());
    const result = await t.action(api.auth.signIn, {
      provider: "phone-password",
      params: { phone: member.phone, password: PASSWORD },
    });
    expect(result.tokens?.token).toBeTruthy();
  });
});

/** A "Revoke in all apps" token as the hub signs it. */
const revokeToken = (overrides: JWTPayload = {}, key: CryptoKey = hubKey) =>
  ticket({ aud: "crate-revoke", role: undefined, name: undefined, ...overrides }, key);

const callRevoke = (t: T, token?: string) =>
  t.fetch("/sso/revoke", { method: "POST", headers: token ? { Authorization: `Bearer ${token}` } : {} });

const hubSessions = async (t: T, phone: string) => {
  const user = (await userByPhone(t, phone))!;
  return (
    await t.run((ctx) => ctx.db.query("authSessions").withIndex("userId", (q) => q.eq("userId", user._id)).collect())
  ).filter((s) => Math.abs(s.expirationTime - s._creationTime - SSO_SESSION_MS) <= 60_000);
};

describe("Revoke in all apps (/sso/revoke)", () => {
  test("ends the hub login and removes the admin role the hub gave", async () => {
    const { t } = await setup();
    await ssoSignIn(t, await ticket());
    const [session] = await hubSessions(t, PHONE);
    const as = t.withIdentity({ subject: `${session.userId}|${session._id}` });
    expect((await as.query(api.users.me, {}))?.hubLink).toBe(HUB);

    const response = await callRevoke(t, await revokeToken());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, sessionsEnded: 1, adminRemoved: true });

    expect(await as.query(api.users.me, {})).toBeNull();
    const user = (await userByPhone(t, PHONE))!;
    expect(user.role).toBeUndefined();
    expect(user.ssoManaged).toBe(false);
    expect(await t.run((ctx) => ctx.db.query("authRefreshTokens").collect())).toHaveLength(0);
    const audit = (await t.run((ctx) => ctx.db.query("auditLog").collect())).map((a) => a.action);
    expect(audit).toContain("sso.access_revoked");

    // Reactivated in the hub later: signing in through the hub works again.
    expect((await ssoSignIn(t, await ticket())).tokens?.token).toBeTruthy();
    expect((await userByPhone(t, PHONE))?.role).toBe("admin");
  });

  test("an admin who had their own account keeps it and their password login", async () => {
    const { t, admin } = await setup();
    await ssoSignIn(t, await ticket({ phone: admin.phone }));
    const response = await callRevoke(t, await revokeToken({ phone: admin.phone }));
    expect(await response.json()).toEqual({ ok: true, sessionsEnded: 1, adminRemoved: false });
    expect(await hubSessions(t, admin.phone)).toHaveLength(0);
    const user = (await t.run((ctx) => ctx.db.get(admin.userId)))!;
    expect(user.role).toBe("admin");
    expect(await admin.as.query(api.users.me, {})).not.toBeNull();
  });

  test("accounts that never used the hub are not touched", async () => {
    const { t, admin } = await setup();
    const member = await createMember(t, admin);
    const before = await t.run((ctx) => ctx.db.query("users").collect());
    for (const phone of [admin.phone, member.phone]) {
      const response = await callRevoke(t, await revokeToken({ phone }));
      expect(await response.json()).toEqual({ ok: true, sessionsEnded: 0, adminRemoved: false });
    }
    expect(await t.run((ctx) => ctx.db.query("users").collect())).toEqual(before);
    expect((await admin.as.query(api.users.me, {}))?.hubLink).toBeNull();
    expect((await member.as.query(api.users.me, {}))?.hubLink).toBeNull();
  });

  test("unsigned, wrong-audience, foreign-key, expired and reused requests are refused and change nothing", async () => {
    const { t } = await setup();
    await ssoSignIn(t, await ticket());
    const now = Math.floor(Date.now() / 1000);
    const reused = await revokeToken();
    await callRevoke(t, reused);
    await ssoSignIn(t, await ticket());

    const snapshot = () =>
      t.run(async (ctx) => ({
        sessions: await ctx.db.query("authSessions").collect(),
        users: await ctx.db.query("users").collect(),
      }));
    const before = await snapshot();
    const bad: Record<string, string | undefined> = {
      none: undefined,
      signInTicket: await ticket(),
      otherApp: await revokeToken({ aud: "staff-revoke" }),
      wrongIssuer: await revokeToken({ iss: "https://evil.example.test" }),
      foreignKey: await revokeToken({}, otherKey),
      expired: await revokeToken({ iat: now - 100, exp: now - 40 }),
      reused,
    };
    for (const [name, token] of Object.entries(bad)) {
      const response = await callRevoke(t, token);
      expect(response.status, name).toBe(401);
      expect(await response.json(), name).toEqual({ ok: false });
    }
    expect(await snapshot()).toEqual(before);
  });
});

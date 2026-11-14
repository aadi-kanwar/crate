import { exportSPKI, generateKeyPair, SignJWT, type CryptoKey, type JWTPayload } from "jose";
import { afterEach, beforeAll, describe, expect, test } from "vitest";
import { api } from "../_generated/api";
import { PASSWORD, createAdmin, createMember, errorCode, setupTest, type T } from "./harness.test-utils";

/** The Livoza Hub for everyone: tickets for any profile type, sync, export, hub-only sign-in. */

const HUB = "https://hub.example.test";
let hubKey: CryptoKey;

beforeAll(async () => {
  const hub = await generateKeyPair("EdDSA", { extractable: true });
  hubKey = hub.privateKey;
  process.env.HUB_SSO_PUBLIC_KEY = (await exportSPKI(hub.publicKey)).trim().replace(/\n/g, "\\n");
  process.env.HUB_ORIGIN = HUB;
});

afterEach(() => {
  delete process.env.HUB_ONLY;
});

let counter = 0;
async function sign(claims: JWTPayload, audience: string, sub: string) {
  const now = Math.floor(Date.now() / 1000);
  counter += 1;
  return await new SignJWT({ ...claims, iss: HUB, aud: audience, sub, jti: `j-${counter}`, iat: now, exp: now + 60 })
    .setProtectedHeader({ alg: "EdDSA" })
    .sign(hubKey);
}

const person = (overrides: JWTPayload = {}) => ({
  phone: "+919844444444",
  name: "Wanda Warden",
  profileType: "warden",
  role: "manager",
  properties: [{ id: "hubP1", name: "Main PG" }],
  ...overrides,
});

const ssoSignIn = async (t: T, claims: JWTPayload, sub = "hubW") =>
  t.action(api.auth.signIn, { provider: "hub-sso", params: { ticket: await sign(claims, "crate", sub) } });

async function postSync(t: T, claims: JWTPayload, sub: string) {
  const token = await sign(claims, "crate-sync", sub);
  return await t.fetch("/sso/sync", { method: "POST", headers: { Authorization: `Bearer ${token}` } });
}

const userByPhone = (t: T, phone: string) =>
  t.run(async (ctx) => ctx.db.query("users").withIndex("phone", (q) => q.eq("phone", phone)).first());

describe("wardens from the hub", () => {
  test("a ticket makes a manager of exactly the hub's properties", async () => {
    const t = await setupTest();
    const admin = await createAdmin(t);
    expect((await ssoSignIn(t, person())).tokens?.token).toBeTruthy();
    expect(await userByPhone(t, "+919844444444")).toMatchObject({
      role: "manager",
      propertyIds: [admin.propertyId],
      organizationId: admin.organizationId,
      hubUserId: "hubW",
    });
  });

  test("kitchen staff synced from the hub become managers; switched off ends their logins", async () => {
    const t = await setupTest();
    const admin = await createAdmin(t);
    const member = await createMember(t, admin, { role: "kitchen_staff" });
    await postSync(t, { kind: "person", ...person({ phone: member.phone }), active: true, revoke: false }, "hubK");
    expect(await userByPhone(t, member.phone)).toMatchObject({ role: "manager", hubUserId: "hubK" });
    await postSync(t, { kind: "person", ...person({ phone: member.phone }), active: false, revoke: true }, "hubK");
    expect((await userByPhone(t, member.phone))?.disabled).toBe(true);
    expect(
      await t.run((ctx) => ctx.db.query("authSessions").withIndex("userId", (q) => q.eq("userId", member.userId)).collect()),
    ).toEqual([]);
  });

  test("residents and staff get no Crate role", async () => {
    const t = await setupTest();
    await createAdmin(t);
    expect(await errorCode(ssoSignIn(t, person({ profileType: "resident", role: "resident" })))).toBe("SSO_LINK_EXPIRED");
  });
});

test("a new property from the hub is added to the organisation", async () => {
  const t = await setupTest();
  const admin = await createAdmin(t);
  const response = await postSync(
    t,
    { kind: "property", property: { id: "hubP7", name: "North PG", organizationName: "Livoza", active: true } },
    "hubP7",
  );
  expect(response.status).toBe(200);
  const properties = await t.run((ctx) => ctx.db.query("properties").collect());
  expect(properties.find((p) => p.hubPropertyId === "hubP7")).toMatchObject({ name: "North PG", organizationId: admin.organizationId });
});

test("export lists admins and members as hub types", async () => {
  const t = await setupTest();
  const admin = await createAdmin(t);
  const member = await createMember(t, admin, { role: "kitchen_staff" });
  const token = await sign({}, "crate-export", "import");
  const body = await (await t.fetch("/sso/export", { method: "POST", headers: { Authorization: `Bearer ${token}` } })).json();
  expect(body.people).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ phone: admin.phone, hubType: "admin", toolPropertyIds: [] }),
      expect.objectContaining({ phone: member.phone, hubType: "warden", toolPropertyIds: [admin.propertyId] }),
    ]),
  );
  expect((await t.fetch("/sso/export", { method: "POST" })).status).toBe(401);
});

test("with HUB_ONLY, Crate's own sign-in sends people to the hub", async () => {
  const t = await setupTest();
  process.env.HUB_ONLY = "true";
  expect(
    await errorCode(t.action(api.auth.signIn, { provider: "phone-password", params: { phone: "+919844444444", password: PASSWORD } })),
  ).toBe("USE_HUB");
  expect(await t.query(api.sso.hubSettings, {})).toEqual({ hubOnly: true, openUrl: `${HUB}/open/crate` });
});

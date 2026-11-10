/// <reference types="vite/client" />
// Shared helpers for backend tests. The double extension keeps Convex from
// deploying this file as a backend module.
import { convexTest } from "convex-test";
import { exportJWK, exportPKCS8, generateKeyPair } from "jose";
import { vi } from "vitest";
import { api } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import schema from "../schema";

export const modules = import.meta.glob("../**/*.ts");

/** Keys Convex Auth needs to issue login tokens inside tests. */
async function configureAuthEnv() {
  if (process.env.JWT_PRIVATE_KEY) return;
  const { privateKey, publicKey } = await generateKeyPair("RS256", {
    extractable: true,
  });
  process.env.JWT_PRIVATE_KEY = (await exportPKCS8(privateKey))
    .trimEnd()
    .replace(/\n/g, " ");
  process.env.JWKS = JSON.stringify({
    keys: [{ use: "sig", ...(await exportJWK(publicKey)) }],
  });
  process.env.CONVEX_SITE_URL = "https://test.convex.site";
  process.env.SITE_URL = "http://localhost:3000";
}

/** Fixes "now" (only Date; timers keep working). Noon IST on `date`. */
export function setToday(date: string) {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(`${date}T06:30:00Z`));
}

export async function setupTest(today = "2027-04-20") {
  await configureAuthEnv();
  setToday(today);
  return convexTest(schema, modules);
}

export type T = Awaited<ReturnType<typeof setupTest>>;

let phoneCounter = 0;
export function nextPhone() {
  phoneCounter += 1;
  return `+9198${String(phoneCounter).padStart(8, "0")}`;
}

/** A client signed in as `userId` (a fresh session). */
export async function signedInAs(t: T, userId: Id<"users">) {
  const sessionId = await t.run(async (ctx) =>
    ctx.db.insert("authSessions", {
      userId,
      expirationTime: Date.now() + 3_600_000,
    }),
  );
  return t.withIdentity({ subject: `${userId}|${sessionId}` });
}

/** An admin who has set up their organisation (through the real mutation) with one property. */
export async function createAdmin(
  t: T,
  name = "Test Admin",
  organizationName = "Test Organisation",
) {
  const phone = nextPhone();
  const userId = await t.run(async (ctx) =>
    ctx.db.insert("users", { phone, role: "admin", name }),
  );
  const as = await signedInAs(t, userId);
  const { organizationId, propertyId } = await as.mutation(
    api.organization.create,
    {
      name: organizationName,
      propertyName: "Main PG",
    },
  );
  return { userId, phone, as, organizationId, propertyId };
}

export type Admin = Awaited<ReturnType<typeof createAdmin>>;

export const PASSWORD = "plain-tea-42";

/**
 * A manager or kitchen staff account created through the real admin action,
 * already past the first-login password change.
 */
export async function createMember(
  t: T,
  admin: Admin,
  details: Partial<{
    role: "manager" | "kitchen_staff";
    propertyIds: Id<"properties">[];
    name: string;
  }> = {},
) {
  const phone = nextPhone();
  const { userId } = await admin.as.action(api.accounts.create, {
    name: details.name ?? "Test Member",
    phone,
    role: details.role ?? "kitchen_staff",
    assignedPropertyIds: details.propertyIds ?? [admin.propertyId],
    temporaryPassword: PASSWORD,
  });
  await t.run((ctx) => ctx.db.patch(userId, { mustChangePassword: false }));
  return { userId, phone, as: await signedInAs(t, userId) };
}

export type Member = Awaited<ReturnType<typeof createMember>>;

/** Adds another property to the admin's organisation. */
export async function addProperty(t: T, admin: Admin, name: string) {
  return await admin.as.mutation(api.organization.addProperty, { name });
}

/** The ConvexError code thrown by `promise`, or "NO_ERROR". */
export async function errorCode(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
    return "NO_ERROR";
  } catch (error) {
    const data = (error as { data?: unknown }).data;
    if (data && typeof data === "object" && "code" in data)
      return String(data.code);
    return `UNEXPECTED: ${(error as Error).message}`;
  }
}

/** The organisation's first category (Grocery). */
export async function firstCategory(t: T, admin: Admin) {
  return await t.run(async (ctx) =>
    (await ctx.db
      .query("categories")
      .withIndex("by_org_order", (q) => q.eq("organizationId", admin.organizationId))
      .first())!._id,
  );
}

/** A verified item, added by the admin. */
export async function createItem(
  t: T,
  admin: Admin,
  details: Partial<{
    name: string;
    baseUnit: "kg" | "litre" | "piece" | "dozen" | "cylinder";
    aliases: string[];
    packSizes: { label: string; quantity: number }[];
    variants: string[];
  }> = {},
) {
  return await admin.as.mutation(api.catalog.createItem, {
    name: details.name ?? "Tomato",
    categoryId: await firstCategory(t, admin),
    baseUnit: details.baseUnit ?? "kg",
    aliases: details.aliases ?? [],
    packSizes: details.packSizes ?? [],
    variants: details.variants ?? [],
  });
}

/** A verified shop, added by the admin. */
export async function createShop(t: T, admin: Admin, name = "Sharma Kirana") {
  return await admin.as.mutation(api.catalog.createShop, { name, type: "kirana" });
}

/** Moves "now" forward by `ms` (fake timers). */
export function advance(ms: number) {
  vi.setSystemTime(new Date(Date.now() + ms));
}

export const HOUR = 60 * 60 * 1000;

import { importSPKI, jwtVerify, type JWTPayload } from "jose";
import { normalizePhone } from "./inputRules";

/**
 * Admin Hub single sign-on: checking a ticket.
 *
 * The hub (only master admins use it) signs a one-time ticket that lives 60
 * seconds. Its signature is checked here with the hub's PUBLIC key, from the
 * `HUB_SSO_PUBLIC_KEY` environment variable on this Convex deployment; the
 * hub's address is `HUB_ORIGIN`. No secret is stored in this app.
 */

/** This app's id in the hub's tools.config.ts; tickets must be addressed to it. */
export const SSO_APP_ID = "crate";
/** Allowance for clocks that disagree a little (seconds). */
export const SSO_CLOCK_TOLERANCE_SECONDS = 30;
/** Tickets are issued with 60 seconds to live; refuse any claiming to be older than this. */
const SSO_MAX_TICKET_AGE_SECONDS = 120;
/** A login made through the hub lasts at most this long; then the admin goes back through the hub. */
export const SSO_SESSION_MS = 12 * 60 * 60 * 1000;
/** Used-ticket records are deleted after this long. */
export const SSO_USED_TICKET_RETENTION_MS = 10 * 60 * 1000;

export type HubTicket = {
  jti: string;
  hubAdminId: string;
  phone: string; // E.164
  name: string;
};

/** What the hub's "Revoke in all apps" request carries. */
export type HubRevoke = {
  jti: string;
  phone: string; // E.164: the master admin whose access is removed
};

export type HubTicketSettings = {
  publicKey: string | undefined;
  hubOrigin: string | undefined;
};

export function hubTicketSettingsFromEnv(): HubTicketSettings {
  return { publicKey: process.env.HUB_SSO_PUBLIC_KEY, hubOrigin: process.env.HUB_ORIGIN };
}

/** The checked claims of a JWT the hub signed for `audience`, or null for any problem. */
async function verifyHubJwt(
  token: string,
  settings: HubTicketSettings,
  audience: string,
  options: { phone: boolean } = { phone: true },
) {
  const { publicKey, hubOrigin } = settings;
  if (!publicKey || !hubOrigin || token.length === 0 || token.length > 4096) return null;
  try {
    // The key may be stored on one line with "\n" written out; turn those back into line breaks.
    const key = await importSPKI(publicKey.replace(/\\n/g, "\n").trim(), "EdDSA");
    const { payload } = await jwtVerify(token, key, {
      algorithms: ["EdDSA"],
      issuer: hubOrigin,
      audience,
      clockTolerance: SSO_CLOCK_TOLERANCE_SECONDS,
      maxTokenAge: SSO_MAX_TICKET_AGE_SECONDS,
      requiredClaims: ["iss", "aud", "sub", "jti", "iat", "exp"],
    });
    const { jti, sub } = payload;
    if (typeof jti !== "string" || jti.length === 0 || jti.length > 200) return null;
    if (typeof sub !== "string" || sub.length === 0) return null;
    const phone =
      typeof payload.phone === "string" ? normalizePhone(payload.phone) : null;
    if (options.phone && phone === null) return null;
    return { payload, jti, sub, phone: phone ?? "" };
    
  } catch {
    return null;
  }
}

/**
 * The ticket's details if it is genuine, addressed to this app, unexpired and
 * for a master admin; otherwise null. Callers must never tell the browser why
 * a ticket was refused.
 */
export async function verifyHubTicket(ticket: string, settings: HubTicketSettings): Promise<HubTicket | null> {
  const checked = await verifyHubJwt(ticket, settings, SSO_APP_ID);
  if (checked === null || checked.payload.role !== "master_admin") return null;
  const name = typeof checked.payload.name === "string" ? checked.payload.name.trim().slice(0, 80) : "";
  return { jti: checked.jti, hubAdminId: checked.sub, phone: checked.phone, name: name.length > 0 ? name : "Admin" };
}

/** A genuine, unexpired "Revoke in all apps" request for this app (audience "<app>-revoke"), or null. */
export async function verifyHubRevoke(token: string, settings: HubTicketSettings): Promise<HubRevoke | null> {
  const checked = await verifyHubJwt(token, settings, `${SSO_APP_ID}-revoke`);
  return checked === null ? null : { jti: checked.jti, phone: checked.phone };
}

// ---------------------------------------------------------------------------
// Livoza Hub for everyone: tickets for every profile type, sync and export.
// ---------------------------------------------------------------------------

export type HubProfileType = "admin" | "warden" | "staff" | "resident";
const PROFILE_TYPES: readonly HubProfileType[] = ["admin", "warden", "staff", "resident"];

/** A hub property as tickets and sync carry it (the hub's own id). */
export type HubPropertyRef = { id: string; name: string };

/**
 * Who a person is in the hub and what this app should give them. The hub
 * decides the role from its tools.config.ts; null means no access here.
 * properties: "all" for master admins, else the hub properties they belong to.
 */
export type HubPerson = {
  hubUserId: string;
  phone: string; // E.164
  name: string;
  profileType: HubProfileType;
  role: string | null;
  properties: "all" | HubPropertyRef[];
  roomNumber: string | null;
};

/** A ticket from the hub for everyone (not the older master-admin-only kind). */
export type HubPersonTicket = HubPerson & { jti: string };

export type HubSync =
  | (HubPerson & { kind: "person"; jti: string; active: boolean; revoke: boolean })
  | {
      kind: "property";
      jti: string;
      property: HubPropertyRef & { organizationName: string; active: boolean };
      /** This app's own property row the import matched it to, if any. */
      toolPropertyId: string | null;
    };

const text = (value: unknown, max: number) => (typeof value === "string" ? value.trim().slice(0, max) : "");

function readProperties(value: unknown): "all" | HubPropertyRef[] | null {
  if (value === "*") return "all";
  if (!Array.isArray(value) || value.length > 200) return null;
  const refs: HubPropertyRef[] = [];
  for (const item of value) {
    if (typeof item !== "object" || item === null) return null;
    const id = text((item as { id?: unknown }).id, 64);
    const name = text((item as { name?: unknown }).name, 80);
    if (id.length === 0) return null;
    refs.push({ id, name });
  }
  return refs;
}

function readPerson(payload: JWTPayload, sub: string, phone: string): HubPerson | null {
  const profileType = payload.profileType as HubProfileType;
  if (!PROFILE_TYPES.includes(profileType)) return null;
  const role = payload.role === null ? null : text(payload.role, 40);
  if (role === "") return null;
  const properties = readProperties(payload.properties);
  if (properties === null) return null;
  const name = text(payload.name, 80);
  const room = text(payload.roomNumber, 20);
  return {
    hubUserId: sub,
    phone,
    name: name.length > 0 ? name : "Hub user",
    profileType,
    role,
    properties,
    roomNumber: room.length > 0 ? room : null,
  };
}

/** A genuine ticket for any profile type, or null. Callers must never say why a ticket was refused. */
export async function verifyHubPersonTicket(ticket: string, settings: HubTicketSettings): Promise<HubPersonTicket | null> {
  const checked = await verifyHubJwt(ticket, settings, SSO_APP_ID);
  if (checked === null || checked.payload.role === "master_admin") return null;
  const person = readPerson(checked.payload, checked.sub, checked.phone);
  if (person === null || person.role === null) return null;
  return { ...person, jti: checked.jti };
}

/** A genuine sync request (audience "<app>-sync"), or null. */
export async function verifyHubSync(token: string, settings: HubTicketSettings): Promise<HubSync | null> {
  const checked = await verifyHubJwt(token, settings, `${SSO_APP_ID}-sync`, { phone: false });
  if (checked === null) return null;
  const { payload, jti, sub } = checked;
  if (payload.kind === "property") {
    const property = payload.property as Record<string, unknown> | undefined;
    const id = text(property?.id, 64);
    const name = text(property?.name, 80);
    if (id.length === 0 || name.length === 0 || id !== sub) return null;
    const toolPropertyId = text(payload.toolPropertyId, 64);
    return {
      kind: "property",
      jti,
      property: { id, name, organizationName: text(property?.organizationName, 80), active: property?.active !== false },
      toolPropertyId: toolPropertyId.length > 0 ? toolPropertyId : null,
    };
  }
  if (payload.kind !== "person") return null;
  const phone = typeof payload.phone === "string" ? normalizePhone(payload.phone) : null;
  if (phone === null) return null;
  const person = readPerson(payload, sub, phone);
  if (person === null) return null;
  return { ...person, kind: "person", jti, active: payload.active === true, revoke: payload.revoke === true };
}

/** A genuine export request (audience "<app>-export") from the hub's import, or null. */
export async function verifyHubExport(token: string, settings: HubTicketSettings): Promise<{ jti: string } | null> {
  const checked = await verifyHubJwt(token, settings, `${SSO_APP_ID}-export`, { phone: false });
  return checked === null ? null : { jti: checked.jti };
}

/** The bearer token of a request from the hub ("" if none). */
export function bearerToken(request: Request): string {
  const header = request.headers.get("Authorization") ?? "";
  return header.startsWith("Bearer ") ? header.slice("Bearer ".length).trim() : "";
}

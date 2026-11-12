import { importSPKI, jwtVerify } from "jose";
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
async function verifyHubJwt(token: string, settings: HubTicketSettings, audience: string) {
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
    const phone = typeof payload.phone === "string" ? normalizePhone(payload.phone) : null;
    if (phone === null) return null;
    return { payload, jti, sub, phone };
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

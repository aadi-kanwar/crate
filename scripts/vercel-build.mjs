// The build Vercel runs (`npm run vercel-build`), as in the Staff app. With
// CONVEX_DEPLOY_KEY set (the production deploy key, in Vercel's project
// settings) it also makes sure the Convex deployment is ready, so going live
// needs no manual setup:
//   1. login signing keys (JWT_PRIVATE_KEY, JWKS): created once if missing
//   2. SITE_URL: kept equal to the site's production address
//   3. the backend code is deployed and the website is built against it
//   4. the first admin: created from SEED_ADMIN_PHONE / SEED_ADMIN_PASSWORD /
//      SEED_ADMIN_NAME (set on the Convex deployment) if there's no admin yet
// Without the key (e.g. preview builds) it builds the website only.
// Secret values are never printed.
import { execFileSync } from "node:child_process";
import { exportJWK, exportPKCS8, generateKeyPair } from "jose";

const quiet = (args) =>
  execFileSync("npx", args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
const loud = (args) => execFileSync("npx", args, { stdio: "inherit" });
const envGet = (name) => quiet(["convex", "env", "get", name]).trim();
const envSet = (name, value) =>
  quiet(["convex", "env", "set", name, "--", value]);

if (!process.env.CONVEX_DEPLOY_KEY) {
  console.log("No CONVEX_DEPLOY_KEY: building the website only.");
  loud(["next", "build"]);
  process.exit(0);
}

if (envGet("JWT_PRIVATE_KEY") === "" || envGet("JWKS") === "") {
  const { privateKey, publicKey } = await generateKeyPair("RS256", {
    extractable: true,
  });
  envSet(
    "JWT_PRIVATE_KEY",
    (await exportPKCS8(privateKey)).trimEnd().replace(/\n/g, " "),
  );
  envSet(
    "JWKS",
    JSON.stringify({ keys: [{ use: "sig", ...(await exportJWK(publicKey)) }] }),
  );
  console.log("Created the login signing keys on the Convex deployment.");
}

const host = process.env.VERCEL_PROJECT_PRODUCTION_URL;
if (host && envGet("SITE_URL") !== `https://${host}`) {
  envSet("SITE_URL", `https://${host}`);
  console.log(`Set SITE_URL to https://${host}.`);
}

loud(["convex", "deploy", "--cmd", "npm run build"]);

const adminExists =
  quiet(["convex", "run", "setup:adminExists"]).trim() === "true";
if (adminExists) {
  console.log("An admin exists.");
} else if (
  envGet("SEED_ADMIN_PHONE") !== "" &&
  envGet("SEED_ADMIN_PASSWORD") !== ""
) {
  console.log(quiet(["convex", "run", "setup:createFirstAdmin"]).trim());
  console.log(
    "Remove SEED_ADMIN_PASSWORD from the Convex deployment now that the admin exists.",
  );
} else {
  console.log(
    "No admin yet: set SEED_ADMIN_PHONE, SEED_ADMIN_PASSWORD and SEED_ADMIN_NAME on the Convex deployment and deploy again.",
  );
}

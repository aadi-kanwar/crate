// Runs before `npm run dev`: if a package listed in package.json isn't
// installed yet (for example after pulling new code), installs it first,
// instead of the app failing with "Module not found".
import { execSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";

const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
const missing = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies }).filter(
  (name) => !existsSync(new URL(`../node_modules/${name}/package.json`, import.meta.url)),
);
if (missing.length > 0) {
  console.log(`Installing packages that aren't installed yet: ${missing.join(", ")}`);
  execSync("npm install", { stdio: "inherit" });
}

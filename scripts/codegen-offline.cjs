// Regenerates convex/_generated/ WITHOUT contacting a Convex deployment,
// using the same templates `npx convex dev` uses. Normally `npx convex dev`
// keeps these files up to date; this script exists for offline work and CI.
// Usage: npm run codegen:offline
const fs = require("fs");
const path = require("path");
const prettier = require("prettier");

const root = path.join(__dirname, "..");
const functionsDir = path.join(root, "convex");
const outDir = path.join(functionsDir, "_generated");
const templates = path.join(root, "node_modules/convex/dist/cjs/cli/codegen_templates");
const { apiCodegen } = require(path.join(templates, "api.js"));
const { serverCodegen } = require(path.join(templates, "server.js"));
const { compareModulePaths, header } = require(path.join(templates, "common.js"));

// Copy of the Convex CLI's dynamic data-model template (its module pulls in
// CLI-only dependencies, so it can't be required directly).
const dataModelDTS = `
${header("Generated data model types.")}
import type { DataModelFromSchemaDefinition, DocumentByName, TableNamesInDataModel, SystemTableNames } from "convex/server";
import type { GenericId } from "convex/values";
import schema from "../schema.js";

/** The names of all of your Convex tables. */
export type TableNames = TableNamesInDataModel<DataModel>;

/** The type of a document stored in Convex. */
export type Doc<TableName extends TableNames> = DocumentByName<DataModel, TableName>;

/** An identifier for a document in Convex. */
export type Id<TableName extends TableNames | SystemTableNames> = GenericId<TableName>;

/** A type describing your Convex data model. */
export type DataModel = DataModelFromSchemaDefinition<typeof schema>;
`;

// Same rules as the Convex bundler's entryPoints().
function entryPoints(dir, rel = "") {
  const out = [];
  for (const entry of fs.readdirSync(path.join(dir, rel), { withFileTypes: true })) {
    const relPath = path.join(rel, entry.name);
    const base = entry.name;
    if (entry.isDirectory()) {
      if (relPath === "_generated" || relPath.startsWith("_deps")) continue;
      out.push(...entryPoints(dir, relPath));
      continue;
    }
    if (![".js", ".cjs", ".mjs", ".jsx", ".ts", ".tsx"].some((ext) => base.endsWith(ext))) continue;
    if (base.endsWith(".d.ts")) continue;
    if (base.startsWith(".") || base.startsWith("#")) continue;
    if (base === "schema.ts" || base === "schema.js") continue;
    if ((base.match(/\./g) || []).length > 1) continue;
    if (relPath.includes(" ")) continue;
    out.push(relPath.split(path.sep).join("/"));
  }
  return out;
}

async function write(name, contents) {
  const formatted = await prettier.format(contents, { parser: "typescript" });
  fs.writeFileSync(path.join(outDir, name), formatted);
}

(async () => {
  fs.mkdirSync(outDir, { recursive: true });
  const modulePaths = entryPoints(functionsDir).sort(compareModulePaths);
  const api = apiCodegen(modulePaths, { useTypeScript: false });
  const server = serverCodegen({ useTypeScript: false, envVars: undefined });
  await write("api.js", api.JS);
  await write("api.d.ts", api.DTS);
  await write("server.js", server.JS);
  await write("server.d.ts", server.DTS);
  await write("dataModel.d.ts", dataModelDTS);
  console.log(`Generated convex/_generated for ${modulePaths.length} modules: ${modulePaths.join(", ")}`);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});

import { expect, test } from "vitest";
import { guardedDb } from "../lib/functions";
import { createAdmin, setupTest } from "./harness.test-utils";

test("audit log entries can be added but never edited or deleted", async () => {
  const t = await setupTest();
  await createAdmin(t);
  await t.run(async (ctx) => {
    const db = guardedDb(ctx);
    const auditId = (await ctx.db.query("auditLog").first())!._id;
    await expect(db.patch(auditId, { action: "tampered" })).rejects.toThrow();
    await expect(db.delete(auditId)).rejects.toThrow();
    expect((await ctx.db.get(auditId))?.action).not.toBe("tampered");
  });
});

import { describe, expect, test } from "vitest";
import { api, internal } from "../_generated/api";
import { FAILED_ATTEMPTS_LIMIT } from "../authLimits";
import {
  PASSWORD,
  createAdmin,
  errorCode,
  nextPhone,
  setupTest,
  createMember,
  signedInAs,
  type T,
} from "./harness.test-utils";

const signIn = (
  t: T,
  phone: string,
  password: string,
  extra: Record<string, string> = {},
) =>
  t.action(api.auth.signIn, {
    provider: "phone-password",
    params: { phone, password, ...extra },
  });

describe("first admin", () => {
  test("is created once from the CLI and can sign in with a normalised number", async () => {
    const t = await setupTest();
    await t.action(internal.setup.createFirstAdmin, {
      phone: "98765 43210",
      password: PASSWORD,
      name: "Owner",
    });
    const users = await t.run((ctx) => ctx.db.query("users").collect());
    expect(users.map((u) => [u.phone, u.role, u.name])).toEqual([
      ["+919876543210", "admin", "Owner"],
    ]);
    for (const written of ["9876543210", "+91 98765-43210", "09876543210"]) {
      expect(
        (await signIn(t, written, PASSWORD)).tokens?.token,
        written,
      ).toBeTruthy();
    }
    expect(
      await errorCode(
        t.action(internal.setup.createFirstAdmin, {
          phone: "9123456780",
          password: PASSWORD,
          name: "Other",
        }),
      ),
    ).toBe("CONFLICT");
  });

  test("can come from environment variables", async () => {
    const t = await setupTest();
    process.env.SEED_ADMIN_PHONE = "9876500000";
    process.env.SEED_ADMIN_PASSWORD = PASSWORD;
    process.env.SEED_ADMIN_NAME = "Env Owner";
    try {
      await t.action(internal.setup.createFirstAdmin, {});
    } finally {
      delete process.env.SEED_ADMIN_PHONE;
      delete process.env.SEED_ADMIN_PASSWORD;
      delete process.env.SEED_ADMIN_NAME;
    }
    const admin = await t.run((ctx) => ctx.db.query("users").first());
    expect(admin?.phone).toBe("+919876500000");
    expect(admin?.role).toBe("admin");
  });
});

describe("sign-in", () => {
  test("there is no self sign-up", async () => {
    const t = await setupTest();
    expect(
      await errorCode(signIn(t, "9876543210", PASSWORD, { flow: "signUp" })),
    ).toBe("FORBIDDEN");
    expect(await t.run((ctx) => ctx.db.query("users").collect())).toHaveLength(
      0,
    );
  });

  test("wrong password and unknown number give the same error", async () => {
    const t = await setupTest();
    await t.action(internal.setup.createFirstAdmin, {
      phone: "9876543210",
      password: PASSWORD,
      name: "Owner",
    });
    expect(await errorCode(signIn(t, "9876543210", "wrong-password"))).toBe(
      "SIGN_IN_FAILED",
    );
    expect(await errorCode(signIn(t, "9123456780", PASSWORD))).toBe(
      "SIGN_IN_FAILED",
    );
  });

  test("too many failed attempts lock the number for a while", async () => {
    const t = await setupTest();
    for (let i = 0; i < FAILED_ATTEMPTS_LIMIT; i += 1)
      await errorCode(signIn(t, "9123456780", "nope-nope-1"));
    expect(await errorCode(signIn(t, "9123456780", PASSWORD))).toBe(
      "TOO_MANY_ATTEMPTS",
    );
  });
});

describe("accounts made by an admin", () => {
  test("must change the temporary password at first login", async () => {
    const t = await setupTest();
    const admin = await createAdmin(t);
    const phone = nextPhone();
    const { userId } = await admin.as.action(api.accounts.create, {
      name: "Ravi Kumar",
      phone,
      role: "kitchen_staff",
      assignedPropertyIds: [admin.propertyId],
      temporaryPassword: PASSWORD,
    });
    expect((await signIn(t, phone, PASSWORD)).tokens?.token).toBeTruthy();
    const member = await signedInAs(t, userId);
    const before = await member.query(api.users.me, {});
    expect(before?.mustChangePassword).toBe(true);
    expect(before?.role).toBe("kitchen_staff");
    await member.action(api.users.changePassword, {
      newPassword: "my-own-secret-9",
    });
    const after = await member.query(api.users.me, {});
    expect(after?.mustChangePassword).toBe(false);
    expect(after?.organization?.properties.map((p) => p.propertyId)).toEqual([
      admin.propertyId,
    ]);
    expect(
      (await signIn(t, phone, "my-own-secret-9")).tokens?.token,
    ).toBeTruthy();
    expect(await errorCode(signIn(t, phone, PASSWORD))).toBe("SIGN_IN_FAILED");
  });

  test("the same number can't be added twice", async () => {
    const t = await setupTest();
    const admin = await createAdmin(t);
    const args = {
      name: "Ravi Kumar",
      phone: "9876543210",
      role: "manager" as const,
      assignedPropertyIds: [admin.propertyId],
      temporaryPassword: PASSWORD,
    };
    await admin.as.action(api.accounts.create, args);
    expect(
      await errorCode(
        admin.as.action(api.accounts.create, { ...args, name: "Someone Else" }),
      ),
    ).toBe("CONFLICT");
    expect(
      await errorCode(
        admin.as.action(api.accounts.create, { ...args, phone: admin.phone }),
      ),
    ).toBe("CONFLICT");
  });

  test("password reset gives a temporary password and signs the person out", async () => {
    const t = await setupTest();
    const admin = await createAdmin(t);
    const member = await createMember(t, admin);
    const { temporaryPassword } = await admin.as.action(
      api.accounts.resetPassword,
      { userId: member.userId },
    );
    expect(temporaryPassword).toMatch(/^[a-z2-9]{4}-[a-z2-9]{4}$/);
    expect(
      (await signIn(t, member.phone, temporaryPassword)).tokens?.token,
    ).toBeTruthy();
    expect(await errorCode(signIn(t, member.phone, PASSWORD))).toBe(
      "SIGN_IN_FAILED",
    );
    const audit = await t.run((ctx) => ctx.db.query("auditLog").collect());
    expect(audit.map((a) => a.action)).toContain("account.password_reset");
    expect(JSON.stringify(audit)).not.toContain(temporaryPassword);
    expect(JSON.stringify(audit)).not.toContain(PASSWORD);
  });

  test("a switched-off account can't sign in and is signed out at once", async () => {
    const t = await setupTest();
    const admin = await createAdmin(t);
    const member = await createMember(t, admin);
    expect(await member.as.query(api.users.me, {})).not.toBeNull();
    await admin.as.mutation(api.accounts.setDisabled, {
      userId: member.userId,
      disabled: true,
    });
    expect(await member.as.query(api.users.me, {})).toBeNull();
    expect(await errorCode(signIn(t, member.phone, PASSWORD))).toBe(
      "SIGN_IN_FAILED",
    );
    await admin.as.mutation(api.accounts.setDisabled, {
      userId: member.userId,
      disabled: false,
    });
    expect((await signIn(t, member.phone, PASSWORD)).tokens?.token).toBeTruthy();
  });
});

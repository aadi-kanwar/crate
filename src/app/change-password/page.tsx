"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useAction } from "convex/react";
import { KeyRound } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { api } from "@convex/_generated/api";
import { PASSWORD_MIN_LENGTH, passwordProblem } from "@convex/lib/inputRules";
import { MemberShell } from "@/components/app/member-shell";
import { destinationFor, useMe } from "@/components/app/session";
import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { Card, CardBody } from "@/components/ui/card";
import { Field } from "@/components/ui/field";
import { Icon } from "@/components/ui/icon";
import { PasswordInput } from "@/components/ui/password-input";
import { LoadingState } from "@/components/ui/skeleton";
import { toast } from "@/components/ui/toaster";
import { friendlyError } from "@/lib/errors";

function buildSchema(needsCurrent: boolean, phone: string | null) {
  return z
    .object({ current: z.string(), password: z.string(), confirm: z.string() })
    .superRefine((v, ctx) => {
      if (needsCurrent && v.current.length === 0) {
        ctx.addIssue({ code: "custom", path: ["current"], message: "Enter your current password." });
      }
      const problem = passwordProblem(v.password, phone);
      if (problem) ctx.addIssue({ code: "custom", path: ["password"], message: problem });
      if (v.confirm !== v.password) {
        ctx.addIssue({ code: "custom", path: ["confirm"], message: "The two passwords don't match." });
      }
    });
}

/**
 * Choose a new password. Right after the office creates the account or resets it, this screen is
 * shown first and the current (temporary) password isn't asked again.
 */
export default function ChangePasswordPage() {
  const me = useMe();
  const router = useRouter();
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    if (me === null) router.replace("/signin");
    // Move on once the account shows the new password is chosen; going
    // earlier would bring them straight back to this screen.
    else if (saved && me && !me.mustChangePassword) router.replace(destinationFor(me));
  }, [me, router, saved]);
  if (me === undefined || me === null || saved) {
    return (
      <MemberShell>
        <LoadingState rows={2} />
      </MemberShell>
    );
  }
  return (
    <MemberShell>
      <ChangePasswordForm forced={me.mustChangePassword} phone={me.phone} onSaved={() => setSaved(true)} />
    </MemberShell>
  );
}

function ChangePasswordForm({ forced, phone, onSaved }: { forced: boolean; phone: string | null; onSaved: () => void }) {
  const changePassword = useAction(api.users.changePassword);
  const [serverError, setServerError] = useState<string | null>(null);
  const form = useForm<z.infer<ReturnType<typeof buildSchema>>>({
    resolver: zodResolver(buildSchema(!forced, phone)),
    defaultValues: { current: "", password: "", confirm: "" },
  });
  const { errors, isSubmitting } = form.formState;
  const onSubmit = form.handleSubmit(async (values) => {
    setServerError(null);
    try {
      await changePassword({ currentPassword: forced ? undefined : values.current, newPassword: values.password });
      toast.success("Your new password is saved.");
      onSaved();
    } catch (error) {
      setServerError(friendlyError(error));
    }
  });
  return (
    <Card>
      <CardBody className="flex flex-col gap-4">
        <span className="flex size-10 items-center justify-center rounded-full bg-subtle text-foreground-secondary">
          <Icon icon={KeyRound} />
        </span>
        <div className="flex flex-col gap-1">
          <h1 className="font-serif text-2xl tracking-tight">
            {forced ? "Choose a new password" : "Change password"}
          </h1>
          <p className="text-foreground-secondary">
            {forced
              ? "You signed in with a temporary password from the office. Choose your own now; you’ll use it from next time."
              : "Your other phones and computers will be signed out."}
          </p>
        </div>
        <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
          {serverError ? <Banner tone="danger">{serverError}</Banner> : null}
          {forced ? null : (
            <Field id="current" label="Current password" error={errors.current?.message}>
              {(p) => <PasswordInput {...p} {...form.register("current")} autoComplete="current-password" />}
            </Field>
          )}
          <Field
            id="password"
            label="New password"
            hint={`At least ${PASSWORD_MIN_LENGTH} characters. Not your phone number.`}
            error={errors.password?.message}
          >
            {(p) => <PasswordInput {...p} {...form.register("password")} autoComplete="new-password" />}
          </Field>
          <Field id="confirm" label="Type the new password again" error={errors.confirm?.message}>
            {(p) => <PasswordInput {...p} {...form.register("confirm")} autoComplete="new-password" />}
          </Field>
          <Button type="submit" width="full" loading={isSubmitting}>
            Save new password
          </Button>
          {forced ? null : (
            <Button variant="ghost" asChild>
              <Link href="/">Cancel</Link>
            </Button>
          )}
        </form>
      </CardBody>
    </Card>
  );
}

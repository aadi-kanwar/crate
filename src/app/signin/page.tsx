"use client";

import { useAuthActions } from "@convex-dev/auth/react";
import { zodResolver } from "@hookform/resolvers/zod";
import { getCountryCallingCode, parsePhoneNumberFromString, type CountryCode } from "libphonenumber-js";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { Brand } from "@/components/app/brand";
import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { Card, CardBody } from "@/components/ui/card";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { PasswordInput } from "@/components/ui/password-input";
import { friendlyError } from "@/lib/errors";

function toE164(country: CountryCode, input: string): string | null {
  const parsed = parsePhoneNumberFromString(input.trim(), country);
  return parsed && parsed.isValid() ? parsed.number : null;
}

const schema = z
  .object({
    country: z.string(),
    phone: z.string().trim().min(1, "Enter your mobile number."),
    password: z.string().min(1, "Enter your password."),
  })
  .superRefine((values, ctx) => {
    if (toE164(values.country as CountryCode, values.phone) === null) {
      ctx.addIssue({ code: "custom", path: ["phone"], message: "Enter a valid mobile number." });
    }
  });

type FormValues = z.infer<typeof schema>;

// A fixed list; India first.
const COUNTRY_NAMES: Array<[CountryCode, string]> = [
  ["IN", "India"],
  ["NP", "Nepal"],
  ["BD", "Bangladesh"],
  ["LK", "Sri Lanka"],
  ["AE", "United Arab Emirates"],
];
const COUNTRY_OPTIONS = COUNTRY_NAMES.map(([code, name]) => ({ code, label: `${name} (+${getCountryCallingCode(code)})` }));

/** Mobile number + password. There's no sign-up: the office creates every account. */
export default function SignInPage() {
  const { signIn } = useAuthActions();
  const router = useRouter();
  const [serverError, setServerError] = useState<string | null>(null);
  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { country: "IN", phone: "", password: "" },
  });
  const { errors, isSubmitting } = form.formState;
  const onSubmit = form.handleSubmit(async (values) => {
    setServerError(null);
    try {
      await signIn("phone-password", { phone: toE164(values.country as CountryCode, values.phone)!, password: values.password });
      router.replace("/");
    } catch (error) {
      setServerError(friendlyError(error));
    }
  });

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-sm flex-col justify-center gap-6 px-4 py-10">
      <Brand size="lg" />
      <div className="flex flex-col gap-1">
        <h1 className="font-serif text-3xl tracking-tight">
          What we buy, <em className="text-primary-soft">and what it costs.</em>
        </h1>
        <p className="text-foreground-secondary">Sign in with your mobile number.</p>
      </div>
      <Card>
        <CardBody>
          <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
            {serverError ? <Banner tone="danger">{serverError}</Banner> : null}
            <Field id="country" label="Country">
              {(p) => (
                <NativeSelect {...p} {...form.register("country")} autoComplete="tel-country-code">
                  {COUNTRY_OPTIONS.map((c) => (
                    <option key={c.code} value={c.code}>
                      {c.label}
                    </option>
                  ))}
                </NativeSelect>
              )}
            </Field>
            <Field id="phone" label="Mobile number" error={errors.phone?.message}>
              {(p) => (
                <Input {...p} {...form.register("phone")} type="tel" inputMode="tel" autoComplete="tel-national" placeholder="98765 43210" />
              )}
            </Field>
            <Field id="password" label="Password" error={errors.password?.message}>
              {(p) => <PasswordInput {...p} {...form.register("password")} autoComplete="current-password" />}
            </Field>
            <Button type="submit" width="full" loading={isSubmitting}>
              Sign in
            </Button>
            <p className="text-sm text-foreground-secondary">
              No account, or forgot your password? Ask the office: they set it up for you.
            </p>
          </form>
        </CardBody>
      </Card>
    </main>
  );
}

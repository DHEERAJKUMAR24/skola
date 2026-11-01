"use client";

import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { Stack } from "@/components/ui/Stack";
import { Text } from "@/components/ui/Text";
import { TextInput } from "@/components/ui/TextInput";
import { safeCallback } from "@/lib/safeCallback";
import { useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";

const post = (url: string, body: unknown) =>
  fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

function ForgotForm() {
  const callback = safeCallback(useSearchParams().get("callbackUrl"));
  const [step, setStep] = useState<"email" | "code" | "done">("email");
  const [email, setEmail] = useState("");
  const [otp, setOtp] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (step === "done")
    return (
      <Stack gap="md" align="start">
        <Alert variant="success">
          Password changed. You were signed out everywhere.
        </Alert>
        <a href={`/login?callbackUrl=${encodeURIComponent(callback)}`}>
          Sign in
        </a>
      </Stack>
    );

  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError(null);
        if (step === "email") {
          await post("/api/account/forgot", { email });
          setStep("code");
        } else {
          const res = await post("/api/account/reset", {
            email,
            otp,
            password,
          });
          if (res.ok) setStep("done");
          else
            setError(
              (await res.json().catch(() => ({}))).error ??
                "Could not reset the password"
            );
        }
        setBusy(false);
      }}
    >
      <Stack gap="md" align="start">
        {error && <Alert variant="error">{error}</Alert>}
        <TextInput
          label="Email"
          type="email"
          autoComplete="username"
          required
          disabled={step === "code"}
          value={email}
          onChange={(e) => setEmail(e.currentTarget.value)}
        />
        {step === "code" && (
          <>
            <Text variant="dimmed">
              If that email has an account, we sent a 6-digit code. It expires
              in 10 minutes.
            </Text>
            <TextInput
              label="Code"
              inputMode="numeric"
              autoComplete="one-time-code"
              required
              value={otp}
              onChange={(e) => setOtp(e.currentTarget.value)}
            />
            <TextInput
              label="New password"
              type="password"
              autoComplete="new-password"
              description="At least 10 characters"
              required
              minLength={10}
              value={password}
              onChange={(e) => setPassword(e.currentTarget.value)}
            />
          </>
        )}
        <Button type="submit" variant="primary" disabled={busy}>
          {step === "email" ? "Send code" : "Change password"}
        </Button>
        <a href={`/login?callbackUrl=${encodeURIComponent(callback)}`}>
          Back to sign in
        </a>
      </Stack>
    </form>
  );
}

export default function ForgotPasswordPage() {
  return (
    <Suspense>
      <ForgotForm />
    </Suspense>
  );
}

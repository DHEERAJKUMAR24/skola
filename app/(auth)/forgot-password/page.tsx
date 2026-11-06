"use client";

import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
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
      <div className="auth-page">
        <div className="auth-page__header">
          <h1 className="auth-page__title">Password changed</h1>
        </div>
        <div className="auth-page__success">
          <Alert variant="success">
            Your password has been changed. You were signed out everywhere.
          </Alert>
          <a
            className="auth-page__link auth-page__link--primary"
            href={`/login?callbackUrl=${encodeURIComponent(callback)}`}
          >
            Sign in
          </a>
        </div>
      </div>
    );

  return (
    <div className="auth-page">
      <div className="auth-page__header">
        <h1 className="auth-page__title">Reset your password</h1>
        <p className="auth-page__description">
          {step === "email"
            ? "Enter your email and we'll send you a reset code."
            : "Enter the 6-digit code from your email and choose a new password."}
        </p>
      </div>

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
        <div className="auth-page__fields">
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
              <p className="auth-page__hint">
                Code expires in 10 minutes. Check your spam folder if you don't
                see it.
              </p>
              <TextInput
                label="6-digit code"
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
        </div>
        <div className="auth-page__submit">
          <Button type="submit" variant="primary" disabled={busy}>
            {step === "email" ? "Send reset code" : "Change password"}
          </Button>
        </div>
      </form>

      <div className="auth-page__links">
        <a
          className="auth-page__link"
          href={`/login?callbackUrl=${encodeURIComponent(callback)}`}
        >
          Back to sign in
        </a>
      </div>
    </div>
  );
}

export default function ForgotPasswordPage() {
  return (
    <Suspense>
      <ForgotForm />
    </Suspense>
  );
}

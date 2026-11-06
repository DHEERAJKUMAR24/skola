"use client";

import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { TextInput } from "@/components/ui/TextInput";
import { safeCallback } from "@/lib/safeCallback";
import { signIn } from "next-auth/react";
import { useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";

function SignupForm() {
  const callback = safeCallback(useSearchParams().get("callbackUrl"));
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  return (
    <div className="auth-page">
      <div className="auth-page__header">
        <h1 className="auth-page__title">Create your account</h1>
        <p className="auth-page__description">
          Free, local-first — your data stays in your browser.
        </p>
      </div>

      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError(null);
          const res = await fetch("/api/account/signup", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ email, password }),
          });
          if (!res.ok) {
            setError(
              (await res.json().catch(() => ({}))).error ??
                "Could not create the account"
            );
            setBusy(false);
            return;
          }
          await signIn("credentials", { email, password, redirect: false });
          window.location.href = callback;
        }}
      >
        <div className="auth-page__fields">
          {error && <Alert variant="error">{error}</Alert>}
          <TextInput
            label="Email"
            type="email"
            autoComplete="username"
            required
            value={email}
            onChange={(e) => setEmail(e.currentTarget.value)}
          />
          <TextInput
            label="Password"
            type="password"
            autoComplete="new-password"
            description="At least 10 characters"
            required
            minLength={10}
            value={password}
            onChange={(e) => setPassword(e.currentTarget.value)}
          />
        </div>
        <div className="auth-page__submit">
          <Button type="submit" variant="primary" disabled={busy}>
            Create account
          </Button>
        </div>
      </form>

      <div className="auth-page__links">
        <a
          className="auth-page__link"
          href={`/login?callbackUrl=${encodeURIComponent(callback)}`}
        >
          Already have an account? Sign in
        </a>
      </div>
    </div>
  );
}

export default function SignupPage() {
  return (
    <Suspense>
      <SignupForm />
    </Suspense>
  );
}

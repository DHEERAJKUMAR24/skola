"use client";

import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { TextInput } from "@/components/ui/TextInput";
import { safeCallback } from "@/lib/safeCallback";
import { signIn } from "next-auth/react";
import { useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";

function LoginForm() {
  const callback = safeCallback(useSearchParams().get("callbackUrl"));
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  return (
    <div className="auth-page">
      <div className="auth-page__header">
        <h1 className="auth-page__title">Welcome back</h1>
        <p className="auth-page__description">
          Sign in to sync your cards across devices.
        </p>
      </div>

      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError(null);
          const res = await signIn("credentials", {
            email,
            password,
            redirect: false,
          });
          if (res?.error) {
            setError(
              "Wrong email or password, or the account is temporarily locked."
            );
            setBusy(false);
          } else {
            window.location.href = callback;
          }
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
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.currentTarget.value)}
          />
        </div>
        <div className="auth-page__submit">
          <Button type="submit" variant="primary" disabled={busy}>
            Sign in
          </Button>
        </div>
      </form>

      <div className="auth-page__links">
        <a
          className="auth-page__link auth-page__link--primary"
          href={`/signup?callbackUrl=${encodeURIComponent(callback)}`}
        >
          Create an account
        </a>
        <a
          className="auth-page__link"
          href={`/forgot-password?callbackUrl=${encodeURIComponent(callback)}`}
        >
          Forgot password?
        </a>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}

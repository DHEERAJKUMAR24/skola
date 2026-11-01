"use client";

import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { Stack } from "@/components/ui/Stack";
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
          setError((await res.json().catch(() => ({}))).error ?? "Could not create the account");
          setBusy(false);
          return;
        }
        await signIn("credentials", { email, password, redirect: false });
        window.location.href = callback;
      }}
    >
      <Stack gap="md" align="start">
        {error && <Alert variant="error">{error}</Alert>}
        <TextInput label="Email" type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.currentTarget.value)} />
        <TextInput label="Password" type="password" autoComplete="new-password" description="At least 10 characters" required minLength={10} value={password} onChange={(e) => setPassword(e.currentTarget.value)} />
        <Button type="submit" variant="primary" disabled={busy}>
          Create account
        </Button>
        <a href={`/login?callbackUrl=${encodeURIComponent(callback)}`}>I already have an account</a>
      </Stack>
    </form>
  );
}

export default function SignupPage() {
  return (
    <Suspense>
      <SignupForm />
    </Suspense>
  );
}

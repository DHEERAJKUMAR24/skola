"use client";

import { Alert } from "@/components/ui/Alert";
import { Text } from "@/components/ui/Text";
import { completeLogin } from "@/logic/auth";
import { useEffect, useRef, useState } from "react";

export default function CallbackPage() {
  const [error, setError] = useState<string | null>(null);
  // StrictMode runs effects twice in dev; the code is single-use, so exchange only once.
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    completeLogin(new URLSearchParams(location.search))
      .then(() => location.replace("/"))
      .catch((e) =>
        setError(e instanceof Error ? e.message : "Sign-in failed")
      );
  }, []);

  return error ? (
    <>
      <Alert variant="error">{error}</Alert>
      <p>
        <a href="/">Back to the app</a>
      </p>
    </>
  ) : (
    <Text variant="dimmed">Signing you in…</Text>
  );
}

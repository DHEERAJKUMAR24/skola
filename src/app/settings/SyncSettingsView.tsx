import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { Stack } from "@/components/ui/Stack";
import { Text } from "@/components/ui/Text";
import { signOut, startLogin, useAuthEmail } from "@/logic/auth";
import { syncNow } from "@/logic/sync";
import { useState } from "react";

export default function SyncSettingsView() {
  const email = useAuthEmail();
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  if (!email) {
    return (
      <Stack gap="md" align="start">
        <Text variant="dimmed">Sign in to sync your cards across devices.</Text>
        <Button variant="primary" onClick={() => startLogin("login")}>
          Sign in
        </Button>
        <Button variant="default" onClick={() => startLogin("signup")}>
          Create account
        </Button>
      </Stack>
    );
  }

  return (
    <Stack gap="md" align="start">
      <Text>Signed in as {email}</Text>
      {error && <Alert variant="error">{error}</Alert>}
      {status && <Alert variant="success">{status}</Alert>}
      <Button
        variant="primary"
        onClick={async () => {
          setError(null);
          setStatus(null);
          try {
            await syncNow();
            setStatus("Synced");
          } catch (e) {
            setError(e instanceof Error ? e.message : String(e));
          }
        }}
      >
        Sync now
      </Button>
      <Button variant="default" onClick={signOut}>
        Sign out
      </Button>
    </Stack>
  );
}

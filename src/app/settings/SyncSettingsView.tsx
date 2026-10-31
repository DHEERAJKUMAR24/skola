import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { Stack } from "@/components/ui/Stack";
import { Text } from "@/components/ui/Text";
import { signOut, syncUrl, useAuthEmail } from "@/logic/auth";
import { syncNow } from "@/logic/sync";
import { useState } from "react";
import AuthForm from "../login/AuthForm";

export default function SyncSettingsView() {
  const email = useAuthEmail();
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  const run = async (action: () => Promise<unknown>, done?: string) => {
    setError(null);
    setStatus(null);
    try {
      await action();
      if (done) setStatus(done);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  if (!syncUrl) {
    return <Text variant="dimmed">Sync is not configured. Set VITE_SYNC_URL to your Worker URL.</Text>;
  }

  if (email) {
    return (
      <Stack gap="md" align="start">
        <Text>Signed in as {email}</Text>
        {error && <Alert variant="error">{error}</Alert>}
        {status && <Alert variant="success">{status}</Alert>}
        <Button variant="primary" onClick={() => run(syncNow, "Synced")}>
          Sync now
        </Button>
        <Button variant="default" onClick={signOut}>
          Sign out
        </Button>
      </Stack>
    );
  }

  return <AuthForm />;
}

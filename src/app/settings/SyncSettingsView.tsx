import { ProfileAvatar, useSyncLabel } from "@/components/Profile/Profile";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { Stack } from "@/components/ui/Stack";
import { Text } from "@/components/ui/Text";
import { signOut, startLogin, useAuthEmail } from "@/logic/auth";
import { syncNow } from "@/logic/syncScheduler";
import { useSyncStatus } from "@/logic/syncStatus";
import { useState } from "react";
import PushDelaySetting from "./PushDelaySetting";

export default function SyncSettingsView() {
  const email = useAuthEmail();
  const status = useSyncStatus();
  const label = useSyncLabel(status);
  const [error, setError] = useState<string | null>(null);

  if (!email) {
    return (
      <Stack gap="md" align="start">
        <ProfileAvatar size={56} />
        <Text variant="dimmed">
          You are using Skola on this device only. Sign in to sync your cards
          across devices.
        </Text>
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
      <ProfileAvatar size={56} />
      <Stack gap="xs" align="start">
        <Text>{email}</Text>
        <Text variant="dimmed">{label}</Text>
      </Stack>
      {error && <Alert variant="error">{error}</Alert>}
      <Button
        variant="primary"
        disabled={status.phase === "syncing"}
        onClick={async () => {
          setError(null);
          try {
            await syncNow();
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
      <PushDelaySetting />
    </Stack>
  );
}

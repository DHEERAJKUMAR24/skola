import { Button } from "@/components/ui/Button";
import { Stack } from "@/components/ui/Stack";
import { Text } from "@/components/ui/Text";
import { startLogin } from "@/logic/auth";

/** Full-screen prompt shown before the app when nobody is signed in. */
export default function AuthGate({ onSkip }: { onSkip: () => void }) {
  return (
    <Stack
      gap="lg"
      align="center"
      style={{ maxWidth: 360, margin: "10vh auto", padding: "0 16px" }}
    >
      <img src="/logo.svg" alt="" width={72} height={72} />
      <h1>Skola++</h1>
      <Text variant="dimmed">Sign in to sync your cards across devices.</Text>
      <Button variant="primary" onClick={() => startLogin("login")}>
        Sign in
      </Button>
      <Button variant="default" onClick={() => startLogin("signup")}>
        Create account
      </Button>
      <Button variant="default" onClick={onSkip}>
        Continue without signing in
      </Button>
    </Stack>
  );
}

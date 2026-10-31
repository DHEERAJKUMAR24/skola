import { Button } from "@/components/ui/Button";
import { Stack } from "@/components/ui/Stack";
import { Text } from "@/components/ui/Text";
import AuthForm from "./AuthForm";

/** Full-screen sign-in shown before the app when sync is configured and nobody is signed in. */
export default function AuthGate({ onSkip }: { onSkip: () => void }) {
  return (
    <Stack gap="lg" align="center" style={{ maxWidth: 360, margin: "10vh auto", padding: "0 16px" }}>
      <h1>Skola</h1>
      <Text variant="dimmed">Sign in to sync your cards across devices.</Text>
      <AuthForm />
      <Button variant="default" onClick={onSkip}>
        Continue without signing in
      </Button>
    </Stack>
  );
}

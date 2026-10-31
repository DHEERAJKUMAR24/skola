import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { Stack } from "@/components/ui/Stack";
import { TextInput } from "@/components/ui/TextInput";
import { signIn, signUp } from "@/logic/auth";
import { useState } from "react";

export default function AuthForm() {
  const [form, setForm] = useState({ email: "", password: "" });
  const [error, setError] = useState<string | null>(null);

  const run = async (action: () => Promise<unknown>) => {
    setError(null);
    try {
      await action();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        run(() => signIn(form.email, form.password));
      }}
    >
      <Stack gap="md" align="start">
        {error && <Alert variant="error">{error}</Alert>}
        <TextInput
          label="Email"
          type="email"
          autoComplete="username"
          value={form.email}
          onChange={(e) => setForm({ ...form, email: e.currentTarget.value })}
        />
        <TextInput
          label="Password"
          type="password"
          autoComplete="current-password"
          value={form.password}
          onChange={(e) => setForm({ ...form, password: e.currentTarget.value })}
        />
        <Button type="submit" variant="primary">
          Sign in
        </Button>
        <Button
          variant="default"
          onClick={() => run(() => signUp(form.email, form.password))}
        >
          Create account
        </Button>
      </Stack>
    </form>
  );
}

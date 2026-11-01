import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { Stack } from "@/components/ui/Stack";
import { Text } from "@/components/ui/Text";
import { currentUserId } from "@/server/auth";
import { getDb } from "@/server/db";
import {
  type AuthorizeRequest,
  OAuthError,
  origin,
  validateAuthorize,
} from "@/server/oauth";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function ConsentPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const p = new URLSearchParams(
    Object.entries(await searchParams).flatMap(([k, v]) =>
      v === undefined ? [] : [[k, v]]
    )
  );
  if (!(await currentUserId()))
    redirect(
      `/login?callbackUrl=${encodeURIComponent(`/oauth/authorize?${p}`)}`
    );

  const h = await headers();
  const o = origin(
    new Request(`${h.get("x-forwarded-proto") ?? "http"}://${h.get("host")}/`)
  );
  let r: AuthorizeRequest;
  try {
    r = await validateAuthorize(getDb(), o, p);
  } catch (e) {
    return (
      <Alert variant="error">
        {e instanceof OAuthError ? e.description : "Invalid request"}
      </Alert>
    );
  }

  return (
    <form method="POST" action="/oauth/authorize">
      {[...p.entries()].map(([k, v]) => (
        <input key={k} type="hidden" name={k} value={v} />
      ))}
      <Stack gap="md" align="start">
        <Text>
          <strong>{r.client.name}</strong> wants to access your Skola account.
        </Text>
        <Text variant="dimmed">
          It will be able to use:{" "}
          {r.scope === "mcp"
            ? "your decks, cards and skills through MCP"
            : "sync"}
          .
        </Text>
        <Button type="submit" name="decision" value="allow" variant="primary">
          Allow
        </Button>
        <Button type="submit" name="decision" value="deny" variant="default">
          Deny
        </Button>
      </Stack>
    </form>
  );
}

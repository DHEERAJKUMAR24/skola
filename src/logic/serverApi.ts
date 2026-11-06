import { NotSignedIn, authFetch, isSignedIn } from "./auth";

/** Failure of a call to the app's own server routes, with a message fit to show as is. */
export class ServerApiError extends Error {
  constructor(
    message: string,
    readonly code?: string,
    readonly status?: number
  ) {
    super(message);
  }
}

/** Shown wherever a screen needs data that only lives on the server. */
export const needsConnection = (what: string) =>
  `${what} needs sign-in and a connection.`;

/**
 * POST to a server-only API route (edit history, learning objectives): the data has no local copy,
 * so signed out and offline end in one clear message instead of a stack trace.
 */
export async function serverCall<T = Record<string, any>>(
  path: string,
  body: object,
  what: string
): Promise<T> {
  if (!isSignedIn()) throw new ServerApiError(needsConnection(what));
  let res: Response;
  try {
    res = await authFetch(path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch (e) {
    // NotSignedIn: the token could not be refreshed. TypeError: fetch itself failed (offline).
    if (e instanceof NotSignedIn || e instanceof TypeError)
      throw new ServerApiError(needsConnection(what));
    throw e;
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok)
    throw new ServerApiError(
      data.error ?? `Request failed (${res.status})`,
      data.code,
      res.status
    );
  return data as T;
}

import { useEffect, useState } from "react";
import { isMediaRef, resolveMedia } from "./media";

// A transparent pixel shown until a picture is ready, so the layout does not jump.
const BLANK =
  "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";
const RETRY_MS = 6000;
const RETRIES = 5;

/**
 * The URL to show for a picture reference: `media:` references are resolved from this device
 * (or downloaded once); data URLs and https links are used as they are. Another device may not
 * have uploaded yet, so a missing picture is retried a few times.
 */
export function useMediaSrc(src: string | undefined): string | undefined {
  const [resolved, setResolved] = useState<string | undefined>();
  useEffect(() => {
    setResolved(undefined);
    if (!src || !isMediaRef(src)) return;
    let alive = true;
    let tries = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const attempt = async () => {
      const url = await resolveMedia(src);
      if (!alive) return;
      if (url) setResolved(url);
      else if (tries++ < RETRIES) timer = setTimeout(attempt, RETRY_MS);
    };
    void attempt();
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [src]);
  if (!src) return undefined;
  return isMediaRef(src) ? (resolved ?? BLANK) : src;
}

/** Note HTML with every `media:` picture swapped for a URL the browser can load. */
export function useMediaHtml(html: string): string {
  const refs = [
    ...new Set(
      [...html.matchAll(/src="(media:[0-9a-f]{64})"/g)].map((m) => m[1])
    ),
  ];
  const key = refs.join(",");
  const [map, setMap] = useState<Record<string, string>>({});
  useEffect(() => {
    if (!key) return;
    let alive = true;
    let tries = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const attempt = async () => {
      const found: Record<string, string> = {};
      for (const ref of key.split(",")) {
        const url = await resolveMedia(ref);
        if (url) found[ref] = url;
      }
      if (!alive) return;
      setMap((m) => ({ ...m, ...found }));
      if (
        Object.keys(found).length < key.split(",").length &&
        tries++ < RETRIES
      )
        timer = setTimeout(attempt, RETRY_MS);
    };
    void attempt();
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [key]);
  if (!key) return html;
  return html.replace(
    /src="(media:[0-9a-f]{64})"/g,
    (_m, ref) => `src="${map[ref] ?? BLANK}"`
  );
}

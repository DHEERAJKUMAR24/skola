import { NotSignedIn, authFetch, getAccessTokenSync, isSignedIn, syncUrl } from "./auth";
import { db } from "./db";
import { syncFlags } from "./syncTracking";

interface WireRow {
  tbl: string;
  id: string;
  data: unknown;
  updatedAt: number;
  deleted?: boolean;
  seq?: number;
}

const TABLES = ["decks", "cards", "notes", "reviewLogs"] as const;
const PUSHED_KEY = "sync.lastPushedAt";
const SEQ_KEY = "sync.lastSeq";

const getNum = (k: string) => Number(localStorage.getItem(k) ?? 0);

// JSON turns Dates into strings; tag them so pull can restore real Dates.
// `this[key]` is the raw value, since Date.toJSON runs before the replacer sees it.
function encode(data: unknown): unknown {
  return JSON.parse(
    JSON.stringify(data, function (this: Record<string, unknown>, key, v) {
      const raw = this[key];
      return raw instanceof Date ? { $d: raw.getTime() } : v;
    })
  );
}

function decode(data: unknown): unknown {
  return JSON.parse(JSON.stringify(data), (_k, v) =>
    v && typeof v === "object" && "$d" in v ? new Date(v.$d) : v
  );
}

async function collectChanges(since: number): Promise<WireRow[]> {
  const rows: WireRow[] = [];
  for (const tbl of TABLES) {
    const recs =
      tbl === "reviewLogs"
        ? await db.reviewLogs.where("reviewedAt").aboveOrEqual(since).toArray()
        : await db.table(tbl).filter((r) => (r.updatedAt ?? 0) >= since).toArray();
    for (const r of recs) {
      rows.push({
        tbl,
        id: r.id,
        data: encode(r),
        updatedAt: tbl === "reviewLogs" ? r.reviewedAt : r.updatedAt ?? 0,
      });
    }
  }
  for (const t of await db.tombstones.where("updatedAt").aboveOrEqual(since).toArray())
    rows.push({ tbl: t.table, id: t.id, data: null, updatedAt: t.updatedAt, deleted: true });
  return rows;
}

async function applyRemote(rows: WireRow[]) {
  syncFlags.applyingRemote = true;
  try {
    for (const r of rows) {
      const table = db.table(r.tbl);
      const local = await table.get(r.id);
      const localAt = local ? (r.tbl === "reviewLogs" ? r.updatedAt : local.updatedAt ?? 0) : -1;
      if (local && localAt >= r.updatedAt) continue;
      try {
        if (r.deleted) await table.delete(r.id);
        // Stored rows already carry the sender's updatedAt; keep it so edits don't bounce back.
        else await table.put({ ...(decode(r.data) as object), id: r.id });
      } catch (e) {
        // One malformed row must not block every later pull.
        console.warn(`sync: skipped ${r.tbl}/${r.id}`, e);
      }
    }
  } finally {
    syncFlags.applyingRemote = false;
  }
}

function check(res: Response, what: string) {
  if (!res.ok) throw new Error(`${what} failed: ${res.status}`);
}

function pushOnHide(url: string, init: RequestInit) {
  const token = getAccessTokenSync();
  return token
    ? fetch(url, { ...init, headers: { authorization: `Bearer ${token}` } })
    : null;
}

export async function syncOnce(baseUrl: string, keepalive = false) {
  if (!isSignedIn()) return;
  const since = getNum(PUSHED_KEY);
  const rows = await collectChanges(since);
  if (rows.length) {
    const init = { method: "POST", body: JSON.stringify({ rows }), keepalive };
    // Page hide cannot await a token refresh, so it only uses a token that is still valid.
    const res = keepalive
      ? await pushOnHide(`${baseUrl}/sync/push`, init)
      : await authFetch(`${baseUrl}/sync/push`, init);
    if (!res) return;
    check(res, "push");
    localStorage.setItem(PUSHED_KEY, String(Math.max(since, ...rows.map((r) => r.updatedAt))));
  }
  if (keepalive) return;
  let more = true;
  while (more) {
    const res = await authFetch(`${baseUrl}/sync/pull?since=${getNum(SEQ_KEY)}`);
    check(res, "pull");
    const body = (await res.json()) as { rows: WireRow[]; seq: number; more: boolean };
    await applyRemote(body.rows);
    localStorage.setItem(SEQ_KEY, String(body.seq));
    more = body.more;
  }
}

/** Manual sync from the UI; throws on failure so the caller can show it. */
export function syncNow() {
  if (!syncUrl) throw new Error("Sync is not configured");
  return syncOnce(syncUrl);
}

/** Sync on start, focus, reconnect and a 30 s timer; flush pending pushes when the page hides. */
export function startSync(baseUrl: string) {
  let running = false;
  const run = async (keepalive = false) => {
    if (running && !keepalive) return;
    running = true;
    try {
      await syncOnce(baseUrl, keepalive);
    } catch (e) {
      // Signed out mid-sync is expected, not an error worth logging.
      if (!(e instanceof NotSignedIn)) console.warn("sync failed", e);
    } finally {
      running = false;
    }
  };
  run();
  window.addEventListener("focus", () => run());
  window.addEventListener("online", () => run());
  window.addEventListener("auth-changed", () => run());
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") run(true);
  });
  setInterval(() => run(), 30_000);
}

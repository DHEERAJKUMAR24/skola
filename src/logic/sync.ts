import { authFetch, getAccessTokenSync, isSignedIn } from "./auth";
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

const TABLES = [
  "decks",
  "cards",
  "notes",
  "reviewLogs",
  "settings",
  "presets",
  "studySessions",
] as const;

/** Settings are keyed by `key`; every other synced table by `id`. */
const keyPathOf = (tbl: string) => (tbl === "settings" ? "key" : "id");
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
        : await db.table(tbl).where("updatedAt").aboveOrEqual(since).toArray();
    for (const r of recs) {
      rows.push({
        tbl,
        id: r[keyPathOf(tbl)],
        data: encode(r),
        updatedAt: tbl === "reviewLogs" ? r.reviewedAt : (r.updatedAt ?? 0),
      });
    }
  }
  for (const t of await db.tombstones
    .where("updatedAt")
    .aboveOrEqual(since)
    .toArray())
    rows.push({
      tbl: t.table,
      id: t.id,
      data: null,
      updatedAt: t.updatedAt,
      deleted: true,
    });
  return rows;
}

async function applyRemote(rows: WireRow[]) {
  if (!rows.length) return;
  syncFlags.applyingRemote = true;
  try {
    // Group rows by table then bulk-fetch locals in one shot per table (avoids N+1).
    const byTable = new Map<string, WireRow[]>();
    for (const r of rows) {
      let list = byTable.get(r.tbl);
      if (!list) {
        list = [];
        byTable.set(r.tbl, list);
      }
      list.push(r);
    }

    for (const [tbl, tblRows] of byTable) {
      const table = db.table(tbl);
      const keyPath = keyPathOf(tbl);
      const ids = tblRows.map((r) => r.id);
      const locals = await table.bulkGet(ids);

      const toPut: object[] = [];
      const toDelete: string[] = [];

      for (let i = 0; i < tblRows.length; i++) {
        const r = tblRows[i];
        const local = locals[i];
        // reviewLogs are append-only; skip only exact duplicates.
        const localAt = local
          ? tbl === "reviewLogs"
            ? r.updatedAt
            : (local.updatedAt ?? 0)
          : -1;
        if (local && localAt >= r.updatedAt) continue;

        if (r.deleted) toDelete.push(r.id);
        // Stored rows already carry the sender's updatedAt; keep it so edits don't bounce back.
        else toPut.push({ ...(decode(r.data) as object), [keyPath]: r.id });
      }

      try {
        if (toDelete.length) await table.bulkDelete(toDelete);
        if (toPut.length) await table.bulkPut(toPut);
      } catch (e) {
        // Bulk failed — fall back row-by-row so one malformed row doesn't block the rest.
        console.warn(
          `sync: bulk apply failed for ${tbl}, retrying individually`,
          e
        );
        for (const r of tblRows) {
          try {
            if (r.deleted) await table.delete(r.id);
            else
              await table.put({
                ...(decode(r.data) as object),
                [keyPath]: r.id,
              });
          } catch (e2) {
            console.warn(`sync: skipped ${tbl}/${r.id}`, e2);
          }
        }
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

/**
 * If nobody else wrote since our last pull, the only new server rows are the ones we just
 * pushed, so move the cursor past them instead of downloading them again later.
 */
function skipOwnEcho(body: { seq?: number; applied?: number }) {
  if (typeof body.seq !== "number" || typeof body.applied !== "number") return;
  if (body.seq - body.applied === getNum(SEQ_KEY))
    localStorage.setItem(SEQ_KEY, String(body.seq));
}

/** Pushes local changes; also pulls unless `pull` is false (push-only saves a request). */
export async function syncOnce(
  baseUrl: string,
  keepalive = false,
  pull = true
) {
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
    localStorage.setItem(
      PUSHED_KEY,
      String(Math.max(since, ...rows.map((r) => r.updatedAt)))
    );
    skipOwnEcho(await res.json().catch(() => ({})));
  }
  if (keepalive || !pull) return;
  let more = true;
  while (more) {
    const res = await authFetch(
      `${baseUrl}/sync/pull?since=${getNum(SEQ_KEY)}`
    );
    check(res, "pull");
    const body = (await res.json()) as {
      rows: WireRow[];
      seq: number;
      more: boolean;
    };
    await applyRemote(body.rows);
    localStorage.setItem(SEQ_KEY, String(body.seq));
    more = body.more;
  }
}

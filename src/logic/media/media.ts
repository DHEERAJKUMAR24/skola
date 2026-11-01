import { authFetch, isSignedIn, syncUrl } from "../auth";
import { db } from "../db";

/**
 * Pictures. A note keeps `media:<sha256>`; the bytes live in this device's IndexedDB and, once
 * uploaded, in R2. Creating a picture never waits for the network: it is saved here first and a
 * background upload follows, so everything works offline and a second device downloads it on
 * first sight. When picture storage is not set up on the server, or nobody is signed in, the
 * picture is kept inside the note as a data URL instead, exactly as before.
 */
export const MEDIA_PREFIX = "media:";
const REF = /^media:([0-9a-f]{64})$/;
const REF_IN_HTML = /src="(media:[0-9a-f]{64})"/g;

export interface MediaRow {
  /** sha256 of the bytes, which is also what the server calls the picture. */
  id: string;
  blob: Blob;
  type: string;
  size: number;
  /** 1 once R2 has it (Dexie cannot index booleans). */
  uploaded: 0 | 1;
}

export const isMediaRef = (s: string) => REF.test(s);
export const shaOfRef = (ref: string) => REF.exec(ref)?.[1];
export const mediaRefsIn = (html: string) =>
  [...html.matchAll(REF_IN_HTML)].map((m) => m[1]);

export async function sha256Hex(blob: Blob): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    await blob.arrayBuffer()
  );
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export async function blobToDataUrl(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let bin = "";
  // In slices: spreading a whole picture into one call would overflow the stack.
  for (let i = 0; i < bytes.length; i += 0x8000)
    bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return `data:${blob.type || "application/octet-stream"};base64,${btoa(bin)}`;
}

/** The bytes of a base64 data URL, decoded in place (no request, nothing to block). */
export function dataUrlToBlob(dataUrl: string): Blob {
  const m = /^data:([^;,]+);base64,([\s\S]*)$/.exec(dataUrl);
  if (!m) throw new Error("not a base64 data URL");
  const bin = atob(m[2]);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: m[1] });
}

// ---- is picture storage available? -------------------------------------------------------

let enabledCache: { signedIn: boolean; value: boolean } | null = null;

/** True when signed in and the server has picture storage. Cached for the session. */
export async function mediaEnabled(): Promise<boolean> {
  const signedIn = isSignedIn();
  if (!signedIn || !syncUrl) return false;
  if (enabledCache?.signedIn === signedIn) return enabledCache.value;
  try {
    const res = await authFetch(`${syncUrl}/media/config`);
    if (!res.ok) return false;
    const value = !!(await res.json()).enabled;
    enabledCache = { signedIn, value };
    return value;
  } catch {
    return false; // offline or not reachable: keep the picture inline this time
  }
}

export const resetMediaEnabledCache = () => {
  enabledCache = null;
};

// ---- saving ------------------------------------------------------------------------------

/** Saves the bytes on this device and returns the reference to put in the note. */
export async function saveMedia(blob: Blob): Promise<string> {
  const id = await sha256Hex(blob);
  const existing = await db.media.get(id);
  if (!existing)
    await db.media.put({
      id,
      blob,
      type: blob.type || "image/webp",
      size: blob.size,
      uploaded: 0,
    });
  void uploadPending();
  return `${MEDIA_PREFIX}${id}`;
}

/** What to store in a note for a picture: a media reference, or a data URL when R2 is off. */
export async function storeImage(blob: Blob): Promise<string> {
  return (await mediaEnabled()) ? saveMedia(blob) : blobToDataUrl(blob);
}

// ---- uploading ---------------------------------------------------------------------------

let uploading = false;

/** Pushes pictures that exist only on this device to R2. Safe to call at any time. */
export async function uploadPending(): Promise<void> {
  if (uploading) return;
  // Look locally first: with nothing waiting, no request is made at all.
  const waiting = await db.media.where("uploaded").equals(0).toArray();
  if (!waiting.length || !navigator.onLine || !(await mediaEnabled())) return;
  uploading = true;
  try {
    for (const row of waiting) {
      try {
        const res = await authFetch(`${syncUrl}/media/upload`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            sha256: row.id,
            size: row.size,
            type: row.type,
          }),
        });
        if (!res.ok) throw new Error(`upload request failed: ${res.status}`);
        const up = await res.json();
        if (!up.exists) {
          // Straight to R2; the server never sees the bytes.
          const put = await fetch(up.uploadUrl, {
            method: "PUT",
            headers: up.headers,
            body: row.blob,
          });
          if (!put.ok) throw new Error(`R2 upload failed: ${put.status}`);
          const done = await authFetch(`${syncUrl}/media/confirm`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ sha256: row.id }),
          });
          if (!done.ok) throw new Error(`confirm failed: ${done.status}`);
        }
        await db.media.update(row.id, { uploaded: 1 });
      } catch (e) {
        // Left pending; the next sync tries again.
        console.warn("picture upload postponed", e);
      }
    }
  } finally {
    uploading = false;
  }
}

// ---- showing -----------------------------------------------------------------------------

const urls = new Map<string, string>();
const inflight = new Map<string, Promise<string | null>>();

/** A URL the browser can show for `media:<sha>`: the local copy, or downloaded once from R2. */
export function resolveMedia(ref: string): Promise<string | null> {
  const sha = shaOfRef(ref);
  if (!sha) return Promise.resolve(null);
  const known = urls.get(sha);
  if (known) return Promise.resolve(known);
  let p = inflight.get(sha);
  if (!p) {
    p = load(sha).finally(() => inflight.delete(sha));
    inflight.set(sha, p);
  }
  return p;
}

async function load(sha: string): Promise<string | null> {
  let row = await db.media.get(sha);
  if (!row) {
    if (!isSignedIn() || !syncUrl || !navigator.onLine) return null;
    try {
      const link = await authFetch(`${syncUrl}/media/url?sha=${sha}`);
      if (!link.ok) return null;
      const res = await fetch((await link.json()).url);
      if (!res.ok) return null;
      const blob = await res.blob();
      // The name of a picture is its fingerprint, so a wrong or tampered file is refused.
      if ((await sha256Hex(blob)) !== sha) return null;
      row = { id: sha, blob, type: blob.type, size: blob.size, uploaded: 1 };
      await db.media.put(row);
    } catch {
      return null;
    }
  }
  const url = URL.createObjectURL(row.blob);
  urls.set(sha, url);
  return url;
}

// ---- moving old inline pictures out of notes ---------------------------------------------

const INLINE_IMG = /src="(data:image\/[a-z+]+;base64,[A-Za-z0-9+/=]+)"/g;
let migrating = false;

/**
 * Notes made before picture storage (or while it was off or offline) keep their pictures inside
 * the note. Once storage is available, move each one to a media reference.
 */
export async function migrateInlineImages(): Promise<number> {
  if (migrating) return 0;
  migrating = true;
  let moved = 0;
  try {
    // Look locally first: most accounts have nothing to move, and then no request is made.
    const inline = (await db.notes.toArray()).filter((n) =>
      JSON.stringify(n.content).includes('"data:image/')
    );
    if (!inline.length || !(await mediaEnabled())) return 0;
    for (const note of inline) {
      const content = note.content as unknown as Record<string, unknown>;
      const next: Record<string, unknown> = { ...content };
      let changed = false;
      for (const [k, v] of Object.entries(content)) {
        if (typeof v !== "string") continue;
        if (k === "image" && v.startsWith("data:image/")) {
          next[k] = await saveMedia(dataUrlToBlob(v));
          changed = true;
        } else if (v.includes('src="data:image/')) {
          let html = v;
          for (const m of [...v.matchAll(INLINE_IMG)]) {
            const ref = await saveMedia(dataUrlToBlob(m[1]));
            html = html.replace(m[1], ref);
          }
          next[k] = html;
          changed = true;
        }
      }
      if (changed) {
        await db.notes.update(note.id, { content: next } as never);
        moved++;
      }
    }
  } catch (e) {
    console.warn("moving pictures out of notes postponed", e);
  } finally {
    migrating = false;
  }
  return moved;
}

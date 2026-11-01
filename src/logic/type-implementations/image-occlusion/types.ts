/** A covered area, as fractions (0 to 1) of the image so it scales with any display size. */
export interface OcclusionBox {
  /** Also the card's occlusionNumber. */
  id: number;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface ImageOcclusionNoteContent {
  /**
   * The picture: a `media:` reference to R2, an https link shown straight from where it lives,
   * or (when R2 is not set up, or offline) a data URL shrunk in the browser.
   */
  image: string;
  /** Optional heading shown above the picture. */
  header?: string;
  boxes: OcclusionBox[];
  /** true: every area is covered and one is asked. false: only the asked area is covered. */
  hideAll: boolean;
}

export type ImageOcclusionCardContent = { occlusionNumber: number };

export const IO_MAX_BOXES = 30;

/** `media:<sha256>`: a picture kept in R2 (and cached on the device), not inside the note. */
export const MEDIA_REF = /^media:[0-9a-f]{64}$/;
export const isMediaRef = (s: string) => MEDIA_REF.test(s);

export const IO_MAX_URL_CHARS = 2048;

/** A plain https link with no login in it. The picture is never downloaded by Skola. */
export function isImageUrl(s: string): boolean {
  if (s.length > IO_MAX_URL_CHARS) return false;
  try {
    const u = new URL(s);
    return u.protocol === "https:" && !u.username && !u.password;
  } catch {
    return false;
  }
}

/** A picture kept inside the note (R2 off or offline) syncs as JSON, so it stays small. */
export const IO_MAX_IMAGE_CHARS = 550_000;
const MIN_SIDE = 0.01;

export function validateImageOcclusion(
  c: Pick<ImageOcclusionNoteContent, "image" | "boxes">
): string | null {
  if (isImageUrl(c.image) || isMediaRef(c.image)) {
    // a link or a media reference: nothing stored but the address
  } else if (!/^data:image\/(png|jpe?g|webp|gif);base64,/.test(c.image))
    return "Choose an image";
  else if (c.image.length > IO_MAX_IMAGE_CHARS) return "The image is too large";
  if (c.boxes.length < 1) return "Draw at least one area on the image";
  if (c.boxes.length > IO_MAX_BOXES) return `At most ${IO_MAX_BOXES} areas`;
  const ids = new Set(c.boxes.map((b) => b.id));
  if (ids.size !== c.boxes.length) return "Areas need distinct ids";
  return null;
}

/** Clamps a drag between two points to the image and returns null for an accidental tiny box. */
export function boxFromDrag(
  a: { x: number; y: number },
  b: { x: number; y: number },
  id: number
): OcclusionBox | null {
  const clamp = (n: number) => Math.min(1, Math.max(0, n));
  const x = clamp(Math.min(a.x, b.x));
  const y = clamp(Math.min(a.y, b.y));
  const w = clamp(Math.max(a.x, b.x)) - x;
  const h = clamp(Math.max(a.y, b.y)) - y;
  return w < MIN_SIDE || h < MIN_SIDE ? null : { id, x, y, w, h };
}

export const nextBoxId = (boxes: OcclusionBox[]) =>
  boxes.reduce((m, b) => Math.max(m, b.id), 0) + 1;

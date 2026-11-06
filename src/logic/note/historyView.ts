import { type DiffPart, diffText } from "./textDiff";

export type FieldMap = Record<string, string | string[]>;

export interface HistoryVersion {
  version_id: string;
  replaced_at: number;
  fields: FieldMap;
  tags: string[] | null;
}

export interface HistoryResponse {
  note_id: string;
  keeps_days: number;
  current: { fields: FieldMap; tags: string[] } | null;
  versions: HistoryVersion[];
}

export interface FieldChange {
  name: string;
  /** The text a restore would produce, with what the current text has and the version lacks marked removed. */
  parts: DiffPart[];
  changed: boolean;
}

const asText = (v: string | string[] | undefined) =>
  Array.isArray(v) ? v.join("\n") : (v ?? "");

/**
 * Compares a saved version with the text as stored now. Read it as "restoring this changes the
 * current text like so": words only in the current text show as removed, words only in the version
 * as added.
 */
export function compareVersion(
  version: { fields: FieldMap; tags: string[] | null },
  current: { fields: FieldMap; tags: string[] } | null
): FieldChange[] {
  const names = [
    ...new Set([
      ...Object.keys(version.fields),
      ...Object.keys(current?.fields ?? {}),
    ]),
  ];
  const out: FieldChange[] = names.map((name) => {
    const before = asText(current?.fields[name]);
    const after = asText(version.fields[name]);
    return {
      name,
      parts: current
        ? diffText(before, after)
        : [{ kind: "same" as const, text: after }],
      changed: !!current && before !== after,
    };
  });
  const tagsNow = (current?.tags ?? []).join(", ");
  const tagsThen = (version.tags ?? []).join(", ");
  if (tagsNow || tagsThen)
    out.push({
      name: "tags",
      parts: current
        ? diffText(tagsNow, tagsThen)
        : [{ kind: "same", text: tagsThen }],
      changed: !!current && tagsNow !== tagsThen,
    });
  return out;
}

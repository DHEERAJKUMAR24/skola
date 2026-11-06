export interface DiffPart {
  kind: "same" | "added" | "removed";
  text: string;
}

const tokens = (s: string) => s.match(/\s+|[^\s]+/g) ?? [];

/** Word-level diff of two texts (LCS), merged into runs. Used by the note History view. */
export function diffText(before: string, after: string): DiffPart[] {
  const a = tokens(before);
  const b = tokens(after);
  // A pathological pair would need a huge table; fall back to a whole-text replacement.
  if (a.length * b.length > 4_000_000)
    return before === after
      ? [{ kind: "same", text: after }]
      : [
          { kind: "removed", text: before },
          { kind: "added", text: after },
        ];
  const w = b.length + 1;
  const lcs = new Uint32Array((a.length + 1) * w);
  for (let i = a.length - 1; i >= 0; i--)
    for (let j = b.length - 1; j >= 0; j--)
      lcs[i * w + j] =
        a[i] === b[j]
          ? lcs[(i + 1) * w + j + 1] + 1
          : Math.max(lcs[(i + 1) * w + j], lcs[i * w + j + 1]);
  const out: DiffPart[] = [];
  const push = (kind: DiffPart["kind"], text: string) => {
    const last = out[out.length - 1];
    if (last?.kind === kind) last.text += text;
    else out.push({ kind, text });
  };
  let i = 0;
  let j = 0;
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i] === b[j]) {
      push("same", a[i]);
      i++;
      j++;
    } else if (
      j < b.length &&
      (i === a.length || lcs[i * w + j + 1] > lcs[(i + 1) * w + j])
    ) {
      push("added", b[j++]);
    } else push("removed", a[i++]);
  }
  return out;
}

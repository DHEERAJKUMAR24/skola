import { InfoTip } from "@/components/InfoTip/InfoTip";
import { Badge } from "@/components/ui/Badge";
import { db } from "@/logic/db";
import { describeCoverage } from "@/logic/master/coverage";
import { coverageOfMaster, linkedStatesOf } from "@/logic/master/masterCards";
import type { MasterSection } from "@/logic/master/masterModel";
import { suggestMasterRating } from "@/logic/master/suggestRating";
import { useLiveQuery } from "dexie-react-hooks";

const COLORS = { 1: "red", 2: "orange", 3: "green", 4: "blue" } as const;

/** Entry text, or the linked card's text when the entry has only a card. */
function EntryText({ text, cardId }: { text: string; cardId?: string }) {
  const fallback = useLiveQuery(async () => {
    if (text || !cardId) return "";
    const card = await db.cards.get(cardId);
    return card ? ((await db.notes.get(card.note))?.sortField ?? "") : "";
  }, [text, cardId]);
  if (text) return <>{text}</>;
  return <>{fallback || "(linked card)"}</>;
}

/** The sections and entries of a master card, read only. */
export function MasterEntries({
  sections,
  title,
}: {
  sections: MasterSection[];
  title?: string;
}) {
  return (
    <div
      className="master-entries"
      style={{ padding: "var(--spacing-md)", fontSize: "var(--font-size-md)" }}
    >
      {title && (
        <h3 style={{ margin: "0 0 var(--spacing-sm)", fontWeight: 600 }}>
          {title}
        </h3>
      )}
      {sections.map((s) => (
        <section key={s.id} style={{ marginBottom: "var(--spacing-md)" }}>
          <h4 style={{ margin: "0 0 var(--spacing-xs)" }}>{s.title}</h4>
          <ul
            style={{
              margin: 0,
              paddingLeft: "var(--spacing-xl)",
              display: "flex",
              flexDirection: "column",
              gap: "var(--spacing-xs)",
            }}
          >
            {s.entries.map((e) => (
              <li key={e.id}>
                <EntryText text={e.text} cardId={e.cardId} />
                {!e.cardId && (
                  <span style={{ opacity: 0.6 }}> (no card yet)</span>
                )}
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

/**
 * The rating the app would suggest from the linked cards' FSRS state. The user still rates with
 * the normal answer buttons: this is advice, never applied automatically.
 */
export function SuggestedRatingBadge({
  sections,
}: {
  sections: MasterSection[];
}) {
  const key = sections
    .flatMap((s) => s.entries.map((e) => e.cardId ?? ""))
    .join(",");
  const suggestion = useLiveQuery(
    async () => suggestMasterRating(await linkedStatesOf(sections)),
    [key]
  );
  if (!suggestion) return null;
  return (
    <div
      className="master-suggestion"
      style={{
        display: "flex",
        alignItems: "center",
        gap: "var(--spacing-sm)",
        padding: "0 var(--spacing-md) var(--spacing-md)",
      }}
    >
      <span>Suggested rating:</span>
      <Badge color={COLORS[suggestion.rating]}>{suggestion.label}</Badge>
      <InfoTip label="Why this rating">
        <b>Suggestion only. You choose the rating.</b> It comes from the
        forgetting curve of the cards linked from the entries.{" "}
        {suggestion.reasons.join(" ")}
      </InfoTip>
    </div>
  );
}

/** One line per coverage problem of a master card, or a note that all is covered. */
export function MasterCoverageSummary({
  deckId,
  sections,
}: {
  deckId: string;
  sections: MasterSection[];
}) {
  const key = JSON.stringify(sections);
  const report = useLiveQuery(
    () => coverageOfMaster(deckId, sections),
    [deckId, key]
  );
  if (!report) return null;
  const lines = describeCoverage(report);
  return (
    <div
      className="master-coverage"
      style={{ padding: "var(--spacing-md)", fontSize: "var(--font-size-sm)" }}
    >
      <b>
        Coverage {Math.round(report.stats.coverage * 100)}% (
        {report.stats.coveredCards} of{" "}
        {report.stats.coveredCards + report.orphanCards.length} cards in an
        entry)
      </b>
      {lines.length === 0 ? (
        <div>Nothing is left out.</div>
      ) : (
        <ul style={{ margin: "var(--spacing-xs) 0 0", paddingLeft: "1.2em" }}>
          {lines.map((l) => (
            <li key={l}>{l}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

import { InfoTip } from "@/components/InfoTip/InfoTip";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { Select } from "@/components/ui/Select";
import { Stack } from "@/components/ui/Stack";
import { Text } from "@/components/ui/Text";
import { Textarea } from "@/components/ui/Textarea";
import {
  type SweepMark,
  combineSweepWithSuggestion,
  matchRecall,
  parseRecallInput,
  summarizeSweep,
} from "@/logic/master/activities";
import { bringDueNow } from "@/logic/master/builderData";
import { linkedStatesOf } from "@/logic/master/masterCards";
import type { MasterSection } from "@/logic/master/masterModel";
import { suggestMasterRating } from "@/logic/master/suggestRating";
import { useLiveQuery } from "dexie-react-hooks";
import { useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

const COLORS = { 1: "red", 2: "orange", 3: "green", 4: "blue" } as const;

interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult:
    | ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void)
    | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
}

function speechCtor(): (new () => SpeechRecognitionLike) | undefined {
  if (typeof window === "undefined") return undefined;
  const w = window as unknown as Record<string, unknown>;
  return (w.SpeechRecognition ?? w.webkitSpeechRecognition) as
    | (new () => SpeechRecognitionLike)
    | undefined;
}

/**
 * Recall sweep: type (or dictate) what you remember of a section, reveal it, mark every entry
 * found or missed. The result feeds the suggested rating. It changes no card by itself; the
 * "study missed cards today" button, which only moves due dates, needs a click.
 */
export default function RecallSweepModal({
  opened,
  onClose,
  sections,
  sectionNoun,
  entryNoun,
}: {
  opened: boolean;
  onClose: () => void;
  sections: MasterSection[];
  sectionNoun: string;
  entryNoun: string;
}) {
  const [t] = useTranslation();
  const [scope, setScope] = useState("");
  const [step, setStep] = useState<"type" | "mark" | "result">("type");
  const [typed, setTyped] = useState("");
  const [marks, setMarks] = useState<Record<string, SweepMark | undefined>>({});
  const [extras, setExtras] = useState<string[]>([]);
  const [listening, setListening] = useState(false);
  const [brought, setBrought] = useState<number | null>(null);
  const rec = useRef<SpeechRecognitionLike | null>(null);

  const picked = useMemo(
    () => (scope ? sections.filter((s) => s.id === scope) : sections),
    [sections, scope]
  );
  const entries = useMemo(() => picked.flatMap((s) => s.entries), [picked]);

  const reveal = () => {
    const items = parseRecallInput(typed);
    const matches = matchRecall(entries, items);
    const m: Record<string, SweepMark | undefined> = {};
    for (const x of matches) if (x.typed) m[x.entryId] = "found";
    setMarks(m);
    const used = new Set(matches.map((x) => x.typed));
    setExtras(items.filter((i) => !used.has(i)));
    setStep("mark");
  };

  const dictate = () => {
    const Ctor = speechCtor();
    if (!Ctor) return;
    if (listening) {
      rec.current?.stop();
      return;
    }
    const r = new Ctor();
    r.lang = navigator.language || "en-US";
    r.continuous = true;
    r.interimResults = false;
    r.onresult = (e) => {
      const said = Array.from(e.results)
        .map((x) => x[0]?.transcript ?? "")
        .join(". ");
      setTyped(
        (cur) => `${cur}${cur && !cur.endsWith("\n") ? "\n" : ""}${said}`
      );
    };
    r.onend = () => setListening(false);
    rec.current = r;
    setListening(true);
    r.start();
  };

  const summary = summarizeSweep(
    entries.map((e) => e.id),
    marks
  );
  const states = useLiveQuery(
    () => (step === "result" ? linkedStatesOf(picked) : []),
    [step, picked]
  );
  const rating = useMemo(
    () =>
      step === "result" && states
        ? combineSweepWithSuggestion(summary, suggestMasterRating(states))
        : null,
    [step, states, marks, entries]
  );

  const missedCardIds = entries
    .filter((e) => marks[e.id] !== "found" && e.cardId)
    .map((e) => e.cardId as string);

  const reset = () => {
    setStep("type");
    setTyped("");
    setMarks({});
    setBrought(null);
  };

  return (
    <Modal
      opened={opened}
      onClose={() => {
        rec.current?.stop();
        onClose();
      }}
      title={
        <>
          {t("masterBuilder.recall-sweep")}
          <InfoTip>{t("masterBuilder.sweep-tip")}</InfoTip>
        </>
      }
    >
      <Stack gap="md">
        {step === "type" && (
          <>
            <Select
              label={sectionNoun}
              value={scope}
              onChange={setScope}
              options={[
                { value: "", label: t("masterBuilder.whole-master") },
                ...sections.map((s) => ({
                  value: s.id,
                  label: s.title || sectionNoun,
                })),
              ]}
            />
            <Textarea
              label={t("masterBuilder.sweep-type", {
                noun: entryNoun.toLowerCase(),
              })}
              description={t("masterBuilder.sweep-type-hint")}
              minRows={6}
              value={typed}
              onChange={(e) => setTyped(e.currentTarget.value)}
            />
            <div className="master-sweep__row">
              {speechCtor() && (
                <Button size="sm" onClick={dictate}>
                  {listening
                    ? t("masterBuilder.sweep-stop")
                    : t("masterBuilder.sweep-say")}
                </Button>
              )}
              <Button
                variant="primary"
                onClick={reveal}
                disabled={entries.length === 0}
              >
                {t("masterBuilder.sweep-reveal")}
              </Button>
            </div>
          </>
        )}
        {step === "mark" && (
          <>
            <Text size="sm">
              {t("masterBuilder.sweep-mark", { noun: entryNoun.toLowerCase() })}
            </Text>
            <ul className="master-sweep__list">
              {entries.map((e) => (
                <li
                  key={e.id}
                  className="master-sweep__item"
                  data-mark={marks[e.id]}
                >
                  <span>{e.text || t("masterBuilder.untitled")}</span>
                  <span className="master-sweep__buttons">
                    <Button
                      size="xs"
                      variant={marks[e.id] === "found" ? "primary" : "default"}
                      onClick={() =>
                        setMarks((m) => ({ ...m, [e.id]: "found" }))
                      }
                    >
                      {t("masterBuilder.sweep-found")}
                    </Button>
                    <Button
                      size="xs"
                      variant={
                        marks[e.id] === "missed" ? "destructive" : "default"
                      }
                      onClick={() =>
                        setMarks((m) => ({ ...m, [e.id]: "missed" }))
                      }
                    >
                      {t("masterBuilder.sweep-missed")}
                    </Button>
                  </span>
                </li>
              ))}
            </ul>
            {extras.length > 0 && (
              <Text size="sm" variant="dimmed">
                {t("masterBuilder.sweep-extras", { items: extras.join(", ") })}
              </Text>
            )}
            <div className="master-sweep__row">
              <Button onClick={() => setStep("type")}>
                {t("masterBuilder.back")}
              </Button>
              <Button variant="primary" onClick={() => setStep("result")}>
                {t("masterBuilder.sweep-finish")}
              </Button>
            </div>
          </>
        )}
        {step === "result" && (
          <>
            <Text weight="semibold">
              {t("masterBuilder.sweep-result", {
                found: summary.found,
                total: summary.total,
              })}
            </Text>
            {rating && (
              <div className="master-sweep__row">
                <span>{t("masterBuilder.suggested")}</span>
                <Badge color={COLORS[rating.rating]}>{rating.label}</Badge>
                <InfoTip label={t("masterBuilder.why-rating")}>
                  <b>{t("masterBuilder.suggestion-only")}</b>{" "}
                  {rating.reasons.join(" ")}
                </InfoTip>
              </div>
            )}
            {missedCardIds.length > 0 && (
              <Stack gap="xs">
                <Button
                  onClick={async () =>
                    setBrought(await bringDueNow(missedCardIds))
                  }
                  disabled={brought !== null}
                >
                  {t("masterBuilder.sweep-bring", {
                    count: missedCardIds.length,
                  })}
                </Button>
                <Text size="xs" variant="dimmed">
                  {brought === null
                    ? t("masterBuilder.sweep-bring-note")
                    : t("masterBuilder.sweep-brought", { count: brought })}
                </Text>
              </Stack>
            )}
            <div className="master-sweep__row">
              <Button onClick={reset}>{t("masterBuilder.sweep-again")}</Button>
              <Button variant="primary" onClick={onClose}>
                {t("masterBuilder.done")}
              </Button>
            </div>
          </>
        )}
      </Stack>
    </Modal>
  );
}

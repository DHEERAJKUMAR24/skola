import { Button, Text } from "@/components/ui";
import type { Card } from "@/logic/card/card";
import { db } from "@/logic/db";
import type { Deck } from "@/logic/deck/deck";
import type { NoteType } from "@/logic/note/note";
import { forecastExam } from "@/logic/scheduling/forecast";
import { examMoment, resolveExam } from "@/logic/scheduling/policy";
import { defaultSettings } from "@/logic/settings/defaultSettings";
import { useSetting } from "@/logic/settings/hooks/useSetting";
import { IconBolt, IconCalendarEvent } from "@tabler/icons-react";
import { useLiveQuery } from "dexie-react-hooks";
import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import "./DeckExamPanel.css";

const BASE = "deck-exam";
const pct = (x: number) => `${Math.round(x * 100)}%`;

interface Props {
  deck: Deck;
  /** Every card of the deck, sub-decks included. */
  cards: Card<NoteType>[] | undefined;
}

/** Countdown and readiness for the deck's exam (its own or inherited). Shows nothing without an exam. */
export default function DeckExamPanel({ deck, cards }: Props) {
  const navigate = useNavigate();
  const [wText] = useSetting("#globalScheduler_w");
  const [globalRetention] = useSetting("#globalScheduler_requestRetention");
  const decksById = useLiveQuery(
    async () => new Map((await db.decks.toArray()).map((d) => [d.id, d])),
    []
  );

  const exam = useMemo(
    () => (decksById ? resolveExam(deck, decksById) : undefined),
    [deck, decksById]
  );

  const forecast = useMemo(() => {
    if (!exam || !cards) return undefined;
    const w = (wText ?? defaultSettings["#globalScheduler_w"])
      .split(",")
      .map(Number);
    return forecastExam(cards, {
      examDate: exam.date,
      now: new Date(),
      targetRetention: deck.options.desiredRetention ?? globalRetention,
      bufferDays: exam.bufferDays,
      w,
    });
  }, [exam, cards, wText, deck.options.desiredRetention, globalRetention]);

  if (!exam || !forecast) return null;

  const passed = examMoment(exam.date).getTime() <= Date.now();
  const days = Math.ceil(forecast.daysLeft);
  const inherited = exam.sourceDeckId !== deck.id;
  const sourceName = decksById?.get(exam.sourceDeckId)?.name;
  const dateText = examMoment(exam.date).toLocaleDateString(undefined, {
    weekday: "short",
    year: "numeric",
    month: "short",
    day: "numeric",
  });

  return (
    <section className={BASE} aria-label="Exam">
      <div className={`${BASE}__head`}>
        <IconCalendarEvent size={20} />
        <div>
          <div className={`${BASE}__title`}>
            {passed
              ? "Exam date has passed"
              : days <= 1
                ? "Exam is tomorrow or today"
                : `Exam in ${days} days`}
          </div>
          <Text size="sm" variant="dimmed">
            {dateText}
            {inherited && sourceName ? ` (from ${sourceName})` : ""}
          </Text>
        </div>
      </div>

      {passed ? (
        <Text size="sm" variant="dimmed">
          Scheduling is back to normal. Edit the deck to set a new date or clear
          this one.
        </Text>
      ) : (
        <>
          <dl className={`${BASE}__stats`}>
            <div>
              <dt>Expected score if you stop now</dt>
              <dd>{pct(forecast.expectedScore)}</dd>
            </div>
            <div>
              <dt>Cards learned</dt>
              <dd>
                {forecast.learned} of {forecast.total}
              </dd>
            </div>
            <div>
              <dt>Not started</dt>
              <dd>{forecast.newCards}</dd>
            </div>
            <div>
              <dt>At risk by exam day</dt>
              <dd>{forecast.atRisk}</dd>
            </div>
          </dl>
          {forecast.newCards > 0 && (
            <Text size="sm" variant="dimmed">
              To start every card before the last-review buffer, learn about{" "}
              <strong>{forecast.newPerDay}</strong> new{" "}
              {forecast.newPerDay === 1 ? "card" : "cards"} a day.
            </Text>
          )}
          <div className={`${BASE}__actions`}>
            <Button
              variant="primary"
              onClick={() => navigate(`/learn/${deck.id}`)}
            >
              Study
            </Button>
            <Button
              variant="default"
              leftSection={<IconBolt size={16} />}
              onClick={() => navigate(`/learn/${deck.id}/cram`)}
            >
              Cram everything
            </Button>
          </div>
          <Text size="sm" variant="dimmed">
            Cram goes through every card once and leaves your FSRS schedule
            exactly as it is.
          </Text>
        </>
      )}
    </section>
  );
}

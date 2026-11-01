import type ModalProps from "@/components/ModalProps";
import { Button, Modal, NumberInput, Switch, Text } from "@/components/ui";
import type { Card } from "@/logic/card/card";
import {
  buryCard,
  resetCard,
  setCardOverride,
  setDueDate,
  setSuspended,
} from "@/logic/card/cardControls";
import { db } from "@/logic/db";
import type { NoteType } from "@/logic/note/note";
import { recallAfter } from "@/logic/scheduling/forecast";
import { DAY_MS, addDays, logicalDayStart } from "@/logic/scheduling/policy";
import { defaultSettings } from "@/logic/settings/defaultSettings";
import { useSetting } from "@/logic/settings/hooks/useSetting";
import { useLiveQuery } from "dexie-react-hooks";
import { useEffect, useState } from "react";
import { State } from "ts-fsrs";
import "./CardSchedulingModal.css";

const BASE = "card-scheduling";
const STATE_LABEL: Record<State, string> = {
  [State.New]: "New",
  [State.Learning]: "Learning",
  [State.Review]: "Review",
  [State.Relearning]: "Relearning",
};

const fmt = (d?: Date | null) => (d ? new Date(d).toLocaleString() : "Never");

/** `YYYY-MM-DDTHH:mm` in local time, the format datetime-local inputs use. */
const toInput = (d: Date) => {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
};

interface Props extends ModalProps {
  card: Card<NoteType>;
  /** Called after the card is hidden from study (suspended or buried). */
  onHidden?: () => void;
}

/** What FSRS knows about one card, and the controls to override it for just this card. */
export default function CardSchedulingModal({
  opened,
  setOpened,
  card,
  onHidden,
}: Props) {
  const live = useLiveQuery(() => db.cards.get(card.id), [card.id, opened]);
  const c = live ?? card;
  const m = c.model;
  const [wText] = useSetting("#globalScheduler_w");
  const [newDayStartHour] = useSetting("#newDayStartHour");

  const [dueInput, setDueInput] = useState("");
  const [retention, setRetention] = useState<number | string>("");
  const [maxInterval, setMaxInterval] = useState<number | string>("");
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(
    null
  );
  const [confirmReset, setConfirmReset] = useState(false);

  useEffect(() => {
    if (!opened) return;
    setDueInput(toInput(new Date(card.model.due)));
    setRetention(
      card.fsrsOverride?.desiredRetention !== undefined
        ? Math.round(card.fsrsOverride.desiredRetention * 100)
        : ""
    );
    setMaxInterval(card.fsrsOverride?.maximumInterval ?? "");
    setMessage(null);
    setConfirmReset(false);
  }, [opened, card.id]);

  const w = (wText ?? defaultSettings["#globalScheduler_w"])
    .split(",")
    .map(Number);
  const isNew = m.state === State.New;
  const elapsedDays = m.last_review
    ? (Date.now() - new Date(m.last_review).getTime()) / DAY_MS
    : 0;
  const recall = isNew ? null : recallAfter(m.stability, elapsedDays, w);

  async function run(action: () => Promise<unknown>, success: string) {
    setMessage(null);
    try {
      await action();
      setMessage({ ok: true, text: success });
    } catch (e) {
      setMessage({
        ok: false,
        text: e instanceof Error ? e.message : String(e),
      });
    }
  }

  const buried = !!c.buriedUntil && c.buriedUntil > Date.now();

  return (
    <Modal
      opened={opened}
      onClose={() => setOpened(false)}
      title="Card scheduling"
    >
      <div className={BASE}>
        <section>
          <h4>Memory (FSRS)</h4>
          <dl className={`${BASE}__grid`}>
            <dt>State</dt>
            <dd>{STATE_LABEL[m.state]}</dd>
            <dt>Stability</dt>
            <dd>{isNew ? "-" : `${m.stability.toFixed(1)} days`}</dd>
            <dt>Difficulty</dt>
            <dd>{isNew ? "-" : `${m.difficulty.toFixed(1)} of 10`}</dd>
            <dt>Recall now</dt>
            <dd>{recall === null ? "-" : `${Math.round(recall * 100)}%`}</dd>
            <dt>Reviews / lapses</dt>
            <dd>
              {m.reps} / {m.lapses}
            </dd>
            <dt>Last review</dt>
            <dd>{fmt(m.last_review)}</dd>
            <dt>Due</dt>
            <dd>{isNew ? "Not scheduled" : fmt(m.due)}</dd>
          </dl>
        </section>

        <section>
          <h4>Study</h4>
          <Switch
            label="Suspended"
            description="Skip this card in study. Its FSRS state is kept."
            checked={!!c.suspended}
            onChange={(e) => {
              // Read the value now; the event is gone after the first await.
              const suspended = e.currentTarget.checked;
              run(
                async () => {
                  await setSuspended(c.id, suspended);
                  if (suspended) onHidden?.();
                },
                suspended ? "Card suspended" : "Card restored"
              );
            }}
          />
          <div className={`${BASE}__row`}>
            <Button
              variant="default"
              onClick={() =>
                run(
                  async () => {
                    const tomorrow = addDays(
                      logicalDayStart(new Date(), newDayStartHour),
                      1
                    );
                    await buryCard(c.id, buried ? null : tomorrow.getTime());
                    if (!buried) onHidden?.();
                  },
                  buried ? "Card is back in study" : "Hidden until tomorrow"
                )
              }
            >
              {buried ? "Unbury" : "Bury until tomorrow"}
            </Button>
          </div>
        </section>

        <section>
          <h4>Due date</h4>
          <Text size="sm" variant="dimmed">
            Moves only the due date. Stability and difficulty stay as they are.
          </Text>
          <div className={`${BASE}__row`}>
            <input
              type="datetime-local"
              className={`${BASE}__date`}
              value={dueInput}
              disabled={isNew}
              onChange={(e) => setDueInput(e.currentTarget.value)}
            />
            <Button
              variant="default"
              disabled={isNew || !dueInput}
              onClick={() =>
                run(
                  () => setDueDate(c.id, new Date(dueInput)),
                  "Due date updated"
                )
              }
            >
              Set due date
            </Button>
          </div>
          {isNew && (
            <Text size="sm" variant="dimmed">
              A new card has no schedule yet. Study it once first.
            </Text>
          )}
        </section>

        <section>
          <h4>This card only</h4>
          <Text size="sm" variant="dimmed">
            Leave a field empty to use the deck's setting.
          </Text>
          <NumberInput
            label="Desired retention (%)"
            value={retention}
            min={70}
            max={99}
            onChange={setRetention}
          />
          <NumberInput
            label="Maximum interval (days)"
            value={maxInterval}
            min={1}
            max={36500}
            onChange={setMaxInterval}
          />
          <div className={`${BASE}__row`}>
            <Button
              variant="primary"
              onClick={() =>
                run(
                  () =>
                    setCardOverride(c.id, {
                      desiredRetention:
                        retention === "" ? undefined : Number(retention) / 100,
                      maximumInterval:
                        maxInterval === "" ? undefined : Number(maxInterval),
                    }),
                  "Card settings saved"
                )
              }
            >
              Save
            </Button>
            <Button
              variant="default"
              onClick={() =>
                run(async () => {
                  await setCardOverride(c.id, undefined);
                  setRetention("");
                  setMaxInterval("");
                }, "Using the deck's settings")
              }
            >
              Use deck settings
            </Button>
          </div>
        </section>

        <section>
          <h4>Reset</h4>
          <Text size="sm" variant="dimmed">
            Makes this a new card again. Your review history is kept.
          </Text>
          <div className={`${BASE}__row`}>
            <Button
              variant={confirmReset ? "primary" : "default"}
              onClick={() => {
                if (!confirmReset) return setConfirmReset(true);
                setConfirmReset(false);
                run(() => resetCard(c.id), "Progress reset");
              }}
            >
              {confirmReset ? "Click again to reset" : "Reset progress"}
            </Button>
          </div>
        </section>

        {message && (
          <output
            className={`${BASE}__message ${message.ok ? "" : `${BASE}__message--error`}`}
          >
            {message.text}
          </output>
        )}
      </div>
    </Modal>
  );
}

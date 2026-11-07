import { InfoTip } from "@/components/InfoTip/InfoTip";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { NumberInput } from "@/components/ui/NumberInput";
import { Switch } from "@/components/ui/Switch";
import { Text } from "@/components/ui/Text";
import type { Card } from "@/logic/card/card";
import {
  buryCard,
  resetCard,
  setCardOverride,
  setDueDate,
  setSuspended,
} from "@/logic/card/cardControls";
import type { ReviewLogRecord } from "@/logic/card/reviewLog";
import { db } from "@/logic/db";
import { NoteType } from "@/logic/note/note";
import { updateNoteContent } from "@/logic/note/updateNoteContent";
import { recallAfter } from "@/logic/scheduling/forecast";
import { DAY_MS, addDays, logicalDayStart } from "@/logic/scheduling/policy";
import { formatSpan } from "@/logic/scheduling/summary";
import { defaultSettings } from "@/logic/settings/defaultSettings";
import { useSetting } from "@/logic/settings/hooks/useSetting";
import { IconChevronDown, IconChevronRight } from "@tabler/icons-react";
import { useLiveQuery } from "dexie-react-hooks";
import { useEffect, useState } from "react";
import { Rating, State } from "ts-fsrs";
import "./CardInfoModal.css";

const BASE = "card-info";

// ── Helpers ──────────────────────────────────────────────────────────────────

const RATING_LABEL: Record<number, string> = {
  [Rating.Again]: "Forgot",
  [Rating.Hard]: "Hard",
  [Rating.Good]: "Good",
  [Rating.Easy]: "Easy",
};

function relativeTime(date: Date | null | undefined): string {
  if (!date) return "Never";
  const ms = Date.now() - new Date(date).getTime();
  const abs = Math.abs(ms);
  const future = ms < 0;
  const span = formatSpan(abs);
  return future ? `in ${span}` : `${span} ago`;
}

function absoluteDate(date: Date | null | undefined): string {
  if (!date) return "—";
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(date));
}

function masteryInfo(
  card: Card<NoteType>,
  w: number[]
): { label: string; cls: string } {
  const m = card.model;
  const now = Date.now();
  if (m.state === State.New) return { label: "New", cls: "new" };
  if (m.state === State.Learning) return { label: "Learning", cls: "learning" };
  if (m.state === State.Relearning) return { label: "Lapsed", cls: "lapsed" };
  const elapsedDays = m.last_review
    ? (now - new Date(m.last_review).getTime()) / DAY_MS
    : 0;
  const recall = recallAfter(m.stability, elapsedDays, w);
  if (recall < 0.7) return { label: "Stale", cls: "stale" };
  if (m.stability >= 21) return { label: "Retaining", cls: "retaining" };
  return { label: "Growing", cls: "growing" };
}

function statusInfo(card: Card<NoteType>): { label: string; cls: string } {
  const m = card.model;
  if (card.suspended) return { label: "Suspended", cls: "dim" };
  if (card.buriedUntil && card.buriedUntil > Date.now())
    return { label: "Buried", cls: "dim" };
  if (m.state === State.New) return { label: "New", cls: "new" };
  if (new Date(m.due) < new Date()) return { label: "Overdue", cls: "overdue" };
  if (m.state === State.Learning) return { label: "Learning", cls: "learning" };
  if (m.state === State.Relearning)
    return { label: "Relearning", cls: "lapsed" };
  return { label: "Scheduled", cls: "review" };
}

function cardLabel(card: Card<NoteType>, index: number, total: number): string {
  if (total === 1) return "Card";
  const c = card.content as { frontIsField1?: boolean };
  if (typeof c.frontIsField1 === "boolean")
    return c.frontIsField1 ? "Forward Card" : "Backward Card";
  return `Card ${index + 1}`;
}

const toInput = (d: Date) => {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
};

function Badge({ label, cls }: { label: string; cls: string }) {
  return (
    <span className={`${BASE}__badge ${BASE}__badge--${cls}`}>{label}</span>
  );
}

// ── Edit SRS panel ───────────────────────────────────────────────────────────

function CardEditPanel({
  card,
  onDone,
  newDayStartHour,
}: {
  card: Card<NoteType>;
  onDone: () => void;
  newDayStartHour: number;
}) {
  const live = useLiveQuery(() => db.cards.get(card.id), [card.id]);
  const c = live ?? card;
  const buried = !!c.buriedUntil && c.buriedUntil > Date.now();
  const isNew = c.model.state === State.New;

  const [dueInput, setDueInput] = useState(() =>
    toInput(new Date(card.model.due))
  );
  const [retention, setRetention] = useState<number | string>(
    card.fsrsOverride?.desiredRetention !== undefined
      ? Math.round(card.fsrsOverride.desiredRetention * 100)
      : ""
  );
  const [maxInterval, setMaxInterval] = useState<number | string>(
    card.fsrsOverride?.maximumInterval ?? ""
  );
  const [confirmReset, setConfirmReset] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function run(action: () => Promise<unknown>, success: string) {
    setMsg(null);
    try {
      await action();
      setMsg({ ok: true, text: success });
    } catch (e) {
      setMsg({
        ok: false,
        text: e instanceof Error ? e.message : String(e),
      });
    }
  }

  return (
    <div className={`${BASE}__edit-panel`}>
      <div className={`${BASE}__edit-section-label`}>Visibility</div>
      <Switch
        label="Suspended"
        description="Skip in study; FSRS memory is kept."
        checked={!!c.suspended}
        onChange={(e) => {
          const v = e.currentTarget.checked;
          run(
            () => setSuspended(c.id, v),
            v ? "Card suspended" : "Card restored"
          );
        }}
      />
      <div className={`${BASE}__edit-row`}>
        <Button
          variant="default"
          size="sm"
          onClick={() =>
            run(
              async () => {
                const tomorrow = addDays(
                  logicalDayStart(new Date(), newDayStartHour),
                  1
                );
                await buryCard(c.id, buried ? null : tomorrow.getTime());
              },
              buried ? "Card unburied" : "Hidden until tomorrow"
            )
          }
        >
          {buried ? "Unbury" : "Bury until tomorrow"}
        </Button>
      </div>

      <div className={`${BASE}__edit-section-label`}>
        Due date
        <InfoTip>
          Moves only the due date. Stability and difficulty stay as they are.
        </InfoTip>
      </div>
      <div className={`${BASE}__edit-row`}>
        <input
          type="datetime-local"
          className={`${BASE}__date-input`}
          value={dueInput}
          disabled={isNew}
          onChange={(e) => setDueInput(e.currentTarget.value)}
        />
        <Button
          variant="default"
          size="sm"
          disabled={isNew || !dueInput}
          onClick={() =>
            run(() => setDueDate(c.id, new Date(dueInput)), "Due date updated")
          }
        >
          Set
        </Button>
      </div>
      {isNew && (
        <Text size="sm" variant="dimmed">
          Study this card once first to unlock scheduling.
        </Text>
      )}

      <div className={`${BASE}__edit-section-label`}>
        Card overrides
        <InfoTip>Leave empty to inherit the deck's setting.</InfoTip>
      </div>
      <NumberInput
        label="Desired retention (%)"
        value={retention}
        min={70}
        max={99}
        onChange={setRetention}
      />
      <NumberInput
        label="Max interval (days)"
        value={maxInterval}
        min={1}
        max={36500}
        onChange={setMaxInterval}
      />
      <div className={`${BASE}__edit-row`}>
        <Button
          variant="primary"
          size="sm"
          onClick={() =>
            run(
              () =>
                setCardOverride(c.id, {
                  desiredRetention:
                    retention === "" ? undefined : Number(retention) / 100,
                  maximumInterval:
                    maxInterval === "" ? undefined : Number(maxInterval),
                }),
              "Settings saved"
            )
          }
        >
          Save
        </Button>
        <Button
          variant="default"
          size="sm"
          onClick={() =>
            run(async () => {
              await setCardOverride(c.id, undefined);
              setRetention("");
              setMaxInterval("");
            }, "Using deck defaults")
          }
        >
          Use deck defaults
        </Button>
      </div>

      <div className={`${BASE}__edit-section-label`}>
        Reset
        <InfoTip>
          Makes this a new card again. Your review history is kept for
          reference.
        </InfoTip>
      </div>
      <div className={`${BASE}__edit-row`}>
        <Button
          variant={confirmReset ? "primary" : "default"}
          size="sm"
          onClick={() => {
            if (!confirmReset) return setConfirmReset(true);
            setConfirmReset(false);
            run(() => resetCard(c.id), "Progress reset");
          }}
        >
          {confirmReset ? "Click again to confirm" : "Reset progress"}
        </Button>
        {confirmReset && (
          <Button
            variant="default"
            size="sm"
            onClick={() => setConfirmReset(false)}
          >
            Cancel
          </Button>
        )}
      </div>

      {msg && (
        <output
          className={`${BASE}__edit-msg${msg.ok ? "" : ` ${BASE}__edit-msg--error`}`}
        >
          {msg.text}
        </output>
      )}

      <button type="button" className={`${BASE}__edit-done`} onClick={onDone}>
        Done
      </button>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

interface Props {
  opened: boolean;
  setOpened: (v: boolean) => void;
  card: Card<NoteType>;
}

export default function CardInfoModal({ opened, setOpened, card }: Props) {
  const [wText] = useSetting("#globalScheduler_w");
  const [newDayStartHour] = useSetting("#newDayStartHour");
  const [expandedHistory, setExpandedHistory] = useState<Set<string>>(
    new Set()
  );
  const [editingCardId, setEditingCardId] = useState<string | null>(null);

  const w = (wText ?? defaultSettings["#globalScheduler_w"])
    .split(",")
    .map(Number);

  const data = useLiveQuery(async () => {
    const note = await db.notes.get(card.note);
    if (!note) return null;
    const cards = await db.cards.where("note").equals(note.id).toArray();
    const deck = await db.decks.get(note.deck);
    const preset = deck?.options.presetId
      ? await db.presets.get(deck.options.presetId)
      : undefined;
    const logs = await db.reviewLogs
      .where("card")
      .anyOf(cards.map((c) => c.id))
      .sortBy("reviewedAt");
    const logsByCard = new Map<string, ReviewLogRecord[]>();
    for (const log of logs) {
      const arr = logsByCard.get(log.card) ?? [];
      arr.push(log);
      logsByCard.set(log.card, arr);
    }
    return { note, cards, deck, preset, logsByCard };
  }, [card.note, card.id, opened]);

  // Content editing state — reset when note changes
  const [front, setFront] = useState("");
  const [back, setBack] = useState("");
  const [field1, setField1] = useState("");
  const [field2, setField2] = useState("");
  const [contentDirty, setContentDirty] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!data?.note) return;
    const c = data.note.content;
    if (c.type === NoteType.Basic) {
      const bc = c as typeof c & { front: string; back: string };
      setFront(bc.front ?? "");
      setBack(bc.back ?? "");
    } else if (c.type === NoteType.DoubleSided) {
      const dc = c as typeof c & { field1: string; field2: string };
      setField1(dc.field1 ?? "");
      setField2(dc.field2 ?? "");
    }
    setContentDirty(false);
  }, [data?.note?.id]);

  if (data === undefined) return null; // loading
  if (data === null) {
    return (
      <Modal
        opened={opened}
        onClose={() => setOpened(false)}
        title="Card Information"
      >
        <Text variant="dimmed">Note not found.</Text>
      </Modal>
    );
  }

  const { note, cards, deck, preset, logsByCard } = data;

  async function saveContent() {
    setSaving(true);
    try {
      if (note.content.type === NoteType.Basic) {
        await updateNoteContent(note.id, {
          type: NoteType.Basic,
          front,
          back,
        });
      } else if (note.content.type === NoteType.DoubleSided) {
        await updateNoteContent(note.id, {
          type: NoteType.DoubleSided,
          field1,
          field2,
        });
      }
      setContentDirty(false);
    } finally {
      setSaving(false);
    }
  }

  function discardContent() {
    setContentDirty(false);
    const c = note.content;
    if (c.type === NoteType.Basic) {
      const bc = c as typeof c & { front: string; back: string };
      setFront(bc.front ?? "");
      setBack(bc.back ?? "");
    } else if (c.type === NoteType.DoubleSided) {
      const dc = c as typeof c & { field1: string; field2: string };
      setField1(dc.field1 ?? "");
      setField2(dc.field2 ?? "");
    }
  }

  const schedulerName = preset?.name ?? "Global Default";
  const isEditable =
    note.content.type === NoteType.Basic ||
    note.content.type === NoteType.DoubleSided;

  function toggleHistory(cardId: string) {
    setExpandedHistory((prev) => {
      const next = new Set(prev);
      if (next.has(cardId)) next.delete(cardId);
      else next.add(cardId);
      return next;
    });
  }

  return (
    <Modal
      opened={opened}
      onClose={() => setOpened(false)}
      title={
        <div className={`${BASE}__title-block`}>
          <span className={`${BASE}__title`}>Card Information</span>
          <span className={`${BASE}__subtitle`}>
            View and edit card details
          </span>
        </div>
      }
    >
      <div className={BASE}>
        {/* ── CONTENT ────────────────────────────────────────── */}
        {isEditable && (
          <section className={`${BASE}__section`}>
            <h3 className={`${BASE}__section-label`}>Content</h3>
            {note.content.type === NoteType.Basic ? (
              <>
                <label htmlFor="ci-front" className={`${BASE}__field-label`}>
                  Front
                </label>
                <input
                  id="ci-front"
                  className={`${BASE}__field-input`}
                  value={front}
                  onChange={(e) => {
                    setFront(e.target.value);
                    setContentDirty(true);
                  }}
                />
                <label htmlFor="ci-back" className={`${BASE}__field-label`}>
                  Back
                </label>
                <textarea
                  id="ci-back"
                  className={`${BASE}__field-input ${BASE}__field-input--area`}
                  value={back}
                  rows={3}
                  onChange={(e) => {
                    setBack(e.target.value);
                    setContentDirty(true);
                  }}
                />
              </>
            ) : (
              <>
                <label htmlFor="ci-field1" className={`${BASE}__field-label`}>
                  Field 1
                </label>
                <input
                  id="ci-field1"
                  className={`${BASE}__field-input`}
                  value={field1}
                  onChange={(e) => {
                    setField1(e.target.value);
                    setContentDirty(true);
                  }}
                />
                <label htmlFor="ci-field2" className={`${BASE}__field-label`}>
                  Field 2
                </label>
                <textarea
                  id="ci-field2"
                  className={`${BASE}__field-input ${BASE}__field-input--area`}
                  value={field2}
                  rows={3}
                  onChange={(e) => {
                    setField2(e.target.value);
                    setContentDirty(true);
                  }}
                />
              </>
            )}
            {contentDirty && (
              <div className={`${BASE}__save-row`}>
                <Button
                  variant="primary"
                  size="sm"
                  onClick={saveContent}
                  disabled={saving}
                >
                  {saving ? "Saving…" : "Save"}
                </Button>
                <Button variant="default" size="sm" onClick={discardContent}>
                  Discard
                </Button>
              </div>
            )}
          </section>
        )}

        {/* ── DETAILS ────────────────────────────────────────── */}
        <section className={`${BASE}__section`}>
          <h3 className={`${BASE}__section-label`}>Details</h3>
          <dl className={`${BASE}__details`}>
            <dt>Created</dt>
            <dd>
              <strong>{relativeTime(note.creationDate)}</strong>
              <span className={`${BASE}__dim`}>
                {" "}
                ({absoluteDate(note.creationDate)})
              </span>
            </dd>
            {deck && (
              <>
                <dt>Deck</dt>
                <dd>{deck.name}</dd>
              </>
            )}
            <dt>Cards in note</dt>
            <dd>{cards.length}</dd>
            {note.tags && note.tags.length > 0 && (
              <>
                <dt>Tags</dt>
                <dd className={`${BASE}__tags`}>
                  {note.tags.map((t) => (
                    <span key={t} className={`${BASE}__tag`}>
                      {t}
                    </span>
                  ))}
                </dd>
              </>
            )}
          </dl>
        </section>

        {/* ── SCHEDULER ──────────────────────────────────────── */}
        <section className={`${BASE}__section`}>
          <h3 className={`${BASE}__section-label`}>
            Spaced Repetition Scheduler
          </h3>
          <div className={`${BASE}__scheduler-name`}>{schedulerName}</div>
        </section>

        {/* ── FLASHCARDS ─────────────────────────────────────── */}
        <section className={`${BASE}__section`}>
          <h3 className={`${BASE}__section-label`}>Flashcards</h3>
          <div className={`${BASE}__card-list`}>
            {cards.map((c, i) => {
              const m = c.model;
              const isCardNew = m.state === State.New;
              const logs = logsByCard.get(c.id) ?? [];
              const histExpanded = expandedHistory.has(c.id);
              const status = statusInfo(c);
              const mastery = masteryInfo(c, w);
              const label = cardLabel(c, i, cards.length);
              const isEditing = editingCardId === c.id;
              const now = new Date();

              const elapsedDays = m.last_review
                ? (now.getTime() - new Date(m.last_review).getTime()) / DAY_MS
                : 0;
              const recall = isCardNew
                ? null
                : recallAfter(m.stability, elapsedDays, w);

              return (
                <div key={c.id} className={`${BASE}__card`}>
                  {/* Card header */}
                  <div className={`${BASE}__card-header`}>
                    <span className={`${BASE}__card-label`}>{label}</span>
                    <Badge label={status.label} cls={status.cls} />
                    <span className={`${BASE}__mastery`}>
                      Mastery <Badge label={mastery.label} cls={mastery.cls} />
                    </span>
                    <button
                      type="button"
                      className={`${BASE}__edit-btn${isEditing ? ` ${BASE}__edit-btn--active` : ""}`}
                      onClick={() => setEditingCardId(isEditing ? null : c.id)}
                    >
                      {isEditing ? "▲ Hide" : "Edit SRS"}
                    </button>
                  </div>

                  {/* Stats grid */}
                  <div className={`${BASE}__stats`}>
                    <div className={`${BASE}__stat`}>
                      <span className={`${BASE}__stat-label`}>
                        Next Practice
                        <InfoTip>
                          When this card is next scheduled for review.
                        </InfoTip>
                      </span>
                      <span className={`${BASE}__stat-value`}>
                        {isCardNew ? "Not scheduled" : relativeTime(m.due)}
                      </span>
                      {!isCardNew && (
                        <span className={`${BASE}__stat-sub`}>
                          {absoluteDate(m.due)}
                        </span>
                      )}
                    </div>
                    <div className={`${BASE}__stat`}>
                      <span className={`${BASE}__stat-label`}>
                        Last Practiced
                        <InfoTip>
                          The most recent time this card was reviewed.
                        </InfoTip>
                      </span>
                      <span className={`${BASE}__stat-value`}>
                        {relativeTime(m.last_review)}
                      </span>
                      {m.last_review && (
                        <span className={`${BASE}__stat-sub`}>
                          {absoluteDate(m.last_review)}
                        </span>
                      )}
                    </div>
                    <div className={`${BASE}__stat`}>
                      <span className={`${BASE}__stat-label`}>
                        Times Practiced
                        <InfoTip>
                          Total number of review sessions for this card.
                        </InfoTip>
                      </span>
                      <span className={`${BASE}__stat-value`}>{m.reps}</span>
                      <span className={`${BASE}__stat-sub`}>reviews</span>
                    </div>
                    <div className={`${BASE}__stat`}>
                      <span className={`${BASE}__stat-label`}>
                        Recall Chance
                        <InfoTip>
                          Estimated probability you remember this card right
                          now, based on FSRS memory model.
                        </InfoTip>
                      </span>
                      <span className={`${BASE}__stat-value`}>
                        {recall === null ? "—" : `${Math.round(recall * 100)}%`}
                      </span>
                      <span className={`${BASE}__stat-sub`}>
                        {isCardNew
                          ? "not yet studied"
                          : `stability ${m.stability.toFixed(1)}d`}
                      </span>
                    </div>
                  </div>

                  {/* Edit SRS panel */}
                  {isEditing && (
                    <CardEditPanel
                      card={c}
                      onDone={() => setEditingCardId(null)}
                      newDayStartHour={newDayStartHour ?? 4}
                    />
                  )}

                  {/* Practice History toggle */}
                  <button
                    type="button"
                    className={`${BASE}__history-toggle`}
                    onClick={() => toggleHistory(c.id)}
                    aria-expanded={histExpanded}
                  >
                    {histExpanded ? (
                      <IconChevronDown size={13} />
                    ) : (
                      <IconChevronRight size={13} />
                    )}
                    Practice History ({logs.length})
                  </button>

                  {/* Practice History table */}
                  {histExpanded && logs.length === 0 && (
                    <Text
                      size="sm"
                      variant="dimmed"
                      className={`${BASE}__history-empty`}
                    >
                      No practice history yet.
                    </Text>
                  )}
                  {histExpanded && logs.length > 0 && (
                    <div className={`${BASE}__history`}>
                      <table className={`${BASE}__history-table`}>
                        <thead>
                          <tr>
                            <th>Rating</th>
                            <th>Practice Date</th>
                            <th>Target Date</th>
                            <th>
                              Delay
                              <InfoTip>
                                How early (−) or late (+) you reviewed compared
                                to the scheduled date.
                              </InfoTip>
                            </th>
                            <th>
                              Interval
                              <InfoTip>
                                How many days until the next review was
                                scheduled after this session.
                              </InfoTip>
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {[...logs].reverse().map((log) => {
                            const delayMs =
                              log.review.getTime() -
                              new Date(log.due).getTime();
                            const isLate = delayMs > 60 * 60 * 1000;
                            const delayLabel =
                              Math.abs(delayMs) < 60 * 60 * 1000
                                ? "On time"
                                : delayMs > 0
                                  ? `+${formatSpan(delayMs)}`
                                  : `−${formatSpan(-delayMs)}`;

                            const intervalLabel =
                              log.scheduled_days >= 1
                                ? `${Math.round(log.scheduled_days)}d`
                                : log.scheduled_days > 0
                                  ? `${Math.round(log.scheduled_days * 24)}h`
                                  : "—";

                            return (
                              <tr key={log.id}>
                                <td>
                                  <span
                                    className={`${BASE}__rating ${BASE}__rating--${log.rating}`}
                                  >
                                    {RATING_LABEL[log.rating] ??
                                      Rating[log.rating]}
                                  </span>
                                </td>
                                <td>
                                  {absoluteDate(log.review)}
                                  <span className={`${BASE}__dim`}>
                                    {" "}
                                    {relativeTime(log.review)}
                                  </span>
                                </td>
                                <td>{absoluteDate(new Date(log.due))}</td>
                                <td
                                  className={
                                    isLate ? `${BASE}__delay--late` : ""
                                  }
                                >
                                  {delayLabel}
                                </td>
                                <td>{intervalLabel}</td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </section>
      </div>
    </Modal>
  );
}

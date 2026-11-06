import DangerousConfirmModal from "@/components/DangerousConfirmModal";
import { InfoTip } from "@/components/InfoTip/InfoTip";
import { Alert } from "@/components/ui/Alert";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Text } from "@/components/ui/Text";
import { TextInput } from "@/components/ui/TextInput";
import { db } from "@/logic/db";
import { DIMENSIONS, type Domain } from "@/logic/learning/mastery";
import {
  DIMENSION_HELP,
  type DomainScore,
  type ObjectiveDetail,
  type ObjectiveFields,
  describeNext,
  objectivesApi,
} from "@/logic/learning/objectivesClient";
import { useLiveQuery } from "dexie-react-hooks";
import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import AssessmentForm from "./AssessmentForm";
import ObjectiveFormModal from "./ObjectiveFormModal";

function DomainTable({
  domain,
  score,
  minRating,
}: {
  domain: Domain;
  score: DomainScore;
  minRating: number;
}) {
  return (
    <div>
      <Text weight="semibold">
        {domain === "K" ? "Knowledge (K)" : "Skill (S)"}:{" "}
        {score.score === null
          ? `not scored until all 4 are tested (${score.tested}/4)`
          : `${score.score} / 100`}
      </Text>
      <table className="objectives__table">
        <thead>
          <tr>
            <th>Dimension</th>
            <th>Latest rating</th>
            <th>Date</th>
            <th>Hints</th>
            <th>Independent</th>
            <th>Tests</th>
          </tr>
        </thead>
        <tbody>
          {DIMENSIONS[domain].map((dim) => {
            const d = score.dimensions[dim];
            return (
              <tr key={dim}>
                <td>
                  {dim} <InfoTip>{DIMENSION_HELP[dim]}</InfoTip>
                </td>
                <td>
                  {d ? (
                    <Badge color={d.rating >= minRating ? "green" : "red"}>
                      {d.rating} / 4
                    </Badge>
                  ) : (
                    "untested"
                  )}
                </td>
                <td>{d ? new Date(d.at).toLocaleDateString() : ""}</td>
                <td>{d ? d.hints : ""}</td>
                <td>{d ? (d.independent ? "yes" : "no") : ""}</td>
                <td>{d ? d.assessments : ""}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function LinkedCards({
  objective,
  onChanged,
  run,
}: {
  objective: ObjectiveDetail;
  onChanged: () => Promise<void>;
  run: (fn: () => Promise<unknown>, ok?: string) => Promise<void>;
}) {
  const [q, setQ] = useState("");
  const ids = objective.card_ids;
  const linked = useLiveQuery(async () => {
    const cards = await db.cards.bulkGet(ids);
    const notes = await db.notes.bulkGet(cards.map((c) => c?.note ?? ""));
    return ids.map((id, i) => ({ id, text: notes[i]?.sortField ?? null }));
  }, [ids.join(",")]);
  const found = useLiveQuery(async () => {
    const needle = q.trim().toLowerCase();
    if (needle.length < 2) return [];
    const notes = await db.notes
      .filter((n) => n.sortField.toLowerCase().includes(needle))
      .limit(8)
      .toArray();
    const out: { id: string; text: string }[] = [];
    for (const n of notes)
      for (const c of await db.cards.where("note").equals(n.id).toArray())
        out.push({ id: c.id, text: n.sortField });
    return out;
  }, [q]);

  return (
    <div className="objectives__panel">
      <Text weight="semibold">
        Linked cards ({ids.length}){" "}
        <InfoTip>
          Cards that practise this objective. Linking only records the
          connection so coverage can be checked: the cards themselves are never
          changed. Cards that no longer exist are counted as missing.
        </InfoTip>
      </Text>
      <Text variant="dimmed" size="sm">
        {objective.cards.due_now} due now, {objective.cards.new} new,{" "}
        {objective.cards.lapses} lapses
        {objective.cards.missing ? `, ${objective.cards.missing} missing` : ""}.
      </Text>
      {ids.length === 0 && <Text variant="dimmed">No cards linked yet.</Text>}
      <ul className="objectives__list">
        {linked?.map((c) => (
          <li key={c.id} className="objectives__row">
            <span>{c.text ?? "(card not on this device)"}</span>
            <Button
              size="xs"
              onClick={() =>
                void run(async () => {
                  await objectivesApi.link(objective.objective_id, undefined, [
                    c.id,
                  ]);
                  await onChanged();
                })
              }
            >
              Unlink
            </Button>
          </li>
        ))}
      </ul>
      <TextInput
        label="Find a card to link"
        placeholder="Type part of the card text"
        value={q}
        onChange={(e) => setQ(e.currentTarget.value)}
      />
      <ul className="objectives__list">
        {found
          ?.filter((c) => !ids.includes(c.id))
          .map((c) => (
            <li key={c.id} className="objectives__row">
              <span>{c.text}</span>
              <Button
                size="xs"
                onClick={() =>
                  void run(async () => {
                    await objectivesApi.link(objective.objective_id, [c.id]);
                    await onChanged();
                  }, "Linked.")
                }
              >
                Link
              </Button>
            </li>
          ))}
      </ul>
    </div>
  );
}

/** One objective: K and S status, assessment history, linked cards, edit and delete. */
export default function ObjectiveDetailView({ id }: { id: string }) {
  const navigate = useNavigate();
  const [o, setO] = useState<ObjectiveDetail | null>(null);
  const [msg, setMsg] = useState<{ error: boolean; text: string } | null>(null);
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState<{
    token: string;
    text: string;
  } | null>(null);

  const run = useCallback(async (fn: () => Promise<unknown>, ok?: string) => {
    try {
      await fn();
      setMsg(ok ? { error: false, text: ok } : null);
    } catch (e) {
      setMsg({ error: true, text: (e as Error).message });
    }
  }, []);
  const reload = useCallback(async () => {
    setO(await objectivesApi.get(id));
  }, [id]);
  useEffect(() => {
    void run(reload);
  }, [reload, run]);

  if (!o)
    return msg ? (
      <Alert variant="error">{msg.text}</Alert>
    ) : (
      <Text variant="dimmed">Loading...</Text>
    );

  const minRating = o.mastery_rules.min_rating;
  const initial: ObjectiveFields = {
    title: o.title,
    description: o.description ?? undefined,
    priority: o.priority,
    track: o.track,
    status: o.status,
  };

  return (
    <>
      <div className="objectives__bar">
        <div>
          <Text weight="semibold" size="lg">
            {o.title}
          </Text>
          <div className="objectives__row">
            <Badge color="primary">{o.priority}</Badge>
            <Badge color="neutral">
              {o.track === "KS" ? "K and S" : "K only"}
            </Badge>
            <Badge color="neutral">{o.status}</Badge>
            {o.mastered && <Badge color="green">mastered</Badge>}
          </div>
        </div>
        <div className="objectives__row">
          <Button size="sm" onClick={() => setEditing(true)}>
            Edit
          </Button>
          <Button
            size="sm"
            variant="destructive"
            onClick={() =>
              void run(async () => {
                const p = await objectivesApi.previewDelete(o.objective_id);
                setDeleting({
                  token: p.confirm_token,
                  text: `This deletes "${p.will_delete.objective}" with ${p.will_delete.evidence} piece(s) of evidence and ${p.will_delete.card_links} card link(s). The cards are kept. Evidence is the proof of learning: consider parking or finishing the objective instead.`,
                });
              })
            }
          >
            Delete
          </Button>
        </div>
      </div>
      {msg && (
        <Alert variant={msg.error ? "error" : "success"}>{msg.text}</Alert>
      )}
      {o.description && <Text>{o.description}</Text>}

      <div className="objectives__panel">
        <Text weight="semibold">
          Mastery{" "}
          <InfoTip>
            Mastered needs, for every tracked domain: all four dimensions
            tested, a score of {o.mastery_rules.min_score} or more, no dimension
            under {o.mastery_rules.min_rating}, unaided recall and explanation,
            independent work on every skill, and a second good result on each
            dimension at least {o.mastery_rules.retest_days} days after the
            first. It is a study rubric, not a certification.
          </InfoTip>
        </Text>
        <Text>Next: {describeNext(o.next)}</Text>
        {o.blockers.length > 0 && (
          <ul>
            {o.blockers.map((b) => (
              <li key={b}>{b}</li>
            ))}
          </ul>
        )}
        <DomainTable domain="K" score={o.K} minRating={minRating} />
        {o.S && <DomainTable domain="S" score={o.S} minRating={minRating} />}
      </div>

      <AssessmentForm
        track={o.track}
        onSubmit={async (a) => {
          await objectivesApi.assess(o.objective_id, {
            ...a,
            source: "app",
            idempotency_key: crypto.randomUUID(),
          });
          await reload();
        }}
      />

      <div className="objectives__panel">
        <Text weight="semibold">Assessment history ({o.evidence.length})</Text>
        {o.evidence.length === 0 && (
          <Text variant="dimmed">No evidence recorded yet.</Text>
        )}
        <ul className="objectives__list">
          {o.evidence.map((e) => (
            <li key={e.assessment_id}>
              <div className="objectives__row">
                <Badge color={e.rating >= minRating ? "green" : "red"}>
                  {e.rating} / 4
                </Badge>
                <strong>
                  {e.domain} {e.dimension}
                </strong>
                <Text variant="dimmed" size="sm">
                  {new Date(e.at).toLocaleString()}, {e.hints} hint(s),{" "}
                  {e.independent ? "independent" : "coached"}
                  {e.source ? `, ${e.source}` : ""}
                </Text>
              </div>
              <p className="objectives__evidence">{e.evidence}</p>
            </li>
          ))}
        </ul>
      </div>

      <LinkedCards objective={o} onChanged={reload} run={run} />

      {editing && (
        <ObjectiveFormModal
          opened
          initial={initial}
          onClose={() => setEditing(false)}
          onSave={async (f) => {
            await objectivesApi.update(o.objective_id, {
              title: f.title,
              description: f.description,
              priority: f.priority,
              track: f.track,
              status: f.status,
            });
            await reload();
          }}
        />
      )}
      <DangerousConfirmModal
        opened={!!deleting}
        setOpened={(v: boolean) => !v && setDeleting(null)}
        dangerousTitle="Delete objective"
        dangerousDescription={deleting?.text}
        dangerousDependencies={[deleting]}
        dangerousAction={() =>
          void run(async () => {
            if (!deleting) return;
            await objectivesApi.confirmDelete(o.objective_id, deleting.token);
            navigate("/objectives");
          })
        }
      />
    </>
  );
}

import { LabelWithTip } from "@/components/InfoTip/InfoTip";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { Select } from "@/components/ui/Select";
import { TextInput } from "@/components/ui/TextInput";
import { Textarea } from "@/components/ui/Textarea";
import { useDecks } from "@/logic/deck/hooks/useDecks";
import type {
  ObjectiveFields,
  ObjectiveStatus,
  Priority,
} from "@/logic/learning/objectivesClient";
import { useState } from "react";

interface Props {
  opened: boolean;
  onClose: () => void;
  /** Present when editing. */
  initial?: ObjectiveFields;
  onSave: (f: ObjectiveFields) => Promise<void>;
}

const NO_DECK = "";

/** Create or edit an objective. Same limits as the server: title up to 200, description up to 4000. */
export default function ObjectiveFormModal({
  opened,
  onClose,
  initial,
  onSave,
}: Props) {
  const [decks] = useDecks();
  const [title, setTitle] = useState(initial?.title ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [deckId, setDeckId] = useState(initial?.deck_id ?? NO_DECK);
  const [priority, setPriority] = useState<Priority>(initial?.priority ?? "P1");
  const [track, setTrack] = useState<"K" | "KS">(initial?.track ?? "KS");
  const [status, setStatus] = useState<ObjectiveStatus>(
    initial?.status ?? "active"
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const ok = title.trim().length > 0 && title.length <= 200;

  async function save() {
    setBusy(true);
    setError(null);
    try {
      await onSave({
        title: title.trim(),
        description: description.trim() || undefined,
        deck_id: deckId || undefined,
        priority,
        track,
        status,
      });
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title={initial ? "Edit objective" : "New objective"}
    >
      <div className="objectives__form">
        <TextInput
          label="Title"
          description="What the learner should be able to do or know."
          value={title}
          maxLength={200}
          onChange={(e) => setTitle(e.currentTarget.value)}
        />
        <Textarea
          label="Description"
          value={description}
          maxLength={4000}
          minRows={3}
          onChange={(e) => setDescription(e.currentTarget.value)}
        />
        {!initial && (
          <Select
            label={
              <LabelWithTip tip="Optional. Links the objective to a deck so you can find it from there. It cannot be changed later.">
                Deck
              </LabelWithTip>
            }
            value={deckId}
            onChange={setDeckId}
            options={[
              { value: NO_DECK, label: "No deck" },
              ...(decks ?? []).map((d) => ({ value: d.id, label: d.name })),
            ]}
          />
        )}
        <Select
          label={
            <LabelWithTip tip="P0 must be learned, P1 is the default, P2 is nice to have. Objectives are listed P0 first.">
              Priority
            </LabelWithTip>
          }
          value={priority}
          onChange={(v) => setPriority(v as Priority)}
          options={[
            { value: "P0", label: "P0: must" },
            { value: "P1", label: "P1: default" },
            { value: "P2", label: "P2: nice to have" },
          ]}
        />
        <Select
          label={
            <LabelWithTip tip="K tracks Knowledge only. K and S also tracks Skill (build, debug, test, adapt). Mastery needs every tracked domain to pass.">
              Track
            </LabelWithTip>
          }
          value={track}
          onChange={(v) => setTrack(v as "K" | "KS")}
          options={[
            { value: "KS", label: "K and S: Knowledge and Skill" },
            { value: "K", label: "K: Knowledge only" },
          ]}
        />
        {initial && (
          <Select
            label={
              <LabelWithTip tip="Park an objective that is not worth more time now, or mark it done. Evidence is never removed by a status change.">
                Status
              </LabelWithTip>
            }
            value={status}
            onChange={(v) => setStatus(v as ObjectiveStatus)}
            options={[
              { value: "active", label: "Active" },
              { value: "parked", label: "Parked" },
              { value: "done", label: "Done" },
            ]}
          />
        )}
        {error && <Alert variant="error">{error}</Alert>}
        <div>
          <Button
            variant="primary"
            disabled={!ok || busy}
            onClick={() => void save()}
          >
            {initial ? "Save changes" : "Create objective"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

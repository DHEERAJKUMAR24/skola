import { LabelWithTip } from "@/components/InfoTip/InfoTip";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { Checkbox } from "@/components/ui/Checkbox";
import { NumberInput } from "@/components/ui/NumberInput";
import { Select } from "@/components/ui/Select";
import { Textarea } from "@/components/ui/Textarea";
import {
  type AssessmentInput,
  validateAssessment,
} from "@/logic/learning/assessmentForm";
import {
  DIMENSIONS,
  type Domain,
  RATING_LABELS,
  type Track,
} from "@/logic/learning/mastery";
import { DIMENSION_HELP } from "@/logic/learning/objectivesClient";
import { useState } from "react";

interface Props {
  track: Track;
  /** Resolves when saved; a rejection is shown under the form. */
  onSubmit: (a: AssessmentInput) => Promise<void>;
}

/** Records evidence by hand. The same checks the server runs are shown before anything is sent. */
export default function AssessmentForm({ track, onSubmit }: Props) {
  const [domain, setDomain] = useState<Domain>("K");
  const [dimension, setDimension] = useState<string>(DIMENSIONS.K[0]);
  const [rating, setRating] = useState(3);
  const [evidence, setEvidence] = useState("");
  const [hints, setHints] = useState(0);
  const [independent, setIndependent] = useState(true);
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState<string | null>(null);
  const [serverError, setServerError] = useState<string | null>(null);

  const input: AssessmentInput = {
    domain,
    dimension,
    rating,
    evidence,
    hints,
    independent,
  };
  const problem = validateAssessment(track, input);
  const shownProblem = evidence ? problem : null;

  const pickDomain = (d: Domain) => {
    setDomain(d);
    setDimension(DIMENSIONS[d][0]);
  };

  async function submit() {
    if (problem) return;
    setBusy(true);
    setServerError(null);
    setSent(null);
    try {
      await onSubmit({ ...input, evidence: evidence.trim() });
      setEvidence("");
      setHints(0);
      setSent("Saved.");
    } catch (e) {
      setServerError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="objectives__panel">
      <LabelWithTip tip="Evidence is dated proof that the learner did something: what they answered or produced and how it was judged. Only record real learner work, never a guess. The time is set by the server, so a later retest cannot be backdated. A 4 means strong and unaided, so it needs 0 hints and independent work.">
        Record an assessment
      </LabelWithTip>
      <Select
        label="Domain"
        value={domain}
        onChange={(v) => pickDomain(v as Domain)}
        options={[
          { value: "K", label: "K: Knowledge" },
          ...(track === "KS" ? [{ value: "S", label: "S: Skill" }] : []),
        ]}
      />
      <Select
        label={
          <LabelWithTip tip={DIMENSION_HELP[dimension] ?? ""}>
            Dimension
          </LabelWithTip>
        }
        value={dimension}
        onChange={setDimension}
        options={DIMENSIONS[domain].map((d) => ({ value: d, label: d }))}
      />
      <Select
        label="Rating"
        value={String(rating)}
        onChange={(v) => setRating(Number(v))}
        options={RATING_LABELS.map((l, i) => ({
          value: String(i),
          label: `${i} ${l}`,
        }))}
      />
      <Textarea
        label="Evidence"
        description="What the learner actually answered or produced, and how you judged it."
        value={evidence}
        minRows={3}
        maxLength={4000}
        onChange={(e) => setEvidence(e.currentTarget.value)}
      />
      <NumberInput
        label={
          <LabelWithTip tip="How many hints the learner needed. Any hint rules out a 4.">
            Hints
          </LabelWithTip>
        }
        value={hints}
        min={0}
        max={20}
        onChange={(v) => setHints(Number(v) || 0)}
      />
      <Checkbox
        label={
          <LabelWithTip tip="Untick if the learner was coached through it. Coached work cannot be a 4.">
            Independent work
          </LabelWithTip>
        }
        checked={independent}
        onChange={(e) => setIndependent(e.currentTarget.checked)}
      />
      {shownProblem && <Alert variant="warning">{shownProblem}</Alert>}
      {serverError && <Alert variant="error">{serverError}</Alert>}
      {sent && <Alert variant="success">{sent}</Alert>}
      <div>
        <Button
          variant="primary"
          disabled={busy || !!problem}
          onClick={() => void submit()}
        >
          Save assessment
        </Button>
      </div>
    </div>
  );
}

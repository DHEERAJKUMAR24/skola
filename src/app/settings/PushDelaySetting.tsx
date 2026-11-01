import { NumberInput } from "@/components/ui/NumberInput";
import { Select } from "@/components/ui/Select";
import { Stack } from "@/components/ui/Stack";
import {
  MAX_PUSH_DELAY_MS,
  MIN_PUSH_DELAY_MS,
  setPushDelayMs,
  usePushDelayMs,
} from "@/logic/syncSettings";
import { useEffect, useState } from "react";

type Unit = "s" | "min";

const UNIT_MS: Record<Unit, number> = { s: 1000, min: 60_000 };

const PRESETS = [
  { value: "5000", label: "5 seconds" },
  { value: "10000", label: "10 seconds" },
  { value: "30000", label: "30 seconds" },
  { value: "60000", label: "1 minute" },
  { value: "120000", label: "2 minutes" },
  { value: "300000", label: "5 minutes" },
  { value: "600000", label: "10 minutes" },
  { value: "900000", label: "15 minutes" },
];

/** Whole minutes read better as minutes; anything else stays in seconds. */
const split = (ms: number): { amount: number; unit: Unit } =>
  ms % 60_000 === 0
    ? { amount: ms / 60_000, unit: "min" }
    : { amount: ms / 1000, unit: "s" };

export default function PushDelaySetting() {
  const saved = usePushDelayMs();
  const [amount, setAmount] = useState<number | string>(split(saved).amount);
  const [unit, setUnit] = useState<Unit>(split(saved).unit);
  const [error, setError] = useState<string | null>(null);

  // Follow changes made elsewhere (another tab, a preset).
  useEffect(() => {
    const s = split(saved);
    setAmount(s.amount);
    setUnit(s.unit);
    setError(null);
  }, [saved]);

  const commit = (value: number | string, u: Unit) => {
    const ms = Number(value) * UNIT_MS[u];
    if (!Number.isFinite(ms) || value === "") {
      setError("Enter a number");
    } else if (ms < MIN_PUSH_DELAY_MS || ms > MAX_PUSH_DELAY_MS) {
      setError("Choose between 5 seconds and 15 minutes");
    } else {
      setError(null);
      setPushDelayMs(ms);
    }
  };

  return (
    <Stack gap="sm" align="start">
      <Select
        label="Push delay"
        description="How long to wait after your last change before saving to the server. Each new change restarts the wait."
        value={
          PRESETS.some((p) => Number(p.value) === saved) ? String(saved) : ""
        }
        options={[
          ...(PRESETS.some((p) => Number(p.value) === saved)
            ? []
            : [{ value: "", label: "Custom" }]),
          ...PRESETS,
        ]}
        onChange={(v) => v && setPushDelayMs(Number(v))}
      />
      <Stack gap="sm" align="end" style={{ flexDirection: "row" }}>
        <NumberInput
          label="Or type a value"
          value={amount}
          min={1}
          error={error}
          onChange={setAmount}
          onBlur={() => commit(amount, unit)}
          onKeyDown={(e) => e.key === "Enter" && commit(amount, unit)}
        />
        <Select
          value={unit}
          options={[
            { value: "s", label: "seconds" },
            { value: "min", label: "minutes" },
          ]}
          onChange={(value) => {
            const next = value as Unit;
            setUnit(next);
            commit(amount, next);
          }}
        />
      </Stack>
    </Stack>
  );
}

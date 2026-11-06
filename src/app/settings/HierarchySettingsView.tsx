import { InfoTip, LabelWithTip } from "@/components/InfoTip/InfoTip";
import { Button } from "@/components/ui/Button";
import { IconButton } from "@/components/ui/IconButton";
import { Select } from "@/components/ui/Select";
import { Stack } from "@/components/ui/Stack";
import { Text } from "@/components/ui/Text";
import { TextInput } from "@/components/ui/TextInput";
import { db } from "@/logic/db";
import {
  HIERARCHY_MAX_LEVELS,
  HIERARCHY_NAME_MAX,
  HIERARCHY_ROLES,
  HIERARCHY_ROLE_LABELS,
  type HierarchyLevel,
  type HierarchyRole,
  effectiveHierarchy,
  newLevelId,
  normalizeHierarchy,
  sameLevels,
  validateHierarchy,
} from "@/logic/settings/hierarchy";
import { useSetting } from "@/logic/settings/hooks/useSetting";
import { setSetting } from "@/logic/settings/setSetting";
import { IconArrowDown, IconArrowUp, IconTrash } from "@tabler/icons-react";
import { useEffect, useState } from "react";

const ROLE_TIPS: Record<HierarchyRole, string> = {
  deck: "A nested deck. Levels with this role become decks inside each other, top to bottom.",
  master:
    "A master card: the compact list that covers everything in a deck. Optional; most people let masters live in the deepest deck.",
  section:
    "A top-level section inside a master card. Above about 12 entries a master card gets one study card per section.",
  entry:
    "One entry of a master card: a single concept or fact, linked to the card that tests it. The last level.",
};

/**
 * Edits the knowledge hierarchy (default Domain, Subject, Chapter, Concept). Saves on every valid
 * change and syncs. Until the user saves, the default is shown and used.
 */
export default function HierarchySettingsView() {
  const [saved, loaded] = useSetting("#hierarchy");
  const current = effectiveHierarchy(saved);
  const [levels, setLevels] = useState<HierarchyLevel[]>(current.levels);
  const [touched, setTouched] = useState(false);
  const error = validateHierarchy(levels);

  // Follow changes that arrive from sync, unless the user is editing.
  useEffect(() => {
    if (!touched) setLevels(effectiveHierarchy(saved).levels);
  }, [saved, touched]);

  useEffect(() => {
    if (!touched || validateHierarchy(levels)) return;
    const next = normalizeHierarchy(levels);
    if (!sameLevels(next, effectiveHierarchy(saved).levels))
      setSetting("#hierarchy", next);
  }, [touched, levels, saved]);

  if (!loaded) return null;

  const edit = (next: HierarchyLevel[]) => {
    setTouched(true);
    setLevels(next);
  };
  const patch = (i: number, p: Partial<HierarchyLevel>) =>
    edit(levels.map((l, j) => (j === i ? { ...l, ...p } : l)));
  const move = (i: number, d: -1 | 1) => {
    const next = [...levels];
    [next[i], next[i + d]] = [next[i + d], next[i]];
    edit(next);
  };

  return (
    <Stack gap="md" align="start" className="hierarchy-settings">
      <Text weight="semibold">
        <LabelWithTip tip="How you break a field of knowledge down, from the biggest level to the smallest. The roles tell Skola what each level is: nested decks, master card sections or master card entries. Assistants get this description too.">
          Knowledge hierarchy
        </LabelWithTip>
      </Text>
      <Text variant="dimmed">
        {current.isDefault && !touched
          ? "Showing the default: Domain and Subject are nested decks, a Chapter is a section of a master card, a Concept is one entry."
          : "Your own hierarchy. Saved automatically and synced to your devices."}
      </Text>

      <Stack gap="sm" className="hierarchy-settings__levels">
        {levels.map((l, i) => (
          <div
            key={l.id}
            className="hierarchy-settings__row"
            style={{
              display: "flex",
              gap: "var(--spacing-sm)",
              alignItems: "flex-end",
              flexWrap: "wrap",
            }}
          >
            <TextInput
              label={`Level ${i + 1} name`}
              value={l.name}
              maxLength={HIERARCHY_NAME_MAX + 10}
              onChange={(e) => patch(i, { name: e.currentTarget.value })}
            />
            <Select
              label={<LabelWithTip tip={ROLE_TIPS[l.role]}>Role</LabelWithTip>}
              value={l.role}
              options={HIERARCHY_ROLES.map((r) => ({
                value: r,
                label: HIERARCHY_ROLE_LABELS[r],
              }))}
              onChange={(role) => patch(i, { role })}
            />
            <IconButton
              variant="subtle"
              aria-label={`Move ${l.name || "level"} up`}
              disabled={i === 0}
              onClick={() => move(i, -1)}
            >
              <IconArrowUp />
            </IconButton>
            <IconButton
              variant="subtle"
              aria-label={`Move ${l.name || "level"} down`}
              disabled={i === levels.length - 1}
              onClick={() => move(i, 1)}
            >
              <IconArrowDown />
            </IconButton>
            <IconButton
              variant="subtle"
              aria-label={`Remove ${l.name || "level"}`}
              disabled={levels.length <= 1}
              onClick={() => edit(levels.filter((_, j) => j !== i))}
            >
              <IconTrash />
            </IconButton>
          </div>
        ))}
      </Stack>

      {error && <Text variant="dimmed">{error} (Not saved yet.)</Text>}

      <div style={{ display: "flex", gap: "var(--spacing-sm)" }}>
        <Button
          size="sm"
          disabled={levels.length >= HIERARCHY_MAX_LEVELS}
          onClick={() =>
            edit([
              ...levels.slice(0, -1),
              {
                id: newLevelId(
                  levels.map((l) => l.id),
                  "level"
                ),
                name: `Level ${levels.length}`,
                role: "section",
              },
              ...levels.slice(-1),
            ])
          }
        >
          Add a level
        </Button>
        {(!current.isDefault || touched) && (
          <Button
            size="sm"
            onClick={async () => {
              setTouched(false);
              await db.settings.delete("#hierarchy");
            }}
          >
            Reset to the default
          </Button>
        )}
      </div>
      <Text variant="dimmed">
        A master card covers every concept in a deck, with nothing left out.
        Decks can hold several, and each sub-deck has its own.
        <InfoTip>
          Most of your studying happens on master cards. Each entry points at
          one card; Skola then shows which cards are in no entry and which
          entries point at nothing.
        </InfoTip>
      </Text>
    </Stack>
  );
}

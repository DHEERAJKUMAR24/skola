import { InfoTip, LabelWithTip } from "@/components/InfoTip/InfoTip";
import { Button } from "@/components/ui/Button";
import { Stack } from "@/components/ui/Stack";
import { Text } from "@/components/ui/Text";
import { Textarea } from "@/components/ui/Textarea";
import { useDebouncedValue } from "@/lib/hooks/useDebouncedValue";
import { db } from "@/logic/db";
import {
  AI_INSTRUCTIONS_EXAMPLE,
  AI_INSTRUCTIONS_INLINE_MAX,
  AI_INSTRUCTIONS_MAX,
  effectiveInstructions,
  normalizeInstructions,
  validateInstructions,
} from "@/logic/settings/aiInstructions";
import { useSetting } from "@/logic/settings/hooks/useSetting";
import { setSetting } from "@/logic/settings/setSetting";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";

/**
 * Standing instructions that every AI assistant connected to Skola receives. Until the user saves
 * their own, the built-in default is shown and used; clearing the box on purpose means none.
 */
export default function AiSettingsView() {
  const [saved, loaded] = useSetting("#aiInstructions");
  const current = effectiveInstructions(saved);
  const [text, setText] = useState(current.text);
  const [touched, setTouched] = useState(false);
  const [debounced] = useDebouncedValue(text, 500);
  const error = validateInstructions(text);

  // Follow changes that arrive from sync or from an assistant, unless the user is typing.
  useEffect(() => {
    if (!touched) setText(effectiveInstructions(saved).text);
  }, [saved, touched]);

  useEffect(() => {
    if (!touched || validateInstructions(debounced)) return;
    const next = normalizeInstructions(debounced);
    if (next !== effectiveInstructions(saved).text)
      setSetting("#aiInstructions", next);
  }, [touched, debounced, saved]);

  if (!loaded) return null;

  const status = current.isDefault
    ? "Showing Skola's default instructions, which assistants already follow. Edit them to make them your own."
    : text.trim()
      ? "These are your own instructions."
      : "No instructions: assistants rely on their skills only.";

  return (
    <Stack gap="md" align="start" className="ai-settings">
      <Textarea
        label={
          <LabelWithTip
            tip={`Your standing instructions for AI assistants such as ChatGPT or Claude. Every assistant connected to Skola gets them at the start of a session, so you do not repeat yourself. They are preferences: they never override the safety rules (assistants still ask before deleting and never grade for you). The first ${AI_INSTRUCTIONS_INLINE_MAX} characters go in at once; the assistant reads the rest on demand.`}
          >
            Instructions for AI assistants
          </LabelWithTip>
        }
        description="How you want cards written, how you want to be quizzed, your subjects, your tags and your language."
        placeholder={AI_INSTRUCTIONS_EXAMPLE}
        value={text}
        minRows={10}
        maxLength={AI_INSTRUCTIONS_MAX + 500}
        error={error}
        onChange={(e) => {
          setTouched(true);
          setText(e.currentTarget.value);
        }}
        style={{ width: "100%", maxWidth: 720 }}
      />
      <Text variant="dimmed">
        {status} {text.length} / {AI_INSTRUCTIONS_MAX} characters. Saved
        automatically and synced to your devices.
      </Text>
      {!current.isDefault && (
        <Button
          size="sm"
          onClick={async () => {
            setTouched(false);
            await db.settings.delete("#aiInstructions");
          }}
        >
          Reset to the default instructions
        </Button>
      )}
      <Text variant="dimmed">
        Assistants can also read and change these with the get_instructions and
        set_instructions tools. To teach an assistant a whole workflow, edit
        your skills: <Link to="/settings/skills">open the skills editor</Link>
        <InfoTip>
          Skills are longer playbooks with their own files. Your own skill with
          the same name replaces a default one, for you only.
        </InfoTip>
        .
      </Text>
    </Stack>
  );
}

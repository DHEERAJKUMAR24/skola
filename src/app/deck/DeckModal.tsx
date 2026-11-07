import type ModalProps from "@/components/ModalProps";
import { Button, Modal, TextInput } from "@/components/ui";
import { ColorIdentifier } from "@/lib/ColorIdentifier";
import { useHotkeys } from "@/lib/hooks/useHotkeys";
import { db } from "@/logic/db";
import type { Deck } from "@/logic/deck/deck";
import { validateDeckName } from "@/logic/deck/deckPath";
import { type ExamForm, fromExamForm, toExamForm } from "@/logic/deck/examForm";
import { newDeck } from "@/logic/deck/newDeck";
import {
  DEFAULT_PRESET_ID,
  ensureDefaultPreset,
  usePresets,
} from "@/logic/deck/presets";
import { updateDeck } from "@/logic/deck/updateDeck";
import { resolveExam } from "@/logic/scheduling/policy";
import { useLiveQuery } from "dexie-react-hooks";
import { t } from "i18next";
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import DeckColorChooser from "./DeckColorChooser";
import "./DeckModal.css";
import DeckStudyFields from "./DeckStudyFields";

const BASE = "deck-modal";
const NAME_MAX = 100;

interface DeckModalProps extends ModalProps {
  mode: "create" | "edit";
  deck?: Deck;
  superDeck?: Deck;
}

function DeckModal({
  opened,
  setOpened,
  mode,
  deck,
  superDeck,
}: DeckModalProps) {
  const navigate = useNavigate();
  const presets = usePresets();

  const [nameValue, setNameValue] = useState<string>("");
  const [nameTouched, setNameTouched] = useState(false);
  const [descriptionValue, setDescriptionValue] = useState<string>("");
  const [deckColor, setDeckColor] = useState<ColorIdentifier>("sky");
  const [presetId, setPresetId] = useState<string>(DEFAULT_PRESET_ID);
  const [exam, setExam] = useState<ExamForm>(toExamForm());
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [status, setStatus] = useState<string | null>(null);

  useEffect(() => {
    void ensureDefaultPreset();
  }, []);

  useEffect(() => {
    setNameTouched(false);
    if (mode === "edit" && deck) {
      setNameValue(deck.name);
      setDescriptionValue(deck.description || "");
      setDeckColor(deck.color || "sky");
      // "" = an older deck that has its own settings and no preset yet.
      setPresetId(deck.options?.presetId ?? "");
      setExam(toExamForm(deck.options));
    } else {
      setNameValue("");
      setDescriptionValue("");
      setDeckColor("sky");
      // A sub-deck starts with its parent's preset. The exam date is inherited, not copied.
      setPresetId(superDeck?.options?.presetId ?? DEFAULT_PRESET_ID);
      setExam(toExamForm());
    }
  }, [mode, deck, superDeck, opened]);

  const decksById = useLiveQuery(
    async () => new Map((await db.decks.toArray()).map((d) => [d.id, d])),
    []
  );
  // The exam a deck would use if it had no date of its own: its nearest ancestor's.
  const inherited = useMemo(() => {
    if (!decksById) return undefined;
    const base = mode === "edit" ? deck : superDeck;
    if (!base) return undefined;
    const probe =
      mode === "edit"
        ? { ...base, options: { ...base.options, examDate: undefined } }
        : base;
    const info = resolveExam(probe, decksById);
    return info
      ? {
          date: info.date,
          deckName: decksById.get(info.sourceDeckId)?.name ?? "a parent deck",
        }
      : undefined;
  }, [decksById, mode, deck, superDeck]);

  const parsed = useMemo(() => fromExamForm(exam), [exam]);
  const examErrors = "errors" in parsed ? parsed.errors : {};
  const ruleError = validateDeckName(nameValue.trim());
  const nameError = !nameTouched
    ? undefined
    : nameValue.trim() === ""
      ? "Give the deck a name"
      : ruleError
        ? t("deck.name-rule", { reason: ruleError })
        : undefined;

  function isInputValid(): boolean {
    return ruleError === null && "options" in parsed;
  }

  function handleClose() {
    setOpened(false);
    setStatus(null);
  }

  async function handleSubmit() {
    setNameTouched(true);
    if (!isInputValid() || !("options" in parsed)) return;
    setIsSubmitting(true);
    setStatus(null);

    try {
      if (mode === "create") {
        const id = await newDeck(
          nameValue.trim(),
          superDeck,
          descriptionValue,
          deckColor,
          { presetId: presetId || DEFAULT_PRESET_ID, ...parsed.options }
        );
        setOpened(false);
        navigate("/deck/" + id);
      } else if (mode === "edit" && deck) {
        await updateDeck(
          deck.id,
          nameValue.trim(),
          descriptionValue,
          deckColor,
          // An older deck left on its own settings keeps them (no preset is written).
          { ...(presetId ? { presetId } : {}), ...parsed.options }
        );
        setOpened(false);
      }
    } catch (error) {
      setStatus(
        `Failed to ${mode === "create" ? "add" : "update"} deck: ${error}`
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter") {
      event.preventDefault();
      void handleSubmit();
    }
  }

  useHotkeys([["mod+Enter", () => handleSubmit()]]);

  const title =
    mode === "create"
      ? superDeck
        ? t("deck.new-deck-modal.new-subdeck", { superDeck: superDeck.name })
        : t("deck.new-deck-modal.new-deck")
      : t("deck.edit.title", { deckName: deck?.name || "" });

  const submitButtonText =
    mode === "create" ? t("deck.new-deck-modal.submit") : t("deck.edit.submit");

  return (
    <Modal opened={opened} onClose={handleClose} title={title}>
      <div className={`${BASE}__form`}>
        <TextInput
          placeholder={t("deck.new-deck-modal.name-placeholder")}
          autoFocus
          label={t("deck.new-deck-modal.name")}
          value={nameValue}
          maxLength={NAME_MAX}
          error={nameError}
          onChange={(e) => setNameValue(e.currentTarget.value)}
          onBlur={() => setNameTouched(true)}
          onKeyDown={handleKeyDown}
        />
        <TextInput
          placeholder={t("deck.new-deck-modal.description-placeholder")}
          label={t("deck.new-deck-modal.description")}
          value={descriptionValue}
          onChange={(e) => setDescriptionValue(e.currentTarget.value)}
          onKeyDown={handleKeyDown}
        />
        <DeckColorChooser deckColor={deckColor} setDeckColor={setDeckColor} />
        <DeckStudyFields
          presets={presets ?? []}
          presetId={presetId}
          onPresetChange={setPresetId}
          showLegacy={mode === "edit" && !deck?.options?.presetId}
          exam={exam}
          examErrors={examErrors}
          onExamChange={setExam}
          inheritedExam={inherited}
          onManagePresets={() => {
            setOpened(false);
            navigate("/settings/presets");
          }}
        />
        {status && <p className={`${BASE}__status`}>{status}</p>}
        <div className={`${BASE}__actions`}>
          <Button variant="default" onClick={handleClose}>
            {t("global.cancel")}
          </Button>
          <Button
            disabled={!isInputValid() || isSubmitting}
            variant="primary"
            onClick={() => void handleSubmit()}
          >
            {isSubmitting ? "..." : submitButtonText}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

export default DeckModal;

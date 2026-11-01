import type ModalProps from "@/components/ModalProps";
import { Button, Modal, TextInput } from "@/components/ui";
import { ColorIdentifier } from "@/lib/ColorIdentifier";
import { useHotkeys } from "@/lib/hooks/useHotkeys";
import type { Deck } from "@/logic/deck/deck";
import {
  FSRS_DEFAULTS,
  type FsrsFormState,
  fromFormState,
  toFormState,
} from "@/logic/deck/fsrsOptions";
import { newDeck } from "@/logic/deck/newDeck";
import { updateDeck } from "@/logic/deck/updateDeck";
import { useSetting } from "@/logic/settings/hooks/useSetting";
import { t } from "i18next";
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import DeckColorChooser from "./DeckColorChooser";
import "./DeckModal.css";
import DeckFsrsFields from "./DeckFsrsFields";

const BASE = "deck-modal";
const NAME_MAX = 60;

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
  const [globalRetention] = useSetting("#globalScheduler_requestRetention");
  const [globalMaxInterval] = useSetting("#globalScheduler_maximumInterval");

  const [nameValue, setNameValue] = useState<string>("");
  const [nameTouched, setNameTouched] = useState(false);
  const [descriptionValue, setDescriptionValue] = useState<string>("");
  const [deckColor, setDeckColor] = useState<ColorIdentifier>("sky");
  const [fsrs, setFsrs] = useState<FsrsFormState>(toFormState());
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [status, setStatus] = useState<string | null>(null);

  useEffect(() => {
    setNameTouched(false);
    if (mode === "edit" && deck) {
      setNameValue(deck.name);
      setDescriptionValue(deck.description || "");
      setDeckColor(deck.color || "sky");
      // Decks made before per-deck FSRS ran on the global settings, so show those, not new-deck defaults.
      const o = deck.options;
      setFsrs(
        toFormState({
          desiredRetention: o?.desiredRetention ?? globalRetention,
          maximumInterval: o?.maximumInterval ?? globalMaxInterval,
          learningSteps: o?.learningSteps ?? FSRS_DEFAULTS.learningSteps,
          relearningSteps: o?.relearningSteps ?? FSRS_DEFAULTS.relearningSteps,
          enableFuzz: o?.enableFuzz ?? false,
        })
      );
    } else {
      setNameValue("");
      setDescriptionValue("");
      setDeckColor("sky");
      // A sub-deck starts from its parent's memory settings.
      setFsrs(toFormState(superDeck?.options));
    }
  }, [mode, deck, superDeck, opened, globalRetention, globalMaxInterval]);

  const parsed = useMemo(() => fromFormState(fsrs), [fsrs]);
  const fsrsErrors = "errors" in parsed ? parsed.errors : {};
  const nameError =
    nameTouched && nameValue.trim() === "" ? "Give the deck a name" : undefined;

  function isInputValid(): boolean {
    return nameValue.trim() !== "" && "options" in parsed;
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
          parsed.options
        );
        setOpened(false);
        navigate("/deck/" + id);
      } else if (mode === "edit" && deck) {
        await updateDeck(
          deck.id,
          nameValue.trim(),
          descriptionValue,
          deckColor,
          parsed.options
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
        <DeckFsrsFields state={fsrs} errors={fsrsErrors} onChange={setFsrs} />
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

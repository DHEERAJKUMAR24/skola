import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";

import { AppBreadcrumbs } from "@/components/AppBreadcrumbs";
import NotFound from "@/components/NotFound";
import SelectDecksHeader from "@/components/SelectDecksHeader";
import { Kbd, Paper, Tooltip } from "@/components/ui";
import { Select, SelectRef } from "@/components/ui/Select";
import { useHotkeys } from "@/lib/hooks/useHotkeys";
import { useOs } from "@/lib/hooks/useOs";
import { getAdapterOfType } from "@/logic/NoteTypeAdapter";
import { NoteTypeLabels } from "@/logic/card/card";
import { useDeckFromUrl } from "@/logic/deck/hooks/useDeckFromUrl";
import { useDecks } from "@/logic/deck/hooks/useDecks";
import { NoteType } from "@/logic/note/note";
import { t } from "i18next";
import { LAST_DECK_KEY } from "../shell/CreateFab";
import { AppHeaderContent } from "../shell/Header/Header";
import NewNotesFooter from "./NewNotesFooter";
import "./NewNotesView.css";

const BASE = "new-notes-view";

function NewNotesView() {
  const navigate = useNavigate();
  const os = useOs();

  const [decks] = useDecks();
  const [deck, isReady] = useDeckFromUrl();
  const [noteType, setNoteType] = useState<NoteType>(NoteType.Basic);
  const [requestedFinish, setRequestedFinish] = useState(false);

  const noteTypeSelectRef = useRef<SelectRef>(null);

  // The floating create button offers this deck next time no deck is open.
  useEffect(() => {
    if (deck) {
      try {
        localStorage.setItem(LAST_DECK_KEY, deck.id);
      } catch {}
    }
  }, [deck]);

  useHotkeys([
    [
      "Mod+J",
      () => {
        noteTypeSelectRef.current?.focus();
        noteTypeSelectRef.current?.click();
      },
    ],
  ]);

  const focusSelectNoteType = useMemo(
    () => () => {
      noteTypeSelectRef.current?.focus();
      noteTypeSelectRef.current?.click();
    },
    []
  );

  const NoteEditor = useMemo(() => {
    return deck
      ? getAdapterOfType(noteType).editor({
          note: null,
          deck: deck,
          mode: "new",
          requestedFinish,
          setRequestedFinish,
          setNoteType,
          focusSelectNoteType,
        })
      : null;
    // requestedFinish is a dependency on purpose: the editor only sees the Add Card button's
    // request when it is rebuilt with the new value.
  }, [deck, noteType, setNoteType, focusSelectNoteType, requestedFinish]);

  if (isReady && !deck) {
    return <NotFound />;
  }

  if (!deck) {
    return null;
  }

  return (
    <div className={BASE}>
      <div className={BASE + "__content"}>
        <AppHeaderContent>
          <AppBreadcrumbs
            segments={[
              { label: deck.name, path: `/deck/${deck.id}` },
              { label: t("note.new.title") },
            ]}
          />
        </AppHeaderContent>

        <div className={BASE + "__editor-container"}>
          <div className={BASE + "__editor-header"}>
            <SelectDecksHeader
              label={t("note.new.adding-to-deck", { deckName: deck.name })}
              decks={decks}
              disableAll
              onSelect={(deckId) => navigate(`/new/${deckId}`)}
            />
            <Tooltip
              label={
                <>
                  {t("note.new.select-note-type.tooltip")}
                  <Kbd>{os === "macos" ? "Cmd" : "Ctrl"} + J</Kbd>
                </>
              }
            >
              <div>
                <Select
                  ref={noteTypeSelectRef}
                  value={noteType}
                  onChange={(type) => {
                    setNoteType((type as NoteType) ?? NoteType.Basic);
                  }}
                  options={[
                    {
                      label: NoteTypeLabels[NoteType.Basic],
                      value: NoteType.Basic,
                    },
                    {
                      label: NoteTypeLabels[NoteType.DoubleSided],
                      value: NoteType.DoubleSided,
                    },
                    {
                      label: NoteTypeLabels[NoteType.Cloze],
                      value: NoteType.Cloze,
                    },
                    {
                      label: NoteTypeLabels[NoteType.MultipleChoice],
                      value: NoteType.MultipleChoice,
                    },
                    {
                      label: NoteTypeLabels[NoteType.List],
                      value: NoteType.List,
                    },
                    {
                      label: NoteTypeLabels[NoteType.Master],
                      value: NoteType.Master,
                    },
                    {
                      label: NoteTypeLabels[NoteType.ImageOcclusion],
                      value: NoteType.ImageOcclusion,
                    },
                  ]}
                />
              </div>
            </Tooltip>
          </div>
          <Paper withBorder withTexture={false}>
            {NoteEditor}
          </Paper>
        </div>
      </div>
      <NewNotesFooter setRequestedFinish={setRequestedFinish} deck={deck} />
    </div>
  );
}

export default NewNotesView;

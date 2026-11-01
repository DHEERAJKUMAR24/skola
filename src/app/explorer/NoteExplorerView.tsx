import { AppHeaderContent } from "@/app/shell/Header/Header";
import { AppBreadcrumbs } from "@/components/AppBreadcrumbs";
import { useDebouncedState } from "@/lib/hooks/useDebouncedState";
import { useDocumentTitle } from "@/lib/hooks/useDocumentTitle";
import { descendantIds } from "@/logic/deck/deckPath";
import { useDecks } from "@/logic/deck/hooks/useDecks";
import { getNote } from "@/logic/note/getNote";
import { useNotesWith } from "@/logic/note/hooks/useNotesWith";
import { NoteSortFunction, NoteSorts } from "@/logic/note/sort";
import { useAllTags } from "@/logic/note/tags";
import { t } from "i18next";
import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import NoteTable from "../NoteTable/NoteTable";
import EditNoteModal from "../editor/EditNoteModal";
import { EditNoteView } from "../editor/EditNoteView";
import { NoteBulkBar } from "./NoteBulkBar";
import { NoteExplorerControls } from "./NoteExplorerControls";
import { useNoteSelection } from "./hooks/useNoteSelection";
import "./NoteExplorerView.css";

const BASE = "note-explorer-view";
const ALL_DECKS_ID = "all";

type SortKey = keyof typeof NoteSorts;

function isValidSortKey(key: string | null): key is SortKey {
  return key !== null && key in NoteSorts;
}

function NoteExplorerView() {
  useDocumentTitle(`${t("manage-cards.title")} | Skola`);
  const [searchParams, setSearchParams] = useSearchParams();

  const deckParam = searchParams.get("deck");
  const noteParam = searchParams.get("note");
  const sortParam = searchParams.get("sort");
  const sortDirParam = searchParams.get("sortDir");
  const tagParam = searchParams.get("tag") ?? undefined;

  const deckId =
    deckParam === ALL_DECKS_ID ? undefined : (deckParam ?? undefined);

  const [decks] = useDecks();
  const allTags = useAllTags();

  const [filter, setFilter, immediateFilter] = useDebouncedState<string>(
    "",
    50
  );

  const initialSortFunction: NoteSortFunction =
    sortParam && isValidSortKey(sortParam)
      ? NoteSorts[sortParam]
      : NoteSorts.bySortField;
  const initialSortDirection =
    sortDirParam !== null ? sortDirParam === "asc" : true;

  const [sort, setSortState] = useState<[NoteSortFunction, boolean]>([
    initialSortFunction,
    initialSortDirection,
  ]);

  const setSort = useCallback(
    (newSort: [NoteSortFunction, boolean]) => {
      setSortState(newSort);
      const sortKey = Object.entries(NoteSorts).find(
        ([, fn]) => fn === newSort[0]
      )?.[0];
      if (sortKey) {
        setSearchParams((prev) => {
          const next = new URLSearchParams(prev);
          next.set("sort", sortKey);
          next.set("sortDir", newSort[1] ? "asc" : "desc");
          return next;
        });
      }
    },
    [setSearchParams]
  );

  const deckScope = deckId ? descendantIds(deckId, decks ?? []) : undefined;

  const [notes] = useNotesWith(
    (n) =>
      n
        .orderBy("sortField")
        .filter((note) => {
          const f = filter.toLowerCase();
          const matchesText =
            note.sortField.toLowerCase().includes(f) ||
            !!note.tags?.some((t) => t.includes(f));
          // Showing a domain or subject includes everything below it.
          const inDeck = deckScope === undefined || deckScope.has(note.deck);
          const hasTag = !tagParam || !!note.tags?.includes(tagParam);
          return matchesText && inDeck && hasTag;
        })
        .toArray()
        .then((m) => m.sort(sort[0](sort[1] ? 1 : -1))),
    [deckId, filter, sort, tagParam, decks]
  );

  const [editNoteModalOpened, setEditNoteModalOpened] =
    useState<boolean>(false);

  const openModal = useCallback(() => {
    setEditNoteModalOpened(true);
  }, []);

  const closeModal = useCallback(() => {
    setEditNoteModalOpened(false);
  }, []);

  const {
    selectedNoteIds,
    openedNote,
    setOpenedNote,
    handleNoteClick,
    handleKeyDown,
    setRowRef,
  } = useNoteSelection({ notes });

  const tableRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (noteParam) {
      getNote(noteParam).then((note) => {
        if (note) {
          setOpenedNote(note);
        }
      });
    }
  }, [noteParam, setOpenedNote]);

  useEffect(() => {
    const element = tableRef.current;
    if (element) {
      element.addEventListener("keydown", handleKeyDown);
      return () => element.removeEventListener("keydown", handleKeyDown);
    }
  }, [handleKeyDown]);

  const handleTagSelect = useCallback(
    (tag: string | null) => {
      setSearchParams((prev) => {
        const next = new URLSearchParams(prev);
        if (tag) next.set("tag", tag);
        else next.delete("tag");
        next.delete("note");
        return next;
      });
    },
    [setSearchParams]
  );

  const handleDeckSelect = useCallback(
    (selectedDeckId: string | null) => {
      setSearchParams((prev) => {
        const next = new URLSearchParams(prev);
        if (!selectedDeckId || selectedDeckId === ALL_DECKS_ID) {
          next.delete("deck");
        } else {
          next.set("deck", selectedDeckId);
        }
        next.delete("note");
        return next;
      });
    },
    [setSearchParams]
  );

  return (
    <div className={BASE}>
      <AppHeaderContent>
        <AppBreadcrumbs segments={[{ label: t("manage-cards.title") }]} />
      </AppHeaderContent>

      <NoteExplorerControls
        decks={decks}
        selectedDeckParam={deckParam ?? ""}
        onDeckSelect={handleDeckSelect}
        filterValue={immediateFilter}
        onFilterChange={setFilter}
        tags={allTags}
        selectedTag={tagParam ?? ""}
        onTagSelect={handleTagSelect}
      />

      {selectedNoteIds.size > 0 && (
        <NoteBulkBar selectedIds={[...selectedNoteIds]} decks={decks} />
      )}

      <div className={`${BASE}__container`}>
        <section
          className={`${BASE}__table-section`}
          ref={tableRef}
          tabIndex={0}
          aria-label="Note list"
          onKeyDown={(e) => {
            if (e.key === "ArrowDown" || e.key === "ArrowUp") {
              e.preventDefault();
            }
          }}
        >
          {notes && (
            <NoteTable
              noteSet={notes ?? []}
              openedNote={openedNote}
              selectedNoteIds={selectedNoteIds}
              onNoteClick={handleNoteClick}
              onSetRowRef={setRowRef}
              openModal={openModal}
              sort={sort}
              setSort={setSort}
            />
          )}
        </section>

        <section className={`${BASE}__note-display`}>
          <EditNoteView note={openedNote} setOpenedNote={setOpenedNote} />
        </section>
      </div>

      {openedNote && (
        <EditNoteModal
          note={openedNote}
          setClose={closeModal}
          opened={editNoteModalOpened}
        />
      )}
    </div>
  );
}

export default NoteExplorerView;

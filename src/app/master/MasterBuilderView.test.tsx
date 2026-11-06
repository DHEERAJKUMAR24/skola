import "fake-indexeddb/auto";
import "@/i18n";
import { getAdapterOfType } from "@/logic/NoteTypeAdapter";
import { db } from "@/logic/db";
import { newDeck } from "@/logic/deck/newDeck";
import { newMasterEntry, newMasterSection } from "@/logic/master/masterModel";
import { NoteType } from "@/logic/note/note";
import { BasicNoteTypeAdapter } from "@/logic/type-implementations/normal/BasicNote";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import MasterBuilderView from "./MasterBuilderView";

// jsdom has no Popover API, which the Select uses.
beforeAll(() => {
  HTMLElement.prototype.hidePopover = () => {};
  HTMLElement.prototype.showPopover = () => {};
});

const renderAt = (noteId: string) =>
  render(
    <MemoryRouter initialEntries={[`/master/${noteId}`]}>
      <Routes>
        <Route path="/master/:noteId" element={<MasterBuilderView />} />
      </Routes>
    </MemoryRouter>
  );

describe("MasterBuilderView", () => {
  let deckId: string;
  beforeEach(async () => {
    await Promise.all(db.tables.map((t) => t.clear()));
    deckId = await newDeck("Deck");
  });

  it("renders sections, shows coverage with an orphan, adds orphans, reorders and saves", async () => {
    const deck = (await db.decks.get(deckId)) as never;
    const orphanNote = (await BasicNoteTypeAdapter.createNote(
      { front: "Orphan card", back: "b" } as never,
      deck
    )) as string;
    expect(orphanNote).toBeTruthy();
    const noteId = (await getAdapterOfType(NoteType.Master).createNote(
      {
        title: "My master",
        sections: [
          newMasterSection("One", [
            newMasterEntry("first"),
            newMasterEntry("second"),
          ]),
          newMasterSection("Two", [newMasterEntry("third")]),
        ],
      },
      deck
    )) as string;

    renderAt(noteId);
    expect(await screen.findByDisplayValue("My master")).toBeInTheDocument();
    expect(screen.getByDisplayValue("first")).toBeInTheDocument();
    expect(await screen.findByTestId("coverage-panel")).toBeInTheDocument();
    // the orphan is reported, with an add-all fix
    const addAll = await screen.findByRole("button", {
      name: /Add all 1 as entries/,
    });
    fireEvent.click(addAll);
    expect(await screen.findByDisplayValue("Orphan card")).toBeInTheDocument();

    // move "first" down: it goes below "second"
    const downs = screen.getAllByRole("button", { name: "Move down" });
    fireEvent.click(downs[0]);

    await waitFor(
      async () => {
        const n = (await db.notes.get(noteId)) as never as {
          content: {
            sections: { title: string; entries: { text: string }[] }[];
          };
        };
        expect(n.content.sections[0].entries.map((e) => e.text)).toEqual([
          "second",
          "first",
        ]);
        const all = n.content.sections.flatMap((s) =>
          s.entries.map((e) => e.text)
        );
        expect(all).toContain("Orphan card");
      },
      { timeout: 4000 }
    );
  });

  it("handles a 320 entry master", async () => {
    const deck = (await db.decks.get(deckId)) as never;
    const sections = Array.from({ length: 8 }, (_, s) =>
      newMasterSection(
        `S${s}`,
        Array.from({ length: 40 }, (_, i) => newMasterEntry(`entry ${s}-${i}`))
      )
    );
    const noteId = (await getAdapterOfType(NoteType.Master).createNote(
      { title: "Big", sections },
      deck
    )) as string;
    const t0 = Date.now();
    renderAt(noteId);
    expect(await screen.findByDisplayValue("entry 7-39")).toBeInTheDocument();
    expect(Date.now() - t0).toBeLessThan(8000);
    fireEvent.change(screen.getByDisplayValue("entry 0-0"), {
      target: { value: "renamed" },
    });
    expect(screen.getByDisplayValue("renamed")).toBeInTheDocument();
  });
});

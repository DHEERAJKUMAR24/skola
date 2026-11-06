import "fake-indexeddb/auto";
import "@/i18n";
import { db } from "@/logic/db";
import { newDeck } from "@/logic/deck/newDeck";
import { linkNotes } from "@/logic/note/linkNotes";
import { BasicNoteTypeAdapter } from "@/logic/type-implementations/normal/BasicNote";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import MasterGraphView from "./MasterGraphView";
import RecallSweepModal from "./RecallSweepModal";

beforeAll(() => {
  HTMLElement.prototype.hidePopover = () => {};
  HTMLElement.prototype.showPopover = () => {};
  HTMLElement.prototype.scrollIntoView = () => {};
  // jsdom has no modal dialogs.
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute("open");
  };
});

describe("recall sweep modal", () => {
  beforeEach(async () => {
    await Promise.all(db.tables.map((t) => t.clear()));
  });
  const sections = [
    {
      id: "s",
      title: "Sec",
      entries: [
        { id: "1", text: "Closures" },
        { id: "2", text: "Hoisting" },
      ],
    },
  ];

  it("types, reveals with matches pre-ticked, marks and gives a suggested rating", async () => {
    render(
      <RecallSweepModal
        opened
        onClose={() => {}}
        sections={sections}
        sectionNoun="Chapter"
        entryNoun="Concept"
      />
    );
    fireEvent.change(await screen.findByRole("textbox"), {
      target: { value: "closures" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Reveal and mark" }));
    // "Closures" was typed: found; "Hoisting" was not: mark it missed by hand.
    const missed = await screen.findAllByRole("button", { name: "Missed" });
    fireEvent.click(missed[1]);
    fireEvent.click(screen.getByRole("button", { name: "See result" }));
    expect(await screen.findByText("You recalled 1 of 2.")).toBeInTheDocument();
    expect(await screen.findByText("Suggested rating:")).toBeInTheDocument();
  });
});

describe("graph view", () => {
  beforeEach(async () => {
    await Promise.all(db.tables.map((t) => t.clear()));
  });

  it("shows linked cards across decks, selects one and removes the link", async () => {
    const a = (await db.decks.get(await newDeck("A"))) as never;
    const b = (await db.decks.get(await newDeck("B"))) as never;
    const n1 = (await BasicNoteTypeAdapter.createNote(
      { front: "Alpha card", back: "x" } as never,
      a
    )) as string;
    const n2 = (await BasicNoteTypeAdapter.createNote(
      { front: "Beta card", back: "x" } as never,
      b
    )) as string;
    await linkNotes(n1, n2);

    render(
      <MemoryRouter initialEntries={["/graph"]}>
        <MasterGraphView />
      </MemoryRouter>
    );
    const alpha = await screen.findByRole("button", { name: "Alpha card" });
    expect(await screen.findByText("2 dots, 1 lines")).toBeInTheDocument();
    fireEvent.click(alpha);
    const remove = await screen.findByRole("button", { name: "Remove" });
    fireEvent.click(remove);
    await waitFor(async () => {
      expect((await db.notes.get(n1))?.linkedNotes).toEqual([]);
    });
  });
});

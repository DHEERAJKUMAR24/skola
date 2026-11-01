import "fake-indexeddb/auto";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { getAdapterOfType } from "../NoteTypeAdapter";
import { Card } from "../card/card";
import { db } from "../db";
import { Deck } from "../deck/deck";
import { newDeck } from "../deck/newDeck";
import { NoteType } from "../note/note";
import {
  boxFromDrag,
  nextBoxId,
  validateImageOcclusion,
} from "./image-occlusion/types";
import { listToText, parseListText, validateList } from "./list/types";
import {
  cleanChoices,
  shuffledOrder,
  validateMultipleChoice,
} from "./multiple-choice/types";

describe("list parsing", () => {
  it("accepts >>>, bullets, dashes and numbers, and drops empty lines", () => {
    expect(
      parseListText(
        ">>> One\n- Two\n* Three\n• Four\n5. Five\n6) Six\n\n   \nSeven"
      )
    ).toEqual(["One", "Two", "Three", "Four", "Five", "Six", "Seven"]);
  });
  it("keeps text that merely contains a dash or a number", () => {
    expect(parseListText("well-known fact\n3 apples")).toEqual([
      "well-known fact",
      "3 apples",
    ]);
  });
  it("round-trips and validates", () => {
    expect(parseListText(listToText(["a", "b"]))).toEqual(["a", "b"]);
    expect(validateList({ front: "<p>Q</p>", items: ["a"] })).toMatch(/two/);
    expect(validateList({ front: "<p> </p>", items: ["a", "b"] })).toMatch(
      /empty/
    );
    expect(validateList({ front: "Q", items: ["a", "b"] })).toBeNull();
  });
});

describe("multiple choice rules", () => {
  const ok = [
    { text: "A", correct: true },
    { text: "B", correct: false },
  ];
  it("needs a question, two filled choices and one correct", () => {
    expect(validateMultipleChoice({ question: "Q", choices: ok })).toBeNull();
    expect(
      validateMultipleChoice({ question: "<p></p>", choices: ok })
    ).toMatch(/question/);
    expect(
      validateMultipleChoice({
        question: "Q",
        choices: [ok[0], { text: " ", correct: false }],
      })
    ).toMatch(/two/);
    expect(
      validateMultipleChoice({
        question: "Q",
        choices: [
          { text: "A", correct: false },
          { text: "B", correct: false },
        ],
      })
    ).toMatch(/correct/);
  });
  it("drops empty choices and trims", () => {
    expect(
      cleanChoices([
        { text: " A ", correct: true },
        { text: "", correct: true },
      ])
    ).toEqual([{ text: "A", correct: true }]);
  });
  it("shuffles stably per card, as a permutation", () => {
    const a = shuffledOrder(6, "card-1");
    expect(shuffledOrder(6, "card-1")).toEqual(a);
    expect([...a].sort()).toEqual([0, 1, 2, 3, 4, 5]);
    expect(shuffledOrder(6, "card-2")).not.toEqual(a);
  });
});

describe("image occlusion rules", () => {
  const image = "data:image/webp;base64,AAAA";
  const box = { id: 1, x: 0.1, y: 0.1, w: 0.2, h: 0.2 };
  it("validates image, areas and ids", () => {
    expect(validateImageOcclusion({ image, boxes: [box] })).toBeNull();
    expect(
      validateImageOcclusion({ image: "http://x/y.png", boxes: [box] })
    ).toMatch(/image/);
    expect(validateImageOcclusion({ image, boxes: [] })).toMatch(/area/);
    expect(validateImageOcclusion({ image, boxes: [box, box] })).toMatch(
      /distinct/
    );
    expect(
      validateImageOcclusion({
        image: `${image}${"A".repeat(600_000)}`,
        boxes: [box],
      })
    ).toMatch(/large/);
  });
  it("builds a box from a drag in any direction, clamped, ignoring tiny drags", () => {
    expect(boxFromDrag({ x: 0.5, y: 0.5 }, { x: 0.2, y: 0.1 }, 3)).toEqual({
      id: 3,
      x: 0.2,
      y: 0.1,
      w: expect.closeTo(0.3),
      h: expect.closeTo(0.4),
    });
    expect(boxFromDrag({ x: -1, y: -1 }, { x: 2, y: 2 }, 1)).toEqual({
      id: 1,
      x: 0,
      y: 0,
      w: 1,
      h: 1,
    });
    expect(boxFromDrag({ x: 0.5, y: 0.5 }, { x: 0.505, y: 0.9 }, 1)).toBeNull();
  });
  it("hands out the next free id", () => {
    expect(nextBoxId([])).toBe(1);
    expect(nextBoxId([box, { ...box, id: 7 }])).toBe(8);
  });
});

describe("card types in the database", () => {
  let deck: Deck;
  const cardsOf = (noteId: string) =>
    db.cards.where("note").equals(noteId).toArray();

  beforeEach(async () => {
    await Promise.all(db.tables.map((t) => t.clear()));
    const id = await newDeck("Test");
    deck = (await db.decks.get(id)) as Deck;
  });

  it("multiple choice: one note, one card; bad input is refused; half edits are not saved", async () => {
    const adapter = getAdapterOfType(NoteType.MultipleChoice);
    const noteId = (await adapter.createNote(
      {
        question: "<p>Capital of France?</p>",
        choices: [
          { text: "Paris", correct: true },
          { text: "Rome", correct: false },
          { text: "  ", correct: false },
        ],
      },
      deck
    )) as string;
    const note = (await db.notes.get(noteId)) as never as {
      content: { choices: unknown[] };
      sortField: string;
    };
    expect(note.content.choices).toHaveLength(2); // the empty row is dropped
    expect(note.sortField).toBe("Capital of France?");
    expect(await cardsOf(noteId)).toHaveLength(1);
    expect((await db.decks.get(deck.id))?.cards).toHaveLength(1);

    await expect(
      adapter.createNote(
        { question: "Q", choices: [{ text: "only", correct: true }] },
        deck
      )
    ).rejects.toThrow(/two/);

    await adapter.updateNote(
      { question: "Q2", choices: [{ text: "x", correct: false }] },
      (await db.notes.get(noteId)) as never
    );
    expect(
      (
        (await db.notes.get(noteId)) as never as {
          content: { question: string };
        }
      ).content.question
    ).toBe("<p>Capital of France?</p>");
  });

  it("list: one card, items stored as typed lines", async () => {
    const adapter = getAdapterOfType(NoteType.List);
    const noteId = (await adapter.createNote(
      {
        front: "<p>Steps?</p>",
        items: parseListText(">>> Plan\n>>> Do\n>>> Check"),
        ordered: true,
      },
      deck
    )) as string;
    const note = (await db.notes.get(noteId)) as never as {
      content: { items: string[]; ordered: boolean };
    };
    expect(note.content).toMatchObject({
      items: ["Plan", "Do", "Check"],
      ordered: true,
    });
    expect(await cardsOf(noteId)).toHaveLength(1);
    await expect(
      adapter.createNote({ front: "Q", items: ["one"], ordered: false }, deck)
    ).rejects.toThrow(/two/);
  });

  it("image occlusion: a card per area; adding and removing areas keeps the others' schedule", async () => {
    const adapter = getAdapterOfType(NoteType.ImageOcclusion);
    const image = "data:image/webp;base64,AAAA";
    const b = (id: number) => ({ id, x: 0.1 * id, y: 0.1, w: 0.1, h: 0.1 });
    const noteId = (await adapter.createNote(
      { image, boxes: [b(1), b(2)], hideAll: true, header: "Heart" },
      deck
    )) as string;
    let cards = await cardsOf(noteId);
    expect(
      cards
        .map((c) => (c.content as { occlusionNumber: number }).occlusionNumber)
        .sort()
    ).toEqual([1, 2]);

    // Give card 1 some history, then change the areas.
    const card1 = cards.find(
      (c) => (c.content as { occlusionNumber: number }).occlusionNumber === 1
    ) as Card<NoteType>;
    await db.cards.update(card1.id, { model: { ...card1.model, reps: 5 } });
    const note = (await db.notes.get(noteId)) as never;
    await adapter.updateNote(
      { image, boxes: [b(1), b(3)], hideAll: true },
      note
    );

    cards = await cardsOf(noteId);
    const numbers = cards
      .map((c) => (c.content as { occlusionNumber: number }).occlusionNumber)
      .sort();
    expect(numbers).toEqual([1, 3]); // 2 removed, 3 added
    expect(cards.find((c) => c.id === card1.id)?.model.reps).toBe(5);
    expect((await db.decks.get(deck.id))?.cards.sort()).toEqual(
      cards.map((c) => c.id).sort()
    );

    // Deleting a card from the notes list removes its area from the picture.
    const card3 = cards.find(
      (c) => (c.content as { occlusionNumber: number }).occlusionNumber === 3
    ) as Card<NoteType.ImageOcclusion>;
    await adapter.deleteCard(card3);
    const after = (await db.notes.get(noteId)) as never as {
      content: { boxes: { id: number }[] };
    };
    expect(after.content.boxes.map((x) => x.id)).toEqual([1]);

    await expect(
      adapter.createNote({ image: "nope", boxes: [b(1)], hideAll: true }, deck)
    ).rejects.toThrow(/image/i);
  });

  it("cloze: a new deletion added while editing gets a card; nothing is deleted mid-typing", async () => {
    const adapter = getAdapterOfType(NoteType.Cloze);
    const noteId = (await adapter.createNote(
      {
        text: "<p>{{c1::Paris}} is in {{c2::France}}</p>",
        occlusionNumberSet: [1, 2],
      },
      deck
    )) as string;
    expect(await cardsOf(noteId)).toHaveLength(2);

    const note = (await db.notes.get(noteId)) as never;
    await adapter.updateNote(
      {
        text: "<p>{{c1::Paris}} is in {{c2::France}} on {{c3::Earth}}</p>",
        occlusionNumberSet: [1, 2, 3],
      },
      note
    );
    expect(await cardsOf(noteId)).toHaveLength(3);

    // c2 briefly incomplete while the user types: its card must survive.
    await adapter.updateNote(
      {
        text: "<p>{{c1::Paris}} is in {{c2::France}</p>",
        occlusionNumberSet: [1],
      },
      note
    );
    expect(await cardsOf(noteId)).toHaveLength(3);
  });
});

describe("study views", () => {
  const card = { id: "card-x" } as Card<NoteType.MultipleChoice>;
  const content = {
    type: NoteType.MultipleChoice,
    question: "<p>Pick the primes</p>",
    choices: [
      { text: "2", correct: true },
      { text: "4", correct: false },
      { text: "5", correct: true },
    ],
    explanation: "<p>4 is even</p>",
  } as never;
  const adapter = getAdapterOfType(NoteType.MultipleChoice);

  it("question side lets you pick several when several are right; answer side marks them", () => {
    const q = render(adapter.displayQuestion(card, content) as never);
    expect(screen.getByText("Select all that apply")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /4/ })); // wrong one
    fireEvent.click(screen.getByRole("button", { name: /5/ })); // right one
    expect(
      screen.getByRole("button", { name: /4/ }).getAttribute("aria-pressed")
    ).toBe("true");
    q.unmount();

    render(adapter.displayAnswer(card, content) as never);
    const buttons = screen.getAllByRole("button");
    const cls = (label: RegExp) =>
      buttons.find((b) => label.test(b.textContent ?? ""))?.className ?? "";
    // Each button reads like "B4": its letter, then the choice.
    expect(cls(/4$/)).toContain("--wrong"); // picked and wrong
    expect(cls(/5$/)).toContain("--correct");
    expect(cls(/2$/)).toContain("--correct"); // right but not picked is still shown
    expect(screen.getByText("4 is even")).toBeTruthy();
  });

  it("list answer shows the items, numbered when order matters", () => {
    const list = getAdapterOfType(NoteType.List);
    const { container } = render(
      list.displayAnswer(
        {} as never,
        {
          type: NoteType.List,
          front: "Q",
          items: ["Plan", "Do"],
          ordered: true,
        } as never
      ) as never
    );
    expect(container.querySelector("ol")?.children).toHaveLength(2);
  });

  it("image occlusion hides the asked area until the answer", () => {
    const io = getAdapterOfType(NoteType.ImageOcclusion);
    const c = {
      type: NoteType.ImageOcclusion,
      image: "data:image/webp;base64,AAAA",
      hideAll: true,
      boxes: [
        { id: 1, x: 0, y: 0, w: 0.2, h: 0.2 },
        { id: 2, x: 0.5, y: 0.5, w: 0.2, h: 0.2 },
      ],
    } as never;
    const card1 = {
      id: "i",
      content: { type: NoteType.ImageOcclusion, occlusionNumber: 1 },
    } as never;
    const q = render(io.displayQuestion(card1, c) as never);
    expect(q.container.querySelector(".occlusion__box--active")).not.toBeNull();
    expect(
      q.container.querySelectorAll(".occlusion__box--covered")
    ).toHaveLength(1); // hide all
    q.unmount();
    const a = render(io.displayAnswer(card1, c) as never);
    expect(a.container.querySelector(".occlusion__box--active")).toBeNull();
    expect(
      a.container.querySelector(".occlusion__box--revealed")
    ).not.toBeNull();
  });
});

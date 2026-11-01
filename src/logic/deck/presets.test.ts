import "fake-indexeddb/auto";
import { describe, expect, it } from "vitest";
import { applyLeech, buryCards } from "../card/cardControls";
import { db } from "../db";
import { BasicNoteTypeAdapter } from "../type-implementations/normal/BasicNote";
import type { Deck } from "./deck";
import { newDeck } from "./newDeck";
import {
  DEFAULT_PRESET_ID,
  PRESET_DEFAULTS,
  type StudyPreset,
  assignPreset,
  createPreset,
  deletePreset,
  effectiveOptions,
  ensureDefaultPreset,
  savePreset,
} from "./presets";

const preset = (over: Partial<StudyPreset> = {}): StudyPreset => ({
  id: "p",
  name: "P",
  ...PRESET_DEFAULTS,
  ...over,
});

const deck = (options: Deck["options"]): Deck => ({
  id: "d",
  name: "D",
  subDecks: [],
  cards: [],
  notes: [],
  options,
});

describe("effectiveOptions", () => {
  const presets = new Map([
    [
      "p",
      preset({
        desiredRetention: 0.95,
        newCardsPerDay: 7,
        maxReviewsPerDay: 50,
        easyDays: [0],
        leechThreshold: 5,
        schedulingMode: "daily",
      }),
    ],
  ]);

  it("lays the preset over the deck and keeps the deck's own exam fields", () => {
    const o = effectiveOptions(
      deck({
        newToReviewRatio: 0.5,
        dailyNewCards: 99,
        presetId: "p",
        examDate: "2026-12-01",
      }),
      presets
    );
    expect(o).toMatchObject({
      desiredRetention: 0.95,
      dailyNewCards: 7,
      maxReviewsPerDay: 50,
      easyDays: [0],
      leechThreshold: 5,
      schedulingMode: "daily",
      examDate: "2026-12-01",
      presetId: "p",
    });
  });

  it("uses a deck's own values when it has no preset, or the preset is gone", () => {
    const own = {
      newToReviewRatio: 0.5,
      dailyNewCards: 25,
      desiredRetention: 0.8,
    };
    expect(effectiveOptions(deck(own), presets)).toBe(
      deck(own).options && effectiveOptions(deck(own), presets)
    );
    expect(effectiveOptions(deck(own), presets)?.desiredRetention).toBe(0.8);
    expect(
      effectiveOptions(deck({ ...own, presetId: "missing" }), presets)
        ?.desiredRetention
    ).toBe(0.8);
    expect(effectiveOptions(undefined, presets)).toBeUndefined();
  });
});

describe("preset management", () => {
  it("creates the Default preset once", async () => {
    await ensureDefaultPreset();
    await ensureDefaultPreset();
    expect(await db.presets.count()).toBe(1);
    expect((await db.presets.get(DEFAULT_PRESET_ID))?.name).toBe("Default");
  });

  it("duplicates a preset under a new id and name", async () => {
    const base = (await db.presets.get(DEFAULT_PRESET_ID)) as StudyPreset;
    const id = await createPreset("Exam prep", {
      ...base,
      desiredRetention: 0.95,
    });
    const copy = await db.presets.get(id);
    expect(copy).toMatchObject({ name: "Exam prep", desiredRetention: 0.95 });
    expect(copy?.id).not.toBe(DEFAULT_PRESET_ID);
  });

  it("rejects personalised weights that are not 21 numbers", async () => {
    await expect(
      savePreset({ ...preset(), weights: [1, 2, 3] })
    ).rejects.toThrow("21 numbers");
    await expect(
      savePreset({ ...preset(), id: "ok", weights: Array(21).fill(0.5) })
    ).resolves.toBeUndefined();
  });

  it("assigns decks to a preset, and deleting it sends them back to Default", async () => {
    const id = await createPreset("Temp");
    const a = await newDeck("A", undefined, undefined, undefined, {
      presetId: DEFAULT_PRESET_ID,
    });
    const b = await newDeck("B", undefined, undefined, undefined, {
      presetId: DEFAULT_PRESET_ID,
    });
    await assignPreset(id, [a, b]);
    expect((await db.decks.get(a))?.options.presetId).toBe(id);

    await deletePreset(id);
    expect(await db.presets.get(id)).toBeUndefined();
    expect((await db.decks.get(a))?.options.presetId).toBe(DEFAULT_PRESET_ID);
    expect((await db.decks.get(b))?.options.presetId).toBe(DEFAULT_PRESET_ID);
  });

  it("never deletes the Default preset", async () => {
    await expect(deletePreset(DEFAULT_PRESET_ID)).rejects.toThrow(
      "cannot be deleted"
    );
    expect(await db.presets.get(DEFAULT_PRESET_ID)).toBeTruthy();
  });
});

describe("leeches and burying", () => {
  async function makeCard() {
    const deckId = await newDeck("Leech deck");
    const d = (await db.decks.get(deckId)) as Deck;
    const noteId = (await BasicNoteTypeAdapter.createNote(
      { front: "q", back: "a" },
      d as never
    )) as string;
    const card = await db.cards.where("note").equals(noteId).first();
    return { noteId, cardId: (card as { id: string }).id };
  }

  it("tags the note, and suspends the card only when asked", async () => {
    const tagOnly = await makeCard();
    await applyLeech({ id: tagOnly.cardId, note: tagOnly.noteId }, "tag");
    expect((await db.notes.get(tagOnly.noteId))?.tags).toContain("leech");
    expect((await db.cards.get(tagOnly.cardId))?.suspended).toBeFalsy();

    const both = await makeCard();
    await applyLeech({ id: both.cardId, note: both.noteId }, "suspend");
    expect((await db.notes.get(both.noteId))?.tags).toContain("leech");
    expect((await db.cards.get(both.cardId))?.suspended).toBe(true);
  });

  it("buries several cards until a given time", async () => {
    const a = await makeCard();
    const b = await makeCard();
    const until = Date.now() + 86_400_000;
    await buryCards([a.cardId, b.cardId], until);
    expect((await db.cards.get(a.cardId))?.buriedUntil).toBe(until);
    expect((await db.cards.get(b.cardId))?.buriedUntil).toBe(until);
  });
});

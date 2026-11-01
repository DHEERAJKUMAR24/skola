import "fake-indexeddb/auto";
import { State } from "ts-fsrs";
import { describe, expect, it } from "vitest";
import { getCardsOf } from "../card/getCardsOf";
import { db } from "../db";
import type { Deck } from "../deck/deck";
import { getAllTags } from "../note/tags";
import { resolveExam } from "../scheduling/policy";
import { markup, seedJsInterview } from "./jsInterview";

describe("markup", () => {
  it("escapes HTML, wraps paragraphs and formats code", () => {
    expect(markup("Use `a < b`.\n\nSecond")).toBe(
      "<p>Use <code>a &lt; b</code>.</p><p>Second</p>"
    );
    expect(markup("Intro\n\n```\nlet x = 1 < 2;\n```")).toBe(
      "<p>Intro</p><pre><code>let x = 1 &lt; 2;</code></pre>"
    );
  });
});

describe("JavaScript interview sample", () => {
  it("builds domain > subject > concepts > cards, with tags and an exam date", async () => {
    const now = new Date(2026, 5, 1, 12, 0, 0);
    const r = await seedJsInterview({ withHistory: true, now, examInDays: 21 });
    expect(r).toMatchObject({ created: true, decks: 9, notes: 42 });

    const domain = (await db.decks.get(r.domainId)) as Deck;
    expect(domain.name).toBe("Programming Languages");
    expect(domain.subDecks).toHaveLength(1);
    const subject = (await db.decks.get(domain.subDecks[0])) as Deck;
    expect(subject.name).toBe("JavaScript");
    expect(subject.subDecks).toHaveLength(7);
    expect(subject.options.examDate).toBe("2026-06-22");

    const byId = new Map((await db.decks.toArray()).map((d) => [d.id, d]));
    for (const id of subject.subDecks) {
      const concept = byId.get(id) as Deck;
      expect(concept.superDecks).toEqual([domain.id, subject.id]);
      expect(concept.notes).toHaveLength(6);
      expect(concept.cards).toHaveLength(6);
      // concepts have no exam date of their own; they inherit the subject's
      expect(resolveExam(concept, byId)?.date).toBe("2026-06-22");
    }
    const arrays = subject.subDecks
      .map((id) => byId.get(id))
      .find((d) => d?.name === "Arrays & Iteration");
    const wholeDays = (await db.presets.toArray()).find(
      (p) => p.name === "Whole days"
    );
    expect(wholeDays?.schedulingMode).toBe("daily");
    expect(arrays?.options.presetId).toBe(wholeDays?.id);

    expect(await getCardsOf(domain)).toHaveLength(42);
    const tags = await getAllTags();
    expect(tags.find((t) => t.tag === "interview")?.count).toBe(42);
    expect(tags.some((t) => t.tag === "closures")).toBe(true);
  });

  it("gives about half the cards a believable study history", async () => {
    const cards = await db.cards.toArray();
    const studied = cards.filter((c) => c.model.state !== State.New);
    expect(studied.length).toBeGreaterThan(15);
    expect(studied.length).toBeLessThan(35);
    const logs = await db.reviewLogs.toArray();
    // every review that moved a card is in the log
    expect(logs.length).toBeGreaterThanOrEqual(studied.length);
    for (const c of studied.slice(0, 5)) {
      const own = logs.filter((l) => l.card === c.id);
      expect(own.length).toBeGreaterThanOrEqual(1);
      expect(c.model.reps).toBe(own.length);
    }
  });

  it("does nothing when the sample already exists", async () => {
    const before = await db.decks.count();
    const r = await seedJsInterview();
    expect(r.created).toBe(false);
    expect(await db.decks.count()).toBe(before);
  });
});

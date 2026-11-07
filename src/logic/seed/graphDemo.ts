/**
 * Graph demo seed — creates a "Graph Demo" deck with 20 interconnected notes
 * using [[wiki-link]] syntax so the graph view shows a rich network.
 *
 * Run from the browser console (dev only):
 *   import { seedGraphDemo } from "@/logic/seed/graphDemo"; await seedGraphDemo();
 * Or click the "Seed graph demo" button that appears in the graph view in dev mode.
 */
import { db } from "@/logic/db";
import { newDeck } from "@/logic/deck/newDeck";
import { createNoteSkeleton } from "@/logic/note/createNoteSkeleton";
import { NoteType } from "@/logic/note/note";

export interface GraphDemoResult {
  deckId: string;
  noteCount: number;
}

/** Returns true if the demo deck already exists. */
export async function graphDemoExists(): Promise<boolean> {
  const decks = await db.decks.toArray();
  return decks.some((d) => d.name === "Graph Demo");
}

export async function seedGraphDemo(): Promise<GraphDemoResult> {
  // ── 1. Deck ────────────────────────────────────────────────────────────────
  const deckId = await newDeck(
    "Graph Demo",
    undefined,
    "Demo notes for the graph view"
  );

  // ── 2. Note definitions with [[wiki-link]] relations in content ───────────
  //  The loadGraphData function parses [[title]] from JSON-stringified content.
  //  We embed them in the question field so they appear in the content text.
  const notes: {
    title: string;
    answer: string;
    tags?: string[];
  }[] = [
    {
      title: "JavaScript",
      answer:
        "A high-level, interpreted programming language. See also [[TypeScript]], [[Closures]], [[Event Loop]], [[Promises]].",
      tags: ["programming", "web"],
    },
    {
      title: "TypeScript",
      answer:
        "A typed superset of [[JavaScript]] that compiles to plain JavaScript. Related: [[Generics]], [[Interfaces]].",
      tags: ["programming", "web"],
    },
    {
      title: "React",
      answer:
        "A UI library built on [[JavaScript]]. Uses [[JSX]], [[Hooks]], and a virtual DOM. Related: [[State Management]].",
      tags: ["programming", "web", "frontend"],
    },
    {
      title: "Hooks",
      answer:
        "[[React]] feature that lets you use state and lifecycle in function components. See [[useState]], [[useEffect]].",
      tags: ["programming", "react"],
    },
    {
      title: "useState",
      answer: "A [[React]] [[Hooks|hook]] for local component state.",
      tags: ["react"],
    },
    {
      title: "useEffect",
      answer:
        "A [[React]] [[Hooks|hook]] for side-effects. Runs after render. Related: [[Closures]].",
      tags: ["react"],
    },
    {
      title: "JSX",
      answer:
        "Syntax extension for [[JavaScript]] that looks like HTML, used in [[React]].",
      tags: ["react", "web"],
    },
    {
      title: "Closures",
      answer:
        "A [[JavaScript]] function that remembers the variables from its outer scope. Used by [[useEffect]] and [[Promises]].",
      tags: ["programming", "javascript"],
    },
    {
      title: "Event Loop",
      answer:
        "[[JavaScript]]'s concurrency model. Processes the call stack and callback queue. Related to [[Promises]] and [[Async Await]].",
      tags: ["javascript", "concurrency"],
    },
    {
      title: "Promises",
      answer:
        "[[JavaScript]] object representing eventual completion or failure of an async operation. See [[Async Await]], [[Event Loop]].",
      tags: ["javascript", "async"],
    },
    {
      title: "Async Await",
      answer:
        "Syntactic sugar over [[Promises]] in [[JavaScript]]. Makes async code look synchronous.",
      tags: ["javascript", "async"],
    },
    {
      title: "Generics",
      answer:
        "[[TypeScript]] feature for type-safe reusable components. Similar to generics in Java or C#.",
      tags: ["typescript"],
    },
    {
      title: "Interfaces",
      answer:
        "[[TypeScript]] construct for describing object shapes. Can be extended and merged. Related: [[Generics]].",
      tags: ["typescript"],
    },
    {
      title: "State Management",
      answer:
        "Pattern for managing application state in [[React]] apps. Options: Context, Redux, Zustand. See also [[Hooks]].",
      tags: ["react", "patterns"],
    },
    {
      title: "CSS",
      answer:
        "Styling language for [[HTML]]. Works alongside [[JavaScript]] and [[React]] for the full web stack.",
      tags: ["web", "frontend"],
    },
    {
      title: "HTML",
      answer:
        "Markup language for web pages. The structure layer alongside [[CSS]] and [[JavaScript]].",
      tags: ["web", "frontend"],
    },
    {
      title: "Node.js",
      answer:
        "[[JavaScript]] runtime for server-side code. Uses the [[Event Loop]] model. Related: [[TypeScript]].",
      tags: ["javascript", "backend"],
    },
    {
      title: "FSRS",
      answer:
        "Free Spaced Repetition Scheduler. A modern [[Spaced Repetition]] algorithm used in Skola.",
      tags: ["learning"],
    },
    {
      title: "Spaced Repetition",
      answer:
        "Memory technique that schedules reviews at increasing intervals. Basis of [[FSRS]] and Anki.",
      tags: ["learning", "memory"],
    },
    {
      title: "Active Recall",
      answer:
        "Learning technique of testing yourself rather than passively reading. Synergises with [[Spaced Repetition]].",
      tags: ["learning", "memory"],
    },
  ];

  // ── 3. Insert notes ────────────────────────────────────────────────────────
  const deck = await db.decks.get(deckId);
  if (!deck) throw new Error("Deck not found after creation");

  const insertedIds: string[] = [];

  await db.transaction("rw", db.decks, db.notes, async () => {
    for (const def of notes) {
      const skeleton = createNoteSkeleton(deckId);
      const note = {
        ...skeleton,
        content: {
          type: NoteType.Basic,
          front: def.title,
          back: def.answer,
        },
        sortField: def.title, // sortField = front for basic notes
        ...(def.tags ? { tags: def.tags } : {}),
      };
      await db.notes.add(note, note.id);
      insertedIds.push(note.id);
    }
    await db.decks.update(deckId, { notes: insertedIds });
  });

  return { deckId, noteCount: insertedIds.length };
}

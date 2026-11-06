export interface TourStep {
  /** CSS selector of the element to highlight. Without one the step is a centered message. */
  el?: string;
  title: string;
  text: string;
}

export interface TourDef {
  id: string;
  /** Matches the hash route, e.g. `/deck/abc`. */
  route: RegExp;
  steps: TourStep[];
}

export const TOURS: TourDef[] = [
  {
    id: "home",
    route: /^\/home$/,
    steps: [
      {
        title: "Welcome to Skola++",
        text: "Flashcards that remember for you. This short tour shows where things are. You can replay it any time from your profile menu.",
      },
      {
        el: ".sidebar__nav",
        title: "Move around",
        text: "Home lists your decks, Notes lets you search and organize every card, Statistics shows your progress and Settings holds your study presets.",
      },
      {
        el: ".home-view__content",
        title: "Your decks",
        text: "A deck is a group of cards. Decks can hold sub-decks, for example Programming Languages > JavaScript > Closures. Open one to study or edit it.",
      },
      {
        el: ".profile__trigger",
        title: "Account and sync",
        text: "Sign in to keep your cards on every device. The ring counts down to the next upload. Nothing is lost offline: it syncs when you are back.",
      },
    ],
  },
  {
    id: "deck",
    route: /^\/deck\/[^/]+/,
    steps: [
      {
        el: ".deck-view__actions",
        title: "Deck actions",
        text: "Add cards, edit the deck, move it, or change its study preset and exam date from here.",
      },
      {
        el: ".deck-hero-section__action-button",
        title: "Study",
        text: "Starts a session with the cards that are due plus new cards, within the daily limits of this deck's preset.",
      },
      {
        el: ".tabs",
        title: "Masters tab",
        text: "A master card lists every concept of this deck. The Masters tab opens the builder, the recall sweep, the gap hunt and the weak-spot drill of each master.",
      },
      {
        el: ".deck-exam",
        title: "Exam date",
        text: "Set an exam date and every card is planned to come back before it. This panel shows how many cards are on track.",
      },
    ],
  },
  {
    id: "learn",
    route: /^\/learn\//,
    steps: [
      {
        el: ".learn-view-footer",
        title: "Rate how well you remembered",
        text: "Again means you forgot. Hard, Good and Easy tell the FSRS algorithm how it went, and it picks the best day to show the card again.",
      },
      {
        title: "Be honest",
        text: "Rating a card Good when you hesitated makes the next review come too late. Shortcuts: Space shows the answer, 1 to 4 rate it.",
      },
    ],
  },
  {
    id: "notes",
    route: /^\/notes$/,
    steps: [
      {
        el: ".note-explorer-view__table-section",
        title: "All your notes",
        text: "Search, filter by deck or tag, and open a note to edit it. Moving a card never resets its review history.",
      },
      {
        el: ".note-bulk-bar",
        title: "Bulk actions",
        text: "Select several notes with the checkboxes to move them, tag them or suspend them at once.",
      },
    ],
  },
  {
    id: "ai-settings",
    route: /^\/settings\/ai$/,
    steps: [
      {
        el: ".ai-settings .textarea",
        title: "Instructions for AI assistants",
        text: "Write how you want your cards and quizzes to be. Every assistant connected to Skola reads this at the start of a session. It syncs across your devices.",
      },
      {
        title: "Hover the (i) icons",
        text: "They explain what is saved, what assistants may do with it, and where to edit full skills.",
      },
    ],
  },
  {
    id: "hierarchy-settings",
    route: /^\/settings\/hierarchy$/,
    steps: [
      {
        el: ".hierarchy-settings__levels",
        title: "Your knowledge hierarchy",
        text: "Name the levels you think in, from the biggest to the smallest. The role says what a level is in Skola: a nested deck, a master card, a section of one, or an entry (one concept). It syncs across your devices.",
      },
      {
        title: "Hover the (i) icons",
        text: "They explain each role and what a master card is.",
      },
    ],
  },
  {
    id: "connect",
    route: /^\/settings\/connect$/,
    steps: [
      {
        el: ".skills-card",
        title: "Connect an assistant",
        text: "Copy this address into Claude, ChatGPT or any assistant that supports MCP. The steps for each one are below, with copy buttons.",
      },
      {
        el: "#default-skills",
        title: "Default skills",
        text: "Skills teach an assistant how to write good cards, quiz you honestly and tidy decks. Open one to read its files. AI agents read the same content at /skills/llm.txt.",
      },
    ],
  },
  {
    id: "skills-editor",
    route: /^\/settings\/skills$/,
    steps: [
      {
        el: ".skills-editor, .skills-page, .settings-view__content",
        title: "Your own skills",
        text: "Write your own playbooks for assistants, or copy a default one and change it. Your skill replaces a default of the same name for you only, and every save keeps a history you can restore.",
      },
    ],
  },
  {
    id: "presets",
    route: /^\/settings\/presets$/,
    steps: [
      {
        el: ".presets",
        title: "Study presets",
        text: "A preset is a named group of study settings, like an Anki options group. Give each deck the preset that suits it. Presets sync across your devices.",
      },
      {
        title: "Hover the (i) icons",
        text: "Every setting has a short explanation. The key one is desired retention: higher means more reviews and a better memory.",
      },
      {
        title: "Optimize and simulate",
        text: "After a few hundred reviews, Optimize fits the FSRS parameters to your own memory. The workload simulator shows how many reviews a day to expect.",
      },
    ],
  },
  {
    id: "objectives",
    route: /^\/objectives/,
    steps: [
      {
        el: ".objectives",
        title: "Learning objectives",
        text: "An objective is something you want to be able to know (K) or do (S). Each of four Knowledge and four Skill dimensions is rated 0 to 4 from real work, and an objective counts as mastered only with high, unaided and retested results.",
      },
      {
        title: "Open one to record evidence",
        text: "The detail page shows what blocks mastery, the history of every assessment, and the cards linked to the objective. You can record an assessment by hand, and connected AI assistants record theirs here too. This page needs sign-in and a connection.",
      },
    ],
  },
  {
    id: "master-builder",
    route: /^\/master\/[^/]+/,
    steps: [
      {
        el: ".master-builder__bar",
        title: "A master card",
        text: "A master lists every concept of a deck with nothing left out. Name it and set its status. The badges show your own level names (Settings > Hierarchy). Everything saves by itself.",
      },
      {
        el: ".master-builder__main",
        title: "Sections and entries",
        text: "Each entry is one concept, linked to the card that tests it. Drag the handle, use the arrows, or tick entries to move or delete several at once.",
      },
      {
        el: ".master-builder__side",
        title: "Coverage",
        text: "Shows what is left out: cards in no entry, entries with a missing card, empty sections, duplicates. Every problem has a fix button, and one click adds all orphan cards as entries grouped by tag.",
      },
      {
        el: ".master-builder__tools",
        title: "Activities",
        text: "Recall sweep: type what you remember, then check yourself. Gap hunt: go through the coverage problems as a checklist. Weak-spot drill: study only the weakest linked cards. None of them changes a card's memory by itself.",
      },
    ],
  },
  {
    id: "graph",
    route: /^\/graph/,
    steps: [
      {
        el: ".master-graph__bar",
        title: "Graph of links",
        text: "Masters and cards as dots, links as lines. Filter by deck; cards of other decks that link in are shown faded.",
      },
      {
        el: ".master-graph__svg",
        title: "Pan, zoom, open",
        text: "Drag to pan, scroll to zoom. Click a dot to see its links, double-click to open it.",
      },
      {
        el: ".master-graph__panel",
        title: "Add or remove links",
        text: "With a dot selected, add a link to any card in any deck, or remove a link. Entry links of a master are dashed.",
      },
    ],
  },
];

export const tourForRoute = (path: string) =>
  TOURS.find((t) => t.route.test(path));

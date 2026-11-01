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
        title: "Welcome to Skola",
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
];

export const tourForRoute = (path: string) =>
  TOURS.find((t) => t.route.test(path));

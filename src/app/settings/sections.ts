/** The settings sections, in the order of the settings sidebar. Plain data, so it is testable. */
export type SettingsSectionId =
  | "general"
  | "appearance"
  | "editing"
  | "learn"
  | "presets"
  | "hierarchy"
  | "ai"
  | "connect"
  | "skills"
  | "database"
  | "sync"
  | "about"
  | "developer";

export interface SettingsGroup {
  title: string;
  sections: { id: SettingsSectionId; label: string }[];
}

export const SETTINGS_GROUPS: SettingsGroup[] = [
  {
    title: "App",
    sections: [
      { id: "general", label: "General" },
      { id: "appearance", label: "Appearance" },
      { id: "editing", label: "Editing" },
    ],
  },
  {
    title: "Studying",
    sections: [
      { id: "learn", label: "Learning" },
      { id: "presets", label: "Study presets" },
      { id: "hierarchy", label: "Hierarchy" },
    ],
  },
  {
    title: "AI assistants",
    sections: [
      { id: "ai", label: "Instructions" },
      { id: "connect", label: "Connect" },
      { id: "skills", label: "Skills" },
    ],
  },
  {
    title: "Data",
    sections: [
      { id: "database", label: "Database" },
      { id: "sync", label: "Account" },
    ],
  },
  {
    title: "More",
    sections: [
      { id: "about", label: "About" },
      { id: "developer", label: "Developer" },
    ],
  },
];

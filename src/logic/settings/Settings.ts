export type Settings<T extends keyof SettingsValues> = {
  key: T;
  value: SettingsValues[T];
};

export enum SupportedLanguages {
  English = "en",
  German = "de",
  Swedish = "sv",
  Portuguese = "pt",
}

export interface SettingsValues {
  "#name"?: string;
  "#language": SupportedLanguages;
  "#useVisualFeedback": boolean;
  "#developerMode": boolean;
  "#showShortcutHints": boolean;
  /** Ids of the guided tours already shown. Synced, so a tour is not repeated on a new device. */
  "#toursSeen": string[];
  /** Standing instructions for AI assistants; the MCP server hands them to every session. Synced. */
  "#aiInstructions"?: string;

  "#colorSchemePreference": "light" | "dark" | "auto";
  "#densityPreference": "relaxed" | "compact" | "auto";
  "#showCognitivePrompts": boolean;

  "#useBubbleMenu": boolean;
  "#useToolbar": boolean;
  "#showSubAndSuperScriptOptionInEditor": boolean;
  "#showStrikethroughOptionInEditor": boolean;
  "#showHighlightOptionInEditor": boolean;
  "#showListOptionInEditor": boolean;
  "#showCodeOptionInEditor": boolean;
  "#showLinkOptionInEditor": boolean;

  "#learn_newToReviewRatio": number;
  "#learn_sort": "creationDate" | "dueDate";
  "#learn_enableHardAndEasy": boolean;
  "#newDayStartHour": number;
  "#globalScheduler_maximumInterval": number;
  "#globalScheduler_requestRetention": number;
  "#globalScheduler_w": string;
}

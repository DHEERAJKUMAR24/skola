import { default_w } from "ts-fsrs";
import { SettingsValues, SupportedLanguages } from "./Settings";

export const defaultSettings: SettingsValues = {
  "#language": SupportedLanguages.English,
  "#useVisualFeedback": true,
  "#developerMode": false,
  "#showShortcutHints": true,

  "#colorSchemePreference": "auto",
  "#densityPreference": "auto",
  "#showCognitivePrompts": true,

  "#useBubbleMenu": true,
  "#useToolbar": false,
  "#showSubAndSuperScriptOptionInEditor": true,
  "#showStrikethroughOptionInEditor": true,
  "#showHighlightOptionInEditor": true,
  "#showListOptionInEditor": true,
  "#showCodeOptionInEditor": true,
  "#showLinkOptionInEditor": true,

  "#learn_newToReviewRatio": 0.5,
  "#learn_sort": "creationDate",
  "#learn_enableHardAndEasy": true,
  "#newDayStartHour": 4,
  "#globalScheduler_maximumInterval": 36500,
  "#globalScheduler_requestRetention": 0.9,
  "#globalScheduler_w":
    default_w.join(","),
};

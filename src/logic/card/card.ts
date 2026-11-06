import { Card as Model } from "ts-fsrs";
import i18n from "../../i18n";
import { NoteType } from "../note/note";
import { Content } from "./CardContent";

export const NoteTypeLabels: Record<NoteType, string> = {
  get [NoteType.Basic]() {
    return i18n.t("note.type.normal");
  },
  get [NoteType.Cloze]() {
    return i18n.t("note.type.cloze");
  },
  get [NoteType.ImageOcclusion]() {
    return i18n.t("note.type.image-occlusion");
  },
  get [NoteType.MultipleChoice]() {
    return i18n.t("note.type.multiple-choice");
  },
  get [NoteType.List]() {
    return i18n.t("note.type.list");
  },
  get [NoteType.Master]() {
    return i18n.t("note.type.master");
  },
  get [NoteType.DoubleSided]() {
    return i18n.t("note.type-double-sided");
  },
  get [NoteType.Undefined]() {
    return i18n.t("note.type.undefined");
  },
};

export interface CardSkeleton {
  id: string;
  model: Model;
  deck: string;
  creationDate: Date;
  customOrder?: number;
  /** Hidden from study until switched back on. FSRS state is kept. */
  suspended?: boolean;
  /** Hidden from study until this time (ms epoch). */
  buriedUntil?: number;
  /** Overrides the deck's FSRS settings for this one card. */
  fsrsOverride?: CardFsrsOverride;
}

export interface CardFsrsOverride {
  desiredRetention?: number;
  maximumInterval?: number;
}

export interface Card<T extends NoteType> extends CardSkeleton {
  content: Content<T>;
  note: string;
}

export function HTMLtoPreviewString(text: string): string {
  return text.replace(/<[^>]*>/g, "").slice(0, 100);
}

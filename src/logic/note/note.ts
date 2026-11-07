import { NoteContent } from "./NoteContent";

export interface NoteSkeleton {
  id: string;
  deck: string;
  creationDate: Date;
  customOrder?: number;
  /*
  An array of note identifiers linked to this note, enabling non-linear interconnections for mind maps and graph views. This supports advanced note-taking methodologies, including incremental writing and higher-order thinking strategies.
  */
  linkedNotes: string[];
  /** Lowercase labels, e.g. "closures". Indexed for filtering. */
  tags?: string[];
  /**
   * Source URLs or external references (Notion, Google Docs, article links …).
   * Stored as plain strings — not indexed. Displayed in the graph info panel and
   * card view. Use `[[note name]]` in note content to auto-link related notes.
   */
  sourceLinks?: string[];
}

export interface Note<T extends NoteType> extends NoteSkeleton {
  content: NoteContent<T>;
  sortField: string;
}

export enum NoteType {
  Basic = "normal",
  Cloze = "cloze",
  ImageOcclusion = "imageOcclusion",
  MultipleChoice = "multipleChoice",
  List = "list",
  Master = "master",
  DoubleSided = "doubleSided",
  Undefined = "undefined",
}

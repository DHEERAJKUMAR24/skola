import type { DeckOptions } from "./deck";
import {
  EXAM_BUFFER_MAX,
  EXAM_DEFAULTS,
  isValidDateString,
} from "./fsrsOptions";

/** The exam fields of the deck form, as strings so partial typing is allowed. */
export interface ExamForm {
  /** `YYYY-MM-DD`, or empty for no exam. */
  examDate: string;
  examBufferDays: string;
  examRamp: boolean;
}

export type ExamFormErrors = { examDate?: string; examBufferDays?: string };

export type ExamOptions = Pick<
  DeckOptions,
  "examDate" | "examBufferDays" | "examRamp"
>;

export const toExamForm = (o?: Partial<DeckOptions>): ExamForm => ({
  examDate: o?.examDate ?? "",
  examBufferDays: String(o?.examBufferDays ?? EXAM_DEFAULTS.examBufferDays),
  examRamp: o?.examRamp ?? EXAM_DEFAULTS.examRamp,
});

/** Validates the exam fields. With no date, all three options are cleared (undefined). */
export function fromExamForm(
  f: ExamForm
): { options: ExamOptions } | { errors: ExamFormErrors } {
  if (!f.examDate)
    return {
      options: {
        examDate: undefined,
        examBufferDays: undefined,
        examRamp: undefined,
      },
    };
  const errors: ExamFormErrors = {};
  if (!isValidDateString(f.examDate)) errors.examDate = "Enter a valid date";
  const buffer = Number(f.examBufferDays);
  if (!Number.isInteger(buffer) || buffer < 0 || buffer > EXAM_BUFFER_MAX)
    errors.examBufferDays = "Enter whole days from 0 to 30";
  if (Object.keys(errors).length) return { errors };
  return {
    options: {
      examDate: f.examDate,
      examBufferDays: buffer,
      examRamp: f.examRamp,
    },
  };
}

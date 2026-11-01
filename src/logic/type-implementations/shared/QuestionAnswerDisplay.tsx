import { Divider } from "@/components/ui";
import { useMediaHtml } from "@/logic/media/useMedia";
import { ReactNode } from "react";

export function QuestionContent({ html }: { html: string }) {
  const shown = useMediaHtml(html);
  return (
    <h3
      style={{
        fontFamily: "var(--font-serif)",
        fontSize: "var(--font-size-xl)",
        fontWeight: 600,
        margin: 0,
        padding: "var(--spacing-md)",
      }}
      dangerouslySetInnerHTML={{ __html: shown }}
    />
  );
}

export function AnswerContent({ html }: { html: string }) {
  const shown = useMediaHtml(html);
  return (
    <div
      style={{
        fontSize: "var(--font-size-md)",
        padding: "var(--spacing-md)",
      }}
      dangerouslySetInnerHTML={{ __html: shown }}
    />
  );
}

export function QuestionAnswerLayout({
  question,
  answer,
}: {
  question: ReactNode;
  answer: ReactNode;
}) {
  return (
    <div>
      {question}
      <Divider />
      {answer}
    </div>
  );
}

export function QuestionOnly({ html }: { html: string }) {
  return <QuestionContent html={html} />;
}

export function QuestionWithAnswer({
  questionHtml,
  answerHtml,
}: {
  questionHtml: string;
  answerHtml: string;
}) {
  return (
    <QuestionAnswerLayout
      question={<QuestionContent html={questionHtml} />}
      answer={<AnswerContent html={answerHtml} />}
    />
  );
}

export function NoteDisplay({
  questionHtml,
  answerHtml,
  showAnswer,
}: {
  questionHtml: string;
  answerHtml: string;
  showAnswer: boolean;
}) {
  return (
    <div>
      <QuestionContent html={questionHtml} />
      {showAnswer && (
        <>
          <Divider />
          <AnswerContent html={answerHtml} />
        </>
      )}
    </div>
  );
}

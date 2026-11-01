import { Card } from "@/logic/card/card";
import { useMediaHtml } from "@/logic/media/useMedia";
import { NoteContent } from "@/logic/note/NoteContent";
import { NoteType } from "@/logic/note/note";

export default function displayDoubleSidedQuestion(
  card: Card<NoteType.DoubleSided>,
  content?: NoteContent<NoteType.DoubleSided>
) {
  function FrontComponent() {
    const html =
      (card.content.frontIsField1 ? content?.field1 : content?.field2) ??
      "error";
    const shown = useMediaHtml(html);
    return <h3 dangerouslySetInnerHTML={{ __html: shown }} />;
  }
  return <FrontComponent />;
}

import { genericFail } from "@/components/Notification/Notification";
import { RichTextEditorControl } from "@/components/ui/RichTextEditor";
import { prepareImage } from "@/logic/media/shrink";
import { IconPhoto } from "@tabler/icons-react";
import { Editor } from "@tiptap/react";
import { memo, useCallback, useRef } from "react";

interface AddImageControlProps {
  editor: Editor | null;
}

const AddImageControl = memo(function AddImageControl({
  editor,
}: AddImageControlProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      if (!file) return;

      void prepareImage(file).then((prepared) => {
        if (!prepared.ok) return genericFail();
        editor?.commands.insertContent(
          `<img src="${prepared.ref}" alt="Image inserted by user"/>`
        );
        editor?.commands.focus();
      });

      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    },
    [editor]
  );

  return (
    <>
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        onChange={handleFileChange}
        style={{ display: "none" }}
      />
      <RichTextEditorControl
        onClick={() => fileInputRef.current?.click()}
        title="Add image"
      >
        <IconPhoto />
      </RichTextEditorControl>
    </>
  );
});

export default AddImageControl;

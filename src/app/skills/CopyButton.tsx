import { copied, genericFail } from "@/components/Notification/Notification";
import { Button } from "@/components/ui/Button";
import { IconCheck, IconCopy } from "@tabler/icons-react";
import { useState } from "react";

export default function CopyButton({
  text,
  label = "Copy",
  what = "Text",
}: { text: string; label?: string; what?: string }) {
  const [done, setDone] = useState(false);
  return (
    <Button
      size="xs"
      variant="default"
      leftSection={done ? <IconCheck size={14} /> : <IconCopy size={14} />}
      onClick={() => {
        navigator.clipboard
          .writeText(text)
          .then(() => {
            copied(what);
            setDone(true);
            setTimeout(() => setDone(false), 1500);
          })
          .catch(() => genericFail());
      }}
    >
      {done ? "Copied" : label}
    </Button>
  );
}

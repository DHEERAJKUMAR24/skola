import { Button, Checkbox, IconButton, TextInput } from "@/components/ui";
import { Stack } from "@/components/ui/Stack";
import { Text } from "@/components/ui/Text";
import { EditMode } from "@/logic/NoteTypeAdapter";
import { Deck } from "@/logic/deck/deck";
import { prepareImage } from "@/logic/media/shrink";
import { useMediaSrc } from "@/logic/media/useMedia";
import { Note, NoteType } from "@/logic/note/note";
import { ImageOcclusionTypeAdapter } from "@/logic/type-implementations/image-occlusion/ImageOcclusionNote";
import {
  IO_MAX_BOXES,
  type OcclusionBox,
  boxFromDrag,
  nextBoxId,
} from "@/logic/type-implementations/image-occlusion/types";
import { IconPhoto, IconX } from "@tabler/icons-react";
import { t } from "i18next";
import { useCallback, useRef, useState } from "react";
import "./ImageOcclusionEditor.css";
import { useAutoSave, useAutoSaveOnChange, useNoteCreation } from "./hooks";

const BASE = "image-occlusion-editor";

type Point = { x: number; y: number };

interface Props {
  note: Note<NoteType.ImageOcclusion> | null;
  deck: Deck;
  mode: EditMode;
  requestedFinish?: boolean;
  setRequestedFinish?: (finish: boolean) => void;
}

export default function ImageOcclusionEditor({
  note,
  deck,
  mode,
  requestedFinish,
  setRequestedFinish,
}: Props) {
  const initial = note?.content;
  const [image, setImage] = useState(initial?.image ?? "");
  const [boxes, setBoxes] = useState<OcclusionBox[]>(initial?.boxes ?? []);
  const [hideAll, setHideAll] = useState(initial?.hideAll ?? true);
  const [header, setHeader] = useState(initial?.header ?? "");
  const [error, setError] = useState<string | null>(null);
  const [drag, setDrag] = useState<{ a: Point; b: Point } | null>(null);

  const stateRef = useRef({ image, boxes, hideAll, header });
  stateRef.current = { image, boxes, hideAll, header };
  const frameRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const getContent = useCallback(() => stateRef.current, []);
  const debouncedAutoSave = useAutoSave(
    mode,
    note,
    getContent,
    ImageOcclusionTypeAdapter.updateNote
  );
  useAutoSaveOnChange(debouncedAutoSave, [image, boxes, hideAll, header]);

  const clear = useCallback(() => {
    setImage("");
    setBoxes([]);
    setHeader("");
    setError(null);
  }, []);
  useNoteCreation(
    mode,
    deck,
    getContent,
    ImageOcclusionTypeAdapter.createNote,
    clear,
    requestedFinish,
    setRequestedFinish
  );

  async function load(file: Blob | null | undefined) {
    if (!file || !file.type.startsWith("image/")) {
      if (file)
        setError(t("note.edit.type-specific.image-occlusion.bad-image"));
      return;
    }
    const prepared = await prepareImage(file);
    if (!prepared.ok) {
      setError(
        t(
          prepared.reason === "too-large"
            ? "note.edit.type-specific.image-occlusion.too-large"
            : "note.edit.type-specific.image-occlusion.bad-image"
        )
      );
      return;
    }
    setError(null);
    setImage(prepared.ref);
  }

  const point = (e: React.PointerEvent): Point => {
    const r = (frameRef.current as HTMLDivElement).getBoundingClientRect();
    return {
      x: (e.clientX - r.left) / r.width,
      y: (e.clientY - r.top) / r.height,
    };
  };

  const preview = drag ? boxFromDrag(drag.a, drag.b, 0) : null;
  const shownImage = useMediaSrc(image);

  return (
    <Stack gap="lg">
      <TextInput
        label={t("note.edit.type-specific.image-occlusion.header")}
        value={header}
        onChange={(e) => setHeader(e.currentTarget.value)}
      />

      <div
        className={`${BASE}__drop`}
        onPaste={(e) => {
          const file = [...e.clipboardData.files].find((f) =>
            f.type.startsWith("image/")
          );
          if (file) {
            e.preventDefault();
            void load(file);
          }
        }}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          void load(e.dataTransfer.files[0]);
        }}
      >
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          style={{ display: "none" }}
          onChange={(e) => {
            void load(e.currentTarget.files?.[0]);
            e.currentTarget.value = "";
          }}
        />
        <Button
          variant="default"
          leftSection={<IconPhoto />}
          onClick={() => fileRef.current?.click()}
        >
          {t(
            image
              ? "note.edit.type-specific.image-occlusion.replace"
              : "note.edit.type-specific.image-occlusion.choose"
          )}
        </Button>
        <Text size="sm">
          {t("note.edit.type-specific.image-occlusion.paste")}
        </Text>
        {error && <Text size="sm">{error}</Text>}
      </div>

      {image && (
        <Stack gap="sm">
          <Text size="sm">
            {t("note.edit.type-specific.image-occlusion.hint")}
          </Text>
          <div
            ref={frameRef}
            className={`${BASE}__frame`}
            onPointerDown={(e) => {
              if (boxes.length >= IO_MAX_BOXES) return;
              e.currentTarget.setPointerCapture(e.pointerId);
              const p = point(e);
              setDrag({ a: p, b: p });
            }}
            onPointerMove={(e) => drag && setDrag({ ...drag, b: point(e) })}
            onPointerUp={() => {
              if (!drag) return;
              const box = boxFromDrag(drag.a, drag.b, nextBoxId(boxes));
              if (box) setBoxes((bs) => [...bs, box]);
              setDrag(null);
            }}
            onPointerCancel={() => setDrag(null)}
          >
            <img
              className={`${BASE}__image`}
              src={shownImage}
              alt=""
              draggable={false}
            />
            {[...boxes, ...(preview ? [{ ...preview, id: -1 }] : [])].map(
              (b) => (
                <div
                  key={b.id}
                  className={`${BASE}__box ${b.id === -1 ? `${BASE}__box--draft` : ""}`}
                  style={{
                    left: `${b.x * 100}%`,
                    top: `${b.y * 100}%`,
                    width: `${b.w * 100}%`,
                    height: `${b.h * 100}%`,
                  }}
                >
                  {b.id !== -1 && (
                    <>
                      <span className={`${BASE}__label`}>{b.id}</span>
                      <button
                        type="button"
                        className={`${BASE}__remove`}
                        aria-label={t(
                          "note.edit.type-specific.image-occlusion.remove-box"
                        )}
                        onPointerDown={(e) => e.stopPropagation()}
                        onClick={() =>
                          setBoxes((bs) => bs.filter((x) => x.id !== b.id))
                        }
                      >
                        <IconX size={12} />
                      </button>
                    </>
                  )}
                </div>
              )
            )}
          </div>

          <div className={`${BASE}__bar`}>
            <Text size="sm">
              {t("note.edit.type-specific.image-occlusion.boxes", {
                count: boxes.length,
              })}
            </Text>
            <IconButton
              variant="subtle"
              aria-label={t("note.edit.type-specific.image-occlusion.clear")}
              title={t("note.edit.type-specific.image-occlusion.clear")}
              disabled={!boxes.length}
              onClick={() => setBoxes([])}
            >
              <IconX />
            </IconButton>
          </div>
          <Checkbox
            checked={hideAll}
            onChange={(e) => setHideAll(e.currentTarget.checked)}
            label={t("note.edit.type-specific.image-occlusion.hide-all")}
          />
          {!boxes.length && (
            <Text size="sm">
              {t("note.edit.type-specific.image-occlusion.no-boxes")}
            </Text>
          )}
        </Stack>
      )}
    </Stack>
  );
}

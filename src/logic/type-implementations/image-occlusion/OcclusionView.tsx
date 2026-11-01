import { useMediaSrc } from "@/logic/media/useMedia";
import "./OcclusionView.css";
import type { ImageOcclusionNoteContent } from "./types";

const BASE = "occlusion";

interface Props {
  content?: ImageOcclusionNoteContent;
  /** The area this card asks about. */
  activeId?: number;
  /** The answer side: the asked area is uncovered. */
  revealed?: boolean;
  /** Notes list: cover every area, or show them all uncovered. */
  coverAll?: boolean;
}

/** The picture with its covered areas, for study and for the notes list. */
export function OcclusionImage({
  content,
  activeId,
  revealed,
  coverAll,
}: Props) {
  const src = useMediaSrc(content?.image);
  if (!content?.image) return null;
  return (
    <figure className={`${BASE}__figure`}>
      {content.header && (
        <figcaption className={`${BASE}__header`}>{content.header}</figcaption>
      )}
      <div className={`${BASE}__frame`}>
        <img className={`${BASE}__image`} src={src} alt="" />
        {content.boxes.map((b) => {
          const active = b.id === activeId;
          // Study: the asked area is covered until the answer; the others follow the mode.
          const covered =
            activeId === undefined
              ? !!coverAll
              : active
                ? !revealed
                : content.hideAll;
          const state = active
            ? revealed
              ? "revealed"
              : "active"
            : covered
              ? "covered"
              : "open";
          return (
            <div
              key={b.id}
              className={`${BASE}__box ${BASE}__box--${state}`}
              style={{
                left: `${b.x * 100}%`,
                top: `${b.y * 100}%`,
                width: `${b.w * 100}%`,
                height: `${b.h * 100}%`,
              }}
            >
              {state === "active" && "?"}
            </div>
          );
        })}
      </div>
    </figure>
  );
}

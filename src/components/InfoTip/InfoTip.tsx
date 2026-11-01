import { IconInfoCircle } from "@tabler/icons-react";
import { type ReactNode, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import "./InfoTip.css";

const BUBBLE_WIDTH = 280;
const isTouch = () =>
  typeof window !== "undefined" &&
  ("ontouchstart" in window || navigator.maxTouchPoints > 0);

interface Props {
  children: ReactNode;
  /** Accessible name of the button. */
  label?: string;
}

/**
 * A small "i" that explains a setting. Opens on hover and keyboard focus, and toggles on tap
 * (the regular Tooltip is hover-only and switched off on touch screens).
 */
export function InfoTip({ children, label = "More information" }: Props) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const button = useRef<HTMLButtonElement>(null);
  const id = useId();

  const show = () => {
    const r = button.current?.getBoundingClientRect();
    if (!r) return;
    const left = Math.min(
      Math.max(8, r.left + r.width / 2 - BUBBLE_WIDTH / 2),
      window.innerWidth - BUBBLE_WIDTH - 8
    );
    setPos({ top: r.bottom + 8, left });
    setOpen(true);
  };

  return (
    <>
      <button
        ref={button}
        type="button"
        className="info-tip"
        aria-label={label}
        aria-expanded={open}
        aria-describedby={open ? id : undefined}
        onMouseEnter={() => !isTouch() && show()}
        onMouseLeave={() => !isTouch() && setOpen(false)}
        onFocus={() => !isTouch() && show()}
        onBlur={() => setOpen(false)}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          open ? setOpen(false) : show();
        }}
        onKeyDown={(e) => e.key === "Escape" && setOpen(false)}
      >
        <IconInfoCircle size={15} aria-hidden="true" />
      </button>
      {open &&
        createPortal(
          <span
            id={id}
            role="tooltip"
            popover="manual"
            // The top layer keeps the bubble above modal dialogs, which a z-index cannot do.
            ref={(el) => el?.showPopover?.()}
            className="info-tip__bubble"
            style={{ top: pos.top, left: pos.left, width: BUBBLE_WIDTH }}
          >
            {children}
          </span>,
          document.body
        )}
    </>
  );
}

/** A form label with an explanation next to it. */
export function LabelWithTip({
  children,
  tip,
}: {
  children: ReactNode;
  tip: ReactNode;
}) {
  return (
    <span className="info-tip__label">
      {children}
      <InfoTip>{tip}</InfoTip>
    </span>
  );
}

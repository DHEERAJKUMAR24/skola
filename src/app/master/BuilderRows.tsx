import { IconButton } from "@/components/ui/IconButton";
import type { MasterEntry, MasterSection } from "@/logic/master/masterModel";
import {
  IconArrowDown,
  IconArrowUp,
  IconGripVertical,
  IconLink,
  IconLinkOff,
  IconPlus,
  IconTrash,
} from "@tabler/icons-react";
import { memo, useState } from "react";
import { useTranslation } from "react-i18next";

export interface RowHandlers {
  onText: (entryId: string, text: string) => void;
  onMove: (entryId: string, delta: -1 | 1) => void;
  onRemove: (entryId: string) => void;
  onPickCard: (entryId: string) => void;
  onUnlink: (entryId: string) => void;
  onToggle: (entryId: string) => void;
  onDragStart: (entryId: string) => void;
  /** Drop on a row: insert before it. */
  onDropOnEntry: (entryId: string) => void;
}

interface RowProps {
  entry: MasterEntry;
  handlers: RowHandlers;
  checked: boolean;
  /** Text of the linked card, "" while loading, null when the card is gone. */
  cardLabel: string | null | undefined;
  placeholder: string;
}

/** One entry. Memoized: typing in one row re-renders only that row. */
export const EntryRow = memo(function EntryRow({
  entry,
  handlers,
  checked,
  cardLabel,
  placeholder,
}: RowProps) {
  const [t] = useTranslation();
  const [over, setOver] = useState(false);
  const missing = !!entry.cardId && cardLabel === null;
  return (
    <li
      className="master-builder__entry"
      data-over={over || undefined}
      data-missing={missing || undefined}
      onDragOver={(e) => {
        e.preventDefault();
        if (!over) setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        e.stopPropagation();
        setOver(false);
        handlers.onDropOnEntry(entry.id);
      }}
    >
      <input
        type="checkbox"
        checked={checked}
        onChange={() => handlers.onToggle(entry.id)}
        aria-label={t("masterBuilder.select-entry")}
      />
      <span
        className="master-builder__grip"
        draggable
        onDragStart={(e) => {
          e.dataTransfer.effectAllowed = "move";
          e.dataTransfer.setData("text/plain", entry.id);
          handlers.onDragStart(entry.id);
        }}
        title={t("masterBuilder.drag")}
      >
        <IconGripVertical size={16} aria-hidden="true" />
      </span>
      <input
        className="master-builder__text"
        value={entry.text}
        placeholder={placeholder}
        onChange={(e) => handlers.onText(entry.id, e.currentTarget.value)}
        aria-label={placeholder}
      />
      {entry.cardId ? (
        <span
          className="master-builder__card"
          data-missing={missing || undefined}
        >
          <button
            type="button"
            className="master-builder__chip"
            onClick={() => handlers.onPickCard(entry.id)}
            title={t("masterBuilder.change-card")}
          >
            <IconLink size={13} aria-hidden="true" />
            {missing
              ? t("masterBuilder.missing-card")
              : cardLabel || t("masterBuilder.loading")}
          </button>
          <IconButton
            size="sm"
            variant="ghost"
            aria-label={t("masterBuilder.unlink")}
            onClick={() => handlers.onUnlink(entry.id)}
          >
            <IconLinkOff size={14} />
          </IconButton>
        </span>
      ) : (
        <button
          type="button"
          className="master-builder__chip master-builder__chip--empty"
          onClick={() => handlers.onPickCard(entry.id)}
        >
          <IconLink size={13} aria-hidden="true" />
          {t("masterBuilder.link-card")}
        </button>
      )}
      <IconButton
        size="sm"
        variant="ghost"
        aria-label={t("masterBuilder.move-up")}
        onClick={() => handlers.onMove(entry.id, -1)}
      >
        <IconArrowUp size={14} />
      </IconButton>
      <IconButton
        size="sm"
        variant="ghost"
        aria-label={t("masterBuilder.move-down")}
        onClick={() => handlers.onMove(entry.id, 1)}
      >
        <IconArrowDown size={14} />
      </IconButton>
      <IconButton
        size="sm"
        variant="ghost"
        aria-label={t("masterBuilder.remove-entry")}
        onClick={() => handlers.onRemove(entry.id)}
      >
        <IconTrash size={14} />
      </IconButton>
    </li>
  );
});

export interface SectionHandlers extends RowHandlers {
  onSectionTitle: (sectionId: string, title: string) => void;
  onSectionMove: (sectionId: string, delta: -1 | 1) => void;
  onSectionRemove: (sectionId: string) => void;
  onAddEntry: (sectionId: string) => void;
  onDropOnSection: (sectionId: string) => void;
  onToggleCollapsed: (sectionId: string) => void;
}

interface SectionProps {
  section: MasterSection;
  index: number;
  count: number;
  handlers: SectionHandlers;
  selected: Set<string>;
  cardLabels: Map<string, string | null>;
  collapsed: boolean;
  sectionNoun: string;
  entryNoun: string;
}

/** A section with its entries. Memoized on the section object, which edits keep stable. */
export const SectionBlock = memo(function SectionBlock({
  section,
  index,
  count,
  handlers,
  selected,
  cardLabels,
  collapsed,
  sectionNoun,
  entryNoun,
}: SectionProps) {
  const [t] = useTranslation();
  return (
    <section
      className="master-builder__section"
      data-section={section.id}
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        handlers.onDropOnSection(section.id);
      }}
    >
      <header className="master-builder__section-head">
        <button
          type="button"
          className="master-builder__collapse"
          aria-expanded={!collapsed}
          onClick={() => handlers.onToggleCollapsed(section.id)}
          aria-label={t("masterBuilder.toggle-section")}
        >
          {collapsed ? "▸" : "▾"}
        </button>
        <input
          className="master-builder__section-title"
          value={section.title}
          placeholder={sectionNoun}
          aria-label={sectionNoun}
          onChange={(e) =>
            handlers.onSectionTitle(section.id, e.currentTarget.value)
          }
        />
        <span className="master-builder__count">{section.entries.length}</span>
        <IconButton
          size="sm"
          variant="ghost"
          aria-label={t("masterBuilder.section-up")}
          disabled={index === 0}
          onClick={() => handlers.onSectionMove(section.id, -1)}
        >
          <IconArrowUp size={14} />
        </IconButton>
        <IconButton
          size="sm"
          variant="ghost"
          aria-label={t("masterBuilder.section-down")}
          disabled={index === count - 1}
          onClick={() => handlers.onSectionMove(section.id, 1)}
        >
          <IconArrowDown size={14} />
        </IconButton>
        <IconButton
          size="sm"
          variant="ghost"
          aria-label={t("masterBuilder.remove-section")}
          onClick={() => handlers.onSectionRemove(section.id)}
        >
          <IconTrash size={14} />
        </IconButton>
      </header>
      {!collapsed && (
        <>
          <ul className="master-builder__entries">
            {section.entries.map((e) => (
              <EntryRow
                key={e.id}
                entry={e}
                handlers={handlers}
                checked={selected.has(e.id)}
                cardLabel={e.cardId ? cardLabels.get(e.cardId) : undefined}
                placeholder={entryNoun}
              />
            ))}
          </ul>
          <button
            type="button"
            className="master-builder__add"
            onClick={() => handlers.onAddEntry(section.id)}
          >
            <IconPlus size={14} aria-hidden="true" />{" "}
            {t("masterBuilder.add-entry", { noun: entryNoun.toLowerCase() })}
          </button>
        </>
      )}
    </section>
  );
});

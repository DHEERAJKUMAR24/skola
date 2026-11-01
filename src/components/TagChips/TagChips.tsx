import "./TagChips.css";

interface Props {
  tags: string[] | undefined;
  /** Makes each chip a button, e.g. to filter by that tag. */
  onSelect?: (tag: string) => void;
}

/** Small read-only list of a note's tags. */
export function TagChips({ tags, onSelect }: Props) {
  if (!tags?.length) return null;
  return (
    <span className="tag-chips">
      {tags.map((tag) =>
        onSelect ? (
          <button
            key={tag}
            type="button"
            className="tag-chips__chip tag-chips__chip--button"
            onClick={(e) => {
              e.stopPropagation();
              onSelect(tag);
            }}
          >
            {tag}
          </button>
        ) : (
          <span key={tag} className="tag-chips__chip">
            {tag}
          </span>
        )
      )}
    </span>
  );
}

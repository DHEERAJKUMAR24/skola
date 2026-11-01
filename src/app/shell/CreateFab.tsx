import { Menu, MenuItem } from "@/components/ui";
import { decksWithPaths } from "@/logic/deck/deckPath";
import { useDecks } from "@/logic/deck/hooks/useDecks";
import {
  IconCards,
  IconFolderPlus,
  IconPlus,
  IconSubtask,
} from "@tabler/icons-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useLocation, useNavigate } from "react-router-dom";
import DeckModal from "../deck/DeckModal";
import "./CreateFab.css";

const BASE = "create-fab";
/** The deck new cards were last added to; the button reuses it when no deck is open. */
export const LAST_DECK_KEY = "lastNewCardDeck";

function lastDeckId() {
  try {
    return localStorage.getItem(LAST_DECK_KEY);
  } catch {
    return null;
  }
}

/** A round button fixed at the bottom right, on every screen, that creates cards and decks. */
export default function CreateFab() {
  const [t] = useTranslation();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const [decks] = useDecks();
  const [modal, setModal] = useState<"deck" | "subdeck" | null>(null);

  // The deck on screen is the natural target for a new card or sub-deck.
  const openId = /^\/(?:deck|new)\/([^/]+)/.exec(pathname)?.[1];
  const openDeck = decks?.find((d) => d.id === openId);

  function newCard() {
    const sorted = decksWithPaths(decks ?? []);
    const target =
      openDeck ??
      sorted.find((x) => x.deck.id === lastDeckId())?.deck ??
      sorted[0]?.deck;
    if (target) navigate(`/new/${target.id}`);
    else setModal("deck"); // a card needs a deck, so make one first
  }

  return (
    <>
      <div
        className={`${BASE}${
          /^\/new(\/|$)/.test(pathname) ? ` ${BASE}--above-footer` : ""
        }`}
      >
        <Menu
          renderTrigger={({ id }) => (
            <button
              type="button"
              popoverTarget={id}
              className={`${BASE}__button`}
              aria-label={t("create-fab.label")}
              title={t("create-fab.label")}
            >
              <IconPlus size={26} />
            </button>
          )}
        >
          <MenuItem leftSection={<IconCards />} onClick={newCard}>
            {t("create-fab.card")}
          </MenuItem>
          <MenuItem
            leftSection={<IconFolderPlus />}
            onClick={() => setModal("deck")}
          >
            {t("create-fab.deck")}
          </MenuItem>
          {openDeck && (
            <MenuItem
              leftSection={<IconSubtask />}
              onClick={() => setModal("subdeck")}
            >
              {t("create-fab.subdeck", { name: openDeck.name })}
            </MenuItem>
          )}
        </Menu>
      </div>
      <DeckModal
        mode="create"
        opened={modal === "deck"}
        setOpened={(o: boolean) => !o && setModal(null)}
      />
      {openDeck && (
        <DeckModal
          mode="create"
          superDeck={openDeck}
          opened={modal === "subdeck"}
          setOpened={(o: boolean) => !o && setModal(null)}
        />
      )}
    </>
  );
}

import { InfoTip } from "@/components/InfoTip/InfoTip";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Text } from "@/components/ui/Text";
import type { Deck } from "@/logic/deck/deck";
import { mastersOfDeck } from "@/logic/master/builderData";
import { createMasterFromDeck } from "@/logic/master/masterCards";
import { countEntries } from "@/logic/master/masterModel";
import { useLiveQuery } from "dexie-react-hooks";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import MasterActions from "./MasterActions";
import "./MasterBuilder.css";

/** The masters of a deck with their activities (tab of the deck page). */
export default function DeckMastersSection({ deck }: { deck?: Deck }) {
  const [t] = useTranslation();
  const navigate = useNavigate();
  const masters = useLiveQuery(
    () => (deck ? mastersOfDeck(deck.id) : []),
    [deck?.id]
  );
  if (!deck) return null;
  return (
    <div className="deck-masters">
      <div className="deck-masters__bar">
        <Text size="sm" variant="dimmed">
          {t("masterBuilder.deck-intro")}
          <InfoTip>{t("masterBuilder.deck-tip")}</InfoTip>
        </Text>
        <Button
          size="sm"
          onClick={async () =>
            navigate(`/master/${await createMasterFromDeck(deck)}`)
          }
        >
          {t("masterBuilder.new-master")}
        </Button>
      </div>
      {masters?.length === 0 && (
        <Text variant="dimmed">{t("masterBuilder.deck-none")}</Text>
      )}
      <ul className="deck-masters__list">
        {masters?.map((m) => (
          <li key={m.id} className="deck-masters__item">
            <div className="deck-masters__head">
              <Text weight="semibold">{m.content.title}</Text>
              {m.content.status && m.content.status !== "active" && (
                <Badge size="sm" color="neutral">
                  {t(`masterBuilder.status-${m.content.status}`)}
                </Badge>
              )}
              <Text size="sm" variant="dimmed">
                {t("masterBuilder.entries-count", {
                  count: countEntries(m.content.sections),
                  sections: m.content.sections.length,
                })}
              </Text>
            </div>
            <MasterActions noteId={m.id} deckId={deck.id} />
          </li>
        ))}
      </ul>
    </div>
  );
}

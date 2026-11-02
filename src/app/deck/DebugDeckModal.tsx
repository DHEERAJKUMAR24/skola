import { Modal } from "@/components/ui/Modal";
import { Text } from "@/components/ui/Text";
import { useCardsOf } from "@/logic/card/hooks/useCardsOf";
import { useStatesOf } from "@/logic/card/hooks/useStatesOf";
import { useSubDecks } from "@/logic/deck/hooks/useSubDecks";
import { useSuperDecks } from "@/logic/deck/hooks/useSuperDecks";
import { deckSchedule } from "@/logic/scheduling/summary";
import { defaultSettings } from "@/logic/settings/defaultSettings";
import { useSetting } from "@/logic/settings/hooks/useSetting";
import { useMemo } from "react";
import { State } from "ts-fsrs";
import { Deck } from "../../logic/deck/deck";
import "./DebugDeckModal.css";

const BASE = "debug-deck-modal";

interface DebugDeckModalProps {
  opened: boolean;
  setOpened: (value: boolean) => void;
  deck?: Deck;
}

function DebugDeckModal({ opened, setOpened, deck }: DebugDeckModalProps) {
  const [cards] = useCardsOf(deck);
  const states = useStatesOf(cards ?? []);
  const [superDecks] = useSuperDecks(deck);
  const [subDecks] = useSubDecks(deck);
  const [wText] = useSetting("#globalScheduler_w");
  const [newDayStartHour] = useSetting("#newDayStartHour");
  const sched = useMemo(
    () =>
      deckSchedule(
        cards ?? [],
        new Date(),
        newDayStartHour,
        (wText ?? defaultSettings["#globalScheduler_w"]).split(",").map(Number)
      ),
    [cards, wText, newDayStartHour, opened]
  );
  const dayLabel = (i: number) =>
    i === 0
      ? "Today"
      : i === 1
        ? "Tomorrow"
        : new Date(Date.now() + i * 86_400_000).toLocaleDateString(undefined, {
            weekday: "short",
            day: "numeric",
            month: "short",
          });

  return (
    <Modal
      opened={opened}
      onClose={() => setOpened(false)}
      title="Deck details"
    >
      <div className={BASE}>
        {deck ? (
          <table className={`${BASE}__table`}>
            <tbody>
              <tr>
                <th>Name:</th>
                <td>{deck.name}</td>
              </tr>
              <tr>
                <th>ID:</th>
                <td>{deck.id}</td>
              </tr>
              <tr>
                <th>SubDecks:</th>
                <td>
                  {subDecks?.map((s, index) => (
                    <span key={s.id}>
                      <a href={"/deck/" + s.id} className={`${BASE}__link`}>
                        {s.name}
                      </a>
                      {index < subDecks.length - 1 && ", "}
                    </span>
                  ))}
                </td>
              </tr>
              <tr>
                <th>SuperDecks:</th>
                <td>
                  {superDecks?.map((s, index) => (
                    <span key={s.id}>
                      <a href={"/deck/" + s.id} className={`${BASE}__link`}>
                        {s.name}
                      </a>
                      {index < superDecks.length - 1 && ", "}
                    </span>
                  ))}
                </td>
              </tr>
              <tr>
                <th>Cards:</th>
                <td className={`${BASE}__ids`}>{deck.cards.join(", ")}</td>
              </tr>
              <tr>
                <th>Notes:</th>
                <td className={`${BASE}__ids`}>{deck.notes.join(", ")}</td>
              </tr>
              <tr>
                <th>Direct Card Length:</th>
                <td>{deck.cards.length}</td>
              </tr>
              <tr>
                <th>Contained Card Length:</th>
                <td>{cards?.length}</td>
              </tr>
              <tr>
                <th colSpan={2} className={`${BASE}__section-header`}>
                  Schedule (cards due)
                </th>
              </tr>
              <tr>
                <th>Overdue:</th>
                <td>{sched.overdue}</td>
              </tr>
              {sched.perDay.map((n, i) => (
                <tr key={dayLabel(i)}>
                  <th>{dayLabel(i)}:</th>
                  <td>{n}</td>
                </tr>
              ))}
              <tr>
                <th>Later:</th>
                <td>{sched.later}</td>
              </tr>
              <tr>
                <th colSpan={2} className={`${BASE}__section-header`}>
                  Memory
                </th>
              </tr>
              <tr>
                <th>Studied / new:</th>
                <td>
                  {sched.studied} / {sched.newCards}
                </td>
              </tr>
              <tr>
                <th>Mature (21d+):</th>
                <td>{sched.mature}</td>
              </tr>
              <tr>
                <th>Avg recall now:</th>
                <td>
                  {sched.studied
                    ? `${Math.round(sched.avgRecall * 100)}%`
                    : "-"}
                </td>
              </tr>
              <tr>
                <th>Avg stability:</th>
                <td>
                  {sched.studied
                    ? `${sched.avgStability.toFixed(1)} days`
                    : "-"}
                </td>
              </tr>
              <tr>
                <th>Avg difficulty:</th>
                <td>
                  {sched.studied
                    ? `${sched.avgDifficulty.toFixed(1)} of 10`
                    : "-"}
                </td>
              </tr>
              <tr>
                <th>Total lapses:</th>
                <td>{sched.lapses}</td>
              </tr>
              <tr>
                <th colSpan={2} className={`${BASE}__section-header`}>
                  States
                </th>
              </tr>
              <tr>
                <th>New:</th>
                <td>{states[State.New]}</td>
              </tr>
              <tr>
                <th>Learning:</th>
                <td>{states[State.Learning]}</td>
              </tr>
              <tr>
                <th>Review:</th>
                <td>{states[State.Review]}</td>
              </tr>
              <tr>
                <th>Relearning:</th>
                <td>{states[State.Relearning]}</td>
              </tr>
            </tbody>
          </table>
        ) : (
          <Text size="sm" variant="dimmed">
            No deck
          </Text>
        )}
      </div>
    </Modal>
  );
}

export default DebugDeckModal;

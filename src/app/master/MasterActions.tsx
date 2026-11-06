import { Button } from "@/components/ui/Button";
import { weakDrillParam } from "@/logic/master/activities";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";

/** The master-specific actions of one master: builder, the three activities and the graph. */
export default function MasterActions({
  noteId,
  deckId,
}: {
  noteId: string;
  deckId: string;
}) {
  const [t] = useTranslation();
  const navigate = useNavigate();
  return (
    <div className="master-actions">
      <Button
        size="sm"
        variant="primary"
        onClick={() => navigate(`/master/${noteId}`)}
      >
        {t("masterBuilder.open-builder")}
      </Button>
      <Button size="sm" onClick={() => navigate(`/master/${noteId}?do=sweep`)}>
        {t("masterBuilder.recall-sweep")}
      </Button>
      <Button size="sm" onClick={() => navigate(`/master/${noteId}?do=gap`)}>
        {t("masterBuilder.gap-hunt")}
      </Button>
      <Button
        size="sm"
        onClick={() => navigate(`/learn/${deckId}/${weakDrillParam(noteId)}`)}
      >
        {t("masterBuilder.weak-drill")}
      </Button>
      <Button
        size="sm"
        variant="ghost"
        onClick={() => navigate(`/graph?focus=${noteId}`)}
      >
        {t("masterBuilder.open-graph")}
      </Button>
    </div>
  );
}

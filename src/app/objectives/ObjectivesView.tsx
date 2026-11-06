import { AppBreadcrumbs } from "@/components/AppBreadcrumbs";
import { InfoTip } from "@/components/InfoTip/InfoTip";
import { Alert } from "@/components/ui/Alert";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { Text } from "@/components/ui/Text";
import { useDocumentTitle } from "@/lib/hooks/useDocumentTitle";
import { startLogin, useAuthEmail } from "@/logic/auth";
import {
  type ObjectiveBrief,
  type ObjectiveStatus,
  type Ratings,
  WHAT,
  describeNext,
  objectivesApi,
} from "@/logic/learning/objectivesClient";
import { needsConnection } from "@/logic/serverApi";
import { useCallback, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { AppHeaderContent } from "../shell/Header/Header";
import ObjectiveDetailView from "./ObjectiveDetail";
import ObjectiveFormModal from "./ObjectiveFormModal";
import "./Objectives.css";

function Dimensions({ label, ratings }: { label: string; ratings: Ratings }) {
  return (
    <div>
      <Text size="xs" variant="dimmed">
        {label}
      </Text>
      <div className="objectives__dims">
        {Object.entries(ratings).map(([dim, r]) => (
          <span
            key={dim}
            className="objectives__dim"
            data-rating={r === null ? "none" : "set"}
            data-low={r !== null && r < 3}
          >
            <span>{dim}</span>
            <strong>{r === null ? "-" : r}</strong>
          </span>
        ))}
      </div>
    </div>
  );
}

function ObjectiveCard({
  o,
  onOpen,
}: {
  o: ObjectiveBrief;
  onOpen: () => void;
}) {
  const score = (s: number | null) => (s === null ? "not scored" : `${s}`);
  return (
    <button type="button" className="objective-card" onClick={onOpen}>
      <div className="objectives__row">
        <Text weight="semibold">{o.title}</Text>
        <Badge color="primary">{o.priority}</Badge>
        {o.status !== "active" && <Badge color="neutral">{o.status}</Badge>}
        {o.mastered && <Badge color="green">mastered</Badge>}
      </div>
      <Text size="sm" variant="dimmed">
        K {score(o.k_score)}
        {o.dimensions.S ? `, S ${score(o.s_score)}` : ", Knowledge only"}.{" "}
        {describeNext(o.next)}
      </Text>
      <Dimensions label="Knowledge (0 to 4)" ratings={o.dimensions.K} />
      {o.dimensions.S && (
        <Dimensions label="Skill (0 to 4)" ratings={o.dimensions.S} />
      )}
    </button>
  );
}

/** Learning objectives with K and S evidence. The data is server-side, so this needs a sign-in. */
export default function ObjectivesView() {
  const { id } = useParams();
  const navigate = useNavigate();
  const email = useAuthEmail();
  useDocumentTitle("Learning objectives");
  const [filter, setFilter] = useState<ObjectiveStatus | "all">("active");
  const [items, setItems] = useState<ObjectiveBrief[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      setItems(await objectivesApi.list(filter === "all" ? undefined : filter));
    } catch (e) {
      setItems(null);
      setError((e as Error).message);
    }
  }, [filter]);
  useEffect(() => {
    if (email && !id) void load();
  }, [email, id, load]);

  return (
    <div className="objectives objectives-view">
      <AppHeaderContent>
        <AppBreadcrumbs
          segments={[
            { label: "Learning objectives", path: "/objectives" },
            ...(id ? [{ label: "Objective" }] : []),
          ]}
        />
      </AppHeaderContent>

      {!email ? (
        <>
          <Alert variant="info">{needsConnection(WHAT)}</Alert>
          <div>
            <Button variant="primary" onClick={() => startLogin("login")}>
              Sign in
            </Button>
          </div>
        </>
      ) : id ? (
        <>
          <div>
            <Button size="sm" onClick={() => navigate("/objectives")}>
              All objectives
            </Button>
          </div>
          <ObjectiveDetailView id={id} />
        </>
      ) : (
        <>
          <div className="objectives__bar objectives__intro">
            <Text variant="dimmed">
              What you want to be able to do or know, with dated evidence for
              Knowledge (K) and Skill (S).{" "}
              <InfoTip>
                An objective says what a learner should know (K: recall,
                explanation, discrimination, transfer) and do (S: build, debug,
                test, adapt). Each dimension is rated 0 to 4 from real work you
                or an assistant record, and mastery needs high, unaided,
                retested results. Cards are linked to an objective to show
                coverage. The same objectives are available to AI assistants.
              </InfoTip>
            </Text>
            <Button variant="primary" onClick={() => setCreating(true)}>
              New objective
            </Button>
          </div>
          <SegmentedControl
            value={filter}
            onChange={(v) => setFilter(v as ObjectiveStatus | "all")}
            data={[
              { value: "active", label: "Active" },
              { value: "parked", label: "Parked" },
              { value: "done", label: "Done" },
              { value: "all", label: "All" },
            ]}
          />
          {error && <Alert variant="error">{error}</Alert>}
          {items?.length === 0 && (
            <Text variant="dimmed">
              No {filter === "all" ? "" : `${filter} `}objectives yet. Create
              one, or ask a connected assistant to.
            </Text>
          )}
          <ul className="objectives__list">
            {items?.map((o) => (
              <li key={o.objective_id}>
                <ObjectiveCard
                  o={o}
                  onOpen={() => navigate(`/objectives/${o.objective_id}`)}
                />
              </li>
            ))}
          </ul>
          {creating && (
            <ObjectiveFormModal
              opened
              onClose={() => setCreating(false)}
              onSave={async (f) => {
                const r = await objectivesApi.create(f);
                navigate(`/objectives/${r.objective_id}`);
              }}
            />
          )}
        </>
      )}
    </div>
  );
}

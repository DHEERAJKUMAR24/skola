import DangerousConfirmModal from "@/components/DangerousConfirmModal";
import { Button } from "@/components/ui/Button";
import {
  IconDatabaseExport,
  IconDatabaseImport,
  IconTrash,
} from "@tabler/icons-react";
import { exportDB, importInto } from "dexie-export-import";
import { useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { db } from "../../../logic/db";
import { seedJsInterview } from "../../../logic/seed/jsInterview";
import "./DatabaseSettingsView.css";
import Section from "../Section";
import StorageSection from "./StorageSection";

const BASE = "database-settings-view";

export default function DatabaseSettingsView() {
  const navigate = useNavigate();
  const [deleteAllDataModalOpened, setDeleteAllDataModalOpened] =
    useState<boolean>(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [seeding, setSeeding] = useState(false);
  const [seedMessage, setSeedMessage] = useState<string | null>(null);

  return (
    <>
      <div>
        <StorageSection />
        <Button
          leftSection={<IconDatabaseExport />}
          onClick={async () => {
            const now = new Date(Date.now());
            const blob = await exportDB(db);
            const a = document.createElement("a");
            a.href = URL.createObjectURL(blob);
            a.download = `skola-export-${now.toLocaleDateString()}-${now.toLocaleTimeString()}.json`;
            a.click();
          }}
        >
          Export All
        </Button>
        <Section title="Sample data">
          <p>
            Programming Languages &gt; JavaScript &gt; 7 concepts with 42
            interview cards, tags, an exam date three weeks away, and some past
            study history so the forecast has something to show.
          </p>
          <Button
            disabled={seeding}
            onClick={async () => {
              setSeeding(true);
              setSeedMessage(null);
              try {
                const r = await seedJsInterview({ withHistory: true });
                setSeedMessage(
                  r.created
                    ? `Added ${r.decks} decks and ${r.notes} cards.`
                    : "The sample is already loaded."
                );
                navigate(`/deck/${r.domainId}`);
              } catch (e) {
                setSeedMessage(`Could not add the sample: ${e}`);
              } finally {
                setSeeding(false);
              }
            }}
          >
            {seeding ? "Adding..." : "Load JavaScript interview sample"}
          </Button>
          {seedMessage && <output>{seedMessage}</output>}
        </Section>
        <Section title="Danger Zone" className={`${BASE}__danger-zone`}>
          <p className={`${BASE}__danger-text`}>
            This section contains potentially dangerous settings. Proceed with
            utmost caution!
          </p>
          <input
            ref={fileInputRef}
            type="file"
            accept=".json"
            className={`${BASE}__file-input`}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) {
                const reader = new FileReader();
                reader.onload = async (event) => {
                  if (event.target) {
                    const blob = new Blob([event.target.result as string], {
                      type: "application/json",
                    });
                    try {
                      await importInto(db, blob, { overwriteValues: true });
                    } catch (error) {
                      console.error(error);
                    }
                  }
                };
                reader.readAsText(file);
              }
            }}
          />
          <Button
            leftSection={<IconDatabaseImport />}
            variant="destructive"
            onClick={() => fileInputRef.current?.click()}
          >
            Import Database (overwrites conflicting data, e.g. settings)
          </Button>
          <Button
            leftSection={<IconTrash />}
            variant="destructive"
            onClick={() => setDeleteAllDataModalOpened(true)}
          >
            Delete all Data
          </Button>
        </Section>
      </div>
      <DangerousConfirmModal
        dangerousAction={() => {
          db.delete();
          navigate("/home");
          window.location.reload();
        }}
        dangerousDependencies={[]}
        dangerousTitle="Delete all Data"
        dangerousDescription="This will delete all of your data including your cards, decks and settings. There is absolutely no way to recover. Are you sure you want to continue?"
        opened={deleteAllDataModalOpened}
        setOpened={setDeleteAllDataModalOpened}
      />
    </>
  );
}

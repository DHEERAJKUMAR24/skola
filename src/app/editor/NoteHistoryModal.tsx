import { InfoTip } from "@/components/InfoTip/InfoTip";
import ModalProps from "@/components/ModalProps";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { Spinner } from "@/components/ui/Spinner";
import { Text } from "@/components/ui/Text";
import { isSignedIn, startLogin, useAuthEmail } from "@/logic/auth";
import { db } from "@/logic/db";
import {
  type FieldChange,
  type HistoryResponse,
  compareVersion,
} from "@/logic/note/historyView";
import { ServerApiError, needsConnection, serverCall } from "@/logic/serverApi";
import { syncNow } from "@/logic/syncScheduler";
import { useCallback, useEffect, useState } from "react";
import "./NoteHistory.css";

const WHAT = "History";
const call = <T,>(body: object) => serverCall<T>("/api/history", body, WHAT);

/** Card id of a note: the server's history tools are keyed by card, the app edits notes. */
async function cardOf(noteId: string) {
  return (await db.cards.where("note").equals(noteId).first())?.id;
}

function Changes({ changes }: { changes: FieldChange[] }) {
  return (
    <>
      {changes.map((c) => (
        <div key={c.name} className="note-history__field">
          <span className="note-history__label">
            {c.name}
            {c.changed ? "" : " (same as now)"}
          </span>
          <p className="note-history__text">
            {c.parts.map((p, i) => (
              <span
                // biome-ignore lint/suspicious/noArrayIndexKey: parts are static for one render
                key={i}
                className={
                  p.kind === "same" ? undefined : `note-history__${p.kind}`
                }
              >
                {p.text}
              </span>
            ))}
          </p>
        </div>
      ))}
    </>
  );
}

/**
 * Earlier versions of a note (last 7 days), each compared with the text now, and a Restore button.
 * The history lives on the server, so this needs sign-in and a connection.
 */
export default function NoteHistoryModal({
  opened,
  setOpened,
  noteId,
}: ModalProps & { noteId: string }) {
  const email = useAuthEmail();
  const [data, setData] = useState<HistoryResponse | null>(null);
  const [cardId, setCardId] = useState<string>();
  const [sel, setSel] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ error: boolean; text: string } | null>(null);

  const load = useCallback(async () => {
    setBusy(true);
    setMsg(null);
    try {
      const id = await cardOf(noteId);
      if (!id) throw new ServerApiError("This note has no cards yet.");
      setCardId(id);
      // Unsent edits would overwrite a restore later: send them first.
      await syncNow().catch(() => {
        throw new ServerApiError(needsConnection(WHAT));
      });
      const res = await call<HistoryResponse>({ op: "history", card_id: id });
      setData(res);
      setSel(res.versions[0]?.version_id);
    } catch (e) {
      setData(null);
      setMsg({ error: true, text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  }, [noteId]);

  useEffect(() => {
    if (opened && email) void load();
  }, [opened, email, load]);

  const version = data?.versions.find((v) => v.version_id === sel);

  async function restore() {
    if (!cardId || !version) return;
    setBusy(true);
    try {
      await call({
        op: "restore",
        card_id: cardId,
        version_id: version.version_id,
      });
      await syncNow().catch(() => {});
      const res = await call<HistoryResponse>({
        op: "history",
        card_id: cardId,
      });
      setData(res);
      setSel(res.versions[0]?.version_id);
      setMsg({
        error: false,
        text: "Restored. The text from before is saved as a new version, so you can undo this.",
      });
    } catch (e) {
      setMsg({ error: true, text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      opened={opened}
      onClose={() => setOpened(false)}
      title={
        <>
          History{" "}
          <InfoTip>
            Skola keeps the text this note had before each edit for 7 days (a
            note not edited for longer still shows its previous version).
            Restoring puts the text and tags back and saves the current text as
            a new version first. Schedules and review history are never touched.
            Pictures drawn into the note are not kept. History is stored on the
            server, so it needs sign-in and a connection.
          </InfoTip>
        </>
      }
    >
      <div className="note-history">
        {(!email || !isSignedIn()) && (
          <>
            <Alert variant="info">{needsConnection(WHAT)}</Alert>
            <div className="note-history__actions">
              <Button variant="primary" onClick={() => startLogin("login")}>
                Sign in
              </Button>
            </div>
          </>
        )}
        {email && busy && !data && <Spinner />}
        {msg && (
          <Alert variant={msg.error ? "error" : "success"}>{msg.text}</Alert>
        )}
        {msg?.error && email && (
          <div className="note-history__actions">
            <Button size="sm" onClick={() => void load()} disabled={busy}>
              Try again
            </Button>
          </div>
        )}
        {data && data.versions.length === 0 && (
          <Text variant="dimmed">
            No earlier versions in the last {data.keeps_days} days. Edit the
            note and the text before the edit is kept here.
          </Text>
        )}
        {data && data.versions.length > 0 && (
          <div className="note-history__layout">
            <ul className="note-history__list" aria-label="Saved versions">
              {data.versions.map((v) => (
                <li key={v.version_id}>
                  <button
                    type="button"
                    className="note-history__version"
                    aria-pressed={v.version_id === sel}
                    onClick={() => setSel(v.version_id)}
                  >
                    {new Date(v.replaced_at).toLocaleString()}
                  </button>
                </li>
              ))}
            </ul>
            <div className="note-history__detail">
              {version && (
                <>
                  <Text variant="dimmed" size="sm">
                    Green is in this version, red is in the text now.
                  </Text>
                  <Changes changes={compareVersion(version, data.current)} />
                  <div className="note-history__actions">
                    <Button
                      variant="primary"
                      disabled={busy}
                      onClick={() => void restore()}
                    >
                      Restore this version
                    </Button>
                  </div>
                </>
              )}
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}

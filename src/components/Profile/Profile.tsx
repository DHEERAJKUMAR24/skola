import { copied, genericFail } from "@/components/Notification/Notification";
import { startTourHere } from "@/components/Tour/TourHost";
import { Menu, MenuItem } from "@/components/ui/Menu";
import { signOut, startLogin, useAuthEmail } from "@/logic/auth";
import { syncNow } from "@/logic/syncScheduler";
import { type SyncStatus, useSyncStatus } from "@/logic/syncStatus";
import {
  IconCopy,
  IconHelp,
  IconLogin,
  IconLogout,
  IconPlugConnected,
  IconRefresh,
  IconSettings,
  IconUser,
  IconUserPlus,
} from "@tabler/icons-react";
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import "./Profile.css";

const BASE = "profile";
const RING_PAD = 4;

function formatSyncedAt(lastSyncedAt: number, now: number): string {
  const diff = now - lastSyncedAt;
  if (diff < 60_000) return "Synced just now";
  if (diff < 3_600_000)
    return `Synced ${Math.floor(diff / 60_000)} min ago`;
  return `Synced at ${new Date(lastSyncedAt).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  })}`;
}

/** Short status text, updated every second while a countdown is running and every minute while idle. */
export function useSyncLabel(status: SyncStatus) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (status.phase === "pending") {
      setNow(Date.now());
      const t = setInterval(() => setNow(Date.now()), 1000);
      return () => clearInterval(t);
    }
    if (status.phase === "idle" && status.lastSyncedAt) {
      setNow(Date.now());
      const t = setInterval(() => setNow(Date.now()), 60_000);
      return () => clearInterval(t);
    }
  }, [status.phase, status.lastSyncedAt]);

  switch (status.phase) {
    case "pending":
      return `Saving in ${Math.max(0, Math.ceil(((status.deadline ?? now) - now) / 1000))}s`;
    case "syncing":
      return "Syncing…";
    case "error":
      return "Sync failed";
    case "offline":
      return "Offline, saved on this device";
    default:
      return status.lastSyncedAt
        ? formatSyncedAt(status.lastSyncedAt, now)
        : "Signed in";
  }
}

function SyncRing({ size, status }: { size: number; status: SyncStatus }) {
  const box = size + RING_PAD * 2;
  const r = (box - 3) / 2;
  const c = 2 * Math.PI * r;
  if (status.phase === "idle") return null;

  const arc = [`${BASE}__ring-arc`, `${BASE}__ring-arc--${status.phase}`].join(
    " "
  );
  const style =
    status.phase === "pending"
      ? ({
          strokeDasharray: c,
          "--ring-c": c,
          "--ring-ms": `${status.duration}ms`,
        } as React.CSSProperties)
      : status.phase === "syncing"
        ? { strokeDasharray: `${c * 0.3} ${c}` }
        : undefined;

  return (
    <svg
      className={`${BASE}__ring`}
      width={box}
      height={box}
      viewBox={`0 0 ${box} ${box}`}
      aria-hidden="true"
    >
      <circle
        className={`${BASE}__ring-track`}
        cx={box / 2}
        cy={box / 2}
        r={r}
      />
      {/* key restarts the countdown animation whenever the deadline moves */}
      <circle
        key={status.deadline ?? status.phase}
        className={arc}
        cx={box / 2}
        cy={box / 2}
        r={r}
        style={style}
      />
    </svg>
  );
}

export function ProfileAvatar({ size = 32 }: { size?: number }) {
  const email = useAuthEmail();
  const status = useSyncStatus();
  const box = size + RING_PAD * 2;

  return (
    <span className={`${BASE}__avatar`} style={{ width: box, height: box }}>
      <span
        className={`${BASE}__face ${email ? "" : `${BASE}__face--guest`}`}
        style={{ width: size, height: size, fontSize: size * 0.45 }}
      >
        {email ? email[0].toUpperCase() : <IconUser size={size * 0.55} />}
      </span>
      {email && <SyncRing size={size} status={status} />}
    </span>
  );
}

interface ProfileMenuProps {
  /** `icon`: just the avatar (header). `card`: avatar with email and status (sidebar). */
  variant: "icon" | "card";
  /** Hide the text in `card` mode (collapsed sidebar). */
  minimal?: boolean;
}

export function ProfileMenu({ variant, minimal = false }: ProfileMenuProps) {
  const email = useAuthEmail();
  const status = useSyncStatus();
  const label = useSyncLabel(status);
  const navigate = useNavigate();
  const popoverId = useRef("");

  const close = () => document.getElementById(popoverId.current)?.hidePopover();
  const pick = (fn: () => void) => () => {
    close();
    fn();
  };

  return (
    <Menu
      renderTrigger={({ id }) => {
        popoverId.current = id;
        return (
          <button
            type="button"
            popoverTarget={id}
            className={`${BASE}__trigger ${BASE}__trigger--${variant}`}
            aria-label="Account menu"
          >
            <ProfileAvatar size={variant === "icon" ? 28 : 32} />
            {variant === "card" && !minimal && (
              <span className={`${BASE}__text`}>
                <span className={`${BASE}__email`}>
                  {email ?? "Not signed in"}
                </span>
                <span className={`${BASE}__status`}>
                  {email ? label : "Local only"}
                </span>
              </span>
            )}
          </button>
        );
      }}
    >
      <MenuItem
        leftSection={<IconHelp size={16} />}
        onClick={pick(startTourHere)}
      >
        Take a tour of this page
      </MenuItem>
      <MenuItem
        leftSection={<IconPlugConnected size={16} />}
        onClick={pick(() => navigate("/settings/connect"))}
      >
        Connect an AI assistant
      </MenuItem>
      <MenuItem
        leftSection={<IconCopy size={16} />}
        onClick={pick(() => {
          navigator.clipboard
            .writeText(`${window.location.origin}/mcp`)
            .then(() => copied("MCP server address"))
            .catch(() => genericFail());
        })}
      >
        Copy MCP server address
      </MenuItem>
      {email ? (
        <>
          <div className={`${BASE}__menu-head`}>
            <span className={`${BASE}__email`}>{email}</span>
            <span className={`${BASE}__status`}>{label}</span>
          </div>
          <MenuItem
            leftSection={<IconRefresh size={16} />}
            onClick={() => void syncNow().catch(() => {})}
          >
            Sync now
          </MenuItem>
          <MenuItem
            leftSection={<IconSettings size={16} />}
            onClick={pick(() => navigate("/settings/sync"))}
          >
            Account settings
          </MenuItem>
          <MenuItem
            color="red"
            leftSection={<IconLogout size={16} />}
            onClick={pick(() => void signOut())}
          >
            Sign out
          </MenuItem>
        </>
      ) : (
        <>
          <MenuItem
            leftSection={<IconLogin size={16} />}
            onClick={pick(() => void startLogin("login"))}
          >
            Sign in
          </MenuItem>
          <MenuItem
            leftSection={<IconUserPlus size={16} />}
            onClick={pick(() => void startLogin("signup"))}
          >
            Create account
          </MenuItem>
        </>
      )}
    </Menu>
  );
}

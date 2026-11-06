import { AppBreadcrumbs } from "@/components/AppBreadcrumbs";
import { NavItem } from "@/components/ui/NavItem";
import { useSetting } from "@/logic/settings/hooks/useSetting";
import {
  IconBolt,
  IconBraces,
  IconCloud,
  IconDatabase,
  IconHierarchy2,
  IconInfoCircle,
  IconPalette,
  IconPencil,
  IconPlugConnected,
  IconSchool,
  IconSettings,
  IconSparkles,
  IconStack2,
} from "@tabler/icons-react";
import { t } from "i18next";
import type { ReactNode } from "react";
import { Navigate, useParams } from "react-router-dom";
import { AppHeaderContent } from "../shell/Header/Header";
import ConnectView from "../skills/ConnectView";
import SkillEditorView from "../skills/SkillEditorView";
import SkillView from "../skills/SkillView";
import AboutSettingsView from "./AboutSettingsView";
import AiSettingsView from "./AiSettingsView";
import AppearanceSettingsView from "./AppearanceSettingsView";
import DatabaseSettingsView from "./DatabaseSettingsView/DatabaseSettingsView";
import EditingSettingsView from "./EditingSettingsView/EditingSettingsView";
import GeneralSettingsView from "./GeneralSettingsView";
import HierarchySettingsView from "./HierarchySettingsView";
import LearnSettingsView from "./LearnSettingsView";
import SyncSettingsView from "./SyncSettingsView";
import StudyPresetsView from "./presets/StudyPresetsView";
import { SETTINGS_GROUPS, type SettingsSectionId } from "./sections";
import "./SettingsView.css";

const BASE = "settings-view";

const ICONS: Record<SettingsSectionId, ReactNode> = {
  general: <IconSettings size={18} />,
  appearance: <IconPalette size={18} />,
  editing: <IconPencil size={18} />,
  learn: <IconBolt size={18} />,
  presets: <IconStack2 size={18} />,
  hierarchy: <IconHierarchy2 size={18} />,
  ai: <IconSparkles size={18} />,
  connect: <IconPlugConnected size={18} />,
  skills: <IconSchool size={18} />,
  database: <IconDatabase size={18} />,
  sync: <IconCloud size={18} />,
  about: <IconInfoCircle size={18} />,
  developer: <IconBraces size={18} />,
};

export default function SettingsView() {
  const [developerMode] = useSetting("#developerMode");
  const { section = "general", item } = useParams();

  const groups = SETTINGS_GROUPS.map((g) => ({
    ...g,
    sections: g.sections.filter((s) => s.id !== "developer" || developerMode),
  })).filter((g) => g.sections.length);
  const current = groups
    .flatMap((g) => g.sections)
    .find((s) => s.id === section);
  if (!current) return <Navigate to="/settings/general" replace />;

  return (
    <div className={BASE}>
      <AppHeaderContent>
        <AppBreadcrumbs
          segments={[{ label: t("settings.title") }, { label: current.label }]}
        />
      </AppHeaderContent>

      <nav className={`${BASE}__nav`} aria-label="Settings sections">
        {groups.map((g) => (
          <div key={g.title} className={`${BASE}__group`}>
            <div className={`${BASE}__group-title`}>{g.title}</div>
            {g.sections.map((s) => (
              <NavItem
                key={s.id}
                label={s.label}
                icon={ICONS[s.id]}
                path={`/settings/${s.id}`}
                active={s.id === section}
              />
            ))}
          </div>
        ))}
      </nav>

      <div className={`${BASE}__content`} data-section={section}>
        {section === "general" && <GeneralSettingsView />}
        {section === "appearance" && <AppearanceSettingsView />}
        {section === "editing" && <EditingSettingsView />}
        {section === "learn" && <LearnSettingsView />}
        {section === "presets" && <StudyPresetsView />}
        {section === "hierarchy" && <HierarchySettingsView />}
        {section === "ai" && <AiSettingsView />}
        {section === "connect" && (item ? <SkillView /> : <ConnectView />)}
        {section === "skills" && <SkillEditorView />}
        {section === "database" && <DatabaseSettingsView />}
        {section === "sync" && <SyncSettingsView />}
        {section === "about" && <AboutSettingsView />}
        {section === "developer" && t("settings.developer.description")}
      </div>
    </div>
  );
}

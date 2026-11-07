import { InfoTip } from "@/components/InfoTip/InfoTip";
import { Select } from "@/components/ui/Select";
import { useSetting } from "@/logic/settings/hooks/useSetting";
import { setSetting } from "@/logic/settings/setSetting";
import { useTranslation } from "react-i18next";

const zones = Intl.supportedValuesOf("timeZone");

export default function TimeZoneSelect() {
  const [timeZone] = useSetting("#timeZone");
  const [t] = useTranslation();
  const current = timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  const options = (zones.includes(current) ? zones : [current, ...zones]).map(
    (z) => ({ value: z, label: z })
  );

  return (
    <Select
      value={current}
      label={
        <>
          {t("settings.general.time-zone")}{" "}
          <InfoTip>{t("settings.general.time-zone-description")}</InfoTip>
        </>
      }
      onChange={(value) => setSetting("#timeZone", value)}
      options={options}
    />
  );
}

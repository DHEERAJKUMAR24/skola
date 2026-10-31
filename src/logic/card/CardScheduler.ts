import { FSRS, default_w, generatorParameters } from "ts-fsrs";
import { useEffect } from "react";
import { defaultSettings } from "../settings/defaultSettings";
import { useSetting } from "../settings/hooks/useSetting";
import { setSetting } from "../settings/setSetting";

const scheduler = new FSRS(generatorParameters());

export function useGlobalScheduler() {
  const [maximumInterval] = useSetting("#globalScheduler_maximumInterval");
  const [requestRetention] = useSetting("#globalScheduler_requestRetention");
  const [w] = useSetting("#globalScheduler_w");

  useEffect(() => {
    const parsedW = (w ?? defaultSettings["#globalScheduler_w"])
      .split(",")
      .map((x) => Number.parseFloat(x));
    // Weights saved for older FSRS versions have a different length; fall back.
    scheduler.parameters = generatorParameters({
      maximum_interval: maximumInterval,
      request_retention: requestRetention,
      w: parsedW.length === default_w.length ? parsedW : default_w,
    });
  }, [maximumInterval, requestRetention, w]);
  return scheduler;
}

export function updateGlobalScheduler() {
  setSetting("#globalScheduler_maximumInterval", scheduler.parameters.maximum_interval);
  setSetting(
    "#globalScheduler_requestRetention",
    scheduler.parameters.request_retention
  );
  setSetting("#globalScheduler_w", scheduler.parameters.w.join(","));
}

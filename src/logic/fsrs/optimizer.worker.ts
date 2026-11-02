// Runs FSRS parameter training off the main thread. The WASM comes from `fsrs-browser`.
import init, { Fsrs, initThreadPool } from "fsrs-browser";

interface Request {
  ratings: Uint32Array;
  deltas: Uint32Array;
  lengths: Uint32Array;
  shortTerm: boolean;
  relearningSteps: number;
}

self.onmessage = async (e: MessageEvent<Request>) => {
  const r = e.data;
  try {
    await init();
    await initThreadPool(Math.min(4, navigator.hardwareConcurrency || 1));
    const fsrs = new Fsrs();
    const weights = fsrs.computeParameters(
      r.ratings,
      r.deltas,
      r.lengths,
      undefined,
      r.shortTerm,
      undefined,
      r.relearningSteps,
      undefined
    );
    (self as unknown as Worker).postMessage({ weights: Array.from(weights) });
  } catch (err) {
    (self as unknown as Worker).postMessage({
      error: err instanceof Error ? err.message : String(err),
    });
  }
};

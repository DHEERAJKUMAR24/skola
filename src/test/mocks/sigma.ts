// Minimal Sigma.js stub for the test environment (no WebGL available in jsdom).
// The real sigma is used in the browser; tests only need the class to not crash.
export default class Sigma {
  kill() {}
  on() {
    return this;
  }
  off() {
    return this;
  }
  scheduleRefresh() {
    return this;
  }
  refresh() {
    return this;
  }
  setSetting() {
    return this;
  }
  getCamera() {
    return { animate: async () => {} };
  }
  graphToViewport() {
    return { x: 0, y: 0 };
  }
}

/** Only same-site paths are allowed as post-login targets, so a crafted link cannot bounce users elsewhere. */
export function safeCallback(value: string | null) {
  return value && /^\/(?![/\\])/.test(value) ? value : "/";
}

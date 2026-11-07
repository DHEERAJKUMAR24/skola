/** `[code] message` so a client can branch on the code and show the text. */
export class ManageError extends Error {
  constructor(code: string, message: string) {
    super(`[${code}] ${message}`);
  }
}

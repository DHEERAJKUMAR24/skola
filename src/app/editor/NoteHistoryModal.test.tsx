import { render, screen } from "@testing-library/react";
import { beforeAll, describe, expect, it, vi } from "vitest";
import NoteHistoryModal from "./NoteHistoryModal";

vi.mock("@/logic/auth", () => ({
  useAuthEmail: () => null,
  startLogin: vi.fn(),
  isSignedIn: () => false,
  authFetch: vi.fn(),
  NotSignedIn: class extends Error {},
}));
vi.mock("@/logic/syncScheduler", () => ({ syncNow: vi.fn() }));

// jsdom has no <dialog> methods.
beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute("open");
  };
});

describe("NoteHistoryModal signed out", () => {
  it("says history needs sign-in and a connection and offers sign-in", () => {
    render(<NoteHistoryModal opened setOpened={() => {}} noteId="n1" />);
    expect(
      screen.getByText("History needs sign-in and a connection.")
    ).toBeVisible();
    expect(screen.getByRole("button", { name: "Sign in" })).toBeVisible();
  });
});

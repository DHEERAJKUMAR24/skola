import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeAll, describe, expect, it, vi } from "vitest";
import AssessmentForm from "./AssessmentForm";
import ObjectivesView from "./ObjectivesView";

const auth = vi.hoisted(() => ({ email: null as string | null }));
vi.mock("@/logic/auth", () => ({
  useAuthEmail: () => auth.email,
  startLogin: vi.fn(),
  isSignedIn: () => !!auth.email,
  authFetch: vi.fn(),
  NotSignedIn: class extends Error {},
}));

// jsdom has no Popover API, which the Select uses.
beforeAll(() => {
  HTMLElement.prototype.hidePopover = () => {};
  HTMLElement.prototype.showPopover = () => {};
});

describe("AssessmentForm", () => {
  it("blocks a 4 with hints and explains why, then submits valid evidence", async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(<AssessmentForm track="KS" onSubmit={onSubmit} />);
    const save = screen.getByRole("button", { name: "Save assessment" });
    expect(save).toBeDisabled();

    fireEvent.change(screen.getByRole("textbox"), {
      target: { value: "wrote the closure from memory" },
    });
    expect(save).toBeEnabled();

    fireEvent.change(screen.getByRole("spinbutton"), {
      target: { value: "2" },
    });
    fireEvent.click(await screen.findByText(/4 strong/));
    expect(
      await screen.findByText(/A 4 means strong and unaided/)
    ).toBeVisible();
    expect(save).toBeDisabled();

    fireEvent.change(screen.getByRole("spinbutton"), {
      target: { value: "0" },
    });
    await waitFor(() => expect(save).toBeEnabled());
    fireEvent.click(save);
    await waitFor(() => expect(onSubmit).toHaveBeenCalledOnce());
    expect(onSubmit.mock.calls[0][0]).toMatchObject({
      domain: "K",
      dimension: "recall",
      rating: 4,
      hints: 0,
      independent: true,
    });
  });

  it("offers only Knowledge on a K-only objective and shows a server refusal", async () => {
    const onSubmit = vi.fn().mockRejectedValue(new Error("evidence changed"));
    render(<AssessmentForm track="K" onSubmit={onSubmit} />);
    expect(screen.queryByText("S: Skill")).toBeNull();
    fireEvent.change(screen.getByRole("textbox"), {
      target: { value: "answered correctly" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save assessment" }));
    expect(await screen.findByText("evidence changed")).toBeVisible();
  });
});

describe("ObjectivesView signed out", () => {
  it("says it needs sign-in and a connection, and makes no request", () => {
    auth.email = null;
    render(
      <MemoryRouter>
        <ObjectivesView />
      </MemoryRouter>
    );
    expect(
      screen.getByText("Learning objectives needs sign-in and a connection.")
    ).toBeVisible();
    expect(screen.getByRole("button", { name: "Sign in" })).toBeVisible();
  });
});

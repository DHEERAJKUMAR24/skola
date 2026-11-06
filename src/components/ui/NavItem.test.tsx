import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { NavItem } from "./NavItem";

describe("NavItem", () => {
  it("renders a button when there is no rightElement", () => {
    const handleClick = vi.fn();
    render(
      <MemoryRouter>
        <NavItem
          label="Test Nav"
          icon={<span data-testid="icon" />}
          onClick={handleClick}
        />
      </MemoryRouter>
    );

    const button = screen.getByRole("button", { name: "Test Nav" });
    expect(button).toBeInTheDocument();
    expect(button.tagName).toBe("BUTTON");

    fireEvent.click(button);
    expect(handleClick).toHaveBeenCalledTimes(1);
  });

  it("does not nest buttons when rightElement contains a button", () => {
    const handleItemClick = vi.fn();
    const handleActionClick = vi.fn();

    const { container } = render(
      <MemoryRouter>
        <NavItem
          label="Test Deck"
          icon={<span data-testid="icon" />}
          onClick={handleItemClick}
          rightElement={
            <button
              type="button"
              aria-label="Deck Menu"
              onClick={handleActionClick}
            >
              Menu
            </button>
          }
        />
      </MemoryRouter>
    );

    // Ensure no button is a descendant of another button
    const buttons = container.querySelectorAll("button");
    expect(buttons.length).toBe(2);
    for (const btn of buttons) {
      expect(btn.querySelector("button")).toBeNull();
    }

    // Clicking the main button triggers only the main callback
    const mainButton = screen.getByRole("button", { name: "Test Deck" });
    fireEvent.click(mainButton);
    expect(handleItemClick).toHaveBeenCalledTimes(1);
    expect(handleActionClick).not.toHaveBeenCalled();

    // Clicking the right button triggers only the right action
    const actionButton = screen.getByRole("button", { name: "Deck Menu" });
    fireEvent.click(actionButton);
    expect(handleActionClick).toHaveBeenCalledTimes(1);
    expect(handleItemClick).toHaveBeenCalledTimes(1); // Still 1, didn't fire again
  });
});

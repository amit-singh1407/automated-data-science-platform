import { render, screen, act } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import App from "./App";

describe("App", () => {
  it("renders platform header and direct workspace dashboard", async () => {
    await act(async () => {
      render(<App />);
    });
    const branding = screen.getAllByText("AutoData AI");
    expect(branding.length).toBeGreaterThan(0);
    expect(screen.getByText("Workspace Ready")).toBeInTheDocument();
    const uploadTexts = screen.getAllByText("Upload Dataset");
    expect(uploadTexts.length).toBeGreaterThan(0);
  });
});

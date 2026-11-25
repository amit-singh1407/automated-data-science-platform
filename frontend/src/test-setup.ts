import "@testing-library/jest-dom";
import { vi } from "vitest";

// Plotly needs a real browser; charts are not under test, so stub it.
vi.mock("plotly.js-dist-min", () => ({
  default: {
    newPlot: async () => undefined,
    react: async () => undefined,
    purge: () => undefined,
  },
}));

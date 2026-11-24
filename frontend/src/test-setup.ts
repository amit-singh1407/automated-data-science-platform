import "@testing-library/jest-dom";
import { vi } from "vitest";

vi.mock("plotly.js-dist-min", () => ({
  default: {
    newPlot: async () => undefined,
    purge: () => undefined
  }
}));

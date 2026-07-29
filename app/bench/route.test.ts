import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  renderBenchmarkDashboard: vi.fn(() => "<html>dashboard</html>"),
  readBenchSummaries: vi.fn(() => []),
}));

vi.mock("@/scripts/dj-bench/dashboard", () => ({
  renderBenchmarkDashboard: mocks.renderBenchmarkDashboard,
}));
vi.mock("@/scripts/dj-bench/reportStore", () => ({
  readBenchSummaries: mocks.readBenchSummaries,
}));

import { GET } from "./route";

describe("GET /bench", () => {
  beforeEach(() => vi.clearAllMocks());

  it("redirects legacy run links to styled run detail", async () => {
    const response = await GET(
      new Request("http://localhost:3001/bench?run=run-1"),
    );

    expect(response.status).toBe(307);
    expect(response.headers.get("location"))
      .toBe("http://localhost:3001/bench/runs/run-1");
  });

  it("renders aggregate dashboard with run-detail links", async () => {
    mocks.readBenchSummaries.mockReturnValue([{
      runId: "run-1",
    } as never]);

    const response = await GET(new Request("http://localhost:3001/bench"));

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/html");
    const link = mocks.renderBenchmarkDashboard.mock.calls[0]?.[2] as
      | ((run: { runId: string }) => string)
      | undefined;
    expect(link?.({ runId: "run-1" })).toBe("/bench/runs/run-1");
  });
});

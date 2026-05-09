// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { JobDto } from "../types";

const job: JobDto = {
  id: "job_test_123",
  name: "Daily list files",
  type: "task",
  refId: "list files",
  version: null,
  schedule: "every weekday at 9am",
  scheduleKind: "recurring",
  nextRunAt: "2026-05-04T13:00:00.000Z",
  status: "active",
  lastOutcome: "never",
  workspacePath: "/tmp/workspace",
  testCommand: null,
  testMode: true,
  createdAt: "2026-05-02T12:00:00.000Z",
  updatedAt: "2026-05-02T12:00:00.000Z",
  lastRunAt: null
};

beforeEach(() => {
  const jobs = [job];
  Object.defineProperty(window, "squidbot", {
    configurable: true,
    value: {
      listJobs: vi.fn(async ({ status }: { status?: string } = {}) => {
        if (!status || status === "all") {
          return jobs;
        }
        return jobs.filter((item) => item.status === status);
      }),
      getJob: vi.fn(async (jobId: string) => ({
        job: jobs.find((item) => item.id === jobId) ?? job,
        runs: [],
        schedule: {
          input: "every weekday at 9am",
          normalized: "0 9 * * 1-5",
          kind: "recurring",
          nextRunAt: "2026-05-04T13:00:00.000Z"
        }
      })),
      createJob: vi.fn(async (request: Partial<JobDto>) => {
        const created = {
          ...job,
          id: "job_created",
          name: request.name ?? "Created job",
          refId: request.refId ?? "list files",
          schedule: request.schedule ?? "every minute"
        };
        jobs.unshift(created);
        return created;
      }),
      pauseJob: vi.fn(async () => ({ ...job, status: "paused" })),
      resumeJob: vi.fn(async () => ({ ...job, status: "active" })),
      removeJob: vi.fn(async () => job),
      runJobNow: vi.fn(async () => ({ job, run: { id: "job_run_test", jobId: job.id, runId: "run_test", traceId: "trace_test" } }))
    }
  });
});

afterEach(() => {
  Reflect.deleteProperty(window, "squidbot");
});

describe("JobsPage", () => {
  it("lists jobs and can create a new task job", async () => {
    const { JobsPage } = await import("./JobsPage");
    render(<JobsPage />);

    await waitFor(() => expect(screen.getByText("Daily list files")).toBeTruthy());
    expect(screen.getByText("0 9 * * 1-5")).toBeTruthy();

    fireEvent.change(screen.getByPlaceholderText("Daily repo check"), { target: { value: "Hourly docs" } });
    fireEvent.change(screen.getByPlaceholderText("list files"), { target: { value: "Use nonexistentTool to generate docs" } });
    fireEvent.change(screen.getByPlaceholderText("*/15 * * * *"), { target: { value: "every minute" } });
    fireEvent.click(screen.getByRole("button", { name: /Create Job/i }));

    await waitFor(() => {
      expect(window.squidbot.createJob).toHaveBeenCalledWith(
        expect.objectContaining({
          name: "Hourly docs",
          type: "task",
          refId: "Use nonexistentTool to generate docs",
          schedule: "every minute"
        })
      );
    });
  });
});

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { initializeDatabase, type SquidDatabase } from "@squidbot/db";
import { computeNextRunAt, parseSchedule, Scheduler } from "../src/index.js";

let database: SquidDatabase | null = null;
let tempRoots: string[] = [];

afterEach(() => {
  database?.close();
  database = null;
  for (const root of tempRoots) {
    fs.rmSync(root, { recursive: true, force: true });
  }
  tempRoots = [];
});

function tempRoot(prefix: string): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempRoots.push(root);
  return root;
}

function tempDb(): SquidDatabase {
  const root = tempRoot("squidbot-scheduler-db-");
  database = initializeDatabase(path.join(root, "squidbot.sqlite"));
  return database;
}

function tempWorkspace(): string {
  const workspace = tempRoot("squidbot-scheduler-workspace-");
  fs.writeFileSync(path.join(workspace, "README.md"), "# Fixture\n", "utf8");
  return workspace;
}

describe("scheduler schedule parsing", () => {
  it("parses cron, recurring phrases, and one-off phrases", () => {
    const from = new Date("2026-05-01T12:00:00.000Z");

    expect(parseSchedule("*/15 * * * *", from)).toMatchObject({
      kind: "recurring",
      normalized: "*/15 * * * *",
      nextRunAt: "2026-05-01T12:15:00.000Z"
    });
    expect(parseSchedule("every Monday at 9am", from)).toMatchObject({
      kind: "recurring",
      normalized: "0 9 * * 1"
    });
    expect(parseSchedule("in 5 minutes", from)).toMatchObject({
      kind: "oneOff",
      nextRunAt: "2026-05-01T12:05:00.000Z"
    });
    expect(parseSchedule("2026-05-04T10:00:00", from)).toMatchObject({
      kind: "oneOff",
      nextRunAt: new Date("2026-05-04T10:00:00").toISOString()
    });
  });

  it("rejects invalid schedules", () => {
    expect(() => parseSchedule("not a real schedule")).toThrow(/Invalid cron expression/);
    expect(() => parseSchedule("61 * * * *")).toThrow(/Cron value out of range/);
    expect(() => parseSchedule("every 0 minutes")).toThrow(/Minute interval/);
  });

  it("computes daily next run times", () => {
    expect(computeNextRunAt("daily at 9:30", new Date(2026, 4, 1, 8, 0, 0))).toBe(new Date(2026, 4, 1, 9, 30, 0).toISOString());
    expect(computeNextRunAt("daily at 9:30", new Date(2026, 4, 1, 10, 0, 0))).toBe(new Date(2026, 4, 2, 9, 30, 0).toISOString());
  });
});

describe("Scheduler", () => {
  it("creates, pauses, resumes, and removes jobs", () => {
    const db = tempDb();
    const scheduler = new Scheduler(db, {
      workspacePath: tempWorkspace(),
      now: () => new Date("2026-05-01T12:00:00.000Z")
    });

    const job = scheduler.createJob({
      name: "List files",
      type: "task",
      refId: "list files",
      schedule: "every minute"
    });

    expect(job.status).toBe("active");
    expect(job.nextRunAt).toBe("2026-05-01T12:01:00.000Z");
    expect(scheduler.listJobs()).toHaveLength(1);
    expect(scheduler.pauseJob(job.id).status).toBe("paused");
    expect(scheduler.resumeJob(job.id).status).toBe("active");
    expect(scheduler.removeJob(job.id).id).toBe(job.id);
    expect(scheduler.listJobs({ status: "all" })).toHaveLength(0);
  });

  it("rejects missing skill references and versions at creation time", () => {
    const db = tempDb();
    const scheduler = new Scheduler(db, {
      workspacePath: tempWorkspace(),
      now: () => new Date("2026-05-01T12:00:00.000Z")
    });

    expect(() =>
      scheduler.createJob({
        name: "Missing skill",
        type: "skill",
        refId: "not_a_real_skill",
        schedule: "every minute"
      })
    ).toThrow(/Skill not found/);
    expect(scheduler.listJobs({ status: "all" })).toHaveLength(0);
  });

  it("runs a due task job and records traceable history", async () => {
    const db = tempDb();
    const workspacePath = tempWorkspace();
    const scheduler = new Scheduler(db, {
      workspacePath,
      now: () => new Date("2026-05-01T12:02:00.000Z")
    });
    const job = scheduler.createJob({
      name: "Run now task",
      type: "task",
      refId: "Fix calculator add function",
      schedule: "in 1 minutes",
      workspacePath
    });

    const result = await scheduler.runNow(job.id);
    const updated = scheduler.getJob(job.id);
    const trace = updated ? db.getTraceByRunId(result.run.runId ?? "") : null;

    expect(result.run.outcome).toBe("success");
    expect(updated?.status).toBe("completed");
    expect(scheduler.showJob(job.id).runs).toHaveLength(1);
    expect(trace).toBeTruthy();
    expect(db.listEvents(`session_job_${job.id}_${new Date("2026-05-01T12:02:00.000Z").getTime().toString(36)}`).some((event) => event.type === "job.completed")).toBe(true);
  });
});

import type { SquidDatabase } from "@squidbot/db";
import { EvalResultStore } from "./resultStore.js";

export function listLeaderboard(database: SquidDatabase, options: { datasetId?: string; domain?: string; limit?: number }) {
  return new EvalResultStore(database).listLeaderboard(options);
}

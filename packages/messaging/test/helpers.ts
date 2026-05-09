import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { initializeDatabase, type SquidDatabase } from "@squidbot/db";
import { MessagingAdapterRegistry, MessagingStore } from "../src/index.js";

export function tempDatabase(): SquidDatabase {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "squidbot-messaging-test-"));
  return initializeDatabase(path.join(dir, "squidbot.sqlite"));
}

export function setupMessaging(database: SquidDatabase): MessagingStore {
  const store = new MessagingStore(database);
  new MessagingAdapterRegistry(store).installDefaults();
  return store;
}

import { execFileSync } from "node:child_process";

const commands = [
  ["npm", ["install"]],
  ["npm", ["run", "typecheck"]],
  ["npm", ["test"]],
  ["npm", ["run", "build"]],
  ["npm", ["audit", "--omit=optional"]],
  ["npm", ["run", "governance", "--", "bootstrap"]],
  ["npm", ["run", "governance", "--", "status"]],
  ["npm", ["run", "chat", "--", "--workspace", "./examples/buggy-python", "list files"]],
  ["npm", ["run", "run", "--", "--workspace", "./examples/buggy-python", "Fix calculator add function", "--test-command", "pytest"]],
  ["npm", ["run", "traces", "--", "list"]],
  ["npm", ["run", "memory", "--", "graph", "search", "--hybrid", "calculator add bug", "--top", "5"]],
  ["npm", ["run", "reflections"]],
  ["npm", ["run", "gaps", "--", "list"]],
  ["npm", ["run", "connectors", "--", "list"]],
  ["npm", ["run", "connectors", "--", "call", "demoSales", "readSales"]],
  ["npm", ["run", "skill", "--", "list"]],
  ["npm", ["run", "job", "--", "list"]],
  ["npm", ["run", "sandbox", "--", "list"]],
  ["npm", ["run", "team", "--", "roles", "list"]],
  ["npm", ["run", "team", "--", "list"]],
  ["npm", ["run", "eval", "--", "datasets", "list"]],
  ["npm", ["run", "messaging", "--", "adapters", "list"]],
  ["npm", ["run", "messaging", "--", "matrix"]],
  ["npm", ["run", "governance", "--", "audit", "latest", "--limit", "10"]]
];

for (const [command, args] of commands) {
  console.error(`\n$ ${command} ${args.join(" ")}`);
  execFileSync(command, args, { stdio: "inherit" });
}

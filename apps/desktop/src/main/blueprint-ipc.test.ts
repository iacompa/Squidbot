import { describe, expect, it } from "vitest";
import { BlueprintRegistry } from "@squidbot/blueprints";

// Verify the registry can be wired from IPC. Integration of ipcMain.handle
// is covered indirectly by the web bundle Playwright tests in 2B.
describe("Blueprint IPC wiring smoke", () => {
  it("BlueprintRegistry constructs against any BlueprintStore-shaped object", () => {
    const stub = {
      saveBlueprint: () => "bp-1",
      getBlueprint: () => null,
      listBlueprints: () => [],
      deleteBlueprint: () => {},
      listBlueprintVersions: () => []
    };
    const reg = new BlueprintRegistry(stub as never);
    expect(reg.list()).toEqual([]);
  });
});

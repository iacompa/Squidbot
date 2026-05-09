import { afterEach, describe, expect, it } from "vitest";
import { cleanupTempRoots, installEvalSkill, tempDb } from "./helpers.js";
import { MutationProposer, SkillVariantStore } from "../src/index.js";

afterEach(cleanupTempRoots);

describe("SkillVariantStore and mutation proposals", () => {
  it("creates variants and rejects invalid direct promotion transitions", () => {
    const db = tempDb();
    installEvalSkill(db);
    const variant = new MutationProposer(db).propose({
      skillId: "skill_eval_fix_add",
      instruction: "Add a verification step before reporting success."
    });
    const store = new SkillVariantStore(db);
    expect(store.listVariantsForSkill("skill_eval_fix_add")).toHaveLength(1);
    expect(() => store.updateState(variant.id, "stable")).toThrow(/Invalid variant transition/);
    expect(store.updateState(variant.id, "sandbox_testing").state).toBe("sandbox_testing");
    db.close();
  });
});

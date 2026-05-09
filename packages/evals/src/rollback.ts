import type { SquidDatabase } from "@squidbot/db";
import { createId } from "@squidbot/core";
import { SkillService, type SkillRecord } from "@squidbot/skills";

export function rollbackEvolution(database: SquidDatabase, skillId: string, target: string, options: { skillsRoot?: string } = {}): SkillRecord {
  const service = new SkillService(database, options.skillsRoot ? { skillsRoot: options.skillsRoot } : {});
  const skill = service.rollback(skillId, target);
  const now = new Date().toISOString();
  database.db
    .prepare(
      `UPDATE skill_versions
       SET status = 'approved',
           promotedAt = COALESCE(promotedAt, @now),
           updatedAt = @now
       WHERE skillId = @skillId
         AND version = @version`
    )
    .run({ skillId, version: target, now });
  database.appendEvent({
    id: createId("evt"),
    timestamp: now,
    sessionId: `session_${skillId}`,
    type: "evolve.rolledBack",
    data: {
      runId: skillId,
      skillId,
      target,
      currentVersion: skill.currentVersion
    }
  });
  return skill;
}

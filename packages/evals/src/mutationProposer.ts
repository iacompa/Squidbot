import type { SquidDatabase } from "@squidbot/db";
import { installDeveloperWorkflowSkills, SkillService } from "@squidbot/skills";
import { SkillVariantStore } from "./skillVariantStore.js";
import type { SkillVariantRecord, VariantMutationType, VariantSourceType } from "./types.js";

export class MutationProposer {
  private readonly variants: SkillVariantStore;
  private readonly skills: SkillService;

  constructor(
    private readonly database: SquidDatabase,
    options: { skillsRoot?: string } = {}
  ) {
    this.variants = new SkillVariantStore(database);
    this.skills = new SkillService(database, options.skillsRoot ? { skillsRoot: options.skillsRoot } : {});
    installDeveloperWorkflowSkills(this.skills);
  }

  propose(input: { skillId: string; fromReflection?: string; fromGap?: string; fromEval?: string; instruction?: string }): SkillVariantRecord {
    const skillId = this.resolveSkillId(input.skillId);
    const skill = this.skills.getSkill(skillId);
    if (!skill) {
      throw new Error(`Skill not found: ${input.skillId}`);
    }
    const version = this.skills.getVersion(skillId);
    if (!version) {
      throw new Error(`Skill version not found for: ${skillId}`);
    }
    const source = this.resolveSource(input);
    const mutationType = this.chooseMutationType(source);
    const patch = this.createPatch(mutationType, source);
    return this.variants.createVariant({
      skillId,
      baseVersion: version.version,
      name: `${skill.name} ${mutationType.replace(/_/g, " ")} variant`,
      description: source.rationale,
      mutationType,
      sourceType: source.sourceType,
      sourceId: source.sourceId,
      patch,
      manifest: {
        ...version.manifest,
        requiredTools: version.manifest.requiredTools,
        evaluationNotes: source.rationale
      },
      prompts: {
        ...version.prompts,
        evolutionInstruction: source.rationale
      },
      policy: {
        requireSandbox: true,
        allowPaid: false,
        connectorWritesRequireApproval: true
      },
      state: "generated"
    });
  }

  private resolveSkillId(value: string): string {
    if (this.skills.getSkill(value)) {
      return value;
    }
    const normalized = value.startsWith("skill_") ? value : `skill_${value.replace(/[^a-zA-Z0-9]+/g, "_").replace(/^_+|_+$/g, "").toLowerCase()}`;
    if (this.skills.getSkill(normalized)) {
      return normalized;
    }
    return value;
  }

  private resolveSource(input: { fromReflection?: string; fromGap?: string; fromEval?: string; instruction?: string }): {
    sourceType: VariantSourceType;
    sourceId: string | null;
    text: string;
    rationale: string;
  } {
    if (input.fromReflection) {
      const reflection = this.database.getReflection(input.fromReflection);
      if (!reflection) {
        throw new Error(`Reflection not found: ${input.fromReflection}`);
      }
      return {
        sourceType: "reflection",
        sourceId: reflection.id,
        text: `${reflection.outcome}\n${reflection.summary}\n${JSON.stringify(reflection.failureModes)}\n${JSON.stringify(reflection.missingContext)}`,
        rationale: `Reflection ${reflection.id} suggested a reusable improvement: ${reflection.outcome}`
      };
    }
    if (input.fromGap) {
      const gap = this.database.getAffordanceGap(input.fromGap);
      if (!gap) {
        throw new Error(`Affordance gap not found: ${input.fromGap}`);
      }
      return {
        sourceType: "affordanceGap",
        sourceId: gap.id,
        text: `${gap.type} ${gap.name} ${gap.description}`,
        rationale: `Affordance gap ${gap.id} indicates ${gap.type} for ${gap.name}.`
      };
    }
    if (input.fromEval) {
      const row = this.database.db.prepare("SELECT * FROM eval_runs WHERE id = ?").get(input.fromEval) as { id: string; metricsJson: string | null; summaryJson: string | null } | undefined;
      if (!row) {
        throw new Error(`Eval run not found: ${input.fromEval}`);
      }
      return {
        sourceType: "evalFailure",
        sourceId: row.id,
        text: `${row.metricsJson ?? ""} ${row.summaryJson ?? ""}`,
        rationale: `Evaluation ${row.id} produced metrics that can be improved through an additional verification step.`
      };
    }
    return {
      sourceType: "user",
      sourceId: null,
      text: input.instruction ?? "manual improvement request",
      rationale: input.instruction ?? "User requested a local skill variant."
    };
  }

  private chooseMutationType(source: { text: string; sourceType: VariantSourceType }): VariantMutationType {
    const text = source.text.toLowerCase();
    if (source.sourceType === "evalFailure") {
      return "additional_verification";
    }
    if (/missingtool|missing tool|affordance/.test(text)) {
      return "fallback_improvement";
    }
    if (/latency|context/.test(text)) {
      return "context_reduction";
    }
    if (/tool error|schema|denied/.test(text)) {
      return "safer_tool_choice";
    }
    if (/test command|verification|sandbox|tests failed|eval/.test(text)) {
      return "additional_verification";
    }
    return "prompt_clarification";
  }

  private createPatch(mutationType: VariantMutationType, source: { rationale: string }): Record<string, unknown> {
    const expectedMetricImpact =
      mutationType === "additional_verification"
        ? { verificationCompleteness: 0.08, taskSuccessRate: 0.03 }
        : mutationType === "context_reduction"
          ? { latencyMs: 0.05 }
          : mutationType === "fallback_improvement"
            ? { toolErrorRate: -0.05 }
            : { verificationCompleteness: 0.03 };
    return {
      mutationType,
      rationale: source.rationale,
      changes: [
        {
          target: "prompt",
          operation: "append",
          value: "Before reporting success, verify fixture tests in sandbox and state whether changes were promoted."
        }
      ],
      requiredTools: ["workspace.readFile", "workspace.createPatch", "sandbox.applyPatch", "sandbox.runCommand", "test.run"],
      expectedMetricImpact,
      policy: {
        requireSandbox: true,
        allowPaid: false,
        connectorWritesRequireApproval: true
      }
    };
  }
}

import { spawnSync } from "node:child_process";
import type { ModelProvider, ModelProviderRequest, ModelResponse, TaskPlan, TaskPlanRequest } from "./base.js";
import { generateDeterministicResponse, generateDeterministicTaskPlan } from "./deterministic.js";
import { estimateRequestTokens } from "./util.js";

export type LocalModelProviderOptions = {
  modelName?: string;
  forceAvailable?: boolean;
};

export class LocalModelProvider implements ModelProvider {
  readonly name = "local";
  readonly modelName: string;
  readonly mode = "local";
  readonly maxTokens = 32_000;
  readonly supportsTools = true;
  readonly costOwner = "local/free";
  private readonly forceAvailable?: boolean;

  estimateTokens = estimateRequestTokens;

  constructor(options: LocalModelProviderOptions = {}) {
    this.modelName = options.modelName ?? "ollama-local";
    this.forceAvailable = options.forceAvailable;
  }

  async isAvailable(): Promise<boolean> {
    if (this.forceAvailable !== undefined) {
      return this.forceAvailable;
    }

    const result = spawnSync("ollama", ["--version"], {
      encoding: "utf8",
      stdio: "ignore",
      timeout: 700
    });

    return result.status === 0;
  }

  async generate(request: ModelProviderRequest): Promise<ModelResponse> {
    return generateDeterministicResponse({
      request,
      provider: this.name,
      modelName: this.modelName,
      mode: this.mode,
      costOwner: this.costOwner,
      contentPrefix: "Local model provider is active. I will use the local/free routing path and trace the call."
    });
  }

  async generateTaskPlan(request: TaskPlanRequest): Promise<TaskPlan> {
    return generateDeterministicTaskPlan(request);
  }
}

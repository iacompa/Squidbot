import type { ModelProvider, ModelProviderRequest, ModelResponse, TaskPlan, TaskPlanRequest } from "./base.js";
import { generateDeterministicResponse, generateDeterministicTaskPlan } from "./deterministic.js";
import { estimateRequestTokens } from "./util.js";

export class MockModelProvider implements ModelProvider {
  readonly name = "mock";
  readonly modelName = "deterministic-mock";
  readonly mode = "mock";
  readonly maxTokens = 16_000;
  readonly supportsTools = true;
  readonly costOwner = "local/free";

  estimateTokens = estimateRequestTokens;

  async isAvailable(): Promise<boolean> {
    return true;
  }

  async generate(request: ModelProviderRequest): Promise<ModelResponse> {
    return generateDeterministicResponse({
      request,
      provider: this.name,
      modelName: this.modelName,
      mode: this.mode,
      costOwner: this.costOwner,
      contentPrefix: "Mock provider is active. I can safely inspect a local workspace and return traceable tool calls."
    });
  }

  async generateTaskPlan(request: TaskPlanRequest): Promise<TaskPlan> {
    return generateDeterministicTaskPlan(request);
  }
}

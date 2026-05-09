import type { ChatMessage, ToolSchema, TokenUsage } from "./base.js";

export function createId(prefix: string): string {
  const random = Math.random().toString(36).slice(2, 10);
  return `${prefix}_${Date.now().toString(36)}_${random}`;
}

export function estimateTextTokens(value: string): number {
  return Math.max(1, Math.ceil(value.length / 4));
}

export function estimateRequestTokens(messages: ChatMessage[], tools: ToolSchema[] = []): number {
  const messageTokens = messages.reduce((total, message) => total + estimateTextTokens(message.content) + 4, 0);
  const toolTokens = tools.reduce((total, tool) => total + estimateTextTokens(`${tool.name} ${tool.description}`) + 12, 0);
  return Math.max(1, messageTokens + toolTokens);
}

export function usageFromText(promptTokens: number, content: string): TokenUsage {
  const completionTokens = estimateTextTokens(content);
  return {
    promptTokens,
    completionTokens,
    totalTokens: promptTokens + completionTokens
  };
}

export function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

export function normalizeBudget(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return Math.floor(value);
  }

  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : null;
  }

  return null;
}

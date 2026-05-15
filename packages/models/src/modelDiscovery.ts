/**
 * Live model discovery — calls a provider's `/v1/models` endpoint with the
 * user's key and returns the model ids it reports as available.
 *
 * Used by the Settings UI: when the user pastes a key into the "Add account"
 * form, we hit `/v1/models` once to confirm the key is valid AND to populate
 * the model dropdown with the exact list of models that key has access to.
 *
 * Why not just rely on the static catalog?
 *   • OpenRouter's catalog is hundreds of models — too many to ship inline.
 *   • Anthropic / OpenAI add new models all the time; our static list goes
 *     stale within weeks of a release.
 *   • Some providers restrict which models a given key can access (free tier
 *     vs paid, region locks, etc.) — only the live endpoint knows for sure.
 *   • Validating the key by calling `/v1/models` is much cheaper than
 *     validating it by attempting a real `chat/completions` call.
 *
 * The function never throws — it returns a discriminated union so callers
 * can render the failure mode (bad key, network down, endpoint missing, etc.)
 * in the UI without a try/catch around every site.
 */

export type DiscoverModelsRequest = {
  apiUrl: string;
  apiKey: string;
  /** Optional override of timeout in ms (default 5000). */
  timeoutMs?: number;
};

export type DiscoverModelsResult =
  | {
      success: true;
      models: string[];
      /** Number of milliseconds the request took. Useful for UI feedback. */
      durationMs: number;
    }
  | {
      success: false;
      /** Stable error code so the UI can branch on auth vs network. */
      code: "auth" | "not_found" | "network" | "timeout" | "malformed" | "unknown";
      message: string;
    };

/**
 * Derives the `/v1/models` URL from the configured `/v1/chat/completions`
 * URL. Most providers follow the OpenAI-compatible contract where these two
 * sit at the same root.
 *
 * Examples:
 *   "https://openrouter.ai/api/v1/chat/completions" → "https://openrouter.ai/api/v1/models"
 *   "https://api.openai.com/v1/chat/completions"    → "https://api.openai.com/v1/models"
 *   "https://api.groq.com/openai/v1/chat/completions" → "https://api.groq.com/openai/v1/models"
 *
 * Falls back to appending "/models" when we can't recognise the suffix.
 */
export function deriveModelsUrl(apiUrl: string): string {
  if (apiUrl.endsWith("/chat/completions")) {
    return apiUrl.slice(0, -"/chat/completions".length) + "/models";
  }
  if (apiUrl.endsWith("/")) {
    return apiUrl + "models";
  }
  return apiUrl + "/models";
}

export async function discoverProviderModels(
  request: DiscoverModelsRequest
): Promise<DiscoverModelsResult> {
  const { apiUrl, apiKey, timeoutMs = 5000 } = request;
  if (!apiUrl || !apiKey) {
    return { success: false, code: "auth", message: "API URL and key are both required." };
  }
  const modelsUrl = deriveModelsUrl(apiUrl);
  const startedAt = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(modelsUrl, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: "application/json"
      },
      signal: controller.signal
    });
    clearTimeout(timer);

    if (response.status === 401 || response.status === 403) {
      return {
        success: false,
        code: "auth",
        message: `Provider rejected the API key (${response.status}). Double-check it and try again.`
      };
    }
    if (response.status === 404) {
      return {
        success: false,
        code: "not_found",
        message: `Provider has no /models endpoint at ${modelsUrl}. Pick a model manually instead.`
      };
    }
    if (!response.ok) {
      return {
        success: false,
        code: "unknown",
        message: `Provider returned HTTP ${response.status} when listing models.`
      };
    }
    const body = (await response.json()) as unknown;
    const models = extractModelIds(body);
    if (models.length === 0) {
      return {
        success: false,
        code: "malformed",
        message: "Provider responded, but the model list was empty or in an unexpected shape."
      };
    }
    return { success: true, models, durationMs: Date.now() - startedAt };
  } catch (err) {
    clearTimeout(timer);
    if (controller.signal.aborted) {
      return {
        success: false,
        code: "timeout",
        message: `Provider didn't respond within ${timeoutMs}ms.`
      };
    }
    return {
      success: false,
      code: "network",
      message: err instanceof Error ? err.message : String(err)
    };
  }
}

/**
 * Pull model ids out of whatever JSON the provider returned. The OpenAI
 * contract is `{ data: [{ id: "...", ... }, ...] }`, but we also handle a
 * couple of common deviations (top-level array, `models` instead of `data`)
 * so we don't fail on the provider whose docs are slightly off-spec.
 */
function extractModelIds(body: unknown): string[] {
  if (!body || typeof body !== "object") return [];
  const obj = body as Record<string, unknown>;
  const candidates = [obj.data, obj.models, body];
  for (const candidate of candidates) {
    if (Array.isArray(candidate)) {
      const ids = candidate
        .map((entry) => {
          if (typeof entry === "string") return entry;
          if (entry && typeof entry === "object" && typeof (entry as { id?: unknown }).id === "string") {
            return (entry as { id: string }).id;
          }
          return null;
        })
        .filter((id): id is string => typeof id === "string" && id.length > 0);
      if (ids.length > 0) return ids;
    }
  }
  return [];
}

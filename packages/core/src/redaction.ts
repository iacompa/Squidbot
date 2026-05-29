const sensitiveKeyPattern = /^(?:api[_-]?key|access[_-]?token|refresh[_-]?token|auth|authorization|bearer|client[_-]?secret|password|credential|secret)$/i;

const redactionPatterns: Array<{ pattern: RegExp; replacement: string }> = [
  {
    pattern:
      /\b(api[_-]?key|access[_-]?token|refresh[_-]?token|auth(?:orization)?|bearer|client[_-]?secret|password|credential|secret)\b\s*[:=]\s*["']?([A-Za-z0-9._~+/=-]{8,})["']?/gi,
    replacement: "$1=[REDACTED]"
  },
  {
    pattern: /\bsk-[A-Za-z0-9_-]{12,}\b/g,
    replacement: "[REDACTED]"
  },
  {
    // GitHub tokens: PAT (ghp_), OAuth (gho_), user (ghu_), server (ghs_), refresh (ghr_).
    pattern: /\bgh[pousr]_[A-Za-z0-9]{20,}\b/g,
    replacement: "[REDACTED]"
  },
  {
    // Slack tokens: xoxb-/xoxp-/xoxa-/xoxr-/xoxs-.
    pattern: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g,
    replacement: "[REDACTED]"
  },
  {
    // AWS access key id (AKIA + 16 uppercase alphanumerics).
    pattern: /\bAKIA[0-9A-Z]{16}\b/g,
    replacement: "[REDACTED]"
  },
  {
    // JWT (header.payload.signature, base64url; header starts with `eyJ`).
    pattern: /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g,
    replacement: "[REDACTED]"
  },
  {
    // `Bearer <token>` not already caught by the key=value rule above.
    pattern: /\b(bearer)\s+([A-Za-z0-9._~+/=-]{12,})/gi,
    replacement: "$1 [REDACTED]"
  },
  {
    pattern: /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi,
    replacement: "[REDACTED_EMAIL]"
  },
  {
    pattern: /\b\d{3}-\d{2}-\d{4}\b/g,
    replacement: "[REDACTED_SSN]"
  },
  {
    pattern: /\b(?:\+?1[-.\s]?)?(?:\(\d{3}\)|\d{3})[-.\s]?\d{3}[-.\s]?\d{4}\b/g,
    replacement: "[REDACTED_PHONE]"
  }
];

export type RedactionResult<T> = {
  value: T;
  redacted: boolean;
  count: number;
};

export function redactSecrets(text: string): string {
  let redacted = text;
  for (const { pattern, replacement } of redactionPatterns) {
    redacted = redacted.replace(pattern, replacement);
  }
  return redacted;
}

export function redactValue<T>(value: T): RedactionResult<T> {
  const result = redactUnknown(value, []);
  return {
    value: result.value as T,
    redacted: result.count > 0,
    count: result.count
  };
}

function redactUnknown(value: unknown, keyPath: string[]): RedactionResult<unknown> {
  const key = keyPath.at(-1) ?? "";
  if (typeof value === "string") {
    if (sensitiveKeyPattern.test(key) && value.trim()) {
      return { value: "[REDACTED]", redacted: true, count: 1 };
    }

    const redacted = redactSecrets(value);
    return {
      value: redacted,
      redacted: redacted !== value,
      count: redacted === value ? 0 : 1
    };
  }

  if (Array.isArray(value)) {
    let count = 0;
    const next = value.map((item, index) => {
      const result = redactUnknown(item, [...keyPath, String(index)]);
      count += result.count;
      return result.value;
    });
    return { value: next, redacted: count > 0, count };
  }

  if (value && typeof value === "object") {
    let count = 0;
    const next: Record<string, unknown> = {};
    for (const [childKey, childValue] of Object.entries(value)) {
      const result = redactUnknown(childValue, [...keyPath, childKey]);
      count += result.count;
      next[childKey] = result.value;
    }
    return { value: next, redacted: count > 0, count };
  }

  return { value, redacted: false, count: 0 };
}

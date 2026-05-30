/**
 * Sensitive key-name substrings, matched against the lowercased, separator-
 * stripped key. The previous pattern was anchored (^...$), so common nested or
 * prefixed keys — `dbPassword`, `githubToken`, `userApiKey`, `clientSecret`,
 * bare `token` — passed through unredacted. Kept specific enough to avoid
 * innocuous keys (no bare "auth", which would also hit "author").
 */
const SENSITIVE_KEY_SUBSTRINGS = [
  "password",
  "passwd",
  "secret",
  "token",
  "apikey",
  "accesskey",
  "credential",
  "privatekey",
  "authorization",
  "bearer"
];

function isSensitiveKey(key: string): boolean {
  const normalized = key.toLowerCase().replace(/[_-]/g, "");
  // Exact match for "auth" — a substring rule would also hit "author".
  if (normalized === "auth") return true;
  return SENSITIVE_KEY_SUBSTRINGS.some((substring) => normalized.includes(substring));
}

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
    // Google AI / Cloud API keys (AIza + ~35 url-safe chars).
    pattern: /\bAIza[0-9A-Za-z_-]{20,}\b/g,
    replacement: "[REDACTED]"
  },
  {
    // Groq API keys (gsk_).
    pattern: /\bgsk_[A-Za-z0-9]{20,}\b/g,
    replacement: "[REDACTED]"
  },
  {
    // xAI API keys (xai-).
    pattern: /\bxai-[A-Za-z0-9]{20,}\b/g,
    replacement: "[REDACTED]"
  },
  {
    // PEM private key blocks (RSA/EC/OpenSSH/DSA/PGP/generic).
    pattern: /-----BEGIN (?:[A-Z0-9 ]+ )?PRIVATE KEY-----[\s\S]*?-----END (?:[A-Z0-9 ]+ )?PRIVATE KEY-----/g,
    replacement: "[REDACTED_PRIVATE_KEY]"
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

function luhnValid(digits: string): boolean {
  let sum = 0;
  let alt = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let n = digits.charCodeAt(i) - 48;
    if (n < 0 || n > 9) return false;
    if (alt) {
      n *= 2;
      if (n > 9) n -= 9;
    }
    sum += n;
    alt = !alt;
  }
  return sum % 10 === 0;
}

/**
 * Redact credit-card-like PANs: a 13-19 digit run (optional single space/dash
 * between digits) that passes the Luhn checksum. Luhn-gating filters out most
 * non-card numbers, but ~1 in 10 long numeric IDs/timestamps are Luhn-valid by
 * chance and will also be redacted. This errs toward redaction — a safe failure
 * in logs/traces (over-redaction), never disclosure.
 */
function redactPan(text: string): string {
  return text.replace(/\b\d(?:[ -]?\d){12,18}\b/g, (match) => {
    const digits = match.replace(/[ -]/g, "");
    return luhnValid(digits) ? "[REDACTED_PAN]" : match;
  });
}

export function redactSecrets(text: string): string {
  // PAN first — before the phone/SSN patterns can nibble a digit substring.
  let redacted = redactPan(text);
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
    if (isSensitiveKey(key) && value.trim()) {
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

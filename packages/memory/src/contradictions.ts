// Deterministic, explainable contradiction detection for memory nodes.
//
// The hard part of detecting contradictions without an LLM is that
// contradictory statements are *lexically very similar* — "always deploy on
// Fridays" and "never deploy on Fridays" share every content word — so a
// similarity metric alone flags them as duplicates, not conflicts. The signal
// that separates a contradiction from a paraphrase is **high topical overlap
// PLUS a polarity flip**: either a negation appears on exactly one side (XOR),
// or each side takes the opposite half of a known antonym pair.
//
// This module is pure (no DB) so it is trivially testable and reusable: the
// store scans candidates with it, and the runtime can warn on memory writes.
// It returns the supporting evidence so an operator can review each candidate
// rather than the graph silently mutating itself.

export type ContradictionEvidence = {
  /** Stemmed content terms shared by both statements — proves "same subject". */
  sharedTerms: string[];
  /** The negation / antonym markers that prove the polarity flip. */
  polaritySignals: string[];
};

export type ContradictionVerdict = {
  isContradiction: boolean;
  /** 0..1 confidence — topical overlap blended with polarity strength. */
  score: number;
  evidence: ContradictionEvidence;
};

type Statement = { title: string; body: string };

// Words that carry polarity rather than subject matter. Excluded from the
// topical-overlap measure so "enable" vs "disable" doesn't count as agreement.
// Stored stemmed (via `stem`) so they match the stemmed tokens `tokenize`
// produces — otherwise "always" (token → "alway") would never match.
const NEGATIONS = new Set(
  [
    "not",
    "no",
    "never",
    "none",
    "cannot",
    "cant",
    "dont",
    "doesnt",
    "didnt",
    "wont",
    "without",
    "avoid",
    "neither",
    "nor"
  ].map(stem)
);

// Mutually-exclusive antonym pairs. Each statement taking opposite halves of a
// pair on the same subject is a contradiction (enable/disable, always/never…).
// Stemmed for the same reason as NEGATIONS.
const ANTONYM_PAIRS: ReadonlyArray<readonly [string, string]> = (
  [
    ["enable", "disable"],
    ["enabled", "disabled"],
    ["allow", "deny"],
    ["allow", "block"],
    ["allowed", "denied"],
    ["always", "never"],
    ["increase", "decrease"],
    ["public", "private"],
    ["required", "optional"],
    ["include", "exclude"],
    ["start", "stop"],
    ["prefer", "avoid"],
    ["add", "remove"],
    ["grant", "revoke"],
    ["accept", "reject"],
    ["show", "hide"],
    ["on", "off"],
    ["true", "false"],
    ["open", "closed"]
  ] as ReadonlyArray<readonly [string, string]>
).map(([left, right]) => [stem(left), stem(right)] as const);

// Stemmed for consistency with the stemmed tokens `tokenize` emits.
const STOPWORDS = new Set(
  [
    "the",
    "a",
    "an",
    "for",
    "to",
    "of",
    "on",
    "in",
    "we",
    "it",
    "is",
    "are",
    "be",
    "and",
    "or",
    "instead",
    "that",
    "this",
    "with",
    "as",
    "at",
    "by",
    "do",
    "does",
    "did",
    "all",
    "our",
    "us",
    "should",
    "must",
    "will"
  ].map(stem)
);

// Words that are polarity markers (negations + every antonym half). Excluded
// from topical overlap so polarity never masquerades as shared subject.
const POLARITY_WORDS = new Set<string>([...NEGATIONS, ...ANTONYM_PAIRS.flat()]);

const MIN_OVERLAP_RATIO = 0.34;
const SCORE_THRESHOLD = 0.45;

/**
 * Assess whether two memory statements contradict each other. Symmetric in its
 * arguments. Returns the verdict plus the evidence that justifies it.
 */
export function assessContradiction(a: Statement, b: Statement): ContradictionVerdict {
  const tokensA = tokenize(`${a.title} ${a.body}`);
  const tokensB = tokenize(`${b.title} ${b.body}`);

  const contentA = contentTerms(tokensA);
  const contentB = contentTerms(tokensB);

  const sharedTerms = [...contentA].filter((term) => contentB.has(term));
  const smaller = Math.min(contentA.size, contentB.size);
  const overlapRatio = smaller === 0 ? 0 : sharedTerms.length / smaller;

  // Same-subject gate: at least one shared content term and a meaningful
  // fraction of the smaller statement's terms in common. Without this, an
  // antonym pair on unrelated topics ("enable X" vs "disable Y") would fire.
  const sameSubject = sharedTerms.length >= 1 && overlapRatio >= MIN_OVERLAP_RATIO;

  const polaritySignals: string[] = [];

  // Antonym flip: each side holds the opposite half of a pair.
  const setA = new Set(tokensA);
  const setB = new Set(tokensB);
  for (const [left, right] of ANTONYM_PAIRS) {
    if ((setA.has(left) && setB.has(right)) || (setA.has(right) && setB.has(left))) {
      polaritySignals.push(`${left}/${right}`);
    }
  }

  // Negation XOR: exactly one side negates. Both-negate means they agree
  // ("never deploy" vs "do not deploy"), so XOR — not OR — is the signal.
  const negatedA = tokensA.some((token) => NEGATIONS.has(token));
  const negatedB = tokensB.some((token) => NEGATIONS.has(token));
  if (negatedA !== negatedB) {
    polaritySignals.push("negation");
  }

  const hasPolarityFlip = polaritySignals.length > 0;
  const isContradiction = sameSubject && hasPolarityFlip;

  // Score blends topical overlap with polarity strength. Antonym pairs are a
  // stronger signal (0.55) than a bare negation flip (0.45); overlap fills the
  // rest. Clamped to [0, 1].
  const polarityStrength = polaritySignals.some((signal) => signal !== "negation") ? 0.55 : 0.45;
  const rawScore = isContradiction ? polarityStrength + 0.45 * overlapRatio : 0;
  const score = Number(Math.min(1, rawScore).toFixed(4));

  return {
    isContradiction: isContradiction && score >= SCORE_THRESHOLD,
    score,
    evidence: { sharedTerms, polaritySignals }
  };
}

function tokenize(text: string): string[] {
  return (
    text
      .toLowerCase()
      .replace(/n't\b/g, "nt") // can't -> cant, don't -> dont
      .replace(/'/g, "")
      .match(/[a-z0-9_]+/g)
      ?.map(stem) ?? []
  );
}

function contentTerms(tokens: string[]): Set<string> {
  return new Set(tokens.filter((token) => token.length > 1 && !STOPWORDS.has(token) && !POLARITY_WORDS.has(token)));
}

function stem(token: string): string {
  if (token.endsWith("ing") && token.length > 5) {
    return token.slice(0, -3);
  }
  if (token.endsWith("ed") && token.length > 4) {
    return token.slice(0, -2);
  }
  if (token.endsWith("s") && token.length > 3) {
    return token.slice(0, -1);
  }
  return token;
}

import type { SquidDatabase } from "@squidbot/db";
import {
  activateProfile,
  createCustomProfile,
  type EnterpriseProfile,
  type EnterpriseProfileInput,
  type ProfileSensitivity
} from "./enterpriseProfile.js";
import { createId, type ApprovedMemory } from "./types.js";

/**
 * AI-assisted onboarding lives in three layers so that it works without an API key
 * and improves when one is configured:
 *
 *   1. The question catalog (`STANDARD_QUESTIONS`) — a fixed conversational script.
 *   2. The deterministic inference (`inferOnboardingProfile`) — keyword-based rules
 *      that turn the user's raw answers into a profile + memories. Always works.
 *   3. Optional LLM enrichment (planned next session) — refines the inference
 *      with a real model when one is configured.
 *
 * The CLI and (future) desktop UI render the questions and pass collected answers
 * back to `inferOnboardingProfile`, then `commitOnboarding` persists the result.
 */

export type OnboardingQuestionKind = "text" | "choice";

export type OnboardingQuestion = {
  id: string;
  prompt: string;
  hint?: string;
  kind: OnboardingQuestionKind;
  choices?: { value: string; label: string; description?: string }[];
  required?: boolean;
  /** Short echo template that the CLI prints after the user answers. */
  echoTemplate?: (value: string) => string;
};

export type OnboardingAnswer = {
  questionId: string;
  rawValue: string;
  skipped: boolean;
};

export type OnboardingMemoryDraft = {
  type: "founder_note" | "guardrail" | "system_inventory" | "business_summary";
  title: string;
  body: string;
  importance: number;
  confidence: number;
};

export type OnboardingInference = {
  /** Profile input ready to hand to `createCustomProfile`. */
  profile: EnterpriseProfileInput;
  /** Memory entries to persist alongside the profile. */
  memories: OnboardingMemoryDraft[];
  /**
   * Plain-English statements about what we learned, displayed to the user before
   * we ask them to confirm. Useful for trust + debuggability.
   */
  rationale: string[];
  /** Personalised next-step suggestions the CLI prints at the end. */
  nextActions: string[];
};

export type CommittedOnboarding = {
  profile: EnterpriseProfile;
  memories: ApprovedMemory[];
  syntheticRunId: string;
};

export const STANDARD_QUESTIONS: OnboardingQuestion[] = [
  {
    id: "business_summary",
    prompt: "In one sentence, what does your business do?",
    hint: "I'll use this to figure out your industry and how to talk about your work.",
    kind: "text",
    required: true,
    echoTemplate: (value) => `Got it. I'll tailor what I help with around: "${value.trim()}".`
  },
  {
    id: "role",
    prompt: "What's your role?",
    hint: "Helps me understand the kind of decisions you make day-to-day.",
    kind: "text",
    required: false,
    echoTemplate: (value) => `Got it — you operate as: ${value.trim()}.`
  },
  {
    id: "founder_note",
    prompt: "What wastes the most time in your day-to-day right now?",
    hint: "I'll save this as a permanent memory and prioritise skill suggestions that fix it.",
    kind: "text",
    required: false,
    echoTemplate: (value) =>
      `Captured. I'll watch for opportunities to reduce time spent on: "${value.trim()}".`
  },
  {
    id: "systems",
    prompt: "What systems does your team use day-to-day?",
    hint: "Comma-separated. Examples: Slack, Gmail, GitHub, Salesforce, Clio, Shopify, Stripe.",
    kind: "text",
    required: false,
    echoTemplate: (value) => `Noted systems: ${value.trim() || "(none yet)"}.`
  },
  {
    id: "sensitivity",
    prompt: "How sensitive is the data you work with?",
    hint: "I'll harden defaults automatically. You can change this later.",
    kind: "choice",
    required: true,
    choices: [
      { value: "standard", label: "Standard", description: "internal docs, communications, normal business data" },
      { value: "sensitive", label: "Sensitive", description: "customer PII, financial data, contracts" },
      {
        value: "regulated",
        label: "Regulated",
        description: "HIPAA / GLBA / attorney-client privilege / FedRAMP / similar — I'll default to read-only mode"
      },
      { value: "air-gapped", label: "Air-gapped", description: "must operate with no external network calls at all" }
    ],
    echoTemplate: (value) => `Set sensitivity to: ${value}.`
  },
  {
    id: "guardrail",
    prompt: "Anything I should ALWAYS or NEVER do?",
    hint: "Compliance rules, brand voice, escalation rules, prohibited actions. Skip if none.",
    kind: "text",
    required: false,
    echoTemplate: (value) => (value.trim() ? `Captured as a permanent guardrail.` : "")
  }
];

// ---------------- Industry inference ----------------

type IndustryRule = {
  industry: string;
  displayName: string;
  keywords: RegExp[];
  /** Heavier-weight keywords that strongly indicate the industry. */
  strongKeywords?: RegExp[];
};

const INDUSTRY_RULES: IndustryRule[] = [
  {
    industry: "legal",
    displayName: "Legal Practice",
    strongKeywords: [/\blaw\s+firm\b/i, /\battorney(s)?\b/i, /\bcounsel\b/i, /\blegal\s+(team|practice)\b/i],
    keywords: [/\bcontract(s)?\b/i, /\blitigation\b/i, /\bclient(s)?\s+matter(s)?\b/i, /\blegal\b/i, /\bcompliance\b/i]
  },
  {
    industry: "automotive_retail",
    displayName: "Auto Dealership",
    strongKeywords: [/\bdealership(s)?\b/i, /\bcar\s+dealer\b/i, /\bauto\s+dealer\b/i],
    keywords: [/\bautomotive\b/i, /\bvehicle(s)?\b/i, /\bRO\s+/, /\bservice\s+department\b/i]
  },
  {
    industry: "healthcare_operations",
    displayName: "Healthcare Operations",
    strongKeywords: [/\bhospital\b/i, /\bclinic\b/i, /\bhealthcare\b/i, /\bpatient(s)?\b/i, /\bmedical\s+practice\b/i],
    keywords: [/\bEHR\b/i, /\bclaims?\b/i, /\bprior\s+auth\b/i, /\bHIPAA\b/i]
  },
  {
    industry: "government_contracting",
    displayName: "Government / Public Sector",
    strongKeywords: [/\bgovernment\b/i, /\bgov\s+contractor\b/i, /\bpublic\s+sector\b/i, /\bfederal\b/i, /\bagency\b/i],
    keywords: [/\bpermit(s)?\b/i, /\bgrant(s)?\b/i, /\brecords?\s+request\b/i, /\bFedRAMP\b/i]
  },
  {
    industry: "software_engineering",
    displayName: "Software Engineering",
    strongKeywords: [/\bsoftware\s+(company|shop|team)\b/i, /\bdev\s+(shop|team)\b/i, /\bengineering\s+team\b/i],
    keywords: [/\bdevelopers?\b/i, /\bcoding\b/i, /\bSaaS\b/i, /\bAPI\b/, /\bdevops\b/i, /\bcloud\b/i]
  },
  {
    industry: "marketing_agency",
    displayName: "Marketing Agency",
    strongKeywords: [/\bmarketing\s+agency\b/i, /\bad\s+agency\b/i, /\bcreative\s+agency\b/i],
    keywords: [/\bcampaign(s)?\b/i, /\bbrand\b/i, /\bmarketing\b/i, /\badvertis(ing|ement)\b/i]
  },
  {
    industry: "ecommerce",
    displayName: "E-commerce",
    strongKeywords: [/\becommerce\b/i, /\be-commerce\b/i, /\bonline\s+store\b/i, /\bshopify\s+store\b/i],
    keywords: [/\bShopify\b/i, /\bWooCommerce\b/i, /\bcheckout\b/i, /\bD2C\b/i, /\bdirect\s+to\s+consumer\b/i]
  },
  {
    industry: "financial_services",
    displayName: "Financial Services",
    strongKeywords: [/\bbank\b/i, /\bfintech\b/i, /\binsurance\s+company\b/i, /\binvestment\s+firm\b/i, /\bregulated\s+finance\b/i],
    keywords: [/\baccount(ing|ant)\b/i, /\bfinance\b/i, /\binvestor(s)?\b/i, /\bbroker(age)?\b/i]
  },
  {
    industry: "real_estate",
    displayName: "Real Estate",
    strongKeywords: [/\breal\s+estate\b/i, /\bproperty\s+management\b/i, /\bbrokerage\b/i],
    keywords: [/\blisting(s)?\b/i, /\bMLS\b/, /\btenant(s)?\b/i, /\bclosing\b/i]
  },
  {
    industry: "consulting",
    displayName: "Consulting",
    strongKeywords: [/\bconsulting\s+(firm|practice)\b/i, /\bmanagement\s+consult/i, /\badvisory\s+firm\b/i],
    keywords: [/\bclient(s)?\b/i, /\bengagement(s)?\b/i, /\badvisory\b/i, /\bconsultant\b/i]
  },
  {
    industry: "saas",
    displayName: "SaaS",
    strongKeywords: [/\bSaaS\b/i, /\bsoftware\s+as\s+a\s+service\b/i, /\bsubscription\s+software\b/i],
    keywords: [/\bplatform\b/i, /\bproduct\b/i, /\busers?\b/i, /\bMRR\b/, /\bARR\b/]
  },
  {
    industry: "retail",
    displayName: "Retail",
    strongKeywords: [/\bretail\s+(store|chain|business)\b/i, /\bbrick\s+and\s+mortar\b/i],
    keywords: [/\bstore(s)?\b/i, /\binventory\b/i, /\bPOS\b/]
  }
];

function scoreIndustry(text: string, rule: IndustryRule): number {
  let score = 0;
  for (const pattern of rule.strongKeywords ?? []) {
    if (pattern.test(text)) score += 3;
  }
  for (const pattern of rule.keywords) {
    if (pattern.test(text)) score += 1;
  }
  return score;
}

export type IndustryGuess = {
  industry: string;
  displayName: string;
  score: number;
  confidence: number;
};

export function guessIndustry(text: string): IndustryGuess {
  if (!text || !text.trim()) {
    return { industry: "general_business", displayName: "Business", score: 0, confidence: 0 };
  }
  let best: IndustryRule | null = null;
  let bestScore = 0;
  for (const rule of INDUSTRY_RULES) {
    const score = scoreIndustry(text, rule);
    if (score > bestScore) {
      best = rule;
      bestScore = score;
    }
  }
  if (!best || bestScore === 0) {
    return { industry: "general_business", displayName: "Business", score: 0, confidence: 0 };
  }
  // 1 hit → 0.4, 2 hits → 0.55, 3 hits (likely a strong keyword) → 0.7, capped at 0.95.
  const confidence = Math.min(0.95, 0.25 + bestScore * 0.15);
  return { industry: best.industry, displayName: best.displayName, score: bestScore, confidence };
}

// ---------------- Vocabulary inference ----------------

const VOCABULARY_BY_INDUSTRY: Record<string, Record<string, string>> = {
  legal: {
    project: "matter",
    task: "matter task",
    customer: "client",
    issue: "filing",
    ticket: "intake",
    record: "matter record"
  },
  real_estate: {
    project: "transaction",
    task: "milestone",
    customer: "client",
    record: "listing record"
  },
  automotive_retail: {
    project: "deal",
    task: "RO",
    customer: "buyer",
    issue: "service ticket",
    ticket: "service ticket",
    record: "repair order"
  },
  healthcare_operations: {
    project: "encounter",
    task: "encounter task",
    customer: "patient",
    issue: "claim",
    ticket: "support case",
    record: "encounter record"
  },
  government_contracting: {
    project: "case",
    task: "case action",
    customer: "constituent",
    issue: "incident",
    ticket: "request",
    record: "case record"
  },
  software_engineering: {
    project: "repo",
    task: "ticket",
    customer: "stakeholder",
    issue: "issue",
    ticket: "issue",
    record: "PR"
  },
  saas: {
    project: "feature",
    task: "ticket",
    customer: "user",
    issue: "incident"
  },
  ecommerce: {
    project: "campaign",
    customer: "buyer",
    issue: "order issue",
    ticket: "support case",
    record: "order"
  },
  marketing_agency: {
    project: "campaign",
    customer: "client",
    ticket: "request"
  },
  financial_services: {
    project: "engagement",
    customer: "client",
    record: "account record"
  },
  consulting: {
    project: "engagement",
    customer: "client",
    ticket: "request"
  },
  retail: {
    project: "season",
    customer: "shopper",
    record: "transaction"
  }
};

// ---------------- Policy pack inference ----------------

function policyPacksFor(industry: string, sensitivity: ProfileSensitivity): string[] {
  const base = new Set<string>(["developer-safe-default", "secrets-redaction"]);
  if (sensitivity === "regulated" || sensitivity === "sensitive") {
    base.add("legal-review");
  }
  if (sensitivity === "air-gapped") {
    base.add("air-gapped-default");
  }
  switch (industry) {
    case "legal":
      base.add("legal-review");
      break;
    case "healthcare_operations":
      base.add("high-stakes-healthcare");
      break;
    case "government_contracting":
      base.add("public-sector");
      break;
    case "financial_services":
      base.add("regulated-finance");
      break;
    default:
      break;
  }
  return [...base];
}

// ---------------- Skill suggestions ----------------

function defaultSkillsFor(industry: string): string[] {
  switch (industry) {
    case "legal":
      return ["contract-clause-extraction", "matter-status-summary", "policy-comparison"];
    case "automotive_retail":
      return ["inventory-anomaly-summary", "service-ro-summary", "customer-followup-draft"];
    case "healthcare_operations":
      return ["claims-prior-auth-support", "operations-summary", "documentation-assistance"];
    case "government_contracting":
      return ["case-intake-triage", "records-request-support", "policy-research"];
    case "software_engineering":
      return ["pr-review", "ci-failure-diagnosis", "release-readiness"];
    case "marketing_agency":
      return ["campaign-report-summary", "content-draft", "client-status-update"];
    case "ecommerce":
      return ["abandoned-cart-followup", "order-exception-report", "inventory-anomaly-summary"];
    case "saas":
      return ["release-readiness", "support-triage", "churn-risk-summary"];
    case "consulting":
      return ["engagement-status-summary", "research-packet-draft", "meeting-notes-summary"];
    case "real_estate":
      return ["listing-summary", "closing-checklist", "client-followup-draft"];
    case "financial_services":
      return ["compliance-evidence-packet", "client-statement-summary"];
    case "retail":
      return ["inventory-anomaly-summary", "transaction-exception-report"];
    default:
      return ["summary", "research", "doc-writing", "data-extraction"];
  }
}

// ---------------- Systems / channels parsing ----------------

const KNOWN_CHANNEL_PATTERNS: Array<{ pattern: RegExp; canonical: string }> = [
  { pattern: /\bslack\b/i, canonical: "slack" },
  { pattern: /\bdiscord\b/i, canonical: "discord" },
  { pattern: /\bteams\b/i, canonical: "teams" },
  { pattern: /\bgoogle\s+chat\b/i, canonical: "google_chat" },
  { pattern: /\btelegram\b/i, canonical: "telegram" },
  { pattern: /\bwhatsapp\b/i, canonical: "whatsapp" },
  { pattern: /\bsignal\b/i, canonical: "signal" },
  { pattern: /\bimessage\b/i, canonical: "imessage" },
  { pattern: /\bmatrix\b/i, canonical: "matrix" },
  { pattern: /\bemail|gmail|outlook\b/i, canonical: "email" },
  { pattern: /\bsms\b/i, canonical: "sms" }
];

export type SystemsAndChannels = {
  systems: string[];
  channels: string[];
};

export function parseSystemsAndChannels(text: string): SystemsAndChannels {
  if (!text || !text.trim()) {
    return { systems: [], channels: [] };
  }
  const tokens = text
    .split(/[,;\n]/)
    .map((token) => token.trim())
    .filter(Boolean);

  const systems: string[] = [];
  const channels: string[] = [];
  const seenSystem = new Set<string>();
  const seenChannel = new Set<string>();

  for (const token of tokens) {
    let assignedAsChannel = false;
    for (const { pattern, canonical } of KNOWN_CHANNEL_PATTERNS) {
      if (pattern.test(token)) {
        if (!seenChannel.has(canonical)) {
          channels.push(canonical);
          seenChannel.add(canonical);
        }
        assignedAsChannel = true;
        break;
      }
    }
    if (!assignedAsChannel) {
      const lowered = token.toLowerCase();
      if (!seenSystem.has(lowered)) {
        systems.push(lowered);
        seenSystem.add(lowered);
      }
    }
  }

  return { systems, channels };
}

// ---------------- Answer lookup helpers ----------------

function findAnswer(answers: OnboardingAnswer[], questionId: string): string | null {
  const answer = answers.find((entry) => entry.questionId === questionId);
  if (!answer || answer.skipped) return null;
  const value = (answer.rawValue ?? "").trim();
  return value || null;
}

function normaliseSensitivity(raw: string | null): ProfileSensitivity {
  if (!raw) return "standard";
  const lowered = raw.trim().toLowerCase();
  if (lowered === "1" || lowered.startsWith("standard")) return "standard";
  if (lowered === "2" || lowered.startsWith("sensitive")) return "sensitive";
  if (lowered === "3" || lowered.startsWith("regulated")) return "regulated";
  if (lowered === "4" || lowered.startsWith("air")) return "air-gapped";
  return "standard";
}

// ---------------- Inference ----------------

export function inferOnboardingProfile(answers: OnboardingAnswer[]): OnboardingInference {
  const businessSummary = findAnswer(answers, "business_summary") ?? "";
  const role = findAnswer(answers, "role");
  const founderNote = findAnswer(answers, "founder_note");
  const systemsRaw = findAnswer(answers, "systems");
  const sensitivityRaw = findAnswer(answers, "sensitivity");
  const guardrail = findAnswer(answers, "guardrail");

  const industryGuess = guessIndustry(businessSummary);
  const sensitivity = normaliseSensitivity(sensitivityRaw);
  const { systems, channels } = parseSystemsAndChannels(systemsRaw ?? "");
  // Drop any identity mappings (e.g. ticket → ticket) so they don't pollute
  // the system prompt and dashboards. They'd be dead weight at every retrieval.
  const rawVocabulary = VOCABULARY_BY_INDUSTRY[industryGuess.industry] ?? {};
  const vocabulary = Object.fromEntries(
    Object.entries(rawVocabulary).filter(([from, to]) => from !== to)
  );
  const policyPacks = policyPacksFor(industryGuess.industry, sensitivity);
  const defaultSkills = defaultSkillsFor(industryGuess.industry);

  const readOnlyByDefault = sensitivity === "regulated" || sensitivity === "air-gapped";

  // Display name: prefer the user's words; fall back to the industry display name.
  const displayName = deriveDisplayName(businessSummary, industryGuess.displayName);

  const profile: EnterpriseProfileInput = {
    industry: industryGuess.industry,
    displayName,
    businessUnit: null,
    role: role,
    primarySystems: systems,
    primaryChannels: channels,
    sensitivity,
    vocabulary,
    branding: {
      productName: `SquidBot for ${displayName}`,
      accentColor: accentColorFor(industryGuess.industry),
      supportEmail: "support@squidbot.dev"
    },
    policyPacks,
    defaultSkills,
    defaultConnectors: [],
    readOnlyByDefault,
    metadata: {
      createdVia: "onboarding",
      industryGuess: {
        industry: industryGuess.industry,
        confidence: industryGuess.confidence
      }
    }
  };

  const memories: OnboardingMemoryDraft[] = [];

  if (businessSummary) {
    memories.push({
      type: "business_summary",
      title: `Business summary — ${displayName}`,
      body: businessSummary,
      importance: 0.8,
      confidence: 0.95
    });
  }
  if (founderNote) {
    memories.push({
      type: "founder_note",
      title: "Top time-waster (founder note)",
      body: founderNote,
      importance: 0.9,
      confidence: 0.95
    });
  }
  if (systemsRaw && (systems.length > 0 || channels.length > 0)) {
    const inventory = [
      systems.length > 0 ? `Primary systems: ${systems.join(", ")}` : null,
      channels.length > 0 ? `Primary channels: ${channels.join(", ")}` : null
    ]
      .filter(Boolean)
      .join("\n");
    memories.push({
      type: "system_inventory",
      title: "Systems inventory",
      body: inventory,
      importance: 0.7,
      confidence: 0.9
    });
  }
  if (guardrail) {
    memories.push({
      type: "guardrail",
      title: "Permanent guardrail (operator policy)",
      body: guardrail,
      importance: 0.95,
      confidence: 0.95
    });
  }

  const rationale: string[] = [];
  rationale.push(
    industryGuess.confidence > 0
      ? `Inferred industry: ${industryGuess.industry} (${Math.round(industryGuess.confidence * 100)}% confidence).`
      : `No industry-specific keywords detected. Treating as ${industryGuess.industry}.`
  );
  rationale.push(`Sensitivity set to "${sensitivity}".${readOnlyByDefault ? " Read-only mode is on by default." : ""}`);
  if (Object.keys(vocabulary).length > 0) {
    rationale.push(
      `Vocabulary tailored: ${Object.entries(vocabulary)
        .map(([from, to]) => `${from}→${to}`)
        .join(", ")}.`
    );
  }
  rationale.push(`Active policy packs: ${policyPacks.join(", ")}.`);
  if (systems.length > 0 || channels.length > 0) {
    rationale.push(`Recognized integrations to suggest connectors for: ${[...systems, ...channels].join(", ")}.`);
  }
  if (founderNote) {
    rationale.push(`Saved your top time-waster as a permanent founder note.`);
  }
  if (guardrail) {
    rationale.push(`Saved your guardrail as a permanent operator policy.`);
  }

  const nextActions: string[] = [];
  nextActions.push(`npm run whoami    # confirm the new profile is active`);
  nextActions.push(`npm run trust -- summary    # see your live security posture`);
  if (founderNote) {
    nextActions.push(`npm run memory -- list    # see your founder note + guardrails`);
  }
  if (systems.length > 0) {
    nextActions.push(`npm run connectors -- list    # connect ${systems.slice(0, 3).join(", ")} when you're ready`);
  }
  if (defaultSkills.length > 0) {
    nextActions.push(`npm run skill -- list    # ${defaultSkills.slice(0, 2).join(", ")} are queued for your business`);
  }

  return { profile, memories, rationale, nextActions };
}

// Words that LOOK capitalised at sentence-start but aren't actually business names.
// Combined "we/the/our/..." pronouns + common descriptor adjectives ("family",
// "boutique", "small", "local", ...). When the first capitalised word is one
// of these, we fall back to the industry display name instead.
const NON_NAME_OPENERS = new Set([
  "we", "the", "our", "my", "a", "an", "this", "that", "it", "i", "they",
  "their", "us", "just", "small", "big", "tiny", "local", "independent",
  "new", "some", "many", "team", "founded", "established", "family",
  "boutique", "premier", "leading", "global", "national", "regional",
  "professional"
]);

function deriveDisplayName(businessSummary: string, fallback: string): string {
  const trimmed = (businessSummary ?? "").trim();
  if (!trimmed) return fallback;

  // Strategy: many users open with their business name as a proper noun
  // ("Acme is a small SaaS...", "Pixel Health serves clinics..."). Extract
  // up to 3 consecutive capitalised words as the display name. Reject common
  // descriptor words ("Family", "Boutique", "Small", ...) and pronouns
  // ("We", "Our", "The"...) which signal sentence-case, not a brand.
  const properNounMatch = trimmed.match(/^([A-Z][a-zA-Z0-9&]+(?:\s+[A-Z][a-zA-Z0-9&]+){0,2})/);
  if (properNounMatch) {
    const candidate = properNounMatch[1].trim();
    const firstWord = candidate.split(/\s+/)[0];
    if (!NON_NAME_OPENERS.has(firstWord.toLowerCase())) {
      return candidate.length > 64 ? `${candidate.slice(0, 61)}...` : candidate;
    }
  }

  // No proper-noun business name detected — fall back to the industry display name.
  // The operator can rename via `profile create` or a future `profile rename` later.
  return fallback;
}

function accentColorFor(industry: string): string {
  switch (industry) {
    case "legal":
      return "#1d4ed8";
    case "automotive_retail":
      return "#dc2626";
    case "healthcare_operations":
      return "#0891b2";
    case "government_contracting":
      return "#15803d";
    case "software_engineering":
      return "#7c3aed";
    case "marketing_agency":
      return "#f97316";
    case "ecommerce":
      return "#ec4899";
    case "saas":
      return "#0ea5e9";
    case "real_estate":
      return "#a16207";
    case "financial_services":
      return "#0f766e";
    case "consulting":
      return "#6366f1";
    default:
      return "#0ea5e9";
  }
}

// ---------------- Commit ----------------

export type CommitOnboardingOptions = {
  activate?: boolean;
};

/**
 * Persist the inferred profile + memories to the database. The profile is
 * created via `createCustomProfile`. Memories are written directly to the
 * memories table as approved entries with a synthetic run id (`run_onboarding_*`)
 * so they show provenance back to the onboarding session without needing a
 * full reflection record.
 */
export function commitOnboarding(
  database: SquidDatabase,
  inference: OnboardingInference,
  options: CommitOnboardingOptions = {}
): CommittedOnboarding {
  const activate = options.activate ?? true;
  const profile = createCustomProfile(database, { ...inference.profile, activate });
  // createCustomProfile only activates when activate=true. If the caller asked
  // to skip activation, we still want the profile saved but inactive.
  if (!activate && profile.isActive) {
    // Defensive — shouldn't happen, but make the state match the request.
    activateProfile(database, profile.id);
  }

  const syntheticRunId = `run_onboarding_${Date.now().toString(36)}_${createId("on").split("_").pop()}`;
  const approvedAt = new Date().toISOString();
  const memories: ApprovedMemory[] = [];

  for (const draft of inference.memories) {
    const stored = database.insertMemory({
      id: createId("memory"),
      type: draft.type,
      title: draft.title,
      body: draft.body,
      sourceRunId: syntheticRunId,
      sourceReflectionId: null,
      sourceEventId: null,
      confidence: draft.confidence,
      importance: draft.importance,
      createdAt: approvedAt,
      approvedAt,
      archivedAt: null
    });
    memories.push({
      id: stored.id,
      type: stored.type,
      title: stored.title,
      body: stored.body,
      sourceRunId: stored.sourceRunId,
      sourceReflectionId: stored.sourceReflectionId,
      sourceEventId: stored.sourceEventId,
      confidence: stored.confidence,
      importance: stored.importance,
      createdAt: stored.createdAt,
      approvedAt: stored.approvedAt,
      archivedAt: stored.archivedAt
    });
  }

  return { profile, memories, syntheticRunId };
}

// ---------------- Pretty-print ----------------

export function formatOnboardingSummary(inference: OnboardingInference): string {
  const lines: string[] = [];
  const profile = inference.profile;
  lines.push("");
  lines.push("✓ Here's what I learned:");
  lines.push("");
  lines.push(`  Business name:  ${profile.displayName}`);
  lines.push(`  Industry:       ${profile.industry}`);
  if (profile.role) lines.push(`  Operator role:  ${profile.role}`);
  lines.push(`  Sensitivity:    ${profile.sensitivity}${profile.readOnlyByDefault ? "  (read-only by default)" : ""}`);
  if (profile.primarySystems.length > 0) lines.push(`  Systems:        ${profile.primarySystems.join(", ")}`);
  if (profile.primaryChannels.length > 0) lines.push(`  Channels:       ${profile.primaryChannels.join(", ")}`);
  if (profile.policyPacks.length > 0) lines.push(`  Policy packs:   ${profile.policyPacks.join(", ")}`);
  const vocabEntries = Object.entries(profile.vocabulary);
  if (vocabEntries.length > 0) {
    lines.push(`  Vocabulary:     ${vocabEntries.map(([from, to]) => `${from}→${to}`).join(", ")}`);
  }

  if (inference.memories.length > 0) {
    lines.push("");
    lines.push("  Memories to save:");
    for (const memory of inference.memories) {
      lines.push(`    • [${memory.type}] ${memory.title}`);
    }
  }

  if (inference.rationale.length > 0) {
    lines.push("");
    lines.push("  Reasoning:");
    for (const reason of inference.rationale) {
      lines.push(`    - ${reason}`);
    }
  }

  return lines.join("\n");
}

export function formatNextActions(inference: OnboardingInference): string {
  if (inference.nextActions.length === 0) return "";
  const lines: string[] = [];
  lines.push("");
  lines.push("Try this next:");
  for (const action of inference.nextActions) {
    lines.push(`  • ${action}`);
  }
  return lines.join("\n");
}

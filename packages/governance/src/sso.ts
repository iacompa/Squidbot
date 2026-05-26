import { createHash, timingSafeEqual } from "node:crypto";
import type { SquidDatabase } from "@squidbot/db";
import { DEFAULT_ADMIN_USER_ID } from "./types.js";

export type SsoProviderKind = "local" | "oidc" | "saml";

export type SsoProviderStatus = {
  id: SsoProviderKind;
  label: string;
  configured: boolean;
  available: boolean;
  detail: string;
};

export type SsoLoginResult = {
  ok: boolean;
  provider: SsoProviderKind;
  subject?: string;
  email?: string;
  reason?: string;
};

export interface SsoProvider {
  readonly id: SsoProviderKind;
  status(database: SquidDatabase): SsoProviderStatus;
  login(args: { token?: string; tenantId?: string }): Promise<SsoLoginResult>;
}

type LocalTokenEntry = {
  subject: string;
  hash: string;
};

function hashToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

function constantTimeStringEqual(a: string, b: string): boolean {
  if (a.length !== b.length) {
    return false;
  }
  const bufA = Buffer.from(a, "utf8");
  const bufB = Buffer.from(b, "utf8");
  return timingSafeEqual(bufA, bufB);
}

class LocalAccountSsoProvider implements SsoProvider {
  readonly id = "local" as const;

  status(database: SquidDatabase): SsoProviderStatus {
    const allowAnonymous = database.getSetting<boolean>("sso.local.allowAnonymous") ?? true;
    const tokens = database.getSetting<LocalTokenEntry[]>("sso.local.tokens") ?? [];
    return {
      id: "local",
      label: "Local accounts",
      configured: true,
      available: true,
      detail: allowAnonymous
        ? `Air-gapped local accounts. Anonymous login enabled (${tokens.length} stored tokens).`
        : `Air-gapped local accounts. Token required (${tokens.length} stored tokens).`
    };
  }

  async login(args: { token?: string; tenantId?: string }): Promise<SsoLoginResult> {
    return { ok: false, provider: "local", reason: "Internal: bind a database before calling login()." };
  }

  async loginWithDatabase(database: SquidDatabase, args: { token?: string; tenantId?: string }): Promise<SsoLoginResult> {
    const allowAnonymous = database.getSetting<boolean>("sso.local.allowAnonymous") ?? true;
    const token = args.token?.trim();

    if (!token) {
      if (!allowAnonymous) {
        return { ok: false, provider: "local", reason: "Anonymous login is disabled. Provide a token." };
      }
      return { ok: true, provider: "local", subject: DEFAULT_ADMIN_USER_ID };
    }

    const storedTokens = database.getSetting<LocalTokenEntry[]>("sso.local.tokens") ?? [];
    const tokenHash = hashToken(token);

    for (const entry of storedTokens) {
      if (typeof entry?.hash === "string" && constantTimeStringEqual(entry.hash, tokenHash)) {
        return { ok: true, provider: "local", subject: entry.subject };
      }
    }

    return { ok: false, provider: "local", reason: "Invalid token." };
  }
}

class OidcSsoProvider implements SsoProvider {
  readonly id = "oidc" as const;

  status(database: SquidDatabase): SsoProviderStatus {
    const issuer = database.getSetting<string>("sso.oidc.issuer");
    const clientId = database.getSetting<string>("sso.oidc.clientId");
    const configured = Boolean(issuer && clientId);
    return {
      id: "oidc",
      label: "OpenID Connect",
      configured,
      available: false,
      detail: configured
        ? `Issuer ${issuer} configured but login flow not yet implemented.`
        : "Configure sso.oidc.issuer and sso.oidc.clientId; login flow not yet implemented."
    };
  }

  async login(): Promise<SsoLoginResult> {
    return {
      ok: false,
      provider: "oidc",
      reason: "OIDC login flow is scaffolded but not implemented. Use the local provider until OIDC is enabled."
    };
  }
}

class SamlSsoProvider implements SsoProvider {
  readonly id = "saml" as const;

  status(database: SquidDatabase): SsoProviderStatus {
    const metadataUrl = database.getSetting<string>("sso.saml.metadataUrl");
    return {
      id: "saml",
      label: "SAML",
      configured: Boolean(metadataUrl),
      available: false,
      detail: metadataUrl ? "SAML metadata configured; assertion consumer not enabled yet." : "SAML not configured."
    };
  }

  async login(): Promise<SsoLoginResult> {
    return { ok: false, provider: "saml", reason: "SAML SSO is planned; local accounts remain the default." };
  }
}

export class SsoManager {
  private readonly localProvider = new LocalAccountSsoProvider();
  private readonly oidcProvider = new OidcSsoProvider();
  private readonly samlProvider = new SamlSsoProvider();
  private readonly providers: SsoProvider[];

  constructor(private readonly database: SquidDatabase) {
    this.providers = [this.localProvider, this.oidcProvider, this.samlProvider];
  }

  listProviders(): SsoProviderStatus[] {
    return this.providers.map((provider) => provider.status(this.database));
  }

  async login(providerId: SsoProviderKind, args: { token?: string; tenantId?: string } = {}): Promise<SsoLoginResult> {
    if (providerId === "local") {
      return this.localProvider.loginWithDatabase(this.database, args);
    }
    const provider = this.providers.find((candidate) => candidate.id === providerId);
    if (!provider) {
      return { ok: false, provider: providerId, reason: `Unknown SSO provider: ${providerId}` };
    }
    return provider.login(args);
  }

  registerLocalToken(token: string, subject: string): void {
    const trimmed = token.trim();
    if (!trimmed) {
      throw new Error("Token must not be empty.");
    }
    if (!subject.trim()) {
      throw new Error("Subject must not be empty.");
    }
    const tokens = this.database.getSetting<LocalTokenEntry[]>("sso.local.tokens") ?? [];
    const entry: LocalTokenEntry = { subject: subject.trim(), hash: hashToken(trimmed) };
    const filtered = tokens.filter((existing) => existing.subject !== entry.subject);
    filtered.push(entry);
    this.database.setSetting("sso.local.tokens", filtered);
  }

  revokeLocalToken(subject: string): boolean {
    const tokens = this.database.getSetting<LocalTokenEntry[]>("sso.local.tokens") ?? [];
    const filtered = tokens.filter((existing) => existing.subject !== subject);
    if (filtered.length === tokens.length) {
      return false;
    }
    this.database.setSetting("sso.local.tokens", filtered);
    return true;
  }
}

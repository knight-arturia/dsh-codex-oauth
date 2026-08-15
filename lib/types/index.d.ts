/**
 * Keeps the harness credential `CODEX_OAUTH_TOKEN` fresh from the local
 * OpenAI Codex CLI session (`~/.codex/auth.json`) so the `llm-pi-ai`
 * `openai-codex` route can authenticate with the rotating ChatGPT OAuth
 * access token.
 *
 * Resolution stays per-request in the consuming adapter (llm-pi-ai re-resolves
 * `apiKeyEnv` through the credentials seam once per stream call): this plugin
 * only mirrors the *current* access token into the managed credentials
 * document whenever the Codex CLI rotates or refreshes it, and warns loudly
 * when the token is missing, malformed, or about to expire.
 * @module @deepseek-ai/dsh-codex-oauth
 */
import type { Context } from '@deepseek-ai/cordis';
import Schema from '@deepseek-ai/schemastery';
export declare const name = "codex-oauth";
export declare const inject: string[];
/** A credential reference: a POSIX shell identifier, e.g. `DEEPSEEK_API_KEY`. */
export type CredentialRef = string & {
    readonly __credentialRef: unique symbol;
};
/** Plugin config: auth-file location and warning thresholds. */
export interface Config {
    /** Codex CLI auth file; defaults to `$CODEX_AUTH_FILE` or `~/.codex/auth.json`. */
    authFile?: string;
    /** Watch the auth file for Codex-side refresh; defaults to true. */
    watch?: boolean;
    /** Watcher write-settle window in milliseconds; defaults to 100. */
    debounceMs?: number;
    /** Warn when the token has fewer than this many minutes until JWT expiry; defaults to 30. */
    warnSkewMinutes?: number;
}
export declare const Config: Schema<Config>;
/** One resolved credential value and the source layer that supplied it. */
export interface ResolvedCredential {
    /** The non-empty secret value. */
    value: string;
    /** Provider-defined source layer id (the local provider uses `env`, `file`, `project-env`, and `user-env`). */
    source: string;
}
/**
 * The credential seam this plugin injects. Mirrors
 * `@deepseek-ai/dsh-credentials`' `CredentialProvider` shape so the package
 * stays dependency-free at runtime: the service itself comes from the app
 * through `inject = ['credentials']`, never from an import. Keep in sync if
 * the upstream seam changes.
 */
export interface CredentialProvider {
    /** Resolve the current value for a reference, or undefined when unconfigured. */
    resolve(ref: CredentialRef): Promise<ResolvedCredential | undefined>;
    /** Persist a non-empty value for a reference. */
    set(ref: CredentialRef, value: string): Promise<void>;
    /** Remove any stored value for a reference. */
    unset(ref: CredentialRef): Promise<void>;
}
declare module '@deepseek-ai/cordis' {
    interface Context {
        credentials: CredentialProvider;
    }
}
/** The credential reference this plugin maintains. */
export declare const TOKEN_REF: CredentialRef;
/** Resolve the auth-file path: config wins, then `CODEX_AUTH_FILE`, then the default. */
export declare function resolveAuthFile(authFile: string | undefined): string;
/** Parsed view of a Codex auth document. */
export interface CodexAuth {
    /** OAuth access token, when present. */
    accessToken: string | undefined;
    /** JWT `exp` claim in seconds since epoch, when decodable. */
    expiresAt: number | undefined;
    /** `last_refresh` timestamp, when present. */
    lastRefresh: string | undefined;
}
/** Parse a `~/.codex/auth.json` document; never throws. */
export declare function parseCodexAuth(text: string): CodexAuth;
/** Decode the `exp` claim of a JWT without validating the signature. */
export declare function jwtExpirySeconds(token: string): number | undefined;
/** Render a duration in human terms, e.g. `3h 12m`. */
export declare function humanizeDuration(seconds: number): string;
export declare function apply(ctx: Context, config?: Config): () => void;
//# sourceMappingURL=index.d.ts.map
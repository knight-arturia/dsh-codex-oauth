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
import { readFile } from 'node:fs/promises';
import { watch as fsWatch } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import Schema from '@deepseek-ai/schemastery';
export const name = 'codex-oauth';
export const inject = ['credentials'];
const REF_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;
/** Brand a raw string as a {@link CredentialRef}. */
function credentialRef(value) {
    if (!REF_PATTERN.test(value)) {
        throw new TypeError(`credential ref "${value}" must match ${String(REF_PATTERN)}`);
    }
    return value;
}
// Official plugin-config convention: a Schemastery schema validates the
// config and fills defaults while the plugin loads (see
// docs/user/develop/basic/config.md).
export const Config = Schema.object({
    authFile: Schema.string(),
    watch: Schema.boolean().default(true),
    debounceMs: Schema.number().default(100),
    warnSkewMinutes: Schema.number().default(30),
});
const DEFAULT_DEBOUNCE_MS = 100;
const DEFAULT_WARN_SKEW_MINUTES = 30;
const WATCH_RETRY_MS = 10_000;
/** The credential reference this plugin maintains. */
export const TOKEN_REF = credentialRef('CODEX_OAUTH_TOKEN');
/** Resolve the auth-file path: config wins, then `CODEX_AUTH_FILE`, then the default. */
export function resolveAuthFile(authFile) {
    return resolve(authFile ?? process.env.CODEX_AUTH_FILE ?? join(homedir(), '.codex', 'auth.json'));
}
/** Parse a `~/.codex/auth.json` document; never throws. */
export function parseCodexAuth(text) {
    let parsed;
    try {
        parsed = JSON.parse(text);
    }
    catch {
        return { accessToken: undefined, expiresAt: undefined, lastRefresh: undefined };
    }
    const tokens = parsed?.tokens;
    const accessToken = typeof tokens?.access_token === 'string' ? tokens.access_token : undefined;
    const maybeLastRefresh = parsed?.last_refresh;
    const lastRefresh = typeof maybeLastRefresh === 'string' ? maybeLastRefresh : undefined;
    return {
        accessToken,
        expiresAt: accessToken === undefined ? undefined : jwtExpirySeconds(accessToken),
        lastRefresh,
    };
}
/** Decode the `exp` claim of a JWT without validating the signature. */
export function jwtExpirySeconds(token) {
    try {
        const payload = token.split('.')[1];
        if (payload === undefined)
            return undefined;
        const exp = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')).exp;
        return typeof exp === 'number' && Number.isFinite(exp) ? exp : undefined;
    }
    catch {
        return undefined;
    }
}
/** Render a duration in human terms, e.g. `3h 12m`. */
export function humanizeDuration(seconds) {
    const s = Math.max(0, Math.round(seconds));
    if (s < 60)
        return `${s}s`;
    const minutes = Math.floor(s / 60);
    if (minutes < 60)
        return `${minutes}m`;
    const hours = Math.floor(minutes / 60);
    if (hours < 48)
        return `${hours}h ${minutes % 60}m`;
    const days = Math.floor(hours / 24);
    return `${days}d ${hours % 24}h`;
}
export function apply(ctx, config = {}) {
    const authFile = resolveAuthFile(config.authFile);
    const debounceMs = config.debounceMs ?? DEFAULT_DEBOUNCE_MS;
    const skewSeconds = (config.warnSkewMinutes ?? DEFAULT_WARN_SKEW_MINUTES) * 60;
    const basenameOfAuth = basename(authFile);
    let closed = false;
    let watcher;
    let timer;
    let retryTimer;
    /** Deduplicate the missing-file warning across watcher/retry events. */
    let missingWarned = false;
    async function clearRef() {
        if (closed)
            return;
        try {
            const existing = await ctx.credentials.resolve(TOKEN_REF);
            if (existing === undefined)
                return;
            await ctx.credentials.unset(TOKEN_REF);
        }
        catch (error) {
            ctx.logger.warn('codex-oauth: could not clear %s: %s', TOKEN_REF, error.message);
        }
    }
    function scheduleSync() {
        if (timer !== undefined)
            clearTimeout(timer);
        timer = setTimeout(() => {
            timer = undefined;
            void sync();
        }, debounceMs);
    }
    async function sync() {
        if (closed)
            return;
        let text;
        try {
            text = await readFile(authFile, 'utf8');
        }
        catch (error) {
            if (error?.code === 'ENOENT') {
                if (!missingWarned) {
                    missingWarned = true;
                    ctx.logger.warn('codex-oauth: no Codex auth file at %s; run `codex login`', authFile);
                }
            }
            else {
                ctx.logger.warn('codex-oauth: cannot read %s', authFile);
                ctx.logger.warn(error);
                return;
            }
            await clearRef();
            return;
        }
        const auth = parseCodexAuth(text);
        missingWarned = false;
        if (auth.accessToken === undefined) {
            ctx.logger.warn('codex-oauth: %s has no access_token; run `codex login`', authFile);
            await clearRef();
            return;
        }
        // Resolve the current stored value once; every decision below compares
        // against it, so an unchanged token is a no-op write.
        let existing;
        try {
            existing = await ctx.credentials.resolve(TOKEN_REF);
        }
        catch (error) {
            ctx.logger.warn('codex-oauth: could not resolve %s: %s', TOKEN_REF, error.message);
            return;
        }
        const changed = existing?.value !== auth.accessToken;
        const nowSeconds = Date.now() / 1000;
        if (auth.expiresAt !== undefined) {
            const secondsLeft = auth.expiresAt - nowSeconds;
            if (secondsLeft <= 0) {
                ctx.logger.error('codex-oauth: %s expired %s ago; run `codex login` or use the Codex CLI to refresh the session', TOKEN_REF, humanizeDuration(-secondsLeft));
                await clearRef();
                return;
            }
            if (secondsLeft < skewSeconds) {
                ctx.logger.warn('codex-oauth: %s expires in %s; run `codex login` or use the Codex CLI to refresh the session', TOKEN_REF, humanizeDuration(secondsLeft));
            }
            else if (changed) {
                ctx.logger.info('codex-oauth: synced %s (expires in %s)', TOKEN_REF, humanizeDuration(secondsLeft));
            }
        }
        else if (changed) {
            ctx.logger.info('codex-oauth: synced %s (expiry unknown)', TOKEN_REF);
        }
        if (!changed)
            return;
        try {
            await ctx.credentials.set(TOKEN_REF, auth.accessToken);
        }
        catch (error) {
            // An env-supplied value shadows the managed document by design; a write
            // failure keeps the last good value.
            ctx.logger.warn('codex-oauth: could not store %s: %s', TOKEN_REF, error.message);
        }
    }
    void sync();
    if (config.watch !== false) {
        // Watch the parent directory so an atomic replace of auth.json (the Codex
        // CLI rewrites the file) still fires, where a watcher on the replaced
        // inode would go silent. A missing parent (Codex never logged in) is
        // retried until it appears rather than crashing the plugin.
        const startWatcher = () => {
            if (closed || watcher !== undefined)
                return;
            try {
                const dir = dirname(authFile);
                watcher = fsWatch(dir, { persistent: true }, (_event, filename) => {
                    if (closed)
                        return;
                    if (filename === null || basename(String(filename)) === basenameOfAuth)
                        scheduleSync();
                });
                if (retryTimer !== undefined) {
                    clearInterval(retryTimer);
                    retryTimer = undefined;
                }
            }
            catch {
                if (retryTimer === undefined) {
                    ctx.logger.info('codex-oauth: waiting for %s to appear (codex login pending)', authFile);
                    retryTimer = setInterval(startWatcher, WATCH_RETRY_MS);
                }
            }
        };
        startWatcher();
        // The initial read raced the watcher's own setup: a change written between
        // that read and the watcher becoming active never fires an event. One
        // reconcile after the watcher is live closes the gap.
        timer = setTimeout(() => {
            timer = undefined;
            void sync();
        }, debounceMs);
    }
    return () => {
        closed = true;
        if (timer !== undefined)
            clearTimeout(timer);
        if (retryTimer !== undefined)
            clearInterval(retryTimer);
        void watcher?.close();
    };
}
//# sourceMappingURL=index.js.map
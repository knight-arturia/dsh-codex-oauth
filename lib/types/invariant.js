/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-codex-oauth`.
 * @module @deepseek-ai/dsh-codex-oauth/invariant
 */
const PACKAGE_NAME = '@deepseek-ai/dsh-codex-oauth';
/** Cordis companion plugin name. */
export const name = 'codex-oauth-invariant';
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants'];
/**
 * No runtime invariant: the plugin's file-watching and credential mirroring
 * behavior is asynchronous I/O pinned by its unit suite.
 */
const install = () => { };
/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx) => Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install));
/* jscpd:ignore-end */
//# sourceMappingURL=invariant.js.map
/**
 * Whether to show test/QA-only UI (Dev toolbar, …).
 *
 * FAIL-CLOSED / opt-in: OFF unless `NEXT_PUBLIC_ENABLE_TEST_UI` is exactly
 * `"true"`. A NEW or misconfigured deployment that forgets the flag must be
 * SAFE (tooling hidden), not exposed. We can NOT gate on `VERCEL_ENV`/`NODE_ENV`:
 * every environment is a production BUILD shipped as a Vercel Preview, so neither
 * signal singles out prod. The explicit opt-in is the only reliable control.
 *
 * → prod needs NO variable (absence = off); QA envs set
 *   `NEXT_PUBLIC_ENABLE_TEST_UI=true` to keep their tooling.
 */
export const SHOW_TEST_UI = process.env.NEXT_PUBLIC_ENABLE_TEST_UI === "true"

/**
 * Whether search engines may index this deployment — drives the `robots` tag.
 *
 * Its OWN dedicated opt-in (`NEXT_PUBLIC_ALLOW_INDEXING=true`), NOT derived from
 * `NEXT_PUBLIC_ENABLE_TEST_UI`. Reusing that var overloaded one flag with two
 * opposite-polarity meanings: test tooling wants "off unless opted in", but
 * indexing wants "off unless we're SURE it's prod". A single var can't fail
 * safe for both — e.g. a prod deploy that (correctly, per SHOW_TEST_UI) leaves
 * the var unset would have been noindexed, deindexing the live site.
 *
 * FAIL-CLOSED for SEO: indexing is OFF unless a deployment explicitly sets
 * `NEXT_PUBLIC_ALLOW_INDEXING=true`. Only prod sets it; every QA env and any
 * misconfigured/new deploy stays noindexed by default (a QA site leaking into
 * Google is the failure to avoid).
 */
export const ALLOW_INDEXING = process.env.NEXT_PUBLIC_ALLOW_INDEXING === "true"

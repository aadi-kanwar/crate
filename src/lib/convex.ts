/**
 * Live Convex queries that stay subscribed for a few minutes after a screen
 * stops using them (see ConvexQueryCacheProvider in convex-client-provider),
 * so going back to a tab or date shows its data at once, still live.
 * Use this instead of `useQuery` from "convex/react".
 */
export { useQuery } from "convex-helpers/react/cache";

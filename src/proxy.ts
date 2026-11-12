import {
  convexAuthNextjsMiddleware,
  createRouteMatcher,
  nextjsMiddlewareRedirect,
} from "@convex-dev/auth/nextjs/server";

/**
 * Runs before every page. Sends signed-out visitors to /signin, and signed-in
 * people away from /signin. This is only for convenience: every permission is
 * checked again by the Convex backend.
 */
const isSignInPage = createRouteMatcher(["/signin"]);
const isDesignPage = createRouteMatcher(["/design"]);
const isHubSignInPage = createRouteMatcher(["/sso"]);

export const proxy = convexAuthNextjsMiddleware(async (request, { convexAuth }) => {
  const signedIn = await convexAuth.isAuthenticated();
  // Admin Hub single sign-on: open to everyone; the ticket itself is checked by the backend.
  if (isHubSignInPage(request)) return undefined;
  if (isSignInPage(request)) {
    return signedIn ? nextjsMiddlewareRedirect(request, "/") : undefined;
  }
  // The design reference is open without login only on a developer's machine.
  if (isDesignPage(request) && process.env.NODE_ENV === "development") return undefined;
  if (!signedIn) return nextjsMiddlewareRedirect(request, "/signin");
});

export const config = {
  // Everything except Next.js internals and static files.
  matcher: ["/((?!.*\\..*|_next).*)", "/", "/(api|trpc)(.*)"],
};

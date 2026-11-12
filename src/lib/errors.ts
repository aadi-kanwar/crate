import { ConvexError } from "convex/values";
import { DEFAULT_MESSAGES, type AppErrorCode, type AppErrorData } from "@convex/lib/errors";

const OFFLINE_MESSAGE =
  "Couldn't reach the app. Check your internet connection and try again.";

/**
 * Pulls the app's { code, message } out of any error. Errors from login pass
 * through the Next.js server as plain text, so we also look inside the text.
 */
export function parseAppError(error: unknown): AppErrorData | null {
  if (error instanceof ConvexError) {
    const data = error.data as unknown;
    if (data && typeof data === "object" && "code" in data) return data as AppErrorData;
  }
  if (error instanceof Error) {
    const start = error.message.indexOf("{");
    const end = error.message.lastIndexOf("}");
    if (start !== -1 && end > start) {
      try {
        const data = JSON.parse(error.message.slice(start, end + 1)) as unknown;
        if (data && typeof data === "object" && "code" in data) {
          const { code, message } = data as { code: string; message?: string };
          if (code in DEFAULT_MESSAGES) {
            return { code: code as AppErrorCode, message: message ?? DEFAULT_MESSAGES[code as AppErrorCode] };
          }
        }
      } catch {
        // Not JSON; fall through.
      }
    }
  }
  return null;
}

/** A message that's safe and helpful to show to a resident or staff member. */
export function friendlyError(error: unknown): string {
  const appError = parseAppError(error);
  if (appError) return appError.message;
  if (typeof navigator !== "undefined" && !navigator.onLine) return OFFLINE_MESSAGE;
  if (error instanceof Error && /network|fetch|connection|timed? ?out/i.test(error.message)) {
    return OFFLINE_MESSAGE;
  }
  return "Something went wrong. Please try again. If it keeps happening, contact the office.";
}

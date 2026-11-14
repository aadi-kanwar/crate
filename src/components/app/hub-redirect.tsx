"use client";

import { useEffect } from "react";
import { api } from "@convex/_generated/api";
import { useQuery } from "@/lib/convex";

/**
 * After the move to the Livoza Hub (HUB_ONLY=true on the backend), this
 * app's own sign-in is off: anyone who lands on it signed out is sent to the
 * hub, which signs them in and opens this app again.
 */
export function HubOnlyRedirect() {
  const settings = useQuery(api.sso.hubSettings, {});
  useEffect(() => {
    if (settings?.hubOnly && settings.openUrl) window.location.replace(settings.openUrl);
  }, [settings]);
  return null;
}

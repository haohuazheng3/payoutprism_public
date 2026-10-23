"use client";

import { useEffect } from "react";
import { identify } from "@/lib/analytics";

/** Marks the owner's own sessions in FlowGlance (email from OWNER_ANALYTICS_EMAIL) so they can be excluded from reports. */
export function AdminIdentify({ email }: { email?: string }) {
  useEffect(() => {
    if (email) identify("owner", email);
  }, [email]);
  return null;
}

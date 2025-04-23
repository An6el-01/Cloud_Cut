// This file configures the initialization of Sentry on the server.
// The config you add here will be used whenever the server handles a request.
// https://docs.sentry.io/platforms/javascript/guides/nextjs/

import * as Sentry from "@sentry/nextjs";
import { SupabaseClient } from "@supabase/supabase-js";
import { supabaseIntegration } from "@supabase/sentry-js-integration";

Sentry.init({
  dsn: process.env.SENTRY_DSN,

  // Define how likely traces are sampled. Adjust this value in production, or use tracesSampler for greater control.
  tracesSampleRate: 1,

  // Setting this option to true will print useful information to the console while you're setting up Sentry.
  debug: false,

  integrations: [
    supabaseIntegration(SupabaseClient, Sentry, {
      tracing: true,
      breadcrumbs: true,
      errors: true,
    }),
    // Prevent duplicate spans from fetch requests to Supabase
    Sentry.httpIntegration({
      ignoreOutgoingRequests: (url: string) => url.startsWith(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest`),
    }),
  ],
});

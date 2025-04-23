"use client";

import * as Sentry from "@sentry/nextjs";
import { SupabaseClient } from "@supabase/supabase-js";
import { supabaseIntegration } from "@supabase/sentry-js-integration";

Sentry.init({
    dsn: process.env.SENTRY_DSN,
    tracesSampleRate: 1.0,
    debug: false,
    integrations: [
        supabaseIntegration(SupabaseClient, Sentry, {
            tracing: true,
            breadcrumbs: true,
            errors: true,
        }),
        Sentry.browserTracingIntegration({
            shouldCreateSpanForRequest: (url) => {
                return ! url.startsWith(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest`);
            },
        }),
    ],
});

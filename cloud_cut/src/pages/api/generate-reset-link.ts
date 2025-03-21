/**
 * What this file does:
 * ---------------------
 * This file creates a special link that allows new users to set up their password
 * when they first join the system. Think of it like creating a secure invitation link
 * that only works once and only for the specific person it was created for.
 * 
 * Who can use this:
 * ----------------
 * Only administrators (GlobalAdmin, SiteAdmin, or Managers) can create these links.
 * Regular users cannot create these links for security reasons.
 * 
 * How it works:
 * ------------
 * 1. An administrator adds a new user to the system
 * 2. This system creates a special secure link
 * 3. The link is sent to the new user's email
 * 4. The new user clicks the link to set up their password
 * 
 * Safety measures:
 * --------------
 * - Only allows 10 requests per minute to prevent abuse
 * - Requires administrator login
 * - Checks if the email is valid
 * - Protects against common security threats
 * 
 * Example:
 * --------
 * When an admin adds a new user:
 * 1. Admin enters the new user's email
 * 2. System creates a secure link
 * 3. New user receives an email with the link
 * 4. New user clicks the link to set their password
 * 
 * Technical details (for developers):
 * ---------------------------------
 * Endpoint: POST /api/generate-reset-link
 * Required headers: Authorization: Bearer <token>
 * Request body: { "email": "user@example.com" }
 * Response: { "resetLink": "https://your-domain.com/resetPassword?token=..." }
 */

import { NextApiRequest, NextApiResponse } from "next";
import { createClient } from "@supabase/supabase-js";
import { RateLimiterMemory } from "rate-limiter-flexible";
import { z } from "zod";

// Initialize Supabase Admin client (requires service_role key)
const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

// Initialize Supabase client for auth (to verify the user)
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

// Rate limiter: 10 requests per minute per IP
const rateLimiter = new RateLimiterMemory({
  points: 10, // 10 requests
  duration: 60, // per 60 seconds
});

// Input validation schema
const requestSchema = z.object({
  email: z.string().email("Invalid email address"),
});

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  // 1. Restrict to POST method
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  // 2. Rate limiting
  try {
    const ip = req.headers["x-forwarded-for"] || req.socket.remoteAddress;
    await rateLimiter.consume(ip as string);
  } catch (rateLimitError) {
    return res.status(429).json({ error: "Too many requests, please try again later. ", rateLimitError });
  }

  // 3. Authenticate the user
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Unauthorized: Missing or invalid token" });
  }

  const token = authHeader.split(" ")[1];
  const { data: { user }, error: authError } = await supabase.auth.getUser(token);

  if (authError || !user) {
    return res.status(401).json({ error: "Unauthorized: Invalid token" });
  }

  // 4. Check user role
  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();

  if (profileError || !profile || (profile.role !== "GlobalAdmin" && profile.role !== "SiteAdmin" && profile.role !== "Manager")) {
    return res.status(403).json({ error: "Forbidden: Insufficient permissions" });
  }

  // 5. Validate input
  try {
    requestSchema.parse(req.body);
  } catch (validationError) {
    return res.status(400).json({ error: "Invalid input", details: validationError });
  }

  const { email } = req.body;

  // 6. Generate reset link
  try {
    const { data, error } = await supabaseAdmin.auth.admin.generateLink({
      type: "recovery",
      email,
      options: {
        redirectTo: process.env.NEXT_PUBLIC_RESET_PASSWORD_URL || "http://localhost:3000/resetPassword",
      },
    });

    if (error) {
      throw error;
    }

    // Log the action (for auditing)
    console.log(`Reset link generated for email: ${email} by user: ${user.id}`);

    return res.status(200).json({ resetLink: data.properties.action_link });
  } catch (error: unknown) {
    console.error("Reset link error:", error);
    return res.status(500).json({
      error: error instanceof Error ? error.message : "Reset Link Error",
      details: process.env.NODE_ENV === "development" ? error : undefined,
    });
  }
}

// Add security headers
export const config = {
  api: {
    headers: [
      { key: "X-Content-Type-Options", value: "nosniff" },
      { key: "X-Frame-Options", value: "DENY" },
      { key: "X-XSS-Protection", value: "1; mode=block" },
    ],
  },
};
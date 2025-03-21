/**
 * What this file does:
 * ---------------------
 * This file handles sending welcome emails to new users when they are added to the system.
 * It's like an automated receptionist that sends a personalized welcome message with
 * instructions on how to set up their account.
 * 
 * Who can use this:
 * ----------------
 * Only high-level administrators (GlobalAdmin or SiteAdmin) can send these welcome emails.
 * This ensures that only authorized people can send official system emails.
 * 
 * How it works:
 * ------------
 * 1. An administrator adds a new user to the system
 * 2. The system creates a personalized welcome email
 * 3. The email is sent to the new user's email address
 * 4. The new user receives the email with a link to set up their password
 * 
 * Safety measures:
 * --------------
 * - Only allows 5 emails per minute to prevent spam
 * - Requires administrator login
 * - Checks if the email is valid
 * - Protects against email content tampering
 * - Tracks email delivery status
 * 
 * Example:
 * --------
 * When an admin adds a new user:
 * 1. Admin enters the new user's details
 * 2. System creates a personalized welcome email
 * 3. Email is sent to the new user
 * 4. System tracks if the email was delivered and opened
 * 
 * Technical details (for developers):
 * ---------------------------------
 * Endpoint: POST /api/send-welcome-email
 * Required headers: Authorization: Bearer <token>
 * Request body: {
 *   "email": "user@example.com",
 *   "name": "User Name",
 *   "resetLink": "https://your-domain.com/resetPassword?token=...",
 *   "email_id": "unique-tracking-id"
 * }
 * Response: { "data": { "id": "email-id", ... } }
 */

import { NextApiRequest, NextApiResponse } from "next";
import { Resend } from "resend";
import { RateLimiterMemory } from "rate-limiter-flexible";
import { z } from "zod";
import { createClient } from "@supabase/supabase-js";

const resend = new Resend(process.env.RESEND_API_KEY);

// Initialize Supabase client for auth
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

// Rate limiter: 5 emails per minute per IP
const rateLimiter = new RateLimiterMemory({
  points: 5, // 5 emails
  duration: 60, // per 60 seconds
});

// Input validation schema
const requestSchema = z.object({
  email: z.string().email("Invalid email address"),
  name: z.string().min(1, "Name is required"),
  resetLink: z.string().url("Invalid reset link"),
  email_id: z.string().min(1, "Email ID is required"),
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

  if (profileError || !profile || (profile.role !== "GlobalAdmin" && profile.role !== "SiteAdmin")) {
    return res.status(403).json({ error: "Forbidden: Insufficient permissions" });
  }

  // 5. Validate input
  try {
    requestSchema.parse(req.body);
  } catch (validationError) {
    return res.status(400).json({ error: "Invalid input", details: validationError });
  }

  const { email, name, resetLink, email_id } = req.body;

  // 6. Sanitize inputs to prevent XSS in the email body
  const sanitizedName = name.replace(/[<>&"']/g, (char: string | number) => {
    const escapeChars: { [key: string]: string } = {
      "<": "&lt;",
      ">": "&gt;",
      "&": "&amp;",
      '"': "&quot;",
      "'": "&#x27;",
    };
    return escapeChars[char] || char;
  });

  // 7. Send the email
  try {
    const { data, error } = await resend.emails.send({
      from: "CloudCut <noreply@cloudcut.com>",
      to: email,
      subject: "Welcome to CloudCut - Set Your Password",
      html: `
        <h1>Welcome to CloudCut, ${sanitizedName}!</h1>
        <p>You've been invited to join CloudCut. Please click the link below to set your password:</p>
        <a href="${resetLink}">Set Your Password</a>
      `,
      tags: [
        { name: 'welcome_email', value: 'true' },
        { name: 'email_id', value: email_id }
      ]
    });

    if (error) {
      return res.status(400).json({ error: error.message });
    }

    // Log the action
    console.log(`Welcome email sent to: ${email} by user: ${user.id}`);

    return res.status(200).json({ data });
  } catch (error: unknown) {
    console.error("Send welcome email error:", error);
    return res.status(500).json({ error: "Internal server error" });
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
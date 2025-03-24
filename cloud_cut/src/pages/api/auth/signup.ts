import { NextApiRequest, NextApiResponse } from "next";
import { signUp } from "@/utils/supabase";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: "Email and password are required" });
    }

    const data = await signUp(email, password);
    return res.status(200).json({ data });
  } catch (err) {
    return res.status(500).json({ error: err instanceof Error ? err.message : "Internal server error" });
  }
}
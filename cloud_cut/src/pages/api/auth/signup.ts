import { NextApiRequest, NextApiResponse } from 'next'
import { signUp } from '@/utils/supabase'

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  try {
    const { email, password } = req.body

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' })
    }

    const { data, error } = await signUp(email, password)

    if (error) {
      return res.status(400).json({ error: error.message })
    }

    return res.status(200).json({ data })
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  } catch (err) {
    return res.status(500).json({ err: 'Internal server error' })
  }
} 
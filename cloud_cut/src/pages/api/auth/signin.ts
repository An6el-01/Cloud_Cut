//**
// Used for api Loggin in for the user. This might not be needed since we are passing the
// State of the user logged in throughout the app.
// 
// Double check if we need this or not.
// Check once domain has been authorized and users are resetting the temporoary password through their email.
//  */

import { NextApiRequest, NextApiResponse } from 'next'
import { signIn } from '@/utils/supabase'

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

    const { data, error } = await signIn(email, password)

    if (error) {
      return res.status(400).json({ error: error.message })
    }

    return res.status(200).json({ data })
  } catch (error: unknown) {
    console.error('Signin API error:', error)
    return res.status(500).json({ 
      error: error instanceof Error ? error.message : 'Internal server error',
      details: process.env.NODE_ENV === 'development' ? error : undefined
    })
  }
} 
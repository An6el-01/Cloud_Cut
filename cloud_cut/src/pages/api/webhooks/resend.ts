//**
// This file is used for having a webhook to communicate with resend.ts in order to track the status of the email we send to the user.
// Resend, is the service we use to send the emails from our domain. (@shadowfoam.com)
//
//  FILE STATUS: Suspended
// */

import { NextApiRequest, NextApiResponse } from 'next'
import { createClient } from '@supabase/supabase-js'

// Initialize Supabase client
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  try {
    const payload = req.body

    // Verify the webhook signature (you'll need to implement this)
    // const signature = req.headers['resend-signature']
    // if (!verifySignature(signature, payload)) {
    //   return res.status(401).json({ error: 'Invalid signature' })
    // }

    // Handle different event types
    switch (payload.type) {
      case 'email.sent':
        // Update the email status in your database
        await supabase
          .from('email_tracking')
          .update({ 
            status: 'sent',
            sent_at: new Date().toISOString()
          })
          .eq('email_id', payload.data.email_id)
        break

      case 'email.delivered':
        await supabase
          .from('email_tracking')
          .update({ 
            status: 'delivered',
            delivered_at: new Date().toISOString()
          })
          .eq('email_id', payload.data.email_id)
        break

      case 'email.failed':
        await supabase
          .from('email_tracking')
          .update({ 
            status: 'failed',
            error: payload.data.error,
            failed_at: new Date().toISOString()
          })
          .eq('email_id', payload.data.email_id)
        break

      case 'email.opened':
        await supabase
          .from('email_tracking')
          .update({ 
            status: 'opened',
            opened_at: new Date().toISOString()
          })
          .eq('email_id', payload.data.email_id)
        break

      case 'email.clicked':
        await supabase
          .from('email_tracking')
          .update({ 
            status: 'clicked',
            clicked_at: new Date().toISOString(),
            clicked_link: payload.data.link
          })
          .eq('email_id', payload.data.email_id)
        break
    }

    return res.status(200).json({ success: true })
  } catch (error) {
    console.error('Webhook error:', error)
    return res.status(500).json({ error: 'Internal server error' })
  }
} 
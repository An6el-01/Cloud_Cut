import { createServerComponentClient, createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { cookies } from 'next/headers';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

let supabaseServerInstance: SupabaseClient | null = null;
let supabaseAdminInstance: SupabaseClient | null = null;

export const getSupabaseServerClient = (isApiRoute = false) => {
  const cookieStore = cookies();
  if (!supabaseServerInstance) {
    supabaseServerInstance = isApiRoute 
      ? createRouteHandlerClient({ cookies: () => cookieStore })
      : createServerComponentClient({ cookies: () => cookieStore });
  }
  return supabaseServerInstance;
};

export const getSupabaseAdmin = () => {
  if (!supabaseAdminInstance) {
    supabaseAdminInstance = createClient(supabaseUrl, supabaseServiceKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false
      }
    });
  }
  return supabaseAdminInstance;
};

// Define allowed admin roles
export const ADMIN_ROLES = ['GlobalAdmin', 'SiteAdmin', 'Manager'];

// Helper function to verify admin role
export const verifyAdminRole = async (email: string, isApiRoute = false) => {
  const supabase = getSupabaseServerClient(isApiRoute);
  
  const { data: userProfile, error: profileError } = await supabase
    .from('profiles')
    .select('role')
    .eq('email', email)
    .single();

  if (profileError) {
    console.error('Error fetching user profile:', profileError);
    throw new Error("Failed to verify user permissions");
  }

  if (!userProfile || !ADMIN_ROLES.includes(userProfile.role)) {
    throw new Error("Only administrators can perform this action");
  }

  return userProfile;
}; 
import { Order, OrderItem } from "@/types/redux";
import { createBrowserClient } from '@supabase/ssr';
import { UserMetadata } from "@supabase/supabase-js";
import { RealtimePostgresChangesPayload } from "@supabase/supabase-js";
import { createUser, deleteUser as deleteUserAction } from '@/app/actions';

let supabaseInstance: ReturnType<typeof createBrowserClient> | null = null;

// Client-side Supabase instance
export const getSupabaseClient = () => {
  if (!supabaseInstance) {
    supabaseInstance = createBrowserClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!);
  }
  return supabaseInstance;
};

export const supabase = getSupabaseClient();

// Remove client-side admin instance for security
// Admin operations should be moved to server-side API routes
// export const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

// Profile interface
export interface Profile {
  id: string;
  name: string;
  email: string;
  phone: string;
  role: string;
}

// Define allowed admin roles
const ADMIN_ROLES = ['GlobalAdmin', 'SiteAdmin', 'Manager'];

// Auth helper functions
export const signUp = async (email: string, password: string, options?: { data?: UserMetadata }) => {
  // Move signup to server-side API route for security
  const response = await fetch('/api/auth/signup', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ email, password, options }),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.message);
  }

  return response.json();
};

export const signIn = async (email: string, password: string) => {
  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password,
  });
  if (error) throw new Error(error.message);
  return data;
};

export const signOut = async () => {
  const { error } = await supabase.auth.signOut();
  if (error) throw new Error(error.message);
};

export const getCurrentUser = async () => {
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error) throw new Error(error.message);
  return user;
};

export const checkAuth = async (): Promise<boolean> => {
  const { data: { session } } = await supabase.auth.getSession();
  return !!session;
};

// Team-related functions
export const fetchProfiles = async (): Promise<Profile[]> => {
  try {
    console.log('Client - Fetching profiles from API');
    const response = await fetch('/api/team/profiles', {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      },
      cache: 'no-store',
      credentials: 'include',
    });
    
    console.log('Client - Received response, status:', response.status);
    
    // Handle empty responses
    const text = await response.text();
    if (!text) {
      console.error('Client - Empty response received');
      return [];
    }
    
    try {
      // Attempt to parse the response as JSON
      const data = JSON.parse(text);
      console.log('Client - Successfully parsed JSON response');
      
      if (!response.ok) {
        throw new Error(data.message || 'Failed to fetch profiles');
      }
      
      return data.profiles || [];
    } catch (parseError) {
      console.error('Client - JSON parsing error:', parseError);
      console.error('Client - Raw response text:', text);
      throw new Error('Failed to parse server response');
    }
  } catch (error) {
    console.error('Client - Error fetching profiles:', error);
    throw new Error(error instanceof Error ? error.message : 'Failed to fetch profiles');
  }
};

export const addUser = async (
  email: string,
  name: string,
  phone: string,
  role: string
): Promise<{ success: boolean; message: string }> => {
  // First check if the current user is authenticated
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) {
    throw new Error("You must be logged in to perform this action");
  }

  // Get the current user's role from the profiles table
  const { data: userProfile, error: profileError } = await supabase
    .from('profiles')
    .select('role')
    .eq('email', session.user.email as string)
    .single();

  if (profileError) {
    console.error('Error fetching user profile:', profileError);
    throw new Error("Failed to verify user permissions");
  }

  console.log('Current user role from profiles:', userProfile?.role);
  console.log('ADMIN_ROLES:', ADMIN_ROLES);
  console.log('userProfile.role:', userProfile?.role);

  if (!userProfile || !ADMIN_ROLES.includes(userProfile.role as string)) {
    throw new Error("Only administrators can add new users");
  }

  console.log('Adding user:', { email, name, phone, role });
  
  try {
    // Use server action instead of API route
    const result = await createUser({
      email,
      name,
      phone,
      role,
      adminEmail: session.user.email || ''
    });
    
    console.log('Create user response:', result);
    
    if (!result.success) {
      throw new Error(result.message || "Failed to create user");
    }
    
    return result;
  } catch (error) {
    console.error('Error creating user:', error);
    throw error;
  }
};

export const updateUser = async (profile: Profile): Promise<void> => {
  const { error } = await supabase
    .from("profiles")
    .update({
      name: profile.name,
      phone: profile.phone,
      role: profile.role,
    })
    .eq("id", profile.id);

  if (error) throw new Error("Failed to update user: " + error.message);
};

export const deleteUser = async (id: string): Promise<void> => {
  // First check if the current user is authenticated
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) {
    throw new Error("You must be logged in to perform this action");
  }

  // Use server action instead of API route
  try {
    const result = await deleteUserAction({
      userId: id,
      adminEmail: session.user.email || ''
    });
    
    console.log('Delete user response:', result);
    
    if (!result.success) {
      throw new Error(result.message || "Failed to delete user");
    }
    
    return;
  } catch (error) {
    console.error('Error deleting user:', error);
    throw error;
  }
};

export const subscribeToOrders = (callback: (payload: RealtimePostgresChangesPayload<Order>) =>  void) => {
  return supabase 
    .channel('orders')
    .on('postgres_changes', { event: '*', schema: 'public', table:"orders" }, callback)
    .subscribe();
}

export const subscribeToOrderItems = (callback: (payload: RealtimePostgresChangesPayload<OrderItem>) => void) => {
  return supabase
    .channel('order_items')
    .on('postgres_changes' , { event: '*', schema: 'public', table: 'order_items' }, callback)
    .subscribe();
}

export const subscribeToProfiles = (callback: (payload: RealtimePostgresChangesPayload<Profile>) => void) => {
  return supabase
    .channel('profiles')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'profiles' }, callback)
    .subscribe();
}
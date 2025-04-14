import { Order, OrderItem } from "@/types/redux";
import { createClientComponentClient } from '@supabase/auth-helpers-nextjs';
import { UserMetadata } from "@supabase/supabase-js";
import { RealtimePostgresChangesPayload } from "@supabase/supabase-js";

let supabaseInstance: ReturnType<typeof createClientComponentClient> | null = null;

// Client-side Supabase instance
export const getSupabaseClient = () => {
  if (!supabaseInstance) {
    supabaseInstance = createClientComponentClient();
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
  const { data, error } = await supabase
    .from("profiles")
    .select("id, name, email, phone, role")
    .order("name", { ascending: true });

  if (error) throw new Error("Failed to fetch profiles: " + error.message);
  return (data as Profile[]) || [];
};

export const addUser = async (
  email: string,
  name: string,
  phone: string,
  role: string
): Promise<void> => {
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
  const response = await fetch('/api/auth/create-user', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    credentials: 'include',
    body: JSON.stringify({ email, name, phone, role }),
  });

  const data = await response.json();
  
  if (!response.ok) {
    throw new Error(data.message || "Failed to create user");
  }

  return data;
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
  // Move delete operation to server-side API route
  const response = await fetch(`/api/auth/delete-user/${id}`, {
    method: 'DELETE',
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.message);
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
import { createClient, UserMetadata } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const supabaseServiceKey = process.env.NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY!;

export const supabase = createClient(supabaseUrl, supabaseAnonKey);
export const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false
  }
});

// Profile interface
export interface Profile {
  id: string;
  name: string;
  email: string;
  phone: string;
  role: string;
}

// Auth helper functions
export const signUp = async (email: string, password: string, options?: { data?: UserMetadata }) => {
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options,
  });
  if (error) throw new Error(error.message);
  return data;
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
    console.log("name", { ascending: true });

  if (error) throw new Error("Failed to fetch profiles: " + error.message);
  return data || [];
};

export const addUser = async (
  email: string,
  name: string,
  phone: string,
  role: string
): Promise<void> => {
  const tempPassword = "TempPassword123!";
  
  // First check if the email already exists
  const { data: existingUser } = await supabase
    .from("profiles")
    .select("email")
    .eq("email", email)
    .single();

  if (existingUser) {
    throw new Error("A user with this email already exists. Please use a different email address.");
  }

  const { data, error } = await supabase.auth.signUp({
    email,
    password: tempPassword,
    options: {
      data: { name, phone, role, needsPasswordReset: true },
    },
  });
  
  if (error) {
    if (error.message.includes("User already registered")) {
      throw new Error("A user with this email already exists. Please use a different email address.");
    }
    throw new Error(error.message);
  }

  //Insert into profiles table
  const userId = data.user?.id;
  if(!userId) throw new Error("Failed to get user ID after signup");

  const { error: insertError } = await supabase
    .from("profiles")
    .insert({
      id: userId,
      name,
      email,
      phone,
      role,
    });

  if (insertError) {
    if (insertError.message.includes("duplicate key value")) {
      throw new Error("A user with this email already exists. Please use a different email address.");
    }
    throw new Error("Failed to insert profile: " + insertError.message);
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
  // First delete the profile
  const { error: profileError } = await supabase
    .from("profiles")
    .delete()
    .eq("id", id);

  if (profileError) throw new Error("Failed to delete profile: " + profileError.message);

  // Then delete the auth user using the admin client
  const { error: authError } = await supabaseAdmin.auth.admin.deleteUser(id);
  if (authError) throw new Error("Failed to delete user: " + authError.message);
};
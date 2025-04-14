'use server';

import { getSupabaseAdmin } from '@/utils/supabaseServer';

export async function createUser(data: {
  email: string;
  name: string;
  phone: string;
  role: string;
  adminEmail: string;
}) {
  console.log('Server Action - Creating user from admin:', data.adminEmail);

  try {
    const { email, name, phone, role, adminEmail } = data;

    if (!adminEmail) {
      console.log('Server Action - No admin email provided');
      return {
        success: false,
        message: "Unauthorized - Admin email required"
      };
    }

    // Get admin client
    const supabaseAdmin = getSupabaseAdmin();
    
    // Verify admin role with the provided email
    try {
      // First check if the email exists in profiles
      const { data: userProfile, error: profileError } = await supabaseAdmin
        .from('profiles')
        .select('role')
        .eq('email', adminEmail)
        .single();

      if (profileError || !userProfile) {
        console.error('Server Action - Error fetching admin profile:', profileError);
        return {
          success: false,
          message: "Admin user not found"
        };
      }

      const ADMIN_ROLES = ['GlobalAdmin', 'SiteAdmin', 'Manager'];
      if (!ADMIN_ROLES.includes(userProfile.role as string)) {
        console.log('Server Action - User does not have admin role:', userProfile.role);
        return {
          success: false,
          message: "Only administrators can add new users"
        };
      }
      
      console.log('Server Action - Admin verification successful:', userProfile.role);
    } catch (error) {
      console.log('Server Action - Admin verification failed:', error);
      return {
        success: false,
        message: error instanceof Error ? error.message : "Unauthorized"
      };
    }

    console.log('Server Action - Creating user:', { email, name, role });

    const tempPassword = `TempPassword123!`;

    // Step 1: Clean up any existing data
    console.log('Server Action - Starting cleanup process for:', email);

    // First check for any existing profiles with this email
    const { data: existingProfiles, error: profileQueryError } = await supabaseAdmin
      .from('profiles')
      .select('id, email')
      .eq('email', email);

    if (profileQueryError) {
      console.error('Server Action - Error querying existing profiles:', profileQueryError);
    } else {
      console.log('Server Action - Found existing profiles:', existingProfiles);
      
      // Delete any existing profiles first
      if (existingProfiles && existingProfiles.length > 0) {
        for (const profile of existingProfiles) {
          console.log('Server Action - Deleting profile with ID:', profile.id);
          const { error: deleteError } = await supabaseAdmin
            .from('profiles')
            .delete()
            .eq('id', profile.id as string);
          
          if (deleteError) {
            console.error('Server Action - Error deleting profile:', deleteError);
          }
        }
      }
    }

    // Then clean up any existing auth users with this email
    const { data: existingUsers } = await supabaseAdmin.auth.admin.listUsers();
    const existingAuthUsers = existingUsers?.users.filter((u) => u.email === email) || [];

    console.log('Server Action - Found auth users:', existingAuthUsers.length);

    for (const user of existingAuthUsers) {
      console.log('Server Action - Cleaning up auth user:', user.id);
      try {
        await supabaseAdmin.auth.admin.deleteUser(user.id);
      } catch (error) {
        console.error('Server Action - Error deleting auth user:', error);
      }
    }

    // Additional safety check - delete any profiles with matching email
    const { error: finalCleanupError } = await supabaseAdmin
      .from('profiles')
      .delete()
      .eq('email', email);

    if (finalCleanupError) {
      console.error('Server Action - Error in final cleanup:', finalCleanupError);
    }

    // Wait for cleanup to complete
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Step 2: Create new user
    console.log('Server Action - Creating new user after cleanup');
    const { data: userData, error: userError } = await supabaseAdmin.auth.admin.createUser({
      email,
      password: tempPassword,
      email_confirm: true,
      user_metadata: { 
        name, 
        phone, 
        role, 
        needsPasswordReset: true
      }
    });

    if (userError) {
      console.error('Server Action - Error creating user:', userError);
      return {
        success: false,
        message: userError.message
      };
    }

    if (!userData?.user?.id) {
      throw new Error('Failed to get user ID after creation');
    }

    // Double check no profile exists with this ID
    const { data: existingProfile } = await supabaseAdmin
      .from('profiles')
      .select('id')
      .eq('id', userData.user.id)
      .single();

    if (existingProfile) {
      console.log('Server Action - Found existing profile with new user ID, deleting...');
      await supabaseAdmin
        .from('profiles')
        .delete()
        .eq('id', userData.user.id);
    }

    // Step 3: Create profile
    console.log('Server Action - Creating profile with ID:', userData.user.id);
    const { error: profileError } = await supabaseAdmin
      .from("profiles")
      .insert({
        id: userData.user.id,
        name,
        email,
        phone,
        role,
      });

    if (profileError) {
      console.error('Server Action - Error creating profile:', profileError);
      // Cleanup: delete the auth user if profile creation fails
      await supabaseAdmin.auth.admin.deleteUser(userData.user.id);
      
      return {
        success: false,
        message: "Failed to create user profile: " + profileError.message
      };
    }

    // Step 4: Send password reset email
    console.log('Server Action - Sending password reset email');
    const { error: resetError } = await supabaseAdmin.auth.admin.generateLink({
      type: 'recovery',
      email,
      options: {
        redirectTo: `${process.env.NEXT_PUBLIC_SITE_URL}/resetPassword`
      }
    });

    if (resetError) {
      console.error('Server Action - Error sending password reset email:', resetError);
    }

    console.log('Server Action - User created successfully:', email);
    
    return { 
      success: true,
      message: `User created successfully. A password reset email has been sent to ${email}. They can use the temporary password (${tempPassword}) until they reset it.`
    };
  } catch (error) {
    console.error('Server Action - Unexpected error:', error);
    return {
      success: false,
      message: error instanceof Error ? error.message : 'Internal server error'
    };
  }
}

export async function deleteUser(data: {
  userId: string;
  adminEmail: string;
}) {
  console.log('Server Action - Deleting user:', data.userId, 'by admin:', data.adminEmail);

  try {
    const { userId, adminEmail } = data;

    if (!adminEmail) {
      console.log('Server Action - No admin email provided');
      return {
        success: false,
        message: "Unauthorized - Admin email required"
      };
    }

    // Get admin client
    const supabaseAdmin = getSupabaseAdmin();
    
    // Verify admin role with the provided email
    try {
      // First check if the email exists in profiles
      const { data: userProfile, error: profileError } = await supabaseAdmin
        .from('profiles')
        .select('role')
        .eq('email', adminEmail)
        .single();

      if (profileError || !userProfile) {
        console.error('Server Action - Error fetching admin profile:', profileError);
        return {
          success: false,
          message: "Admin user not found"
        };
      }

      const ADMIN_ROLES = ['GlobalAdmin', 'SiteAdmin', 'Manager'];
      if (!ADMIN_ROLES.includes(userProfile.role as string)) {
        console.log('Server Action - User does not have admin role:', userProfile.role);
        return {
          success: false,
          message: "Only administrators can delete users"
        };
      }
      
      console.log('Server Action - Admin verification successful:', userProfile.role);
    } catch (error) {
      console.log('Server Action - Admin verification failed:', error);
      return {
        success: false,
        message: error instanceof Error ? error.message : "Unauthorized"
      };
    }

    // Step 1: Get user details before deletion
    const { data: userData, error: userError } = await supabaseAdmin.auth.admin.getUserById(userId);
    
    if (userError) {
      console.error('Server Action - Error fetching user:', userError);
      return { 
        success: false,
        message: "User not found" 
      };
    }

    // Step 2: Delete from profiles table first
    console.log('Server Action - Deleting profile for user:', userId);
    const { error: profileDeleteError } = await supabaseAdmin
      .from('profiles')
      .delete()
      .eq('id', userId);

    if (profileDeleteError) {
      console.error('Server Action - Error deleting profile:', profileDeleteError);
      // Continue with auth user deletion even if profile deletion fails
    }

    // Additional cleanup - delete any other profiles with the same email
    if (userData?.user?.email) {
      console.log('Server Action - Cleaning up additional profiles for email:', userData.user.email);
      const { error: emailProfileDeleteError } = await supabaseAdmin
        .from('profiles')
        .delete()
        .eq('email', userData.user.email);

      if (emailProfileDeleteError) {
        console.error('Server Action - Error cleaning up additional profiles:', emailProfileDeleteError);
      }
    }

    // Step 3: Delete from auth.users
    console.log('Server Action - Deleting auth user:', userId);
    const { error: deleteError } = await supabaseAdmin.auth.admin.deleteUser(userId);

    if (deleteError) {
      console.error('Server Action - Error deleting auth user:', deleteError);
      return { 
        success: false,
        message: deleteError.message 
      };
    }

    // Final verification
    console.log('Server Action - Verifying deletion');
    const { data: verifyProfile } = await supabaseAdmin
      .from('profiles')
      .select('id')
      .eq('id', userId)
      .single();

    if (verifyProfile) {
      console.warn('Server Action - Profile still exists after deletion, attempting final cleanup');
      await supabaseAdmin
        .from('profiles')
        .delete()
        .eq('id', userId);
    }

    console.log('Server Action - User deleted successfully:', userId);
    return { 
      success: true,
      message: "User deleted successfully"
    };

  } catch (error) {
    console.error('Server Action - Unexpected error:', error);
    return {
      success: false,
      message: error instanceof Error ? error.message : 'Internal server error'
    };
  }
} 
import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/utils/supabaseServer';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// Add OPTIONS method handler to properly respond to preflight requests
export async function OPTIONS() {
  return new NextResponse(null, {
    status: 200,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    },
  });
}

export async function POST(request: Request) {
  console.log('API Route - POST /api/auth/user-creation - Starting');
  console.log('API Route - Request method:', request.method);
  
  try {
    // Parse the request body to get the authorization info
    let requestData;
    try {
      requestData = await request.json();
      console.log('API Route - Parsed request data');
    } catch (parseError) {
      console.error('API Route - Error parsing request JSON:', parseError);
      return NextResponse.json(
        { message: "Invalid request format" },
        { status: 400 }
      );
    }
    
    const { email, name, phone, role, adminEmail } = requestData;
    
    console.log('API Route - Creating user request from admin:', adminEmail);

    if (!adminEmail) {
      console.log('API Route - No admin email provided');
      return NextResponse.json(
        { message: "Unauthorized - Admin email required" },
        { status: 401 }
      );
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
        console.error('API Route - Error fetching admin profile:', profileError);
        return NextResponse.json(
          { message: "Admin user not found" },
          { status: 404 }
        );
      }

      const ADMIN_ROLES = ['GlobalAdmin', 'SiteAdmin', 'Manager'];
      if (!ADMIN_ROLES.includes(userProfile.role as string)) {
        console.log('API Route - User does not have admin role:', userProfile.role);
        return NextResponse.json(
          { message: "Only administrators can add new users" },
          { status: 403 }
        );
      }
      
      console.log('API Route - Admin verification successful:', userProfile.role);
    } catch (error) {
      console.log('API Route - Admin verification failed:', error);
      return NextResponse.json(
        { message: error instanceof Error ? error.message : "Unauthorized" },
        { status: 403 }
      );
    }

    console.log('API Route - Creating user:', { email, name, role });

    const tempPassword = `TempPassword123!`;

    try {
      // Step 1: Clean up any existing data
      console.log('API Route - Starting cleanup process for:', email);

      // First check for any existing profiles with this email
      const { data: existingProfiles, error: profileQueryError } = await supabaseAdmin
        .from('profiles')
        .select('id, email')
        .eq('email', email);

      if (profileQueryError) {
        console.error('API Route - Error querying existing profiles:', profileQueryError);
      } else {
        console.log('API Route - Found existing profiles:', existingProfiles);
        
        // Delete any existing profiles first
        if (existingProfiles && existingProfiles.length > 0) {
          for (const profile of existingProfiles) {
            console.log('API Route - Deleting profile with ID:', profile.id);
            const { error: deleteError } = await supabaseAdmin
              .from('profiles')
              .delete()
              .eq('id', profile.id as string);
            
            if (deleteError) {
              console.error('API Route - Error deleting profile:', deleteError);
            }
          }
        }
      }

      // Then clean up any existing auth users with this email
      const { data: existingUsers } = await supabaseAdmin.auth.admin.listUsers();
      const existingAuthUsers = existingUsers?.users.filter((u) => u.email === email) || [];

      console.log('API Route - Found auth users:', existingAuthUsers.length);

      for (const user of existingAuthUsers) {
        console.log('API Route - Cleaning up auth user:', user.id);
        try {
          await supabaseAdmin.auth.admin.deleteUser(user.id);
        } catch (error) {
          console.error('API Route - Error deleting auth user:', error);
        }
      }

      // Additional safety check - delete any profiles with matching email
      const { error: finalCleanupError } = await supabaseAdmin
        .from('profiles')
        .delete()
        .eq('email', email);

      if (finalCleanupError) {
        console.error('API Route - Error in final cleanup:', finalCleanupError);
      }

      // Wait for cleanup to complete
      await new Promise(resolve => setTimeout(resolve, 2000));

      // Step 2: Create new user
      console.log('API Route - Creating new user after cleanup');
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
        console.error('API Route - Error creating user:', userError);
        return NextResponse.json(
          { message: userError.message },
          { status: 400 }
        );
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
        console.log('API Route - Found existing profile with new user ID, deleting...');
        await supabaseAdmin
          .from('profiles')
          .delete()
          .eq('id', userData.user.id);
      }

      // Step 3: Create profile
      console.log('API Route - Creating profile with ID:', userData.user.id);
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
        console.error('API Route - Error creating profile:', profileError);
        // Cleanup: delete the auth user if profile creation fails
        await supabaseAdmin.auth.admin.deleteUser(userData.user.id);
        
        return NextResponse.json(
          { message: "Failed to create user profile: " + profileError.message },
          { status: 400 }
        );
      }

      // Step 4: Send password reset email
      console.log('API Route - Sending password reset email');
      const { error: resetError } = await supabaseAdmin.auth.admin.generateLink({
        type: 'recovery',
        email,
        options: {
          redirectTo: `${process.env.NEXT_PUBLIC_SITE_URL}/resetPassword`
        }
      });

      if (resetError) {
        console.error('API Route - Error sending password reset email:', resetError);
      }

      console.log('API Route - User created successfully:', email);
      
      return NextResponse.json({ 
        success: true,
        message: `User created successfully. A password reset email has been sent to ${email}. They can use the temporary password (${tempPassword}) until they reset it.`
      });

    } catch (error) {
      console.error('API Route - Error in user creation process:', error);
      return NextResponse.json(
        { message: error instanceof Error ? error.message : 'Failed to create user' },
        { status: 500 }
      );
    }
  } catch (error) {
    console.error('API Route - Unexpected error:', error);
    return NextResponse.json(
      { message: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    );
  }
} 
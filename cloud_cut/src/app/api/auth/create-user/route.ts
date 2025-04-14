import { NextResponse } from 'next/server';
import { getSupabaseServerClient, getSupabaseAdmin, verifyAdminRole } from '@/utils/supabaseServer';

export async function POST(request: Request) {
  try {
    console.log('API Route - Starting create-user request');
    
    // Get the server-side Supabase client with API route flag
    const supabase = getSupabaseServerClient(true);

    // Get the session
    const { data: { session }, error: sessionError } = await supabase.auth.getSession();
    
    console.log('API Route - Session check:', {
      hasSession: !!session,
      sessionError: sessionError?.message
    });

    if (!session || !session.user?.email) {
      console.log('API Route - No session or email found');
      return NextResponse.json(
        { message: "Unauthorized - Please log in" },
        { status: 401 }
      );
    }

    console.log('API Route - User email:', session.user.email);

    // Verify admin role with API route flag
    try {
      await verifyAdminRole(session.user.email, true);
    } catch (error) {
      console.log('API Route - Admin verification failed:', error);
      return NextResponse.json(
        { message: error instanceof Error ? error.message : "Unauthorized" },
        { status: 403 }
      );
    }

    const { email, name, phone, role } = await request.json();
    console.log('API Route - Creating user:', { email, name, role });

    const tempPassword = `TempPassword123!`;

    // Get admin client
    const supabaseAdmin = getSupabaseAdmin();

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
              .eq('id', profile.id);
            
            if (deleteError) {
              console.error('API Route - Error deleting profile:', deleteError);
            }
          }
        }
      }

      // Then clean up any existing auth users with this email
      const { data: existingUsers } = await supabaseAdmin.auth.admin.listUsers();
      const existingAuthUsers = existingUsers?.users.filter(u => u.email === email) || [];

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
        email_confirm: true, // Set to true since we'll send a custom email
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

      // Double check no profile exists with this ID DON'T DELETE THIS
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
        // Log the full error for debugging
        console.error('Reset email error details:', resetError);
      }

      console.log('API Route - User created successfully:', email);
      console.log('API Route - Temporary password:', tempPassword);
      
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
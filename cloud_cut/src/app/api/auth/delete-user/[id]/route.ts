import { NextResponse } from 'next/server';
import { getSupabaseServerClient, getSupabaseAdmin, verifyAdminRole } from '@/utils/supabaseServer';
import { cookies } from 'next/headers';

export async function DELETE(
  request: Request,
  { params }: { params: { id: string } }
) {
  try {
    console.log('API Route - Starting delete-user request');
    
    // Get the server-side Supabase client with API route flag
    const cookieStore = cookies();
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

    const userId = params.id;
    if (!userId) {
      return NextResponse.json(
        { message: "User ID is required" },
        { status: 400 }
      );
    }

    console.log('API Route - Deleting user:', userId);

    // Get admin client
    const supabaseAdmin = getSupabaseAdmin();

    try {
      // Step 1: Get user details before deletion
      const { data: userData, error: userError } = await supabaseAdmin.auth.admin.getUserById(userId);
      
      if (userError) {
        console.error('API Route - Error fetching user:', userError);
        return NextResponse.json(
          { message: "User not found" },
          { status: 404 }
        );
      }

      // Step 2: Delete from profiles table first
      console.log('API Route - Deleting profile for user:', userId);
      const { error: profileDeleteError } = await supabaseAdmin
        .from('profiles')
        .delete()
        .eq('id', userId);

      if (profileDeleteError) {
        console.error('API Route - Error deleting profile:', profileDeleteError);
        // Continue with auth user deletion even if profile deletion fails
      }

      // Additional cleanup - delete any other profiles with the same email
      if (userData?.user?.email) {
        console.log('API Route - Cleaning up additional profiles for email:', userData.user.email);
        const { error: emailProfileDeleteError } = await supabaseAdmin
          .from('profiles')
          .delete()
          .eq('email', userData.user.email);

        if (emailProfileDeleteError) {
          console.error('API Route - Error cleaning up additional profiles:', emailProfileDeleteError);
        }
      }

      // Step 3: Delete from auth.users
      console.log('API Route - Deleting auth user:', userId);
      const { error: deleteError } = await supabaseAdmin.auth.admin.deleteUser(userId);

      if (deleteError) {
        console.error('API Route - Error deleting auth user:', deleteError);
        return NextResponse.json(
          { message: deleteError.message },
          { status: 400 }
        );
      }

      // Final verification
      console.log('API Route - Verifying deletion');
      const { data: verifyProfile } = await supabaseAdmin
        .from('profiles')
        .select('id')
        .eq('id', userId)
        .single();

      if (verifyProfile) {
        console.warn('API Route - Profile still exists after deletion, attempting final cleanup');
        await supabaseAdmin
          .from('profiles')
          .delete()
          .eq('id', userId);
      }

      console.log('API Route - User deleted successfully:', userId);
      return NextResponse.json({ 
        success: true,
        message: "User deleted successfully"
      });

    } catch (error) {
      console.error('API Route - Error in deletion process:', error);
      return NextResponse.json(
        { message: error instanceof Error ? error.message : 'Failed to delete user' },
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
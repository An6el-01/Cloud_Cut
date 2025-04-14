import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/utils/supabaseServer';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  try {
    console.log('API Route - Starting signup request');

    const { email, password, options } = await request.json();
    console.log('API Route - Signup attempt for:', email);

    // Get admin client
    const supabaseAdmin = getSupabaseAdmin();

    // Create the user
    const { data: userData, error: signUpError } = await supabaseAdmin.auth.admin.createUser({
      email,
      password,
      email_confirm: true, // Auto-confirm email for now
      user_metadata: options?.data || {}
    });

    if (signUpError) {
      console.error('API Route - Signup error:', signUpError);
      return NextResponse.json(
        { message: signUpError.message },
        { status: 400 }
      );
    }

    // Create initial profile
    const { error: profileError } = await supabaseAdmin
      .from('profiles')
      .insert({
        id: userData.user.id,
        email: userData.user.email,
        name: options?.data?.name || '',
        phone: options?.data?.phone || '',
        role: 'User' // Default role
      });

    if (profileError) {
      console.error('API Route - Profile creation error:', profileError);
      // Cleanup: delete the auth user if profile creation fails
      await supabaseAdmin.auth.admin.deleteUser(userData.user.id);
      return NextResponse.json(
        { message: "Failed to create user profile" },
        { status: 400 }
      );
    }

    console.log('API Route - User signed up successfully:', email);
    return NextResponse.json({
      success: true,
      message: "User created successfully",
      user: userData.user
    });
  } catch (error) {
    console.error('API Route - Unexpected error:', error);
    return NextResponse.json(
      { message: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    );
  }
} 
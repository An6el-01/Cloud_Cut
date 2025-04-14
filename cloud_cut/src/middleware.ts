import { createMiddlewareClient } from '@supabase/auth-helpers-nextjs';
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

// Define allowed admin roles
const ADMIN_ROLES = ['GlobalAdmin', 'SiteAdmin', 'Manager'];

export async function middleware(req: NextRequest) {
  console.log('Middleware - Request path:', req.nextUrl.pathname);
  
  // Create a response early so we can modify headers
  const res = NextResponse.next();

  // Create a new supabase client for each request
  const supabase = createMiddlewareClient({ req, res });

  try {
    // Refresh session if expired - required for Server Components
    const { data: { session }, error } = await supabase.auth.getSession();
    
    console.log('Middleware - Session check:', {
      hasSession: !!session,
      error: error?.message
    });

    // Protect API routes
    if (req.nextUrl.pathname.startsWith('/api/auth/')) {
      console.log('Middleware - Protecting API route');
      
      if (!session) {
        console.log('Middleware - No session found for API route');
        return NextResponse.json(
          { message: 'Unauthorized' },
          { status: 401 }
        );
      }

      // For sensitive operations, check if user has admin role
      if (req.nextUrl.pathname.includes('/create-user') ||
          req.nextUrl.pathname.includes('/delete-user')) {
        console.log('Middleware - Checking admin role for:', session.user.email);
        
        // Get user's role from profiles table
        const { data: userProfile, error: profileError } = await supabase
          .from('profiles')
          .select('role')
          .eq('email', session.user.email)
          .single();

        if (profileError) {
          console.log('Middleware - Error fetching profile:', profileError.message);
          return NextResponse.json(
            { message: 'Error verifying permissions' },
            { status: 500 }
          );
        }

        console.log('Middleware - User profile:', userProfile);

        if (!userProfile || !ADMIN_ROLES.includes(userProfile.role)) {
          console.log('Middleware - User not authorized:', userProfile?.role);
          return NextResponse.json(
            { message: 'Forbidden - Admin access required' },
            { status: 403 }
          );
        }
        console.log('Middleware - Admin access granted');
      }
    }

    // If there's no session and the user is trying to access a protected route
    if (!session && !req.nextUrl.pathname.startsWith('/')) {
      console.log('Middleware - Redirecting to login');
      // Redirect to the login page
      return NextResponse.redirect(new URL('/', req.url));
    }

    // If there's a session and the user is trying to access the login page
    if (session && req.nextUrl.pathname === '/') {
      console.log('Middleware - Redirecting to manufacturing');
      // Redirect to the manufacturing page
      return NextResponse.redirect(new URL('/manufacturing', req.url));
    }

    return res;
  } catch (error) {
    console.error('Middleware - Error:', error);
    return NextResponse.json(
      { message: 'Internal server error' },
      { status: 500 }
    );
  }
}

// Update matcher to handle all routes including API routes
export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico).*)',
  ],
}; 
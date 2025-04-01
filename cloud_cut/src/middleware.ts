import { createMiddlewareClient } from '@supabase/auth-helpers-nextjs';
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

export async function middleware(req: NextRequest) {
  const res = NextResponse.next();
  const supabase = createMiddlewareClient({ req, res });

  // Check if we have a session
  const {
    data: { session },
  } = await supabase.auth.getSession();

  // If there's no session and the user is trying to access a protected route
  if (!session && !req.nextUrl.pathname.startsWith('/')) {
    // Redirect to the login page
    return NextResponse.redirect(new URL('/', req.url));
  }

  // If there's a session and the user is trying to access the login page
  if (session && req.nextUrl.pathname === '/') {
    // Redirect to the manufacturing page
    return NextResponse.redirect(new URL('/manufacturing', req.url));
  }

  return res;
}

// Specify which routes should be protected
export const config = {
  matcher: ['/((?!api|_next/static|_next/image|favicon.ico).*)'],
}; 
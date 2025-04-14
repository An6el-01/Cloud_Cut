import { createServerClient } from '@supabase/ssr';
import { createClient } from '@supabase/supabase-js';
import { cookies } from 'next/headers';
import { CookieOptions } from '@supabase/ssr';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const supabaseServerInstance = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
        cookies: {
            get(name: string) {
                return cookies().get(name)?.value;
            },
            set(name: string, value: string, options: CookieOptions) {
                cookies().set(name, value, options);
            },
            remove(name: string, options: CookieOptions) {
                cookies().set(name, '', { ...options, maxAge: 0 });
            },
        },
    }
);

let supabaseAdminInstance: ReturnType<typeof createClient> | null = null;

export function getSupabaseServerClient() {
    return supabaseServerInstance;
}

export function getSupabaseRouteHandlerClient() {
    return createServerClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
        {
            cookies: {
                get(name: string) {
                    return cookies().get(name)?.value;
                },
                set(name: string, value: string, options: CookieOptions) {
                    cookies().set(name, value, options);
                },
                remove(name: string, options: CookieOptions) {
                    cookies().set(name, '', { ...options, maxAge: 0 });
                },
            },
        }
    );
}

export const getSupabaseAdmin = () => {
    if (!supabaseAdminInstance) {
        supabaseAdminInstance = createClient(supabaseUrl, supabaseServiceKey, {
            auth: {
                autoRefreshToken: false,
                persistSession: false
            }
        });
    }
    return supabaseAdminInstance;
};

// Define allowed admin roles
export const ADMIN_ROLES = ['GlobalAdmin', 'SiteAdmin', 'Manager'];

// Helper function to verify admin role
export const verifyAdminRole = async (email: string) => {
    const supabase = getSupabaseServerClient();
    
    const { data: userProfile, error: profileError } = await supabase
        .from('profiles')
        .select('role')
        .eq('email', email)
        .single();

    if (profileError) {
        console.error('Error fetching user profile:', profileError);
        throw new Error("Failed to verify user permissions");
    }

    if (!userProfile || !ADMIN_ROLES.includes(userProfile.role)) {
        throw new Error("Only administrators can perform this action");
    }

    return userProfile;
}; 
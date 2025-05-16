"use client";

import { useEffect, useState } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { useSelector } from 'react-redux';
import { checkAuth } from '@/utils/supabase';

interface RootState {
  auth: {
    user: any;
    userProfile: {
      role: string;
      email: string;
    } | null;
  };
}

interface RouteProtectionProps {
  children: React.ReactNode;
}

const RouteProtection: React.FC<RouteProtectionProps> = ({ children }) => {
  const router = useRouter();
  const pathname = usePathname();
  const userProfile = useSelector((state: RootState) => state.auth.userProfile);
  const user = useSelector((state: RootState) => state.auth.user);
  const [isAuthorized, setIsAuthorized] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  console.log('RouteProtection - Current path:', pathname);
  console.log('RouteProtection - User profile:', userProfile);

  useEffect(() => {
    const checkUserAccess = async () => {
      try {
        // Skip protection for login, reset password and API routes
        if (
          pathname === '/' || 
          pathname === '/resetPassword' || 
          pathname?.startsWith('/api/')
        ) {
          setIsAuthorized(true);
          setIsLoading(false);
          return;
        }

        // Check if user is authenticated
        const isAuthenticated = await checkAuth();
        if (!isAuthenticated || !user) {
          console.log('RouteProtection - User not authenticated, redirecting to login');
          router.push('/');
          return;
        }

        // Check if userProfile exists
        if (!userProfile) {
          console.log('RouteProtection - No user profile found, redirecting to login');
          router.push('/');
          return;
        }

        console.log(`RouteProtection - User role: ${userProfile.role}, Path: ${pathname}`);

        // Check authorization for Packer role
        if (userProfile.role === 'Packer') {
          // Packers can only access /packing and /profile
          if (pathname === '/packing' || pathname === '/profile') {
            console.log('RouteProtection - Packer accessing allowed page');
            setIsAuthorized(true);
          } else {
            console.log('RouteProtection - Packer trying to access restricted page, redirecting to /packing');
            router.push('/packing');
            return;
          }
        } else {
          // All other roles have full access
          console.log('RouteProtection - Non-Packer role, full access granted');
          setIsAuthorized(true);
        }

        setIsLoading(false);
      } catch (error) {
        console.error('RouteProtection - Error checking access:', error);
        setIsLoading(false);
        router.push('/');
      }
    };

    checkUserAccess();
  }, [pathname, userProfile, user, router]);

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-pulse text-white">Loading...</div>
      </div>
    );
  }

  return isAuthorized ? <>{children}</> : null;
};

export default RouteProtection; 
"use client";

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useSelector } from 'react-redux';
import { getAccessPermissions, UserAccess } from '@/utils/accessControl';

interface RootState {
  auth: {
    userProfile: {
      role: string;
      email: string;
    } | null;
    selectedStation: string | null;
  };
}

interface RouteProtectionProps {
  children: React.ReactNode;
  requiredPermission: keyof ReturnType<typeof getAccessPermissions>;
  fallbackPath?: string;
}

export default function RouteProtection({ 
  children, 
  requiredPermission, 
  fallbackPath 
}: RouteProtectionProps) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);

  const router = useRouter();
  const userProfile = useSelector((state: RootState) => state.auth.userProfile);
  const selectedStation = useSelector((state: RootState) => state.auth.selectedStation);

  useEffect(() => {
    if (userProfile) {
      const userAccess: UserAccess = {
        role: userProfile.role,
        selectedStation: selectedStation
      };
      
      const accessPermissions = getAccessPermissions(userAccess);
      
      if (!accessPermissions[requiredPermission]) {
        console.log(`Access denied to ${requiredPermission}`);
        
        // Redirect to appropriate fallback page
        if (fallbackPath) {
          router.push(fallbackPath);
        } else {
          // Default fallback based on available permissions
          if (accessPermissions.canAccessManufacturing) {
            router.push('/manufacturing');
          } else if (accessPermissions.canAccessPacking) {
            router.push('/packing');
          } else {
            router.push('/profile');
          }
        }
      }
    }
  }, [userProfile, selectedStation, requiredPermission, fallbackPath, router]);

  // Prevent hydration mismatch: don't render until mounted on client
  if (!mounted) return null;

  // Don't render children if user doesn't have access
  if (!userProfile) {
    return null; // or a loading spinner
  }

  const userAccess: UserAccess = {
    role: userProfile.role,
    selectedStation: selectedStation
  };
  
  const accessPermissions = getAccessPermissions(userAccess);
  
  if (!accessPermissions[requiredPermission]) {
    return null; // or an access denied message
  }

  return <>{children}</>;
} 
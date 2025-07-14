"use client";

import Link from 'next/link';
import Image from 'next/image';
import { usePathname, useRouter } from 'next/navigation';
import { useSelector } from 'react-redux';
import { useEffect, useState } from 'react';
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

const Navbar = () => {
  const pathname = usePathname();
  const router = useRouter();
  const userProfile = useSelector((state: RootState) => state.auth.userProfile);
  const selectedStation = useSelector((state: RootState) => state.auth.selectedStation);
  const [isClient, setIsClient] = useState(false);

  useEffect(() => {
    setIsClient(true);
  }, []);
  
  const getPageTitle = () => {
    if (!pathname) return 'Home';
    if (pathname === '/') return 'Home';
    return pathname.slice(1).charAt(0).toUpperCase() + pathname.slice(2);
  };

  // Get access permissions based on role and selected station
  const userAccess: UserAccess = {
    role: userProfile?.role || '',
    selectedStation: selectedStation
  };
  
  const accessPermissions = getAccessPermissions(userAccess);

  // Redirect if user tries to access unauthorized routes
  useEffect(() => {
    if (userProfile && pathname && !pathname.startsWith('/api/')) {
      const currentPage = pathname.slice(1); // Remove leading slash
      
      // Check if user can access the current page
      const canAccess = (() => {
        switch (currentPage) {
          case 'manufacturing':
            return accessPermissions.canAccessManufacturing;
          case 'packing':
            return accessPermissions.canAccessPacking;
          case 'picking':
            return accessPermissions.canAccessPicking;
          case 'stock':
            return accessPermissions.canAccessStock;
          case 'team':
            return accessPermissions.canAccessTeam;
          case 'admin':
            return accessPermissions.canAccessAdmin;
          case 'analytics':
            return accessPermissions.canAccessAnalytics;
          case 'inserts':
            return accessPermissions.canAccessAdmin; // Anyone with admin access can access inserts
          case 'profile':
          case 'resetPassword':
          case '':
            return true; // Always allow access to profile and home
          default:
            return false;
        }
      })();

      if (!canAccess) {
        console.log('NavBar - Redirecting user from unauthorized path:', pathname);
        // Redirect to appropriate default page
        if (accessPermissions.canAccessManufacturing) {
          router.push('/manufacturing');
        } else if (accessPermissions.canAccessPacking) {
          router.push('/packing');
        } else {
          router.push('/profile');
        }
      }
    }
  }, [userProfile, accessPermissions, pathname, router]);

  return (
    <nav className="shadow-md fixed w-full p-5 z-50 bg-black">
      <div className="max-w-78l mx-auto px-4 sm:px-6 lg:px-8 ">
        <div className="flex justify-between h-16 ">
          {/* Logo and Brand */}
          <div className="flex items-center">
            <Link href={isClient ? (accessPermissions.canAccessManufacturing ? "/manufacturing" : "/packing") : "/manufacturing"} className="flex items-center">
              <Image
                src="/sfLogo.png"
                alt="Shadow Foam Logo"
                width={800}
                height={20}
                className="h-10 w-auto"
                priority
              />
              <span className="ml-5 text-2xl font-semibold text-white">
                {getPageTitle()}
              </span>
            </Link>
          </div>

          {/* Navigation Links - only render after hydration to prevent mismatch */}
          {isClient && (
            <div className="flex items-center space-x-4">

              {/* Manufacturing link */}
              {accessPermissions.canAccessManufacturing && (
                <Link
                  href="/manufacturing"
                  className="text-white relative px-3 py-2 rounded-md text-md font-medium group"
                >
                  Manufacturing
                </Link>
              )}

              {/* Packing link */}
              {accessPermissions.canAccessPacking && (
                <Link
                  href="/packing"
                  className="text-white relative px-3 py-2 rounded-md text-md font-medium group"
                >
                  Packing
                </Link>
              )}

              {/* Picking link */}
              {accessPermissions.canAccessPicking && (
                <Link
                  href="/picking"
                  className="text-white relative px-3 py-2 rounded-md text-md font-medium group"
                >
                  Picking
                </Link>
              )}

              {/* Team link */}
              {accessPermissions.canAccessTeam && (
                <Link
                  href="/team"
                  className="text-white relative px-3 py-2 rounded-md text-md font-medium group"  
                >
                  My Team
                </Link>
              )}

              {/* Stock link */}
              {accessPermissions.canAccessStock && (
                <Link
                  href="/stock"
                  className="text-white relative px-3 py-2 rounded-md text-md font-medium group"
                >
                  Stock
                </Link>
              )}

              {/* Admin link */}
              {accessPermissions.canAccessAdmin && (
                <Link
                  href="/admin"
                  className="text-white relative px-3 py-2 rounded-md text-md font-medium group"
                >
                  Admin
                </Link>
              )}
              
              {/* Profile Section - always available */}
              <div className="relative">
                <Link href="/profile" className="flex flex-col items-center">
                  <div className="w-16 h-16 relative overflow-hidden rounded-full bg-white p-1 flex items-center justify-center">
                    <Image
                      src="/profile.png"
                      alt="Profile"
                      width={80}
                      height={80}
                      className="object-contain"
                    />
                  </div>
                </Link>
              </div>
            </div>
          )}
        </div>
      </div>
    </nav>
  );
};

export default Navbar; 
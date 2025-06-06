"use client";

import Link from 'next/link';
import Image from 'next/image';
import { usePathname, useRouter } from 'next/navigation';
import { useSelector } from 'react-redux';
import { useEffect, useState } from 'react';

interface RootState {
  auth: {
    userProfile: {
      role: string;
      email: string;
    } | null;
  };
}

const Navbar = () => {
  const pathname = usePathname();
  const router = useRouter();
  const userProfile = useSelector((state: RootState) => state.auth.userProfile);
  const [isClient, setIsClient] = useState(false);

  useEffect(() => {
    setIsClient(true);
  }, []);
  
  const getPageTitle = () => {
    if (!pathname) return 'Home';
    if (pathname === '/') return 'Home';
    return pathname.slice(1).charAt(0).toUpperCase() + pathname.slice(2);
  };

  const isPackerRole = userProfile?.role === 'Packer';

  // Redirect if a Packer tries to access unauthorized routes directly
  useEffect(() => {
    if (isPackerRole && pathname && 
        pathname !== '/packing' && 
        pathname !== '/profile' && 
        pathname !== '/' && 
        pathname !== '/resetPassword' && 
        pathname !== '/stock' &&
        !pathname.startsWith('/api/')) {
      console.log('NavBar - Redirecting Packer from unauthorized path:', pathname);
      router.push('/packing');
    }
  }, [isPackerRole, pathname, router]);

  return (
    <nav className="shadow-md fixed w-full p-5 z-50 bg-black">
      <div className="max-w-78l mx-auto px-4 sm:px-6 lg:px-8 ">
        <div className="flex justify-between h-16 ">
          {/* Logo and Brand */}
          <div className="flex items-center">
            <Link href={isPackerRole ? "/packing" : "/manufacturing"} className="flex items-center">
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

          {/* Navigation Links */}
          <div className="flex items-center space-x-4">
            {!isPackerRole && (
              <Link
                href="/manufacturing"
                className="text-white relative px-3 py-2 rounded-md text-md font-medium group"
              >
                Manufacturing
              </Link>
            )}

            {/* Packing link is available to all users */}
            <Link
              href="/packing"
              className="text-white relative px-3 py-2 rounded-md text-md font-medium group"
            >
              Packing
            </Link>

            {!isPackerRole && (
              <Link
                href="/team"
                className="text-white relative px-3 py-2 rounded-md text-md font-medium group"  
              >
                My Team
              </Link>
            )}
            {!isPackerRole && (
              <Link
                href="/stock"
                className="text-white relative px-3 py-2 rounded-md text-md font-medium group"
              >
                Stock
              </Link>
            )}

            {!isPackerRole && (
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
        </div>
      </div>
    </nav>
  );
};

export default Navbar; 
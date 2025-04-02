"use client";

import Link from 'next/link';
import Image from 'next/image';
import { usePathname } from 'next/navigation';

const Navbar = () => {
  const pathname = usePathname();
  
  const getPageTitle = () => {
    if (!pathname) return 'Home';
    if (pathname === '/') return 'Home';
    return pathname.slice(1).charAt(0).toUpperCase() + pathname.slice(2);
  };

  return (
    <nav className="shadow-md fixed w-full top-10 z-50">
      <div className="max-w-78l mx-auto px-4 sm:px-6 lg:px-8 ">
        <div className="flex justify-between h-16 ">
          {/* Logo and Brand */}
          <div className="flex items-center">
            <Link href="/manufacturing" className="flex items-center">
              <Image
                src="/sfLogo.png"
                alt="Shadow Foam Logo"
                width={800}
                height={20}
                className="h-10 w-auto"
                priority
              />
              <span className="ml-5 text-xxl font-semibold text-white">
                {getPageTitle()}
              </span>
            </Link>
          </div>

          {/* Navigation Links */}
          <div className="flex items-center space-x-4">
            <Link
              href="/manufacturing"
              className="text-white relative px-3 py-2 rounded-md text-md font-medium group"
            >
              Manufacturing
            </Link>

            <Link
              href="/team"
              className="text-white relative px-3 py-2 rounded-md text-md font-medium group"  
            >
              My Team
            </Link>
            <Link
              href="/admin"
              className="text-white relative px-3 py-2 rounded-md text-md font-medium group"
            >
              Admin
            </Link>
            
            {/* Profile Section */}
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
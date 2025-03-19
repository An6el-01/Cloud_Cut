"use client";

import Link from 'next/link';
import Image from 'next/image';
import { usePathname } from 'next/navigation';

const Navbar = () => {
  const pathname = usePathname();
  
  /**
   * Gets the Page title the user is currently in.
   * 
  */
  const getPageTitle = () => {
    if (pathname === '/') return 'Home';
    // Remove leading slash and capitalize first letter
    return pathname.slice(1).charAt(0).toUpperCase() + pathname.slice(2);
  };

  return (
    <nav className="shadow-md fixed w-full top-10 z-50">
      <div className="max-w-78l mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between h-16">
          {/* Logo and Brand */}
          <div className="flex items-center">
            <Link href="/manufacturing" className="flex items-center">
              <Image
                src="/sfLogo.png"
                alt="Shadow Foam Shield"
                width={200}
                height={60}
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
            
            {/* Profile Section */}
            <div className="relative group">
              <Link href="/profile" className="flex flex-col items-center cursor-pointer">
                <div className="w-16 h-16 relative overflow-hidden rounded-full bg-white p-1 transition-all duration-500 group-hover:bg-gradient-to-br from-black via-red-600 to-black flex items-center justify-center">
                  <div className="absolute inset-0 bg-white transition-opacity duration-500 group-hover:opacity-0" />
                  <Image
                    src="/profile.png"
                    alt="Profile"
                    width={80}
                    height={80}
                    className="object-contain transition-all duration-500 group-hover:scale-110 group-hover:rotate-3 group-hover:brightness-0 group-hover:invert relative z-10"
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
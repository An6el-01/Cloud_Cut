"use client";

import Image from "next/image";
import { useState, useEffect, useRef } from 'react';
import { useRouter } from "next/navigation";
import { signIn, getCurrentUser, checkAuth } from '@/utils/supabase';
import { useDispatch } from 'react-redux';
import { setUser, setUserProfile, setSelectedStation as setReduxSelectedStation } from '@/redux/slices/authSlice';
import { getSupabaseClient } from '@/utils/supabase';
import { syncOrders } from '@/redux/thunks/ordersThunks';
import { store } from '@/redux/store';
import { createPortal } from "react-dom";

interface Profile {
  role: string;
  email: string;
}

export default function Home() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [mounted, setMounted] = useState(false);
  const router = useRouter();
  const dispatch = useDispatch();
  const buttonRef = useRef<HTMLButtonElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [selectedStation, setSelectedStation] = useState('');
  
  const [dropdownStyle, setDropdownStyle] = useState({
    top: 0,
    left: 0,
    width: 0
  });

  // Update dropdown position when opened
  useEffect(() => {
    if (isOpen && buttonRef.current) {
      const rect = buttonRef.current.getBoundingClientRect();
      setDropdownStyle({
        top: rect.bottom + window.scrollY,
        left: rect.left + window.scrollX,
        width: rect.width
      });
    }
  }, [isOpen])

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node) &&
          buttonRef.current && !buttonRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [isOpen])
  // Handle client-side mounting
  useEffect(() => {
    setMounted(true);
  }, []);

  // Function to redirect based on user role and selected station
  const redirectBasedOnRole = (role: string) => {
    console.log('Redirecting based on role:', role, 'and station:', selectedStation);
    
    // If a specific station is selected, override role-based routing
    if (selectedStation === 'CNC') {
      router.push("/manufacturing");
      return;
    }
    
    if (selectedStation === 'Packing') {
      router.push("/packing");
      return;
    }
    
    // If station is 'none' or not selected, use role-based routing
    if (role === 'Packer') {
      router.push("/packing");
    } else {
      router.push("/manufacturing");
    }
  };

  // Check if already authenticated on mount
  useEffect(() => {
    const checkSession = async () => {
      try {
        const isAuthenticated = await checkAuth();
        if(isAuthenticated) {
          const user = await getCurrentUser();
          if (!user) return;
          
          if (user.user_metadata.needsPasswordReset){
            router.push("/resetPassword")
          } else {
            // Get user profile from profiles table
            const supabase = getSupabaseClient();
            const { data: profile } = await supabase
              .from('profiles')
              .select('*')
              .eq('email', user.email || '')
              .single();

            if (profile) {
              dispatch(setUser(user));
              dispatch(setUserProfile({
                role: profile.role as string,
                email: profile.email as string
              }));
              
              // Redirect based on user role
              redirectBasedOnRole(profile.role as string);
            }
          }
        }
      } catch (error) {
        console.error('Auth check failed:', error);
      }
    };
    checkSession();
  }, [router, dispatch]);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    // Validate that a station is selected
    if (!selectedStation || selectedStation === '') {
      setError('Please select a station before logging in');
      return;
    }

    setLoading(true);

    try {
      const { user } = await signIn(email, password);
      if (!user) return;
      
      if (user.user_metadata.needsPasswordReset) {
        router.push("/resetPassword");
      } else {
        // Get user profile from profiles table
        const supabase = getSupabaseClient();
        const { data: profile, error: profileError } = await supabase
          .from('profiles')
          .select('*')
          .eq('email', user.email || '')
          .single();

        if (profileError) {
          console.error('Error fetching user profile:', profileError);
          setError('Error fetching user profile');
          return;
        }

        if (profile) {
          // Set both user and profile in Redux
          dispatch(setUser(user));
          dispatch(setUserProfile({
            role: profile.role as string,
            email: profile.email as string
          }));
          dispatch(setReduxSelectedStation(selectedStation || null));
          
          // Store in localStorage for persistence
          localStorage.setItem('authState', JSON.stringify({
            user,
            userProfile: {
              role: profile.role,
              email: profile.email
            },
            selectedStation: selectedStation
          }));
          
          // Trigger sync on login
          store.dispatch(syncOrders());
          
          // Redirect based on user role
          redirectBasedOnRole(profile.role as string);
        }
      }
    } catch (error: unknown) {
      setError(error instanceof Error ? error.message : "An error occurred during sign-in");
    } finally {
      setLoading(false);
    }
  };

  // Don't render the form until after client-side hydration
  if (!mounted) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-pulse text-white">Loading...</div>
      </div>
    );
  };

  const toggleDropdown = () => {
    setIsOpen(prev => !prev);
  };

  const handleOptionClick = (station: string) => {
    setIsOpen(false);
    setSelectedStation(station);
  }
  

  return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="bg-white/90 p-6 rounded-lg shadow-lg w-full max-w-md backdrop-blur-sm">
        <div className="flex justify-center mb-4">
          <Image
            src="/sfShield.png"
            alt="Shadow Foam Shield"
            width={50}
            height={50}
            priority
          />
        </div>
        <h2 className="text-center text-2xl font-bold mb-4 text-black">Welcome!</h2>
        <p className="text-center text-gray-600 mb-6">Please enter your details below</p>

        <form onSubmit={onSubmit} className="space-y-4">
          {/* Email Input */}
          <div>
            <label htmlFor="email" className="block text-sm font-medium text-black">
              Email:
            </label>
            <input
              type="email"
              id="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="mt-1 block w-full p-3 border border-gray-800 rounded-lg focus:ring focus:ring-blue-200 bg-white text-black"
              placeholder="Enter your email"
              required
              disabled={loading}
            />
          </div>
          {/* Password Input */}
          <div>
            <label htmlFor="password" className="block text-sm font-medium text-black">
              Password:
            </label>
            <input
              type="password"
              id="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="mt-1 block w-full p-2 border border-gray-800 rounded-md focus:ring focus:ring-blue-200 bg-white text-black"
              placeholder="Enter your password"
              required
              disabled={loading}
            />
          </div>
          {/*Station Dropdown */}
          <div>
            <label htmlFor="station-select" className="block text-sm font-medium text-black mb-1">
              Station: <span className="text-red-500">*</span>
            </label>
            {/**Button trigger */}
            <button
              ref={buttonRef}
              type="button"
              className={`inline-flex justify-between items-center w-full rounded-md border shadow-sm px-4 py-2 bg-white text-sm font-medium text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-1 focus:ring-blue-500 ${
                !selectedStation || selectedStation === '' ? 'border-red-300' : 'border-gray-300'
              }`}
              id="station-select"
              aria-expanded={isOpen}
              aria-haspopup="true"
              onClick={toggleDropdown}
            >
              {selectedStation === '' ? 'Select Station' : selectedStation === 'none' ? 'None' : selectedStation}
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" className="ml-2 -mr-1 h-5 w-5 text-gray-400" aria-hidden="true">
                <path d="M6 9l6 6 6-6"/>
              </svg>
            </button>

            {/**Dropdown Menu Portal */}
            {isOpen && typeof document !== 'undefined' && createPortal(
              <div
                ref={dropdownRef}
                className="origin-top-right absolute mt-2 rounded-md shadow-lg bg-white ring-1 ring-black ring-opacity-5 focus:outline-none"
                role="menu"
                aria-orientation="vertical"
                aria-labelledby="select-station-button"
                tabIndex={-1}
                style={{
                  top: dropdownStyle.top,
                  left: dropdownStyle.left,
                  width: dropdownStyle.width,
                  zIndex: 9999,
                  position: 'absolute'
                }}
              >
                <div className="py-1" role="none">
                  <button
                    className={`${selectedStation === 'CNC' ? 'bg-gray-100 text-gray-900' : 'text-gray-700'} flex justify-between items-center w-full px-4 py-2 text-sm hover:bg-gray-100`}
                    role="menuitem"
                    tabIndex={-1}
                    onClick={() => handleOptionClick('CNC')}
                  >
                    CNC
                  </button>
                  <button
                    className={`${selectedStation === 'Packing' ? 'bg-gray-100 text-gray-900' : 'text-gray-700'} flex justify-between items-center w-full px-4 py-2 text-sm hover:bg-gray-100`}
                    role="menuitem"
                    tabIndex={-1}
                    onClick={() => handleOptionClick('Packing')}
                  >
                    Packing
                  </button>
                  <button
                    className={`${selectedStation === 'none' ? 'bg-gray-100 text-gray-900' : 'text-gray-700'} flex justify-between items-center w-full px-4 py-2 text-sm hover:bg-gray-100`}
                    role="menuitem"
                    tabIndex={-1}
                    onClick={() => handleOptionClick('none')}
                  >
                    None
                  </button>
                </div>
              </div>,
              document.body
            )}
          </div>
          {/* Error Message */}
          {error && <div className="text-red-500 text-sm text-center">{error}</div>}
          {/* Forgot Password Link */}
          <div className="text-sm text-blue-600 hover:underline text-right">
            <a href="/resetPassword">Forgot Password?</a>
          </div>
          {/* Log In Button */}
          <div className="flex justify-center">
            <button
              type="submit"
              className="w-40 bg-gradient-to-r from-gray-950 to-red-600 border border-black text-white p-2 rounded-xl hover:bg-[#b71c1c] transition flex items-center justify-center disabled:opacity-50"
              disabled={loading}
            >
              {loading ? (
                <span className="animate-spin">↻</span>
              ) : (
                "Log In"
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
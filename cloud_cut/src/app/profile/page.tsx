"use client";

import Navbar from "@/components/Navbar"
import Image from "next/image"
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { getCurrentUser, checkAuth, signOut, supabase } from "@/utils/supabase";
import type { Profile } from "@/utils/supabase";

export default function Profile() {
    const [profile, setProfile] = useState<Profile | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const router = useRouter();

    useEffect(() => {
        const initialize = async () => {
            const isAuthenticated = await checkAuth();
            if (!isAuthenticated) {
                router.push("/");
                return;
            }

            try {
                const user = await getCurrentUser();
                if (user) {
                    // Fetch the user's profile information
                    const { data, error } = await supabase
                        .from("profiles")
                        .select("*")
                        .eq("id", user.id)
                        .single();

                    if (error) throw error;
                    setProfile(data);
                }
            } catch (err) {
                setError(err instanceof Error ? err.message : "Failed to load profile");
            } finally {
                setIsLoading(false);
            }
        };

        initialize();
    }, [router]);

    const handleLogout = async () => {
        try {
            await signOut();
            router.push("/");
        } catch (err) {
            setError(err instanceof Error ? err.message : "Failed to logout");
        }
    };

    if (error) {
        return (
            <div className="min-h-screen">
                <Navbar />
                <div className="container mx-auto pt-32 px-4 sm:px-6 lg:px-8">
                    <div className="max-w-md mx-auto bg-white rounded-lg shadow-lg overflow-hidden border-t-4 border-red-600">
                        <div className="p-8">
                            <div className="flex items-center justify-center">
                                <svg className="h-16 w-16 text-red-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                                </svg>
                            </div>
                            <h2 className="mt-6 text-2xl font-bold text-center text-gray-900">Unable to Load Profile</h2>
                            <p className="mt-3 text-center text-red-600 font-medium">{error}</p>
                            <div className="mt-8 flex justify-center">
                                <button 
                                    onClick={() => window.location.reload()}
                                    className="px-6 py-3 bg-red-600 text-white rounded-md hover:bg-red-700 transition-all duration-200 font-medium shadow-md hover:shadow-lg focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-2"
                                >
                                    Try Again
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        );
    }

    if (isLoading) {
        return (
            <div className="min-h-screen">
                <Navbar />
                <div className="container mx-auto pt-32 px-4 sm:px-6 lg:px-8 flex justify-center">
                    <div className="max-w-md w-full bg-white rounded-lg shadow-lg p-8">
                        <div className="animate-pulse space-y-8">
                            <div className="flex justify-center">
                                <div className="rounded-full bg-gray-200 h-36 w-36 border-4 border-gray-800"></div>
                            </div>
                            <div className="space-y-2 flex flex-col items-center">
                                <div className="h-6 bg-gray-200 rounded w-48"></div>
                                <div className="h-4 bg-gray-200 rounded w-32 mt-2"></div>
                            </div>
                            <div className="h-px bg-gray-200 w-full my-6"></div>
                            <div className="space-y-6">
                                <div className="grid grid-cols-4 gap-4">
                                    <div className="h-4 bg-gray-200 rounded col-span-1"></div>
                                    <div className="h-4 bg-gray-200 rounded col-span-3"></div>
                                </div>
                                <div className="grid grid-cols-4 gap-4">
                                    <div className="h-4 bg-gray-200 rounded col-span-1"></div>
                                    <div className="h-4 bg-gray-200 rounded col-span-3"></div>
                                </div>
                                <div className="grid grid-cols-4 gap-4">
                                    <div className="h-4 bg-gray-200 rounded col-span-1"></div>
                                    <div className="h-4 bg-gray-200 rounded col-span-3"></div>
                                </div>
                            </div>
                            <div className="flex justify-center mt-6">
                                <div className="h-10 bg-gray-200 rounded w-48"></div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="min-h-screen ">
            <Navbar />
            
            <div className="container mx-auto h-[calc(100vh-64px)] pt-16 px-4 sm:px-6 lg:px-8 flex items-center justify-center">
                <div className="w-full max-w-4xl max-h-[calc(100vh-104px)]">
                    {/* Profile Card */}
                    <div className="bg-white rounded-xl shadow-xl overflow-hidden flex flex-col h-full border border-gray-800">
                        {/* Top Banner with integrated profile image */}
                        <div className="h-24 bg-gradient-to-r from-red-700 to-red-900 flex items-end px-6 sm:px-8 pb-3">
                            <div className="flex items-end">
                                <div className="relative">
                                    <div className="rounded-full border-4 border-white shadow-md h-20 w-20 overflow-hidden bg-white translate-y-10">
                                        <Image
                                            src="/profile.png"
                                            alt="Profile"
                                            width={80}
                                            height={80}
                                            className="h-full w-full object-cover"
                                        />
                                    </div>
                                    {/* Status indicator */}
                                    <div className="absolute bottom-8 right-0 h-4 w-4 rounded-full border-2 border-white bg-green-500"></div>
                                </div>
                                <div className="ml-4 mb-1 hidden sm:block text-white">
                                    <h1 className="text-xl font-bold">{profile?.name}</h1>
                                    <div className="flex items-center">
                                        <span className="text-xs text-white/75">{profile?.role || 'User'}</span>
                                    </div>
                                </div>
                            </div>
                        </div>
                        
                        {/* Profile Content */}
                        <div className="pt-12 sm:pt-4 px-6 sm:px-8 pb-6 overflow-y-auto flex-1">
                            {/* Profile Header with Name and Role (mobile only) */}
                            <div className="border-b border-gray-100 pb-3 sm:hidden">
                                <h1 className="text-xl font-bold text-gray-900">{profile?.name}</h1>
                                <div className="mt-1 flex items-center flex-wrap">
                                    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-800 border border-red-200">
                                        {profile?.role || 'User'}
                                    </span>
                                </div>
                            </div>
                            
                            <div className="flex justify-between pt-3 mb-6">
                                <div className="flex items-center text-xs text-gray-600">
                                    <svg className="h-3 w-3 mr-1 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                                    </svg>
                                    <span className="truncate max-w-[200px]">{profile?.email}</span>
                                </div>
                                <button
                                    className="inline-flex items-center px-3 py-1 border border-transparent rounded-md text-xs font-medium text-white bg-red-600 hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-red-500 transition-all duration-200 shadow-sm"
                                    onClick={() => alert('Edit profile functionality would go here')}
                                >
                                    <svg className="-ml-0.5 mr-1 h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                                    </svg>
                                    Edit Profile
                                </button>
                            </div>
                            
                            {/* Main content in 2 columns */}
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-4">
                                {/* Left Column */}
                                <div className="bg-gray-50 rounded-lg p-4 border border-gray-100 shadow-sm">
                                    {/* User Information */}
                                    <div>
                                        <h2 className="text-sm font-bold text-gray-900 mb-3 flex items-center">
                                            <svg className="h-4 w-4 mr-1.5 text-red-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                                            </svg>
                                            Personal Information
                                        </h2>
                                        
                                        <div className="space-y-3">
                                            <div className="flex justify-between">
                                                <p className="text-xs font-medium text-gray-500">Full Name</p>
                                                <p className="text-sm font-medium text-gray-900">{profile?.name || 'Not provided'}</p>
                                            </div>
                                            
                                            <div className="flex justify-between">
                                                <p className="text-xs font-medium text-gray-500">Email Address</p>
                                                <p className="text-sm font-medium text-gray-900">{profile?.email || 'Not provided'}</p>
                                            </div>
                                            
                                            <div className="flex justify-between">
                                                <p className="text-xs font-medium text-gray-500">Phone Number</p>
                                                <p className="text-sm font-medium text-gray-900">{profile?.phone || 'Not provided'}</p>
                                            </div>
                                            
                                            <div className="flex justify-between">
                                                <p className="text-xs font-medium text-gray-500">Role</p>
                                                <p className="text-sm font-medium text-gray-900 capitalize">{profile?.role || 'User'}</p>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                                
                                {/* Right Column */}
                                <div className="space-y-4">
                                    {/* Security Section */}
                                    <div className="bg-gray-50 rounded-lg p-4 border border-gray-100 shadow-sm">
                                        <h2 className="text-sm font-bold text-gray-900 mb-3 flex items-center">
                                            <svg className="h-4 w-4 mr-1.5 text-red-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                                            </svg>
                                            Security
                                        </h2>
                                        
                                        <div className="flex justify-between items-center">
                                            <div>
                                                <h3 className="text-xs font-medium text-gray-900">Password</h3>
                                                <p className="text-xs text-gray-500">Change your password</p>
                                            </div>
                                            <button
                                                className="inline-flex items-center px-2 py-1 border border-gray-300 shadow-sm text-xs font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-red-500 transition-all duration-200"
                                                onClick={() => alert('Change password functionality would go here')}
                                            >
                                                <svg className="-ml-0.5 mr-1 h-3 w-3 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" />
                                                </svg>
                                                Change
                                            </button>
                                        </div>
                                    </div>
                                    
                                    {/* Account Actions */}
                                    <div className="bg-gray-50 rounded-lg p-4 border border-gray-100 shadow-sm">
                                    <h2 className="text-sm font-bold text-gray-900 mb-3 flex items-center">
                                            <svg className="h-4 w-4 mr-1.5 text-red-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                                            </svg>
                                            Sign Out
                                        </h2>
                                        <div className="flex justify-between items-center">
                                            <div>
                                                <p className="text-xs text-gray-500">Sign out from your account</p>
                                            </div>
                                            <button
                                                className="inline-flex items-center px-3 py-1 border border-transparent rounded-md shadow-sm text-xs font-medium text-white bg-black hover:bg-gray-900 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-gray-900 transition-all duration-200"
                                                onClick={handleLogout}
                                            >
                                                <svg className="-ml-0.5 mr-1 h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                                                </svg>
                                                Sign Out
                                            </button>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
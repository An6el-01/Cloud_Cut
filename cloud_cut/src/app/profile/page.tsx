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
                <div className="container mx-auto pt-32 p-6 flex justify-center">
                    <div className="bg-white rounded-lg p-6 w-[600px] text-center">
                        <p className="text-red-500">{error}</p>
                    </div>
                </div>
            </div>
        );
    }

    if (!profile) {
        return (
            <div className="min-h-screen">
                <Navbar />
                <div className="container mx-auto pt-32 p-6 flex justify-center">
                    <div className="bg-white rounded-lg p-6 w-[600px] text-center">
                        <p>Loading profile...</p>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="min-h-screen">
            <Navbar />
            <div className="container mx-auto pt-32 p-6 flex justify-center">
                {/* Profile Card */}
                <div className="bg-white rounded-lg p-6 w-[600px]">
                    {/* Profile Image */}
                    <div className="flex justify-center mb-6">
                        <div className="w-32 h-32 bg-white rounded-full flex items-center justify-center border border-black">
                            <Image
                                src="/profile.png"
                                alt="Profile"
                                width={150}
                                height={150}
                                className="rounded-full"
                            />
                        </div>
                    </div>
                    
                    {/* Divider Line */}
                    <div className="flex justify-center mb-6">
                        <hr className="w-4/5 border-t border-gray-300" />
                    </div>

                    {/* User Information */}
                    <div className="space-y-4 text-black">
                        <div className="flex justify-between items-center">
                            <span className="font-bold">Name:</span>
                            <span>{profile.name}</span>
                        </div>
                        <div className="flex justify-between items-center">
                            <span className="font-bold">Email:</span>
                            <span>{profile.email}</span>
                        </div>
                        <div className="flex justify-between items-center">
                            <span className="font-bold">Phone Number:</span>
                            <span>{profile.phone}</span>
                        </div>
                        <div className="flex justify-between items-center">
                            <span className="font-bold">Role:</span>
                            <span>{profile.role}</span>
                        </div>
                    </div>

                    {/* Log Out Button */}
                    <div className="flex justify-center mt-6">
                        <button 
                            className="w-40 bg-gradient-to-r from-gray-950 to-red-600 text-white p-2 rounded-xl hover:bg-[#b71c1c] transition flex items-center justify-center border border-black"
                            onClick={handleLogout}
                        >
                            Log Out
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}
"use client";

import Navbar from "@/components/Navbar"
import Image from "next/image"
import Link from "next/link";

export default function Profile() {
    return (
        <div>
            <Navbar />
            <div className=" container mx-auto mt-60 p-6 flex justify-center">
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
                            <span className="font-bold ">Name:</span>
                            <span>Team Member Name</span>
                        </div>
                        <div className="flex justify-between items-center">
                            <span className="font-bold">Email:</span>
                            <span>t.member@shadowfoam.com</span>
                        </div>
                        <div className="flex justify-between items-center">
                            <span className="font-bold">Phone Number:</span>
                            <span>07123456789</span>
                        </div>
                        <div className="flex justify-between items-center">
                            <span className="font-bold">Role:</span>
                            <span>Admin</span>
                        </div>
                    </div>

                    {/* Log Out Button */}
                    <div className="flex justify-center mt-6">
                        <Link href="/">
                            <button 
                                className="w-40 bg-linear-to-r from-gray-950 to-red-600 border-amber-400 text-white  p-2 rounded-xl hover:bg-[#b71c1c] transition flex items-center justify-center"
                                onClick={() => {
                                    // Add logout functionality here
                                    console.log("Logging out...");
                                }}
                            >
                                Log Out
                            </button>
                        </Link>
                        
                    </div>
                </div>
            </div>
        </div>
    )
}
"use client";
import Navbar from "@/components/Navbar";
import Image from "next/image";

export default function Team() {
  return (
    <div className="relative min-h-screen">
      {/* Navbar */}
      <div className="fixed top-0 left-0 w-full z-10">
        <Navbar />
      </div>

      {/* Main Content */}
      <div className="flex justify-center min-h-screen pt-44">
        {/* Quick Add Section */}
        <div className="bg-[#D9D9D9]/60 rounded-lg p-7 w-[80vw] max-w-[1200px] min-w-[900px] flex space-x-4 max-h-25">
          <input
            type="text"
            id="name"
            className="mt-1 block w-50 h-12 p-3 border border-gray-800 rounded-lg focus:ring focus:ring-blue-200 bg-white text-black"
            placeholder="Name..."
          />
          <input
            type="email"
            id="email"
            className="mt-1 block w-70 h-12 p-3 border border-gray-800 rounded-lg focus:ring focus:ring-blue-200 bg-white text-black"
            placeholder="Email..."
          />
          <input
            type="text"
            id="phone"
            className="mt-1 block w-50 h-12 p-3 border border-gray-800 rounded-lg focus:ring focus:ring-blue-200 bg-white text-black"
            placeholder="Phone..."
          />
          <select
            id="dropdown"
            className="mt-1 block w-30 h-12 p-3 pr-10 border border-gray-800 rounded-lg focus:ring focus:ring-blue-200 bg-white text-black appearance-none"
          >
            <option value="" disabled selected>
              Role...
            </option>
            <option value="GlobalAdmin">Global Admin</option>
            <option value="SiteAdmin">Site Admin</option>
            <option value="Manager">Manager</option>
            <option value="Operator">Operator</option>
          </select>
          <button
            type="submit"
            className="w-80 h-12 mt-1 bg-gradient-to-r from-gray-950 to-red-600 border border-black text-white p-2 rounded-xl hover:bg-[#b71c1c] transition flex items-center justify-center"
          >
            <Image
              src="/addIcon.png"
              alt="AddMemberIcon"
              width={25}
              height={25}
              className="mr-6"
            />
            Add New Team Member
          </button>
        </div>
      </div>
    </div>
  );
}
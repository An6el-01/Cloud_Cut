"use client";

import Navbar from "@/components/Navbar";
import Image from "next/image";
import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { fetchProfiles, addUser, updateUser, deleteUser, checkAuth, Profile } from "@/utils/supabase";

export default function Team() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [role, setRole] = useState("");
  const [success, setSuccess] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [editingProfile, setEditingProfile] = useState<Profile | null>(null);
  const router = useRouter();

  useEffect(() => {
    const initialize = async () => {
      const isAuthenticated = await checkAuth();
      if (!isAuthenticated) {
        router.push("/");
      } else {
        try {
          const data = await fetchProfiles();
          console.log("useEffect - fetched profiles:", data);
          setProfiles(data);
        } catch (err) {
          setError(err instanceof Error ? err.message : "Failed to load profiles");
        }
      }
    };
    initialize();
  }, [router]);

  const handleAddUser = async (e: React.FormEvent) => {
    setIsLoading(true);
    e.preventDefault();
    setSuccess(null);
    setError(null);

    if (!name || !email || !phone || !role) {
      setError("All the input fields are required");
      setIsLoading(false);
      return;
    }

    try {
      await addUser(email, name, phone, role);
      setSuccess(`User ${name} created successfully! Temporary password: TempPassword123!`);
      setName("");
      setEmail("");
      setPhone("");
      setRole("");
      const updatedProfiles = await fetchProfiles();
      console.log("handleAddUser - updated profiles:", updatedProfiles);
      setProfiles(updatedProfiles);
    } catch (err) {
      setError(err instanceof Error ? err.message : "An unexpected error occurred");
    }
    setIsLoading(false);
  };

  const handleEdit = (profile: Profile) => {
    setEditingProfile(profile);
  };

  const handleSaveEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingProfile) return;

    try {
      await updateUser(editingProfile);
      setSuccess("User updated successfully!");
      setEditingProfile(null);
      const updatedProfiles = await fetchProfiles();
      setProfiles(updatedProfiles);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update user");
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Are you sure you want to delete this user?")) return;

    try {
      await deleteUser(id);
      setSuccess("User deleted successfully!");
      const updatedProfiles = await fetchProfiles();
      setProfiles(updatedProfiles);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete user");
    }
  };

  return (
    <div className="relative min-h-screen">
      <div className="fixed top-0 left-0 w-full z-10">
        <Navbar />
      </div>

      <div className="flex flex-col items-center min-h-screen pt-44 space-y-8">
        <div className="bg-[#D9D9D9]/60 rounded-lg p-7 w-[80vw] max-w-[1200px] min-w-[900px]">
          <form onSubmit={handleAddUser} className="flex flex-wrap justify-center gap-4">
            <input
              type="text"
              id="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="mt-1 block w-50 h-12 p-3 border border-gray-800 rounded-lg focus:ring focus:ring-blue-200 bg-white text-black"
              placeholder="Name..."
            />
            <input
              type="email"
              id="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="mt-1 block w-70 h-12 p-3 border border-gray-800 rounded-lg focus:ring focus:ring-blue-200 bg-white text-black"
              placeholder="Email..."
            />
            <input
              type="text"
              id="phone"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              className="mt-1 block w-50 h-12 p-3 border border-gray-800 rounded-lg focus:ring focus:ring-blue-200 bg-white text-black"
              placeholder="Phone..."
            />
            <select
              id="dropdown"
              value={role}
              onChange={(e) => setRole(e.target.value)}
              className="mt-1 block w-30 h-12 p-3 pr-10 border border-gray-800 rounded-lg focus:ring focus:ring-blue-200 bg-white text-gray-500 appearance-none"
            >
              <option value="" disabled>
                Role...
              </option>
              <option value="GlobalAdmin">Global Admin</option>
              <option value="SiteAdmin">Site Admin</option>
              <option value="Manager">Manager</option>
              <option value="Operator">Operator</option>
            </select>
            <button
              type="submit"
              className="w-60 h-12 mt-1 bg-gradient-to-r from-gray-950 to-red-600 border border-black text-white p-2 rounded-xl hover:bg-[#b71c1c] transition flex items-center justify-center"
              disabled={isLoading}
            >
              <Image src="/addIcon.png" alt="AddMemberIcon" width={25} height={25} className="mr-6" />
              {isLoading ? "Adding..." : "Add User"}
            </button>
          </form>
        </div>

        <div className="w-[80vw] max-w-[1200px] min-w-[900px]">
          <div className="bg-[#1d1d1d] rounded-t-lg">
            <h1 className="text-2xl font-bold text-white p-4">Team Members</h1>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full bg-white border border-gray-200">
              <thead className="bg-gray-100">
                <tr>
                  <th className="px-6 py-4 text-center text-black text-md">Name</th>
                  <th className="px-12 py-4 text-center text-black text-md">Email</th>
                  <th className="px-12 py-4 text-center text-black text-md">Phone Number</th>
                  <th className="px-12 py-4 text-center text-black text-md">Role</th>
                  <th className="px-6 py-4 text-center text-black text-md">Edit</th>
                  <th className="px-6 py-4 text-center text-black text-md">Delete</th>
                </tr>
              </thead>
              <tbody>
                {profiles.map((profile) => (
                  <tr key={profile.id} className="border-b hover:bg-gray-50 text-center">
                    <td className="px-6 py-4 text-center text-black ">{profile.name}</td>
                    <td className="px-12 py-4 text-center text-black">{profile.email}</td>
                    <td className="px-12 py-4 text-center text-black">{profile.phone}</td>
                    <td className="px-12 py-4 text-center text-black">{profile.role}</td>
                    <td className="px-6 py-4">
                      <button 
                        onClick={() => handleEdit(profile)}
                        className="cursor-pointer"
                        >
                        <Image
                          src={"/editPencil.png"}
                          alt="Edit"
                          width={22}
                          height={22}
                        />
                      </button>
                    </td>
                    <td className="px-6 py-4">
                      <button 
                        onClick={() => handleDelete(profile.id)}
                        className="cursor-pointer"
                      >
                        <Image
                          src={"/binClosed.png"}
                          alt="Delete"
                          width={22}
                          height={22}
                        />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {editingProfile && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50">
          <div className="bg-white rounded-xl p-8 w-full max-w-md shadow-2xl transform transition-all">
            <div className="flex justify-between items-center mb-6">
              <h2 className="text-2xl font-bold text-gray-800">Edit Team Member</h2>
              <button
                onClick={() => setEditingProfile(null)}
                className="text-gray-500 hover:text-gray-700 transition-colors"
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            
            <form onSubmit={handleSaveEdit} className="space-y-6">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Name</label>
                <input
                  type="text"
                  value={editingProfile.name}
                  onChange={(e) => setEditingProfile({ ...editingProfile, name: e.target.value })}
                  className="w-full h-12 p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-red-500 focus:border-transparent bg-white text-gray-900 transition-all"
                  placeholder="Enter name"
                />
              </div>
              
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Phone Number</label>
                <input
                  type="text"
                  value={editingProfile.phone}
                  onChange={(e) => setEditingProfile({ ...editingProfile, phone: e.target.value })}
                  className="w-full h-12 p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-red-500 focus:border-transparent bg-white text-gray-900 transition-all"
                  placeholder="Enter phone number"
                />
              </div>
              
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Role</label>
                <select
                  value={editingProfile.role}
                  onChange={(e) => setEditingProfile({ ...editingProfile, role: e.target.value })}
                  className="w-full h-12 p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-red-500 focus:border-transparent bg-white text-gray-900 appearance-none cursor-pointer transition-all"
                >
                  <option value="GlobalAdmin">Global Admin</option>
                  <option value="SiteAdmin">Site Admin</option>
                  <option value="Manager">Manager</option>
                  <option value="Operator">Operator</option>
                </select>
              </div>

              <div className="flex justify-center space-x-4 pt-4">
                <button
                  type="submit"
                  className="px-6 py-2.5 bg-gradient-to-r from-gray-950 to-red-600 text-white rounded-lg hover:from-gray-900 hover:to-red-700 transition-all font-medium shadow-md hover:shadow-lg"
                >
                  Save Changes
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {success && (
        <div className="fixed bottom-4 left-1/2 transform -translate-x-1/2 bg-green-500 p-4 rounded-lg z-50">
          {success}
        </div>
      )}
      {error && (
        <div className="fixed bottom-4 left-1/2 transform -translate-x-1/2 bg-red-500 p-4 rounded-lg z-50">
          {error}
        </div>
      )}
    </div>
  );
}
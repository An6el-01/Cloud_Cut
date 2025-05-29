"use client";

import Navbar from "@/components/Navbar";
import Image from "next/image";
import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { 
  fetchProfiles, 
  addUser, 
  updateUser, 
  deleteUser, 
  checkAuth, 
  Profile, 
  subscribeToProfiles 
} from "@/utils/supabase";
import { getSupabaseClient } from "@/utils/supabase";

export default function Team() {
  const [mounted, setMounted] = useState(false);
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
  const [searchTerm, setSearchTerm] = useState("");
  const [filteredProfiles, setFilteredProfiles] = useState<Profile[]>([]);

  // Add useEffect to clear success message after 10 seconds
  useEffect(() => {
    if (success) {
      const timer = setTimeout(() => {
        setSuccess(null);
      }, 10000);
      return () => clearTimeout(timer);
    }
  }, [success]);

  // Add useEffect to clear error message after 10 seconds
  useEffect(() => {
    if (error) {
      const timer = setTimeout(() => {
        setError(null);
      }, 7000);
      return () => clearTimeout(timer);
    }
  }, [error]);

  // Pagination state
  const [currentPage, setCurrentPage] = useState(1);
  const profilesPerPage = 7;
  
  // Filter and sort profiles when dependencies change
  useEffect(() => {
    if (!profiles) return;

    let result = [...profiles];

    // Apply search filter
    if (searchTerm) {
      const lowerSearchTerm = searchTerm.toLowerCase();
      result = result.filter(
        (profile) => 
          profile.name.toLowerCase().includes(lowerSearchTerm) ||
          profile.email.toLowerCase().includes(lowerSearchTerm)
      );
    }

    setFilteredProfiles(result);
    setCurrentPage(1); // Reset to first page on search
  }, [profiles, searchTerm]);

  // Handle clear search
  const handleClearSearch = () => {
    setSearchTerm("");
  };

  // Calculate pagination values based on filtered profiles instead of all profiles
  const indexOfLastProfile = currentPage * profilesPerPage;
  const indexOfFirstProfile = indexOfLastProfile - profilesPerPage;
  const currentProfiles = filteredProfiles.slice(indexOfFirstProfile, indexOfLastProfile);
  const totalPages = Math.ceil(filteredProfiles.length / profilesPerPage);

  // Handle page change
  const handlePageChange = (pageNumber: number) => {
    if (pageNumber >= 1 && pageNumber <= totalPages) {
      setCurrentPage(pageNumber);
    }
  };

  useEffect(() => {
    setMounted(true);
  }, []);

  // Set up real-time subscription to profile changes
  useEffect(() => {
    const initialize = async () => {
      const isAuthenticated = await checkAuth();
      if (!isAuthenticated) {
        router.push("/");
      } else {
        try {
          setIsLoading(true);
          const data = await fetchProfiles();
          console.log("useEffect - fetched profiles:", data);
          setProfiles(data);
          setError(null); // Clear any existing errors on successful fetch

          // Subscribe to profile changes
          const subscription = subscribeToProfiles((payload) => {
            console.log("REALTIME EVENT RECEIVED:", payload);
            console.log("Event type:", payload.eventType);
            console.log("New data:", payload.new);
            
            if (payload.eventType === "INSERT") {
              // Add new profile to the list
              setProfiles(current => [...current, payload.new]);
            } else if (payload.eventType === "UPDATE") {
              // Update existing profile in the list
              setProfiles(current => 
                current.map(profile => 
                  profile.id === payload.new.id ? payload.new : profile
                )
              );
            } else if (payload.eventType === "DELETE") {
              // Remove deleted profile from the list
              setProfiles(current => 
                current.filter(profile => profile.id !== payload.old.id)
              );
            }
          });

          // Cleanup subscription on component unmount
          return () => {
            subscription.unsubscribe();
          };
        } catch (err) {
          console.error("Failed to load profiles:", err);
          setError(err instanceof Error ? err.message : "Failed to load profiles");
        } finally {
          setIsLoading(false);
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
      const result = await addUser(email, name, phone, role);
      setSuccess(result.message || `User ${name} created successfully!`);
      
      // Add this line to manually refresh profiles after adding a user
      fetchProfiles().then(data => setProfiles(data));
      
      setName("");
      setEmail("");
      setPhone("");
      setRole("");
      // Real-time subscription will handle updating profiles
    } catch (err) {
      setError(err instanceof Error ? err.message : "An unexpected error occurred");
    }
    setIsLoading(false);
  };

  const handleEdit = async (profile: Profile) => {
    try {
      // Get the current session from Supabase
      const supabase = getSupabaseClient();
      const { data: { session } } = await supabase.auth.getSession();
      
      if (!session) {
        setError("You must be logged in to edit team members.");
        return;
      }
      
      // Find the profile with matching email from the session
      const currentUserProfile = profiles.find(p => p.email === session.user.email);
      const allowedRoles = ['GlobalAdmin', 'SiteAdmin', 'Manager'];
      
      console.log("currentUserProfile role", currentUserProfile?.role);
      
      if (!currentUserProfile || !allowedRoles.includes(currentUserProfile.role)) {
        setError("You don't have permission to edit team members. Admin access required.");
        return;
      }
      
      setEditingProfile(profile);
    } catch (err) {
      console.error("Error checking permissions:", err);
      setError("Failed to verify permissions");
    }
  };

  const handleSaveEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingProfile) return;

    try {
      await updateUser(editingProfile);
      setSuccess("User updated successfully!");
      setEditingProfile(null);
      // Real-time subscription will handle updating profiles
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update user");
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Are you sure you want to delete this user?")) return;

    try {
      // Get the current session from Supabase
      const supabase = getSupabaseClient();
      const { data: { session } } = await supabase.auth.getSession();
      
      if (!session) {
        setError("You must be logged in to delete team members.");
        return;
      }
      
      // Find the profile with matching email from the session
      const currentUserProfile = profiles.find(p => p.email === session.user.email);
      const allowedRoles = ['GlobalAdmin', 'SiteAdmin', 'Manager'];
      
      console.log("currentUserProfile role for delete", currentUserProfile?.role);
      
      if (!currentUserProfile || !allowedRoles.includes(currentUserProfile.role)) {
        setError("You don't have permission to delete team members. Admin access required.");
        return;
      }

      await deleteUser(id);
      setSuccess("User deleted successfully!");
      // Real-time subscription will handle updating profiles
    } catch (err) {
      console.error("Error deleting user:", err);
      setError(err instanceof Error ? err.message : "Failed to delete user");
    }
  };

  if (!mounted) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-pulse text-gray-700">Loading...</div>
      </div>
    );
  }

  return (
    <div className="relative min-h-screen">
      <div className="fixed top-0 left-0 w-full z-10">
        <Navbar />
      </div>

      <div className="flex flex-col items-center min-h-screen pt-44 space-y-6">
        {/* Add User Form */}
        <div className="bg-white/70 backdrop-blur-sm rounded-xl p-6 w-[80vw] max-w-[1200px] min-w-[900px] shadow-lg border border-gray-200">
          <form onSubmit={handleAddUser} className="flex flex-wrap items-end gap-4" autoComplete="off">
            <div className="flex-1 min-w-[200px] space-y-1">
              <label htmlFor="name" className="block text-sm font-medium text-gray-700">
                Name
              </label>
              <div className="relative">
                <input
                  type="text"
                  id="name"
                  name="name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full h-10 p-2 pl-8 border border-gray-300 rounded-lg focus:ring-2 focus:ring-red-500 focus:border-transparent bg-white text-gray-900 transition-all"
                  placeholder="Enter name"
                  required
                  autoComplete="off"
                />
                <svg className="absolute left-2 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                </svg>
              </div>
            </div>
            <div className="flex-1 min-w-[200px] space-y-1">
              <label htmlFor="email" className="block text-sm font-medium text-gray-700">
                Email
              </label>
              <div className="relative">
                <input
                  type="email"
                  id="email"
                  name="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full h-10 p-2 pl-8 border border-gray-300 rounded-lg focus:ring-2 focus:ring-red-500 focus:border-transparent bg-white text-gray-900 transition-all"
                  placeholder="Enter email"
                  required
                  autoComplete="off"
                />
                <svg className="absolute left-2 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                </svg>
              </div>
            </div>
            <div className="flex-1 min-w-[200px] space-y-1">
              <label htmlFor="phone" className="block text-sm font-medium text-gray-700">
                Phone Number
              </label>
              <div className="relative">
                <input
                  type="tel"
                  id="phone"
                  name="phone"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  className="w-full h-10 p-2 pl-8 border border-gray-300 rounded-lg focus:ring-2 focus:ring-red-500 focus:border-transparent bg-white text-gray-900 transition-all"
                  placeholder="Enter phone number"
                  required
                  autoComplete="off"
                />
                <svg className="absolute left-2 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
                </svg>
              </div>
            </div>
            <div className="flex-1 min-w-[200px] space-y-1">
              <label htmlFor="role" className="block text-sm font-medium text-gray-700">
                Role
              </label>
              <div className="relative">
                <select
                  id="role"
                  name="role"
                  value={role}
                  onChange={(e) => setRole(e.target.value)}
                  className="w-full h-10 p-2 pl-8 border border-gray-300 rounded-lg focus:ring-2 focus:ring-red-500 focus:border-transparent bg-white text-gray-900 appearance-none cursor-pointer transition-all"
                  required
                >
                  <option value="" disabled>
                    Select role...
                  </option>
                  <option value="GlobalAdmin">Global Admin</option>
                  <option value="SiteAdmin">Site Admin</option>
                  <option value="Manager">Manager</option>
                  <option value="Operator">Operator</option>
                  <option value="Packer">Packer</option>
                </select>
                <svg className="absolute left-2 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
                </svg>
                <svg className="absolute right-2 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </div>
            </div>
            <div className="flex-1 min-w-[200px] space-y-1">
              <button
                type="submit"
                className="w-full h-10 bg-gradient-to-r from-gray-950 to-red-600 text-white rounded-lg hover:from-gray-900 hover:to-red-700 transition-all font-medium shadow-md hover:shadow-lg disabled:opacity-70 disabled:cursor-not-allowed flex items-center justify-center gap-4 group"
                disabled={isLoading}
              >
                {isLoading ? (
                  <span className="flex items-center">
                    <svg className="animate-spin -ml-1 mr-2 h-4 w-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                    </svg>
                    Loading...
                  </span>
                ) : (
                  <span className="flex items-center">
                    <Image src="/addIcon.png" alt="" width={16} height={16} className="group-hover:scale-110 transition-transform mr-3" />
                    Add User
                  </span>
                )}
              </button>
            </div>
          </form>
        </div>

        {/* Team Members Table */}
        <div className="w-[80vw] max-w-[1200px] min-w-[900px]">
          <div className="bg-[#1d1d1d] rounded-t-lg p-4">
            <div className="flex flex-col space-y-3 md:space-y-0 md:flex-row justify-between items-start md:items-center">
              <h1 className="text-2xl font-bold text-white">Team Members</h1>
              <div className="flex flex-col space-y-2 sm:space-y-0 sm:flex-row sm:space-x-3 w-full md:w-auto">
                {/* Search results counter */}
                {searchTerm && (
                  <div className="text-sm text-gray-300 self-start sm:self-center sm:mr-4" aria-live="polite">
                    Found {filteredProfiles.length} {filteredProfiles.length === 1 ? 'member' : 'members'} for "{searchTerm}"
                  </div>
                )}

                <div className="flex space-x-3 w-full sm:w-auto">
                  {/* Search bar */}
                  <div className="relative flex-1 sm:w-64">
                    <input
                      type="text"
                      placeholder="Search by name or email"
                      value={searchTerm}
                      onChange={(e) => setSearchTerm(e.target.value)}
                      className="w-full pl-10 pr-10 py-2 text-sm text-black bg-white/90 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-red-500 focus:border-red-500"
                      aria-label="Search team members"
                    />
                    <div className="absolute inset-y-0 left-0 flex items-center pl-3 pointer-events-none">
                      <svg className="w-4 h-4 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"></path>
                      </svg>
                    </div>
                    {searchTerm && (
                      <button
                        onClick={handleClearSearch}
                        className="absolute right-2 top-1/2 transform -translate-y-1/2 text-gray-400 hover:text-gray-600"
                        aria-label="Clear search"
                      >
                        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <circle cx="12" cy="12" r="10"/>
                          <path d="m15 9-6 6"/>
                          <path d="m9 9 6 6"/>
                        </svg>
                      </button>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>
          <div className="overflow-x-auto bg-white rounded-b-lg shadow-lg">
            <table className="w-full border border-gray-200">
              <thead className="bg-gray-100 sticky top-0 z-10">
                <tr>
                  <th className="px-6 py-4 text-center text-black text-md font-semibold">Name</th>
                  <th className="px-16 py-4 text-center text-black text-md font-semibold">Email</th>
                  <th className="px-3 py-4 text-center text-black text-md font-semibold">Phone Number</th>
                  <th className="px-8 py-4 text-center text-black text-md font-semibold">Role</th>
                  <th className="px-2 py-4  text-black text-md font-semibold">Actions</th>
                </tr>
              </thead>
            </table>
            <div className="h-[calc(80vh-370px)] overflow-y-auto">
              <table className="w-full border border-gray-200">
                <tbody className="divide-y divide-gray-200">
                  {isLoading ? (
                    // Skeleton loading rows
                    [...Array(7)].map((_, index) => (
                      <tr key={`skeleton-${index}`} className="animate-pulse" aria-hidden="true">
                        <td className="px-6 py-4">
                          <div className="h-4 bg-gray-200 rounded w-24 mx-auto"></div>
                        </td>
                        <td className="px-12 py-4 ">
                          <div className="h-4 bg-gray-200 rounded w-32 mx-auto"></div>
                        </td>
                        <td className="px-12 py-4">
                          <div className="h-4 bg-gray-200 rounded w-24 mx-auto"></div>
                        </td>
                        <td className="px-12 py-4">
                          <div className="h-4 bg-gray-200 rounded w-20 mx-auto"></div>
                        </td>
                        <td className="px-6 py-4">
                          <div className="flex justify-center space-x-4">
                            <div className="h-8 w-8 bg-gray-200 rounded"></div>
                            <div className="h-8 w-8 bg-gray-200 rounded"></div>
                          </div>
                        </td>
                      </tr>
                    ))
                  ) : filteredProfiles.length === 0 && searchTerm ? (
                    <tr>
                      <td colSpan={5} className="px-6 py-10 text-center text-gray-500">
                        <div className="flex flex-col items-center">
                          <svg className="w-10 h-10 mb-3 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"></path>
                          </svg>
                          <p className="text-lg font-medium">No team members found</p>
                          <p className="text-sm">Try a different search term or clear the search</p>
                          <button 
                            onClick={handleClearSearch}
                            className="mt-3 px-4 py-2 text-sm text-white bg-red-600 rounded-md hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-red-500"
                          >
                            Clear Search
                          </button>
                        </div>
                      </td>
                    </tr>
                  ) : (
                    currentProfiles.map((profile) => (
                      <tr key={profile.id} className="hover:bg-gray-50 text-center transition-colors">
                        <td className="px-6 py-4 text-black">{profile.name}</td>
                        <td className="px-12 py-4 text-black">{profile.email}</td>
                        <td className="px-12 py-4 text-black">{profile.phone}</td>
                        <td className="px-12 py-4 text-black">{profile.role}</td>
                        <td className="px-6 py-4">
                          <div className="flex justify-center space-x-4">
                            <button 
                              onClick={() => handleEdit(profile)}
                              className="p-2 text-gray-600 hover:text-gray-900 focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-2 rounded-lg transition-colors"
                            >
                              <Image
                                src="/editPencil.png"
                                alt=""
                                width={20}
                                height={20}
                              />
                            </button>
                            <button 
                              onClick={() => handleDelete(profile.id)}
                              className="p-2 text-gray-600 hover:text-red-600 focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-2 rounded-lg transition-colors"
                            >
                              <Image
                                src="/binClosed.png"
                                alt=""
                                width={20}
                                height={20}
                              />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
            {/* Pagination controls */}
            {filteredProfiles.length > 0 && (
              <div className="flex flex-col sm:flex-row justify-between items-center bg-white p-4 border-t border-gray-200">
                <div className="text-sm text-gray-600 mb-3 sm:mb-0">
                  Showing <span className="font-medium">{indexOfFirstProfile + 1}</span> to{" "}
                  <span className="font-medium">{Math.min(indexOfLastProfile, filteredProfiles.length)}</span> of{" "}
                  <span className="font-medium">{filteredProfiles.length}</span>{" "}
                  team members
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => handlePageChange(currentPage - 1)}
                    disabled={currentPage === 1}
                    className="px-3 py-1 rounded bg-gray-200 text-gray-700 disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-300 focus:outline-none focus:ring-2 focus:ring-offset-1 focus:ring-gray-500 transition-colors"
                    aria-label="Previous page"
                  >
                    Previous
                  </button>
                  <div className="flex items-center px-3 py-1 text-gray-600">
                    <label htmlFor="page-number" className="sr-only">Page number</label>
                    <input
                      id="page-number"
                      type="number"
                      min="1"
                      max={totalPages}
                      value={currentPage}
                      onChange={(e) => {
                        const page = parseInt(e.target.value);
                        if (!isNaN(page) && page >= 1 && page <= totalPages) {
                          handlePageChange(page);
                        }
                      }}
                      className="w-12 text-center border border-gray-300 rounded mx-2 focus:outline-none focus:ring-2 focus:ring-red-500 focus:border-transparent"
                      aria-label={`Page ${currentPage} of ${totalPages}`}
                    />
                    <span>of {totalPages}</span>
                  </div>
                  <button
                    onClick={() => handlePageChange(currentPage + 1)}
                    disabled={currentPage === totalPages}
                    className="px-3 py-1 rounded bg-gray-200 text-gray-700 disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-300 focus:outline-none focus:ring-2 focus:ring-offset-1 focus:ring-gray-500 transition-colors"
                    aria-label="Next page"
                  >
                    Next
                  </button>
                </div>
              </div>
            )}
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
                className="text-gray-500 hover:text-gray-700 transition-colors focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-2 rounded-lg p-1"
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
                  type="tel"
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
                  className="px-6 py-2.5 bg-gradient-to-r from-gray-950 to-red-600 text-white rounded-lg hover:from-gray-900 hover:to-red-700 focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-2 transition-all font-medium shadow-md hover:shadow-lg"
                >
                  Save Changes
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {success && (
        <div className="fixed bottom-4 left-1/2 transform -translate-x-1/2 bg-green-500 text-white p-4 rounded-lg z-50 shadow-lg">
          {success}
        </div>
      )}
      {error && (
        <div className="fixed bottom-4 left-1/2 transform -translate-x-1/2 bg-red-500 text-white p-4 rounded-lg z-50 shadow-lg">
          {error}
        </div>
      )}
    </div>
  );
}
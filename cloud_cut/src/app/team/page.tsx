"use client";

import Navbar from "@/components/Navbar";
import Image from "next/image";
import { useState, useEffect } from 'react';
import { createClient, AuthError } from '@supabase/supabase-js';
import { useRouter } from "next/navigation";

//Supabase Client
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

export default function Team() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [role, setRole] = useState("");
  const [success, setSuccess] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const router = useRouter();
  useEffect(() => {
    const checkAuth = async() => {
      const { data: { session } } = await supabase.auth.getSession();
      if(!session) {
        router.push("/")
      }
    }
    checkAuth();
  }, [router])

  const handleAddUser = async (e: React.FormEvent) => {
    setIsLoading(true);
    e.preventDefault();
    setSuccess(null);
    setError(null);

    //Validate Inputs
    // if(!name || !email || !phone ||! role) {
    //   setError("All the input fields are required");
    //   return;
    // }

    //Generate a temporary password
    const tempPassword = "TempPassword123!";

    try {
      const { data, error } = await supabase.auth.signUp({
        email,
        password: tempPassword,
        options: {
          data: {
            name,
            phone, 
            role,
            needsPasswordReset: true //add flag to track first login.
          }
        }
      });
      console.log(data);
      //CODE FOR PASSWORD RESET LINK, SENDING EMAIL, & TRACKING EMAIL SENT.
      // console.log("handleAddUser()-> data: ",data); 
      // if (error) {
      //   throw error;
      // }

      // //Generate a password reset link
      // const resetResponse = await fetch("/api/generate-reset-link", {
      //   method: 'POST',
      //   headers: {
      //     "Content-Type": "application/json",
      //   },
      //   body: JSON.stringify({ email }),
      // });

      // const resetData = await resetResponse.json();
      // if (!resetResponse.ok) {
      //   throw new Error(resetData.error || "Failed to generate reset link");
      // }

      // const resetLink = resetData.resetLink;

      // // Create email tracking record
      // const { data: trackingData, error: trackingError } = await supabase
      //   .from('email_tracking')
      //   .insert({
      //     email_id: resetData.email_id, // Make sure your generate-reset-link endpoint returns this
      //     user_id: data.user?.id,
      //     email: email,
      //     status: 'pending'
      //   })
      //   .select()
      //   .single();

      // if (trackingError) {
      //   console.error('Failed to create email tracking:', trackingError);
      //   throw new Error('Failed to create email tracking');
      // }

      // //Send the welcome email with the reset link
      // const emailResponse = await fetch("/api/send-welcome-email", {
      //   method: 'POST',
      //   headers: {
      //     "Content-Type": "application/json",
      //   },
      //   body: JSON.stringify({ 
      //     email, 
      //     name, 
      //     resetLink,
      //     email_id: trackingData.email_id // Pass the tracking ID to the email service
      //   }),
      // });

      // if(!emailResponse.ok) {
      //   const emailData = await emailResponse.json();
      //   throw new Error(emailData.error || "Failed to send welcome email");
      // }

      // setSuccess(
      //   `User ${name} created successfully! A welcome email with a password reset link has been sent to ${email}.`
      // );

      //Reset Form

      if (error) throw error;

      setSuccess(
        `User ${name} created successfully! Temporary password: ${tempPassword}`
      );

      setName('');
      setEmail('');
      setPhone('');
      setRole('');
    } catch (error: unknown) {
      if (error instanceof AuthError) {
        setError(error.message || "An error occurred while adding the user. Type: AuthError.")
      } else if (error instanceof Error) {
        setError(error.message || "An error occurred while adding the user. Type: Error.")
      } else {
        setError("An unexpected error occurred while adding the user.")
      }
    }
    setIsLoading(false);
  };

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
          <form onSubmit={handleAddUser} className="flex space-x-4 w-full">
            <input
              type="text"
              id="name"
              onChange={(e) => setName(e.target.value)}
              className="mt-1 block w-50 h-12 p-3 border border-gray-800 rounded-lg focus:ring focus:ring-blue-200 bg-white text-black"
              placeholder="Name..."
            />
            <input
              type="email"
              id="email"
              onChange={(e) => setEmail(e.target.value)}
              className="mt-1 block w-70 h-12 p-3 border border-gray-800 rounded-lg focus:ring focus:ring-blue-200 bg-white text-black"
              placeholder="Email..."
            />
            <input
              type="text"
              id="phone"
              onChange={(e) => setPhone(e.target.value)}
              className="mt-1 block w-50 h-12 p-3 border border-gray-800 rounded-lg focus:ring focus:ring-blue-200 bg-white text-black"
              placeholder="Phone..."
            />
            <select
              id="dropdown"
              onChange={(e) => setRole(e.target.value)}
              className="mt-1 block w-30 h-12 p-3 pr-10 border border-gray-800 rounded-lg focus:ring focus:ring-blue-200 bg-white text-gray-500 appearance-none"
            >
              <option defaultValue="" disabled selected>
                Role...
              </option>
              <option value="GlobalAdmin">Global Admin</option>
              <option value="SiteAdmin">Site Admin</option>
              <option value="Manager">Manager</option>
              <option value="Operator">Operator</option>
            </select>
            <button
              type="submit"
              className="w-120 h-12 mt-1 bg-gradient-to-r from-gray-950 to-red-600 border border-black text-white p-2 rounded-xl hover:bg-[#b71c1c] transition flex items-center justify-center"
              disabled={isLoading} // Change to->{!canAddUser | isLoading} whenever we restrict the roles that can add users.
            >
              <Image
                src="/addIcon.png"
                alt="AddMemberIcon"
                width={25}
                height={25}
                className="mr-6"
              />
              {isLoading ? 'Adding...' : 'Add User'}
            </button>
          </form>
         
        </div>
      </div>

      {/** Success/Error Message */}
      {success && (
        <div className="fixed bottom-4 left-1/2 transform translate-x-1/2 bg-green-500 p-4 rounded-lg">
          {success}
        </div>
      )}
      {error && (
        <div className="fixed bottom-4 left-1/2 transform translate-x-1/2 bg-red-500 p-4 rounded-lg">
          {error}
        </div>
      )}
    </div>
  );
}
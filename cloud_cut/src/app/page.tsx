"use client";

import Image from "next/image";
import { useState } from 'react';
import { useRouter } from "next/navigation";
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

const handleSignIn = async (email: string, password: string)=> {
  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password,
  });

  if(error) {
    throw new Error(error.message || "Sign-in failed");
  }

  return data;
}
export default function Home() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    try{
      await handleSignIn(email, password);

      //Check is user needs to reset password
      const { data: { user } } = await supabase.auth.getUser();
      if(user?.user_metadata.needsPasswordReset) {
        router.push("/resetPassword");
      } else {
        router.push("manufacturing");
      }
    }catch(error: unknown){
      setError(error instanceof Error ? error.message : "An error occurred during sign-in");
    }
  }

  return (
    <div className="min-h-screen">
      <div className="pt-16 min-h-screen flex items-center justify-center">
        {/* Centered Log-In Card */}
        <div className="bg-white p-6 rounded-lg shadow-lg w-full max-w-md">
          {/* Logo */}
          <div className="flex justify-center mb-4">
            <Image
              src="/sfShield.png"
              alt="Shadow Foam Shield"
              width={50}
              height={50}
            />
          </div>

          {/* Welcome Text */}
          <h2 className="text-center text-2xl font-bold mb-4 text-black">
            Welcome!
          </h2>

          {/* Instructions Text */}
          <p className="text-center text-gray-600 mb-6">
            Please enter your details below
          </p>

          {/* Form */}
          <form onSubmit={onSubmit} className="space-y-4">
            {/* Email Input */}
            <div>
              <label
                htmlFor="email"
                className="block text-sm font-medium text-black"
              >
                Email:
              </label>
              <input
                type="email"
                id="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="mt-1 block w-full p-3 border border-gray-800 rounded-lg focus:ring focus:ring-blue-200 bg-white text-black"
                placeholder=""
                required
              />
            </div>

            {/* Password Input */}
            <div>
              <label
                htmlFor="password"
                className="block text-sm font-medium text-black"
              >
                Password:
              </label>
              <input
                type="password"
                id="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="mt-1 block w-full p-2 border border-gray-800 rounded-md focus:ring focus:ring-blue-200 bg-white text-black"
                placeholder=""
                required
              />
            </div>

            {error && (
              <div className="text-red-500 text-sm text-center">
                {error}
              </div>
            )}

            {/* Register Link */}
            <div className="text-sm text-blue-600 hover:underline text-right">
              <a href="">Forgot Password?</a>
            </div>

            {/* Log-In Button */}
            <div className="flex justify-center">
              <button
                type="submit"
                className="w-40 bg-linear-to-r from-gray-950 to-red-600 border border-black text-white p-2 rounded-xl hover:bg-[#b71c1c] transition flex items-center justify-center"
              >
                Log In
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
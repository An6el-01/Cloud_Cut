"use client";

import Image from "next/image";
import { useState, useEffect } from 'react';
import { useRouter } from "next/navigation";
import { signIn, getCurrentUser, checkAuth } from '@/utils/supabase';

export default function Home() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [mounted, setMounted] = useState(false);
  const router = useRouter();

  // Handle client-side mounting
  useEffect(() => {
    setMounted(true);
  }, []);

  // Check if already authenticated on mount
  useEffect(() => {
    const checkSession = async () => {
      try {
        const isAuthenticated = await checkAuth();
        if(isAuthenticated) {
          const user = await getCurrentUser();
          if (user?.user_metadata.needsPasswordReset){
            router.push("/resetPassword")
          }else{
            router.push("/manufacturing");
          }
        }
      } catch (error) {
        console.error('Auth check failed:', error);
      }
    };
    checkSession();
  }, [router]);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      await signIn(email, password);
      const user = await getCurrentUser();

      if (user?.user_metadata.needsPasswordReset) {
        router.push("/resetPassword");
      } else {
        router.push("/manufacturing");
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
          {error && <div className="text-red-500 text-sm text-center">{error}</div>}
          <div className="text-sm text-blue-600 hover:underline text-right">
            <a href="/resetPassword">Forgot Password?</a>
          </div>
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
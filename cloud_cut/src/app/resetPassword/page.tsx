"use client";
import { useState} from 'react';
import { AuthError, createClient } from "@supabase/supabase-js";
import { useRouter } from "next/navigation";

const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

export default function ResetPassword() {
    const [password, setPassword] = useState("");
    const [confirmPassword, setConfirmPassword] = useState("");
    const [error, setError] = useState<string | null>(null);
    const [success, setSuccess] = useState<string | null>(null);
    const router = useRouter();

    const handleResetPassword = async (e: React.FormEvent) => {
        e.preventDefault();
        setError(null);
        setSuccess(null);

        if (password !== confirmPassword) {
            setError("Passwords do not match");
            return;
        }

        if (password.length < 8) {
            setError("Password must be at least 8 characters long")
            return;
        }

        try{
            const { error } = await supabase.auth.updateUser({
                password,
                data: { needsPasswordReset: false }
            });

            if (error) {
                throw error;
            }

            setSuccess("Password updated successfully! Redirecting to login...");
            setTimeout(() => {
                router.push("/");
            }, 3000);
        } catch (error: unknown) {
            if (error instanceof AuthError) {
              if (error.code === "weak_password") {
                setError("Password is too weak. Please use a stronger password.");
              } else {
                setError(error.message || "An error occurred");
              }
            } else if (error instanceof Error) {
                setError(error.message || "An unexpected error occurred");
            } else{
                setError("An unexpected error occurred");
            }
        }
    };
    return (
        <div className="min-h-screen flex items-center justify-center">
          <div className="bg-white p-6 rounded-lg shadow-lg w-full max-w-md">
            <h2 className="text-center text-2xl font-bold mb-4 text-black">
              Set Your Password
            </h2>
            {error && <p className="text-center text-red-500 mb-4">{error}</p>}
            {success && <p className="text-center text-green-500 mb-4">{success}</p>}
            <form onSubmit={handleResetPassword} className="space-y-4">
              <div>
                <label htmlFor="password" className="block text-sm font-medium text-black">
                  New Password:
                </label>
                <input
                  type="password"
                  id="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="mt-1 block w-full p-3 border border-gray-800 rounded-lg focus:ring focus:ring-blue-200 bg-white text-black"
                  required
                />
              </div>
              <div>
                <label htmlFor="confirmPassword" className="block text-sm font-medium text-black">
                  Confirm Password:
                </label>
                <input
                  type="password"
                  id="confirmPassword"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  className="mt-1 block w-full p-3 border border-gray-800 rounded-lg focus:ring focus:ring-blue-200 bg-white text-black"
                  required
                />
              </div>
              <div className="flex justify-center">
                <button
                  type="submit"
                  className="w-40 bg-gradient-to-r from-gray-950 to-red-600 border border-black text-white p-2 rounded-xl hover:bg-[#b71c1c] transition"
                >
                  Set Password
                </button>
              </div>
            </form>
          </div>
        </div>
      );
}
"use client";
import { useState } from 'react';
import { AuthError } from "@supabase/supabase-js";
import { useRouter } from "next/navigation";
import { getSupabaseClient } from '@/utils/supabase';

export default function ResetPassword() {
    const [password, setPassword] = useState("");
    const [confirmPassword, setConfirmPassword] = useState("");
    const [error, setError] = useState<string | null>(null);
    const [success, setSuccess] = useState<string | null>(null);
    const [loading, setLoading] = useState(false);
    const router = useRouter();

    const handleResetPassword = async (e: React.FormEvent) => {
        e.preventDefault();
        setError(null);
        setSuccess(null);
        setLoading(true);

        try {
            // Basic validation
            if (password !== confirmPassword) {
                setError("Passwords do not match");
                return;
            }

            if (password.length < 8) {
                setError("Password must be at least 8 characters long");
                return;
            }

            // Password strength validation
            const hasUpperCase = /[A-Z]/.test(password);
            const hasLowerCase = /[a-z]/.test(password);
            const hasNumbers = /\d/.test(password);
            const hasSpecialChar = /[!@#$%^&*(),.?":{}|<>]/.test(password);

            if (!hasUpperCase || !hasLowerCase || !hasNumbers || !hasSpecialChar) {
                setError(
                    "Password must contain at least one uppercase letter, one lowercase letter, one number, and one special character"
                );
                return;
            }

            const supabase = getSupabaseClient();
            const { error: updateError } = await supabase.auth.updateUser({
                password,
                data: { needsPasswordReset: false }
            });

            if (updateError) {
                throw updateError;
            }

            setSuccess("Password updated successfully! Redirecting to login...");
            
            // Wait a moment before redirecting
            setTimeout(() => {
                router.push("/");
            }, 3000);

        } catch (error: unknown) {
            console.error('Password reset error:', error);
            
            if (error instanceof AuthError) {
                if (error.message.includes('weak_password')) {
                    setError("Password is too weak. Please use a stronger password.");
                } else {
                    setError(error.message || "An error occurred while resetting your password");
                }
            } else if (error instanceof Error) {
                setError(error.message || "An unexpected error occurred");
            } else {
                setError("An unexpected error occurred while resetting your password");
            }
        } finally {
            setLoading(false);
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
                            disabled={loading}
                            minLength={8}
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
                            disabled={loading}
                            minLength={8}
                        />
                    </div>
                    <div className="text-sm text-gray-600">
                        Password must contain:
                        <ul className="list-disc list-inside">
                            <li>At least 8 characters</li>
                            <li>One uppercase letter</li>
                            <li>One lowercase letter</li>
                            <li>One number</li>
                            <li>One special character</li>
                        </ul>
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
                                "Set Password"
                            )}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
}
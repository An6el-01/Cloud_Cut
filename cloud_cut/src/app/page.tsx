import Image from "next/image";
import Link from 'next/link';

export default function Home() {
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
          <form className="space-y-4">
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
                className="mt-1 block w-full p-3 border border-gray-800 rounded-lg focus:ring focus:ring-blue-200 bg-white text-black"
                placeholder=""
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
                className="mt-1 block w-full p-2 border border-gray-800 rounded-md focus:ring focus:ring-blue-200 bg-white text-black"
                placeholder=""
              />
            </div>

            {/* Register Link */}
            <div className="text-sm text-blue-600 hover:underline text-right">
              <a href="">Forgot Password?</a>
            </div>

            {/* Log-In Button */}
            <div className="flex justify-center">
              <Link href={"/manufacturing"}>
              <button
                type="submit"
                className="w-40 bg-linear-to-r from-gray-950 to-red-600 border-amber-400 text-white  p-2 rounded-xl hover:bg-[#b71c1c] transition flex items-center justify-center"
              >
                Log In
              </button>
              </Link>
              
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
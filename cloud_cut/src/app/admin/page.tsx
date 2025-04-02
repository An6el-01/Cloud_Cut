"use client";

import Navbar from '@/components/Navbar';



export default function admin() {
    return(
        <div className="relative min-h-screen">
            <div className="fixed top-0 left-0 w-full z-10">
                <Navbar/>
            </div>
        </div>
    )
}
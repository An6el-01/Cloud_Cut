"use client"

import NavBar from "@/components/Navbar";
import { useEffect, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import { AppDispatch, RootState} from '@/redux/store';
import Sentry from '@sentry/nextjs';
import Image from "next/image";

export default function Stock() {
    const dispatch = useDispatch<AppDispatch>();
    const [activeTab, setActiveTab] = useState<'StockManagement' | 'DamageTracking'>('StockManagement');
    const {loading, error, items} = useSelector((state: RootState) => state.stock);

    return (
        <div className="min-h-screen">
            {/**NavBar */}
            <NavBar />

            {/**Pill Section */}
            <div className="container mx-auto pt-28 flex justify-center gap-8">
                <div className="flex justify-center">
                    <div className="relative bg-[#2b3544] rounded-full shadow-xl p-1 inline-flex border border-gray-700 w-[320px]">
                        {/**Sliding background that moves based on active tab */}
                        <div className={`sliding-pill ${activeTab === 'StockManagement' ? 'pill-first' : 'pill-second'}`}></div>
                            {/**Stock Management Tab */}
                            <button
                                onClick={ async () => {
                                    await Sentry.startSpan({
                                        name: 'setActiveTab-StockManagement',
                                    }, async () => {
                                        setActiveTab('StockManagement');
                                    });
                                }}
                                className="relative rounded-full font-medium transition-all duration-300 z-10 flex-1 py-2 px-3"
                            >
                                <span className={`relative z-10 flex items-center justify-center gap-1.5 whitespace-nowrap
                                     ${activeTab === 'StockManagement' ? 'text-white font-semibold' : 'text-gray-300 hover:text-white'}`}>
                                    Stock Management
                                </span>
                            </button>

                            {/**Damage Tracking Tab */}
                            <button
                                onClick={async () => {
                                    await Sentry.startSpan({
                                        name: 'setActiveTab-DamageTracking',
                                    }, async () => {
                                        setActiveTab('DamageTracking');
                                    });
                                }}
                                className="relative rounded-full font-medium transition-all duration-300 z-10 flex-1 py-2 px-3"
                            >
                                <span className={`relative z-10 flex items-center justify-center gap-1.5 whitespace-nowrap
                                    ${activeTab === 'DamageTracking' ? 'text-white font-semibold' : 'text-gray-300 hover:text-white'}`}>
                                    Damage Tracking
                                </span>
                            </button>
                    </div>  
                </div>
            </div>

            <div className="container mx-auto pt-10 mb-8 p-6 flex justify-center gap-8">
                {/**Medium Sheet Stock Table */}
                <div className="flex-1 max-w-8xl">
                    <div className="bg-[#1d1d1d]/90 rounded-t-lg backdrop-blur-sm p-4">
                        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
                            <h1 className="text-white text-3xl font-semibold">
                                Medium Sheet Stock
                            </h1>

                            <div className="flex flex-wrap items-center gap-3">
                                <div className="flex items-center gap-4">
                                    <button
                                        className={`flex items-center gap-2 px-3.5 py-2 text-white font-medium rounded-lg transition-all duration-300 bg-gradient-to-br from-red-700 to-red-800 hover:from-red-600 hover:to-red-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-red-500 shadow-md hover:shadow-lg disabled:opacity-70 disabled:cursor-not-allowed`}
                                        aria-label="Add New Item"
                                    >
                                        <span>
                                            Add New Item
                                        </span>
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>
                    <div className="overflow-x-auto bg-white h-[calc(100vh-300px)] flex flex-col">
                        {loading ? (
                            <div className="flex-1 flex flex-col items-center justify-center bg-gray-50 p-6">
                                <div className="w-12 h-12 rounded-full border-4 border-gray-300 border-t-blue-600 animate-spin mb-4"></div>
                                <p className="text-gray-700 font-medium">Loading Stock Data...</p>
                                <p className="text-gray-500 text-sm mt-2">Retrieving data from database</p>
                            </div>
                        ) : error ? (
                            <div className="text-center py-4">
                                <p className="text-red-500">{error}</p>
                            </div>
                        ) : (
                            <>
                                <div className="flex-1 overflow-y-auto">
                                    <table className="w-full bg-white/90 backdrop-blur-sm border border-gray-20 table-auto h-full">
                                        <thead className="bg-gray-100/90 sticky top-0">
                                            <tr>
                                                <th className="px-4 py-4 text-center text-black text-md">Color</th>
                                                <th className="px-4 py-4 text-center text-black text-md">30mm Stock</th>
                                                <th className="px-4 py-4 text-center text-black text-md">50mm Stock</th>
                                                <th className="px-4 py-4 text-center text-black text-md">70mm Stock</th>
                                                <th className="px-4 py-4 text-center text-black text-md">Edit</th>
                                                <th className="px-4 py-4 text-center text-black text-md">Delete</th>
                                            </tr> 
                                        </thead>
                                        <tbody>
                                            {items.map((item) => (
                                                <tr
                                                    key={item.id}
                                                    className="transition-all duration-200 cursor-pointer text-center h-[calc((100vh-300px-48px)/15)]"
                                                >
                                                    <td className="px-4 py-2 text-black">{item.color}</td>
                                                    <td className="px-4 py-2 text-black">{item.thirty_mm_stock}</td>
                                                    <td className="px-4 py-2 text-black">{item.fifty_mm_stock}</td>
                                                    <td className="px-4 py-2 text-black">{item.seventy_mm_stock}</td>
                                                    <td className="px-4 py-2 text-black">
                                                        <button 
                                                            className="flex justify-center items-center h-full w-full hover:bg-gray-100 rounded-full p-2 transition-colors focus:outline-none focus:ring-2 focus:ring-gray-300"
                                                            onClick={() => {}}
                                                            aria-label="Edit an item"
                                                        >
                                                            <Image
                                                                src="/editPencil.png"
                                                                alt=""
                                                                width={15}
                                                                height={15}
                                                            />
                                                        </button>
                                                    </td>
                                                    <td className="px-4 py-2 text-black">
                                                        <button
                                                            className="flex justify-center items-center h-full w-full hover:bg-gray-100 rounded-full p-2 transition-colors focus:outline-none focus:ring-2 focus:ring-gray-300"
                                                            onClick={() => {}}
                                                            aria-label="Delete an item"
                                                        >
                                                            <Image
                                                                src="/binClosed.png"
                                                                alt=""
                                                                width={15}
                                                                height={15}
                                                            />
                                                        </button>
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            </>
                        )}
                    </div>
                </div>
            </div>
        </div>
    )
}

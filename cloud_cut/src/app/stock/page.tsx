"use client"

import NavBar from "@/components/Navbar";
import { useEffect, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import { AppDispatch, RootState} from '@/redux/store';
import * as Sentry from '@sentry/nextjs';
import Image from "next/image";
import { fetchFinishedStockFromSupabase, syncFinishedStock } from "@/redux/thunks/stockThunk";

// Define the type for stock items
interface StockItem {
    id: number;
    sku: string;
    stock: number;
    item_name: string;
    created_at: string;
    updated_at: string;
}

// Add helper function to format medium sheet name
const formatMediumSheetName = (sku: string): string => {
    const parts = sku.split('-');
    if (parts.length >= 3) {
        const color = parts[1];
        const thickness = parts[2];
        return `${color} [${thickness}]`;
    }
    return sku;
};

// Add helper function to get color class for medium sheet
const getSheetColorClass = (sheetName: string): string => {
    const name = sheetName.toUpperCase();
    
    if (name.includes('BLACK')) return 'bg-gray-900';
    if (name.includes('BLUE')) return 'bg-blue-600';
    if (name.includes('GREEN')) return 'bg-green-600';
    if (name.includes('GREY') || name.includes('GRAY')) return 'bg-gray-500';
    if (name.includes('ORANGE')) return 'bg-orange-500';
    if (name.includes('PINK')) return 'bg-pink-500';
    if (name.includes('PURPLE')) return 'bg-purple-600';
    if (name.includes('RED')) return 'bg-red-600';
    if (name.includes('TEAL')) return 'bg-teal-500';
    if (name.includes('YELLOW')) return 'bg-yellow-500';
    
    return 'bg-gray-400';
};

export default function Stock() {
    const dispatch = useDispatch<AppDispatch>();
    const [activeTab, setActiveTab] = useState<'StockManagement' | 'DamageTracking'>('StockManagement');
    const {loading, error, items} = useSelector((state: RootState) => state.stock);
    const [isRefreshing, setIsRefreshing] = useState(false);
    const [currentPage, setCurrentPage] = useState(1);
    const itemsPerPage = 9;

    // Filter items to only show medium sheets
    const mediumSheetItems = items.filter(item => item.sku?.startsWith('SFS-'));
    
    // Calculate pagination
    const totalPages = Math.ceil(mediumSheetItems.length / itemsPerPage);
    const startIndex = (currentPage - 1) * itemsPerPage;
    const endIndex = startIndex + itemsPerPage;
    const currentItems = mediumSheetItems.slice(startIndex, endIndex);

    // Add debug logging
    useEffect(() => {
        console.log('All stock items:', items);
        console.log('Filtered medium sheet items:', items.filter((item: StockItem) => item.sku.startsWith('SFS-')));
    }, [items]);

    // Debug log for table rendering
    useEffect(() => {
        console.log('Rendering table with items:', currentItems);
    }, [currentItems]);

    const handleRefresh = () => {
        setIsRefreshing(true);
        dispatch(syncFinishedStock())
            .then(() => {
                dispatch(fetchFinishedStockFromSupabase({
                    page: 1,
                    perPage: 15
                }));
            })
            .catch((error: any) => {
                console.error('Error in syncFinishedStock:', error);
            })
            .finally(() => {
                setIsRefreshing(false);
            });
    }

    useEffect(() => {
        dispatch(fetchFinishedStockFromSupabase({
            page: 1,
            perPage: 15
        }));
    }, [dispatch]);

    const handlePageChange = (newPage: number) => {
        setCurrentPage(newPage);
    };

    return (
        <div className="min-h-screen">
            {/**NavBar */}
            <NavBar />

            {/**Pill Section */}
            <div className="container mx-auto pt-28 flex justify-center gap-8">
                <div className="flex justify-center">
                    <div className="relative bg-[#2b3544] rounded-full shadow-xl p-1 inline-flex border border-gray-700 w-[450px] overflow-hidden">
                        {/* Sliding background that moves based on active tab */}
                        <div className={`sliding-pill ${activeTab === 'StockManagement' ? 'pill-first' : 'pill-second'}`}></div>
                        {/* Stock Management Tab */}
                        <button
                            onClick={async () => {
                                await Sentry.startSpan({
                                    name: 'setActiveTab-StockManagement',
                                }, async () => {
                                    setActiveTab('StockManagement');
                                });
                            }}
                            className="relative rounded-full font-medium transition-all duration-300 z-10 flex-1 flex items-center justify-center py-2 px-6 min-w-[150px] h-12"
                        >
                            <span className={`relative z-10 flex items-center justify-center gap-2 px-2 whitespace-nowrap ${
                                activeTab === 'StockManagement' ? 'text-white font-semibold' : 'text-gray-300 hover:text-white'
                            }`}>
                                {/* Clipboard Icon */}
                                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 flex-shrink-0 mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 2a1 1 0 00-1 1v1H7a2 2 0 00-2 2v14a2 2 0 002 2h10a2 2 0 002-2V6a2 2 0 00-2-2h-1V3a1 1 0 00-1-1H9zm0 2h6v1H9V4z" />
                                </svg>
                                Stock Management
                            </span>
                        </button>
                        {/* Damage Tracking Tab */}
                        <button
                            onClick={async () => {
                                await Sentry.startSpan({
                                    name: 'setActiveTab-DamageTracking',
                                }, async () => {
                                    setActiveTab('DamageTracking');
                                });
                            }}
                            className="relative rounded-full font-medium transition-all duration-300 z-10 flex-1 flex items-center justify-center py-2 px-6 min-w-[150px] h-12"
                        >
                            <span className={`relative z-10 flex items-center justify-center gap-2 px-2 whitespace-nowrap ${
                                activeTab === 'DamageTracking' ? 'text-white font-semibold' : 'text-gray-300 hover:text-white'
                            }`}>
                                {/* Warning Icon */}
                                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 flex-shrink-0 mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01M21 20H3a2 2 0 01-1.72-2.97l9-16a2 2 0 013.44 0l9 16A2 2 0 0121 20z" />
                                </svg>
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
                                        onClick={async () => {
                                            try {
                                                await Sentry.startSpan({
                                                    name: 'handleRefresh-Stock',
                                                }, async () => {
                                                    handleRefresh();
                                                });
                                            } catch (error) {
                                                console.error('Error in Sentry span:', error);
                                                handleRefresh();
                                            }
                                        }}
                                        className="flex items-center gap-2 px-4 py-2 text-white font-semibold rounded-lg shadow transition-all duration-200
                                            bg-gradient-to-br from-gray-700 to-gray-800 hover:from-gray-500 hover:to-gray-600 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-gray-400
                                            disabled:opacity-70 disabled:cursor-not-allowed"
                                    >
                                        <span className={`${isRefreshing ? "animate-spin" : ""} text-red-400`}>
                                            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                                <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/>
                                                <path d="M21 3v5h-5"/>
                                                <path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/>
                                                <path d="M8 16H3v5"/>
                                            </svg>
                                        </span>
                                        <span>{isRefreshing ? "Syncing..." : "Refresh"}</span>
                                    </button>
                                    <button
                                        className="flex items-center gap-2 px-4 py-2 text-white font-semibold rounded-lg shadow transition-all duration-200
                                            bg-gradient-to-br from-green-600 to-green-700 hover:from-green-500 hover:to-green-600 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-green-400"
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
                                    <table className="w-full bg-white/90 backdrop-blur-sm border border-gray-20 table-auto">
                                        <thead className="bg-gray-100/90 sticky top-0">
                                            <tr>
                                                <th className="px-4 py-4 text-left text-black text-md">Medium Sheet</th>
                                                <th className="px-4 py-4 text-center text-black text-md">SKU</th>
                                                <th className="px-4 py-4 text-center text-black text-md">Stock</th>
                                                <th className="px-4 py-4 text-center text-black text-md">Edit</th>
                                                <th className="px-4 py-4 text-center text-black text-md">Delete</th>
                                            </tr> 
                                        </thead>
                                        <tbody>
                                            {currentItems.length > 0 ? (
                                                currentItems.map((item: StockItem) => (
                                                    <tr
                                                        key={item.id}
                                                        className="transition-all duration-200 cursor-pointer text-center h-16"
                                                    >
                                                        <td className="px-4 py-2 text-left">
                                                            <div className="flex items-center">
                                                                {/* Color pill using item_name for color matching */}
                                                                <span className={`w-8 h-4 rounded-full mr-3 ${getSheetColorClass(item.item_name)}`}></span>
                                                                <span className="text-black text-lg">
                                                                    {item.item_name}
                                                                </span>
                                                            </div>
                                                        </td>
                                                        <td className="px-4 py-2 text-center">
                                                            <span className="text-black text-lg">
                                                                {item.sku}
                                                            </span>
                                                        </td>
                                                        <td className="px-4 py-2 text-black">
                                                            <span className="inline-flex items-center justify-center min-w-[2.5rem] px-3 py-1 shadow-sm rounded-full text-lg text-black">
                                                                {item.stock}
                                                            </span>
                                                        </td>
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
                                                ))
                                            ) : (
                                                <tr>
                                                    <td colSpan={5} className="px-4 py-8 text-center    text-gray-500">
                                                        No medium sheet items found
                                                    </td>
                                                </tr>
                                            )}
                                        </tbody>
                                    </table>
                                </div>
                                {/* Pagination Controls */}
                                <div className="flex justify-center items-center gap-4 py-4 bg-white border-t border-gray-200">
                                    <button
                                        onClick={() => handlePageChange(currentPage - 1)}
                                        disabled={currentPage === 1}
                                        className="px-4 py-2 rounded-md bg-gray-100 text-gray-700 hover:bg-gray-200 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                                    >
                                        Previous
                                    </button>
                                    <div className="flex items-center gap-2">
                                        {Array.from({ length: totalPages }, (_, i) => i + 1).map((pageNum) => (
                                            <button
                                                key={pageNum}
                                                onClick={() => handlePageChange(pageNum)}
                                                className={`w-8 h-8 rounded-md ${
                                                    currentPage === pageNum
                                                        ? 'bg-red-600 text-white'
                                                        : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                                                } transition-colors`}
                                            >
                                                {pageNum}
                                            </button>
                                        ))}
                                    </div>
                                    <button
                                        onClick={() => handlePageChange(currentPage + 1)}
                                        disabled={currentPage === totalPages}
                                        className="px-4 py-2 rounded-md bg-gray-100 text-gray-700 hover:bg-gray-200 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                                    >
                                        Next
                                    </button>
                                </div>
                            </>
                        )}
                    </div>
                </div>
            </div>
        </div>
    )
}

"use client";

import NavBar from "@/components/Navbar";
import { useEffect, useState } from "react";
import { useDispatch , useSelector } from "react-redux";
import { AppDispatch, RootState, store } from "@/redux/store";
import { subscribeToOrderItems, subscribeToOrders, getCurrentUser } from "@/utils/supabase";
import { OrderItem, Order } from "@/types/redux";
import { supabase } from "@/utils/supabase";
import RetailPackConfirm from "@/components/retailPackConfirm";

export default function Picking () {
    const { loading, error} = useSelector((state: RootState) => state.orders);
    const [isRefreshing, setIsRefreshing] = useState(false);
    const [allRetailPacksChecked, setAllRetailPacksChecked] = useState(false);
    const [retailPackFilter, setRetailPackFilter] = useState('');
    const [retailPackPage, setRetailPackPage] = useState(1);
    const retailPacksPerPage = 15;
    const [retailPackTableBPage, setRetailPackTableBPage] = useState(1);
    const [ordersWithRetailPacks, setOrdersWithRetailPacks] = useState<Record<string, Order[]>>({});
    const allOrderItems = useSelector((state: RootState) => state.orders.orderItems);
    const [loadingRetailPackOrders, setLoadingRetailPackOrders] = useState(false);
    const [pendingRetailPackOrders, setPendingRetailPackOrders] = useState<RetailPackOrders>([]);
    const [showRetailPackConfirmDialog, setShowRetailPackConfirmDialog] = useState(false);
    const [selectedRetailPack, setSelectedRetailPack] = useState<string | null>(null);
    const [checkedRetailPacks, setCheckedRetailPacks] = useState<Record<string, boolean>>({});

    type RetailPackOrders = { retailPackName: string; orderIds: string[] }[];
    
    
    const orderPriorities = useSelector((state: RootState) =>
        state.orders.allOrders.reduce((acc, order) => {
            const orderItems = state.orders.orderItems[order.order_id] || [];
            acc[order.order_id] = orderItems.length > 0
                ? Math.max(...orderItems.map((item) => item.priority || 0))
                : 0;
            return acc;
        }, {} as Record<string, number>)
    );

    const itemsByRetailPack = useSelector((state: RootState) => {
        const allOrderItems = state.orders.allOrders.flatMap((order: Order) => {
            const orderItems = state.orders.orderItems[order.order_id] || [];
            return orderItems;
        });

        const retailPackItems = allOrderItems.reduce((acc: Record<string, number>, item: OrderItem) => {
            if (item.item_name.includes('Retail Pack')) {
                acc[item.item_name] = (acc[item.item_name] || 0) + item.quantity;
            }
            return acc;
        }, {} as Record<string, number>);
        return retailPackItems;
    });

    //Function to compute the total number of retail packs after filtering
    const getFilteredRetailPacks = () => {
        return Object.entries(itemsByRetailPack)
            .filter(([itemName]) => {
                if(!retailPackFilter) return true;
                return itemName.toLowerCase().includes(retailPackFilter.toLowerCase());
            })
            .sort(([itemNameA, quantityA], [itemNameB, quantityB]) => {
                // Sort by quantity (highest first)
                return quantityB - quantityA;
            });
    };

    // Function to get Retail Packs for Table A
    const getTableARetailPacks = () => {
        const filteredPacks = getFilteredRetailPacks();
        const startIndex = (retailPackPage - 1) * retailPacksPerPage;
        const endIndex = Math.min(startIndex + retailPacksPerPage, filteredPacks.length);

        // Table A gets the first 10 items of the current page
        return filteredPacks.slice(startIndex, endIndex);
    };

    const getTableBRetailPacks = () => {
        const filteredPacks = getFilteredRetailPacks();
        const totalPacks = filteredPacks.length;

        // Table B starts at the 11th item, and provides items from its own page
        const tableBStartIndex = retailPacksPerPage + (retailPackTableBPage -1) * retailPacksPerPage;
        const tableBEndIndex = Math.min(tableBStartIndex + retailPacksPerPage, totalPacks);
        
        //Only return items if Table A is full (has 10 items)
        if (totalPacks <= retailPacksPerPage){
            return [];
        }

        return filteredPacks.slice(tableBStartIndex, tableBEndIndex);
    };

    const findOrdersWithRetailPack = (retailPack: string | null) => {
        if(!retailPack) return [];

        // Return cached orders if already fetched
        if(ordersWithRetailPacks[retailPack]) {
            return ordersWithRetailPacks[retailPack];
        }

        // Find all order IDs that have this retail pack
        const orderIdsWithRetailPack = new Set<string>();

        // Check each order's items for the retail pack name
        Object.entries(allOrderItems).forEach(([orderId, items]) => {
            const matchingItems = items.filter(item => item.item_name === retailPack);

            if (matchingItems.length > 0){
                orderIdsWithRetailPack.add(orderId);
            }
        });

        // Convert Set to Array
        const orderIdsArray = Array.from(orderIdsWithRetailPack);

        //Initialize with empty array to avoid undefined
        if (!ordersWithRetailPacks[retailPack]) {
            setOrdersWithRetailPacks(prev => ({
                ...prev,
                [retailPack]: []
            }));
        }

        //If we have order IDs, fetch them from the database
        if (orderIdsArray.length > 0) {
            //Fetch order data from supabase in the background
            setLoadingRetailPackOrders(true);

            const fetchOrders = async () => {
                try{
                    const { data: fetchedOrders, error } = await supabase
                        .from('orders')
                        .select('*')
                        .in('order_id', orderIdsArray)
                        .eq('status', 'Pending')
                        .eq('manufactured', true)
                        .eq('packed', false)
                    if(error) {
                        console.error('Error fetching orders for retail pack:', error);
                        return;
                    }

                    if(fetchedOrders) {
                        // Type casting to ensure we're setting Order[] type
                        const typedOrders = fetchedOrders as unknown as Order[];

                        //Sort orders by priority using the orderPriorities from Redux state
                        const sortedOrders = [...typedOrders].sort((a, b) => {
                            const priorityA = orderPriorities[a.order_id] || 0;
                            const priorityB = orderPriorities[b.order_id] || 0;
                            return priorityB - priorityA;
                        });

                        setOrdersWithRetailPacks(prev => ({
                            ...prev,
                            [retailPack]: sortedOrders
                        }));
                    }
                } catch (err) {
                    console.error('Error in findOrdersWithRetailPack:', err);
                } finally {
                    setLoadingRetailPackOrders(false);
                }
            };

            fetchOrders();
        }
        return ordersWithRetailPacks[retailPack] || [];
    }
    
    useEffect(() => {
        setCheckedRetailPacks({});
    }, [retailPackPage]);

    const getRetailPackColorClass = (retailPackName: string): string => {
        if (retailPackName.includes('BLACK')) return 'bg-black';
        if (retailPackName.includes('WHITE')) return 'bg-white';
        if (retailPackName.includes('GREEN')) return 'bg-green-500';
        if (retailPackName.includes('RED')) return 'bg-red-500';
        if (retailPackName.includes('BLUE')) return 'bg-blue-500';
        if (retailPackName.includes('YELLOW')) return 'bg-yellow-400';
        if (retailPackName.includes('ORANGE')) return 'bg-orange-500';
        if (retailPackName.includes('PURPLE')) return 'bg-purple-500';
        if (retailPackName.includes('PINK')) return 'bg-pink-400';
        if (retailPackName.includes('GREY')) return 'bg-gray-400';
        if (retailPackName.includes('TEAL')) return 'bg-teal-500';
        // Default color if no match
        return 'bg-gray-400';
    }

    const calculateTotalPages = () => {
        const filteredPacks = getFilteredRetailPacks();
        const totalItems = filteredPacks.length;

        // Table A always has at least 1 page
        const tableATotalPages = Math.ceil(Math.min(totalItems, retailPacksPerPage) / retailPacksPerPage) || 1;

        // Table B only has pages if there are more that 10 items total
        let tableBTotalPages = 0;
        if (totalItems > retailPacksPerPage) {
            // Calculate how many additional pages are needed for Table B
            tableBTotalPages = Math.ceil((totalItems - retailPacksPerPage) / retailPacksPerPage);
        }

        return { tableATotalPages, tableBTotalPages };
    };

    const handleTableAPageChange = (newPage: number) => {
        if (newPage >= 1) {
            const { tableATotalPages } = calculateTotalPages();
            if (newPage <= tableATotalPages) {
                setRetailPackPage(newPage);
            }
        }
    }

    const handleTableBPageChange = (newPage: number) => {
        if (newPage >= 1) {
            const { tableBTotalPages } = calculateTotalPages();
            if (newPage <= tableBTotalPages) {
                setRetailPackTableBPage(newPage);
            }
        }
    }

    // const handleRetailPackClick = (retailPack: string) => {
    //     setSelectedRetailPack(retailPack);

    // }

    return(
        <div className="min-h-screen flex flex-col">
            <NavBar />
            <div className="flex flex-1 items-center justify-center">
            <div className="container mx-auto pt-10 mb-8 p-6 flex justify-center gap-8">
                {/**Retail Packs Section - Table A */}        
                    <div className="flex-1 max-w-3xl">
                        <div className="bg-[#1d1d1d]/90 rounded-t-lg flex justify-between items-center backdrop-blur-sm p-4">
                            <h1 className="text-2xl font-bold text-white">Table A</h1>
                        </div>
                        <div className="overflow-x-auto bg-white h-[calc(91vh-270px)] flex flex-col">
                            {loading ? (
                                <div className="flex-1 flex flex-col items-center justify-center bg-gray-50 p-6">
                                    <div className="w-12 h-12 rounded-full border-4 border-gray-300 border-t-blue-600 animate-spin mb-4"></div>
                                    <p className="text-gray-700 font-medium">Loading Retail Packs...</p>
                                </div>
                            ) : error ? (
                                <div className="text-center py-4">
                                    <p className="text-red-500">{error}</p>
                                </div>
                            ) : (
                                <div className="flex flex-col h-full">
                                    <div className="flex-1 overflow-y-auto min-h-[400px]">
                                        <table className="w-full bg-white/90 backdrop-blur-sm border border-gray-200 table-auto">
                                            <thead className="bg-gray-100/90 sticky top-0">
                                                <tr>
                                                    <th className="px-6 py-4 text-left text-lg font-semibold text-black">Retail Pack</th>
                                                    <th className="px-6 py-4 text-center text-lg font-semibold text-black">Quantity</th>
                                                    <th className="px-6 py-4 text-center">
                                                        <div className="flex justify-center" onClick={(e) => e.stopPropagation()}>
                                                            <label className="relative inline-flex items-center cursor-pointer">
                                                                <input
                                                                    type="checkbox"
                                                                    checked={allRetailPacksChecked}
                                                                    onChange={() => {
                                                                        // Instead of marking immediately, open confirm dialog with pending data
                                                                        const tableARetailPacks = getTableARetailPacks();
                                                                        const tableARetailPackOrders = tableARetailPacks.map(([retailPackName]) => ({
                                                                            retailPackName,
                                                                            orderIds: (findOrdersWithRetailPack(retailPackName) || []).map(order => order.order_id)
                                                                        }));
                                                                        setPendingRetailPackOrders(tableARetailPackOrders);
                                                                        setShowRetailPackConfirmDialog(true);
                                                                    }}
                                                                    className="sr-only peer"
                                                                    aria-label="Mark all retail packs as packed"
                                                                    disabled={getTableARetailPacks().length === 0}
                                                                />
                                                                <div className="w-5 h-5 border-2 border-black rounded peer-checked:bg-green-500 peer-checked:border-green-500 peer-focus:ring-2 peer-focus:ring-green-400/50 transition-all flex items-center justify-center">
                                                                    {allRetailPacksChecked && (
                                                                        <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                                                        <path d="M12 22c5.523 0 10-4.477 10-10S17.523 2 12 2 2 6.477 2 12s4.477 10 10 10z" />
                                                                        <path d="m9 12 2 2 4-4" />
                                                                      </svg>
                                                                    )}
                                                                </div>
                                                            </label>
                                                        </div>
                                                    </th>
                                                </tr>
                                            </thead>
                                            <tbody className="divide-y divide-gray-300">
                                                {isRefreshing ? (
                                                    //Skeleton loading rows while refreshing
                                                    [...Array(5)].map((_, index) => (
                                                        <tr key={`skeleton-${index}`} className="animate-pulse">
                                                            <td className="px-6 py-5">
                                                                <div className="h-4 bg-gray-600 rounded w-20 mx-auto opacity-40"></div>
                                                            </td>
                                                            <td className="px-6 py-5">
                                                                <div className="h-4 bg-gray-600 rounded w-20 mx-auto opacity-40"></div>
                                                            </td>
                                                        </tr>
                                                    ))
                                                ) : (
                                                    //Render Retail Packs and their quantities for Table A
                                                    getTableARetailPacks().length === 0 ? (
                                                        <tr>
                                                            <td colSpan={3} className="px-6 py-10 text-center">
                                                                <div className="flex flex-col items-center justify-center h-60 text-black">
                                                                    <svg xmlns="http://www.w3.org/2000/svg" className="h-12 w-12 mb-3 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                                                                    </svg>
                                                                    <p className="text-lg font-medium">No retail packs in pending orders</p>
                                                                    <p className="text-sm text-gray-500 mt-1">There are no retail packs in the orders ready for packing</p>
                                                                </div>
                                                            </td>
                                                        </tr>
                                                    ) : (
                                                        getTableARetailPacks().map(([itemName, quantity], index) => (
                                                            <tr 
                                                                key={itemName} 
                                                                className={`transition-colors duration-150 h-14
                                                                    ${selectedRetailPack === itemName ? 'bg-blue-50' : (index % 2 === 0 ? 'bg-white' : 'bg-gray-50')} 
                                                                    hover:bg-blue-50 cursor-pointer shadow-sm`}
                                                                // onClick={() => handleRetailPackClick(itemName)}
                                                            >
                                                                <td className="px-6 py-3 text-left">
                                                                    <div className="flex items-center space-x-3">
                                                                        <div className={`w-4 h-4 rounded-full mr-3 ${getRetailPackColorClass(itemName)}`}></div>
                                                                        <span className="text-black text-lg">
                                                                            {itemName}
                                                                        </span>
                                                                    </div>
                                                                </td>
                                                                <td className="px-6 py-3 text-center">
                                                                    <span className="inline-flex items-center justify-center min-w-[2.5rem] px-3 py-1 shadow-sm rounded-full text-lg text-black">
                                                                        {quantity}
                                                                    </span>
                                                                </td>
                                                                <td className="px-6 py-3 text-center">
                                                                    <label 
                                                                    className="inline-flex items-center cursor-pointer"
                                                                    onClick={e => e.stopPropagation()}
                                                                    >
                                                                        <input
                                                                            type="checkbox"
                                                                            checked={!!checkedRetailPacks[itemName]}
                                                                            onChange={() => {
                                                                                const retailPackName = itemName;
                                                                                const orderIds = (findOrdersWithRetailPack(retailPackName) || []).map(order => order.order_id);
                                                                                setPendingRetailPackOrders([{ retailPackName, orderIds }]);
                                                                                setShowRetailPackConfirmDialog(true);
                                                                            }}
                                                                            onClick={e => e.stopPropagation()}
                                                                            className="sr-only peer"
                                                                            aria-label={`Mark all ${itemName} retail packs as packed`}
                                                                        />
                                                                        <div className="w-5 h-5 border-2 border-black rounded peer-checked:bg-green-500 peer-checked:border-green-500 peer-focus:ring-2 peer-focus:ring-green-400/50 transition-all flex items-center justify-center">
                                                                            {!!checkedRetailPacks[itemName] && (
                                                                                <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                                                                    <path d="M12 22c5.523 0 10-4.477 10-10S17.523 2 12 2 2 6.477 2 12s4.477 10 10 10z" />
                                                                                    <path d="m9 12 2 2 4-4" />
                                                                                </svg>
                                                                            )}
                                                                        </div>
                                                                    </label>
                                                                </td>
                                                            </tr>
                                                        ))
                                                    )
                                                )}
                                            </tbody>
                                        </table>
                                    </div>
                                    <div className="flex justify-between items-center bg-white/90 backdrop-blur-sm p-4 border border-gray-200 mt-auto">
                                        <div className="text-sm text-gray-600">
                                            {getFilteredRetailPacks().length} retail packs found
                                        </div>
                                        {calculateTotalPages().tableATotalPages > 0 && (
                                            <div className="flex gap-2">
                                                <button
                                                    onClick={() => handleTableAPageChange(retailPackPage - 1)}
                                                    disabled={retailPackPage === 1}
                                                    className="px-3 py-1 rounded bg-gray-200 text-gray-700 disabled:opacity-50 disabled:cursor-not-allowed"
                                                >
                                                    Previous
                                                </button>
                                                <span>
                                                    Page {retailPackPage} of {calculateTotalPages().tableATotalPages}
                                                </span>
                                                <button
                                                    onClick={() => handleTableAPageChange(retailPackPage + 1)}
                                                    disabled={retailPackPage >= calculateTotalPages().tableATotalPages}
                                                    className="px-3 py-1 rounded bg-gray-200 text-gray-700 disabled:opacity-50 disabled:cursor-not-allowed"
                                                >
                                                    Next
                                                </button>
                                            </div>
                                        )}
                                    </div>
                                </div>
                            )}     
                        </div>
                    </div>
                {/**Retail Packs Section2 - Table B */}
                    <div className="flex-1 max-w-3xl">
                        <div className="bg-[#1d1d1d]/90 rounded-t-lg flex justify-between items-center backdrop-blur-sm p-4">
                            <h1 className="text-2xl font-bold text-white">Table B</h1>
                        </div>
                        <div className="overflow-x-auto bg-white h-[calc(91vh-270px)] flex flex-col">
                            {loading ? (
                                <div className="flex-1 flex flex-col items-center justify-center bg-gray-50 p-6">
                                    <div className="w-12 h-12 rounded-full border-4 border-gray-300 border-t-blue-600 animate-spin mb-4"></div>
                                    <p className="text-gray-700 font-medium">Loading Retail Packs...</p>
                                </div>
                            ) : error ? (
                                <div className="text-center py-4">
                                    <p className="text-red-500">{error}</p>
                                </div>
                            ) : (
                                <div className="flex flex-col h-full">
                                    <div className="flex-1 overflow-y-auto min-h-[400px]">
                                        <table className="w-full bg-white/90 backdrop-blur-sm border border-gray-200 table-auto">
                                            <thead className="bg-gray-100/90 sticky top-0">
                                                <tr>
                                                    <th className="px-6 py-4 text-left text-lg font-semibold text-black">Retail Pack</th>
                                                    <th className="px-6 py-4 text-center text-lg font-semibold text-black">Quantity</th>
                                                    <th className="px-6 py-4 text-center">
                                                        <div className="flex justify-center" onClick={(e) => e.stopPropagation()}>
                                                            <label className={`relative inline-flex items-center cursor-pointer`}>
                                                                <input
                                                                    type="checkbox"
                                                                    checked={allRetailPacksChecked}
                                                                    onChange={() => {
                                                                        //Instead of making it immediate, open the confirm dialog with the pending data
                                                                        const tableBRetailPacks = getTableBRetailPacks();
                                                                        const tableBRetailPackOrders = tableBRetailPacks.map(([retailPackName]) => ({
                                                                            retailPackName,
                                                                            orderIds: (findOrdersWithRetailPack(retailPackName) || []).map(order => order.order_id)
                                                                        }));
                                                                        setPendingRetailPackOrders(tableBRetailPackOrders);
                                                                        setShowRetailPackConfirmDialog(true);
                                                                    }}
                                                                    className="sr-only peer"
                                                                    aria-label="Mark all retail packs as packed"
                                                                    disabled={getTableBRetailPacks().length === 0}
                                                                />
                                                                <div className="w-5 h-5 border-2 border-black rounded peer-checked:bg-green-500 peer-checked:border-green-500 peer-focus:ring-2 peer-focus:ring-green-400/50 transition-all flex items-center justify-center">
                                                                    {allRetailPacksChecked && (
                                                                        <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                                                        <path d="M12 22c5.523 0 10-4.477 10-10S17.523 2 12 2 2 6.477 2 12s4.477 10 10 10z" />
                                                                        <path d="m9 12 2 2 4-4" />
                                                                      </svg>
                                                                    )}
                                                                </div>
                                                            </label>
                                                        </div>
                                                    </th>
                                                </tr>
                                            </thead>
                                            <tbody className="divide-y divide-gray-300">
                                                {isRefreshing ? (
                                                    //Skeleton loading rows while refreshing
                                                    [...Array(5)].map((_, index) => (
                                                        <tr key={`skeleton-${index}`} className="animate-pulse">
                                                            <td className="px-6 py-5">
                                                                <div className="h-4 bg-gray-600 rounded w-20 mx-auto opacity-40"></div>
                                                            </td>
                                                            <td className="px-6 py-5">
                                                                <div className="h-4 bg-gray-600 rounded w-20 mx-auto opacity-40"></div>
                                                            </td>
                                                        </tr>
                                                    ))
                                                ) : (
                                                    //Render Retail Packs and their quantities for Table B
                                                    getTableBRetailPacks().length === 0 ? (
                                                        <tr>
                                                            <td colSpan={3} className="px-6 py-10 text-center">
                                                                <div className="flex flex-col items-center justify-center h-60 text-black">
                                                                    {getFilteredRetailPacks().length <= retailPacksPerPage ? (
                                                                        <>
                                                                            <svg xmlns="http://www.w3.org/2000/svg" className="h-12 w-12 mb-3 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                                                                            </svg>
                                                                            <p className="text-lg font-medium">All retail packs are in Table A</p>
                                                                            <p className="text-sm text-gray-500 mt-1">Table B is not needed</p>
                                                                        </>
                                                                    ) : (
                                                                        <>
                                                                            <svg xmlns="http://www.w3.org/2000/svg" className="h-12 w-12 mb-3 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4" />
                                                                            </svg>
                                                                            <p className="text-lg font-medium">No additional retail packs</p>
                                                                            <p className="text-sm text-gray-500 mt-1">There are no additional retail packs to display in Table B</p>
                                                                        </>
                                                                    )}
                                                                </div>
                                                            </td>
                                                        </tr>
                                                    ) : (
                                                        getTableBRetailPacks().map(([itemName, quantity], index) => (
                                                            <tr 
                                                                key={itemName} 
                                                                className={`transition-colors duration-150 h-14
                                                                    ${selectedRetailPack === itemName ? 'bg-blue-50' : (index % 2 === 0 ? 'bg-white' : 'bg-gray-50')} 
                                                                    hover:bg-blue-50 cursor-pointer shadow-sm`}
                                                                // onClick={() => handleRetailPackClick(itemName)}
                                                            >
                                                                <td className="px-6 py-3 text-left">
                                                                    <div className="flex items-center space-x-3">
                                                                        <div className={`w-4 h-4 rounded-full mr-3 ${getRetailPackColorClass(itemName)}`}></div>
                                                                        <span className="text-black text-lg">
                                                                            {itemName}
                                                                        </span>
                                                                    </div>
                                                                </td>
                                                                <td className="px-6 py-3 text-center">
                                                                    <span className="inline-flex items-center justify-center min-w-[2.5rem] px-3 py-1 shadow-sm rounded-full text-lg text-black">
                                                                        {quantity}
                                                                    </span>
                                                                </td>
                                                                <td className="px-6 py-3 text-center">
                                                                    <label 
                                                                    className="inline-flex items-center cursor-pointer"
                                                                    onClick={e => e.stopPropagation()}
                                                                    >
                                                                        <input
                                                                            type="checkbox"
                                                                            checked={!!checkedRetailPacks[itemName]}
                                                                            onChange={() => {
                                                                                const retailPackName = itemName;
                                                                                const orderIds = (findOrdersWithRetailPack(retailPackName) || []).map(order => order.order_id);
                                                                                setPendingRetailPackOrders([{ retailPackName, orderIds }]);
                                                                                setShowRetailPackConfirmDialog(true);
                                                                            }}
                                                                            onClick={e => e.stopPropagation()}
                                                                            className="sr-only peer"
                                                                            aria-label={`Mark all ${itemName} retail packs as packed`}
                                                                        />
                                                                        <div className="w-5 h-5 border-2 border-black rounded peer-checked:bg-green-500 peer-checked:border-green-500 peer-focus:ring-2 peer-focus:ring-green-400/50 transition-all flex items-center justify-center">
                                                                            {!!checkedRetailPacks[itemName] && (
                                                                                <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                                                                    <path d="M12 22c5.523 0 10-4.477 10-10S17.523 2 12 2 2 6.477 2 12s4.477 10 10 10z" />
                                                                                    <path d="m9 12 2 2 4-4" />
                                                                                </svg>
                                                                            )}
                                                                        </div>
                                                                    </label>
                                                                </td>
                                                            </tr>
                                                        ))
                                                    )
                                                )}
                                            </tbody>
                                        </table>
                                    </div>
                                    <div className="flex justify-between items-center bg-white/90 backdrop-blur-sm p-4 border border-gray-200 mt-auto">
                                        <div className="text-sm text-gray-600">
                                            {Math.max(0, getFilteredRetailPacks().length - retailPacksPerPage)} additional retail packs
                                        </div>
                                        {calculateTotalPages().tableBTotalPages > 0 && (
                                            <div className="flex gap-2">
                                                <button
                                                    onClick={() => handleTableBPageChange(retailPackTableBPage - 1)}
                                                    disabled={retailPackTableBPage === 1}
                                                    className="px-3 py-1 rounded bg-gray-200 text-gray-700 disabled:opacity-50 disabled:cursor-not-allowed"
                                                >
                                                    Previous
                                                </button>
                                                <span>
                                                    Page {retailPackTableBPage} of {calculateTotalPages().tableBTotalPages}
                                                </span>
                                                <button
                                                    onClick={() => handleTableBPageChange(retailPackTableBPage + 1)}
                                                    disabled={retailPackTableBPage >= calculateTotalPages().tableBTotalPages}
                                                    className="px-3 py-1 rounded bg-gray-200 text-gray-700 disabled:opacity-50 disabled:cursor-not-allowed"
                                                >
                                                    Next
                                                </button>
                                            </div>
                                        )}
                                    </div>
                                </div>
                            )}     
                        </div>
                    </div>
                </div> 
            </div>
        </div>
    );
}
"use client";

import Navbar from '@/components/Navbar';
import { useEffect, useRef, useState, useCallback } from "react";
import { useDispatch, useSelector } from 'react-redux';
import { AppDispatch, RootState } from '@/redux/store';
import Image from 'next/image';
import {
    setSelectedOrderId,
} from "@/redux/slices/ordersSlice";
import {
    selectArchivedOrders,
} from "@/redux/slices/ordersSelectors";
import { subscribeToOrders, subscribeToOrderItems } from "@/utils/supabase";
import OrderItemsOverlay from '@/components/OrderItemsOverlay';
import { Order, OrderItem } from '@/types/redux';
import { store } from '@/redux/store';
import { createPortal } from 'react-dom';
import EditCompOrder from '@/components/editCompOrder';

// Define types used by the dropdown component
type SortField = 'order_id' | 'order_date' | 'customer_name';
type SortDirection = 'asc' | 'desc';

// Custom dropdown component using portal
const SortDropdown = ({ 
    sortConfig, 
    onSortChange 
}: { 
    sortConfig: {field: SortField, direction: SortDirection}, 
    onSortChange: (field: SortField) => void 
}) => {
    const [isOpen, setIsOpen] = useState(false);
    const buttonRef = useRef<HTMLButtonElement>(null);
    const dropdownRef = useRef<HTMLDivElement>(null);
    
    // Handle click outside
    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (
                dropdownRef.current && 
                !dropdownRef.current.contains(event.target as Node) &&
                buttonRef.current && 
                !buttonRef.current.contains(event.target as Node)
            ) {
                setIsOpen(false);
            }
        };
        
        if (isOpen) {
            document.addEventListener('mousedown', handleClickOutside);
        }
        
        return () => {
            document.removeEventListener('mousedown', handleClickOutside);
        };
    }, [isOpen]);
    
    // Handle escape key
    useEffect(() => {
        const handleEscape = (event: KeyboardEvent) => {
            if (event.key === 'Escape') {
                setIsOpen(false);
            }
        };
        
        if (isOpen) {
            document.addEventListener('keydown', handleEscape);
        }
        
        return () => {
            document.removeEventListener('keydown', handleEscape);
        };
    }, [isOpen]);
    
    // Cleanup on unmount
    useEffect(() => {
        return () => setIsOpen(false);
    }, []);
    
    // Calculate position for the dropdown
    const [dropdownStyle, setDropdownStyle] = useState({
        top: 0,
        left: 0,
        width: 0
    });
    
    // Update dropdown position when opened
    useEffect(() => {
        if (isOpen && buttonRef.current) {
            const rect = buttonRef.current.getBoundingClientRect();
            setDropdownStyle({
                top: rect.bottom + window.scrollY,
                left: rect.left + window.scrollX,
                width: rect.width
            });
        }
    }, [isOpen]);
    
    // Toggle dropdown
    const toggleDropdown = () => {
        setIsOpen(prev => !prev);
    };
    
    // Handle option selection
    const handleOptionClick = (field: SortField) => {
        onSortChange(field);
        setIsOpen(false);
    };
    
    return (
        <div className="relative">
            {/* Button trigger */}
            <button 
                ref={buttonRef}
                type="button" 
                className="inline-flex justify-between items-center w-full rounded-md border border-gray-300 shadow-sm px-4 py-2 bg-white text-sm font-medium text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-1 focus:ring-blue-500"
                id="sort-menu-button"
                aria-expanded={isOpen}
                aria-haspopup="true"
                onClick={toggleDropdown}
            >
                {sortConfig.field === 'order_id' ? 'Sort: Order ID' : 
                sortConfig.field === 'order_date' ? 'Sort: Date' : 'Sort: Customer'}
                {sortConfig.direction === 'asc' ? 
                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M12 20V4"/>
                        <path d="M5 11l7-7 7 7"/>
                    </svg> : 
                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M12 4v16"/>
                        <path d="M19 13l-7 7-7-7"/>
                    </svg>
                }
            </button>
            
            {/* Dropdown menu portal */}
            {isOpen && typeof document !== 'undefined' && createPortal(
                <div 
                    ref={dropdownRef}
                    className="origin-top-right absolute mt-2 rounded-md shadow-lg bg-white ring-1 ring-black ring-opacity-5 focus:outline-none"
                    role="menu"
                    aria-orientation="vertical"
                    aria-labelledby="sort-menu-button"
                    tabIndex={-1}
                    style={{
                        top: dropdownStyle.top,
                        left: dropdownStyle.left,
                        width: dropdownStyle.width,
                        zIndex: 9999,
                        position: 'absolute'
                    }}
                >
                    <div className="py-1" role="none">
                        <button
                            className={`${sortConfig.field === 'order_id' ? 'bg-gray-100 text-gray-900' : 'text-gray-700'} flex justify-between items-center w-full px-4 py-2 text-sm hover:bg-gray-100`}
                            role="menuitem"
                            tabIndex={-1}
                            onClick={() => handleOptionClick('order_id')}
                        >
                            Order ID
                            {sortConfig.field === 'order_id' && (
                                <span className="text-blue-600">
                                    {sortConfig.direction === 'asc' ? '↑' : '↓'}
                                </span>
                            )}
                        </button>
                        <button
                            className={`${sortConfig.field === 'order_date' ? 'bg-gray-100 text-gray-900' : 'text-gray-700'} flex justify-between items-center w-full px-4 py-2 text-sm hover:bg-gray-100`}
                            role="menuitem"
                            tabIndex={-1}
                            onClick={() => handleOptionClick('order_date')}
                        >
                            Date Received
                            {sortConfig.field === 'order_date' && (
                                <span className="text-blue-600">
                                    {sortConfig.direction === 'asc' ? '↑' : '↓'}
                                </span>
                            )}
                        </button>
                        <button
                            className={`${sortConfig.field === 'customer_name' ? 'bg-gray-100 text-gray-900' : 'text-gray-700'} flex justify-between items-center w-full px-4 py-2 text-sm hover:bg-gray-100`}
                            role="menuitem"
                            tabIndex={-1}
                            onClick={() => handleOptionClick('customer_name')}
                        >
                            Customer Name
                            {sortConfig.field === 'customer_name' && (
                                <span className="text-blue-600">
                                    {sortConfig.direction === 'asc' ? '↑' : '↓'}
                                </span>
                            )}
                        </button>
                    </div>
                </div>,
                document.body
            )}
        </div>
    );
};

export default function Admin() {
    const dispatch = useDispatch<AppDispatch>();
    const [archivedOrders, setArchivedOrders] = useState<{ orders: Order[], orderItems: Record<string, OrderItem[]> }>({ orders: [], orderItems: {} });
    const selectedOrderId = useSelector((state: RootState) => state.orders.selectedOrderId);
    const [showOrderItems, setShowOrderItems] = useState(false);
    const { loading, error } = useSelector((state: RootState) => state.orders);
    const selectedRowRef = useRef<HTMLTableRowElement>(null);
    const [isRefreshing, setIsRefreshing] = useState(false);
    
    // New state to track editing state
    const [editingOrder, setEditingOrder] = useState<Order | null>(null);
    
    // Pagination state
    const [currentPage, setCurrentPage] = useState(1);
    const ordersPerPage = 15;
    
    // Search functionality
    const [searchTerm, setSearchTerm] = useState("");
    const [filteredOrders, setFilteredOrders] = useState<Order[]>([]);
    
    // Sorting functionality
    const [sortConfig, setSortConfig] = useState<{field: SortField, direction: SortDirection}>({
        field: 'order_date',
        direction: 'desc'
    });
    
    // Calculate pagination values based on filtered orders
    const indexOfLastOrder = currentPage * ordersPerPage;
    const indexOfFirstOrder = indexOfLastOrder - ordersPerPage;
    const currentOrders = filteredOrders.slice(indexOfFirstOrder, indexOfLastOrder);
    const totalPages = Math.ceil(filteredOrders.length / ordersPerPage);

    // Subscribe to real-time updates and fetch archived orders on mount
    useEffect(() => {
        loadArchivedOrders();

        const ordersSubscription = subscribeToOrders((payload) => {
            if (payload.eventType === "INSERT" && payload.new.status === "Archived") {
                loadArchivedOrders();
            } else if (payload.eventType === "UPDATE" && payload.new.status === "Archived") {
                loadArchivedOrders();
            } else if (payload.eventType === "DELETE") {
                loadArchivedOrders();
            }
        });

        const itemsSubscription = subscribeToOrderItems((payload) => {
            if (payload.eventType === "INSERT" || payload.eventType === "UPDATE" || payload.eventType === "DELETE") {
                loadArchivedOrders();
            }
        });

        return () => {
            ordersSubscription.unsubscribe();
            itemsSubscription.unsubscribe();
        };
    }, []);
    
    // Filter orders when search term or original orders change
    useEffect(() => {
        filterOrders();
    }, [searchTerm, archivedOrders.orders]);
    
    // Filter orders based on search term
    const filterOrders = () => {
        if (!searchTerm.trim()) {
            setFilteredOrders(archivedOrders.orders);
            return;
        }
        
        const term = searchTerm.toLowerCase().trim();
        const filtered = archivedOrders.orders.filter(order => 
            order.order_id.toLowerCase().includes(term) || 
            order.customer_name.toLowerCase().includes(term)
        );
        
        setFilteredOrders(filtered);
        // Reset to first page when search changes
        setCurrentPage(1);
    };
    
    // Clear search
    const handleClearSearch = () => {
        setSearchTerm("");
    };

    const loadArchivedOrders = async () => {
        setIsRefreshing(true);
        try {
            const state = store.getState();
            const archived = await selectArchivedOrders(state);
            setArchivedOrders(archived);
            console.log(`Loaded ${archived.orders.length} archived orders with ${Object.keys(archived.orderItems).length} order items`);
        } catch (error) {
            console.error('Error loading archived orders:', error);
        } finally {
            setIsRefreshing(false);
        }
    };

    const handleOrderClick = (orderId: string) => {
        dispatch(setSelectedOrderId(orderId));
        setShowOrderItems(true);
        setTimeout(() => {
            selectedRowRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
        }, 100);
    };
    
    // Handle page change
    const handlePageChange = (pageNumber: number) => {
        if (pageNumber >= 1 && pageNumber <= totalPages) {
            setCurrentPage(pageNumber);
            window.scrollTo(0, 0);
        }
    };

    const handleRefresh = () => {
        setIsRefreshing(true);
        loadArchivedOrders()
            .finally(() => {
                setIsRefreshing(false);
            });
    };

    // Request a sort by field
    const handleSortChange = useCallback((field: SortField) => {
        // If clicking the same field, toggle direction
        const direction = sortConfig.field === field && sortConfig.direction === 'desc' ? 'asc' : 'desc';
        setSortConfig({ field, direction });
    }, [sortConfig]);
    
    // Apply sorting and filtering to orders
    useEffect(() => {
        let result = [...archivedOrders.orders];
        
        // Apply search filter
        if (searchTerm.trim()) {
            const term = searchTerm.toLowerCase().trim();
            result = result.filter(order => 
                order.order_id.toLowerCase().includes(term) || 
                order.customer_name.toLowerCase().includes(term)
            );
        }
        
        // Apply sorting
        result.sort((a, b) => {
            let comparison = 0;
            
            switch (sortConfig.field) {
                case 'order_id':
                    comparison = a.order_id.localeCompare(b.order_id);
                    break;
                case 'order_date':
                    comparison = new Date(a.order_date).getTime() - new Date(b.order_date).getTime();
                    break;
                case 'customer_name':
                    comparison = a.customer_name.localeCompare(b.customer_name);
                    break;
                default:
                    return 0;
            }
            
            return sortConfig.direction === 'asc' ? comparison : -comparison;
        });
        
        setFilteredOrders(result);
        // Reset to first page when search or sort changes
        setCurrentPage(1);
    }, [searchTerm, archivedOrders.orders, sortConfig]);

    // Handle edit button click
    const handleEditClick = (order: Order, e: React.MouseEvent) => {
        e.stopPropagation(); // Prevent triggering the row click
        setEditingOrder(order);
    };
    
    // Handle save after editing
    const handleSaveEdit = (updatedOrder: Order) => {
        // Update the order in our local state
        const updatedOrders = archivedOrders.orders.map(order => 
            order.order_id === updatedOrder.order_id ? updatedOrder : order
        );
        
        setArchivedOrders(prev => ({
            ...prev,
            orders: updatedOrders
        }));
        
        // Clear the editing state
        setEditingOrder(null);
    };

    return (
        <div className="relative min-h-screen text-white">
            {/* Navbar */}
            <div className="fixed top-0 left-0 w-full z-10">
                <Navbar />
            </div>

            {/* Main Content */}
            <div className="pt-40 px-6 flex flex-col lg:flex-row gap-6">
                {/**Overlay showing Order Items */}
                {showOrderItems && selectedOrderId && (
                    <OrderItemsOverlay
                        orderId={selectedOrderId}
                        onClose={() => setShowOrderItems(false)}
                        items={archivedOrders.orderItems[selectedOrderId] || []}
                    />
                )}
                {/* Left Section: Orders Table */}
                <div className="flex-1">
                    {/* Header and search */}
                    <div className="bg-[#1d1d1d]/90 rounded-t-lg backdrop-blur-sm p-4">
                        <div className="flex flex-col space-y-3 md:space-y-0 md:flex-row justify-between items-start md:items-center">
                            <h1 className="text-2xl font-bold text-white">Completed Orders</h1>
                            <div className="flex flex-col space-y-2 sm:space-y-0 sm:flex-row sm:space-x-3 w-full md:w-auto">
                                {/* Search results counter */}
                                {searchTerm && (
                                    <div className="text-sm text-gray-300 self-start sm:self-center sm:mr-4" aria-live="polite">
                                        Found {filteredOrders.length} {filteredOrders.length === 1 ? 'result' : 'results'} for &quot;{searchTerm}&quot;
                                    </div>
                                )}
                            
                                <div className="flex space-x-3 w-full sm:w-auto">
                                    {/* Search bar */}
                                    <div className="relative flex-1 sm:w-64">
                                        <input
                                            type="text"
                                            placeholder="Search by Order ID or Customer Name"
                                            value={searchTerm}
                                            onChange={(e) => setSearchTerm(e.target.value)}
                                            className="w-full pl-10 pr-10 py-2 text-sm text-black bg-white/90 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                                            aria-label="Search completed orders"
                                        />
                                        <div className="absolute inset-y-0 left-0 flex items-center pl-3 pointer-events-none">
                                            <svg className="w-4 h-4 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"></path>
                                            </svg>
                                        </div>
                                        {searchTerm && (
                                            <button
                                                onClick={handleClearSearch}
                                                className="absolute right-2 top-1/2 transform -translate-y-1/2 text-gray-400 hover:text-gray-600"
                                                aria-label="Clear search"
                                            >
                                                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                                    <circle cx="12" cy="12" r="10"/>
                                                    <path d="m15 9-6 6"/>
                                                    <path d="m9 9 6 6"/>
                                                </svg>
                                            </button>
                                        )}
                                    </div>
                                    
                                    {/* Sorting dropdown - using the new component */}
                                    <div className="w-56">
                                        <SortDropdown 
                                            sortConfig={sortConfig} 
                                            onSortChange={handleSortChange} 
                                        />
                                    </div>
                                    
                                    {/* Refresh button */}
                                    <button
                                        onClick={handleRefresh}
                                        className={`flex items-center gap-2 px-3.5 py-2 text-white font-medium rounded-lg transition-all duration-300 bg-gradient-to-br from-gray-700 to-gray-800 hover:from-gray-600 hover:to-gray-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-gray-500 shadow-md hover:shadow-lg disabled:opacity-70 disabled:cursor-not-allowed`}
                                        disabled={isRefreshing}
                                        aria-label={isRefreshing ? "Syncing orders in progress" : "Refresh orders list"}
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
                                </div>
                            </div>
                        </div>
                    </div>
                    
                    {/* Table Container */}
                    <div className="bg-[#1d1d1d]/90 rounded-t-lg backdrop-blur-sm relative" style={{ zIndex: 1 }}>
                        <div className="overflow-x-auto bg-white h-[calc(100vh-300px)] flex flex-col">
                            {loading ? (
                                <div className="flex-1 flex flex-col items-center justify-center bg-gray-50 p-6 text-black">
                                    <div className="w-12 h-12 rounded-full border-4 border-gray-300 border-t-blue-600 animate-spin mb-4" aria-hidden="true"></div>
                                    <p className="font-medium" role="status">Loading orders...</p>
                                    <p className="text-gray-500 text-sm mt-1">Retrieving data from database</p>
                                </div>
                            ) : error ? (
                                <div className="flex-1 flex flex-col items-center justify-center bg-gray-50 p-6" role="alert">
                                    <div className="text-red-500 mb-4">
                                        <svg xmlns="http://www.w3.org/2000/svg" className="h-10 w-10" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                                        </svg>
                                    </div>
                                    <p className="text-red-600 font-medium mb-2">Error loading orders</p>
                                    <p className="text-gray-600 mb-4">{error}</p>
                                    <button
                                        onClick={handleRefresh}
                                        className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 transition-colors"
                                    >
                                        Retry
                                    </button>
                                </div>
                            ) : filteredOrders.length === 0 ? (
                                <div className="flex-1 flex flex-col items-center justify-center bg-gray-50 p-6">
                                    <div className="text-gray-400 mb-4">
                                        {searchTerm ? (
                                            <svg xmlns="http://www.w3.org/2000/svg" className="h-16 w-16" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                                            </svg>
                                        ) : (
                                            <svg xmlns="http://www.w3.org/2000/svg" className="h-16 w-16" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8m-9 4h4" />
                                            </svg>
                                        )}
                                    </div>
                                    {searchTerm ? (
                                        <>
                                            <p className="text-black font-medium mb-1">No matching orders found</p>
                                            <p className="text-gray-500 text-sm">Try a different search term or clear the search</p>
                                            <button 
                                                onClick={handleClearSearch}
                                                className="mt-4 px-4 py-2 bg-gray-200 text-gray-800 rounded hover:bg-gray-300 focus:outline-none focus:ring-2 focus:ring-gray-500 focus:ring-offset-2 transition-colors"
                                            >
                                                Clear Search
                                            </button>
                                        </>
                                    ) : (
                                        <>
                                            <p className="text-black font-medium mb-1">No completed orders found</p>
                                            <p className="text-gray-500 text-sm">Orders marked as complete will appear here</p>
                                        </>
                                    )}
                                </div>
                            ) : (
                                <div className="flex-1 overflow-y-auto">
                                    <table 
                                        className="w-full bg-white/90 backdrop-blur-sm border border-gray-200 table-auto h-full"
                                        role="grid"
                                        aria-label="Completed Orders"
                                    >
                                        <thead className="bg-gray-100/90 sticky top-0">
                                            <tr>
                                                <th scope="col" className="px-4 py-4 text-center text-black text-md font-semibold">Order Id</th>
                                                <th scope="col" className="px-4 py-2 text-center text-black text-md font-semibold whitespace-nowrap">Date Received</th>
                                                <th scope="col" className="px-4 py-2 text-center text-black text-md font-semibold">Customer Name</th>
                                                <th scope="col" className="px-4 py-4 text-center text-black text-md font-semibold">Items</th>
                                                <th scope="col" className="px-4 py-4 text-center text-black text-md font-semibold">Edit</th>
                                                <th scope="col" className="px-4 py-4 text-center text-black text-md font-semibold">Delete</th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-gray-200">
                                            {isRefreshing ? (
                                                // Skeleton loading rows while refreshing
                                                [...Array(5)].map((_, index) => (
                                                    <tr key={`skeleton-${index}`} className="animate-pulse" aria-hidden="true">
                                                        <td className="px-4 py-5">
                                                            <div className="h-4 bg-gray-200 rounded w-20 mx-auto"></div>
                                                        </td>
                                                        <td className="px-4 py-5">
                                                            <div className="h-4 bg-gray-200 rounded w-28 mx-auto"></div>
                                                        </td>
                                                        <td className="px-4 py-5">
                                                            <div className="h-4 bg-gray-200 rounded w-28 mx-auto"></div>
                                                        </td>
                                                        <td className="px-4 py-5">
                                                            <div className="h-4 bg-gray-200 rounded w-24 mx-auto"></div>
                                                        </td>
                                                        <td className="px-4 py-5">
                                                            <div className="h-4 bg-gray-200 rounded w-8 mx-auto"></div>
                                                        </td>
                                                        <td className="px-4 py-5">
                                                            <div className="h-4 bg-gray-200 rounded w-8 mx-auto"></div>
                                                        </td>
                                                    </tr>
                                                ))
                                            ) : (
                                                currentOrders.map((order) => (
                                                    <tr
                                                        key={order.order_id}
                                                        ref={order.order_id === selectedOrderId ? selectedRowRef : null}
                                                        className={`transition-colors duration-150 cursor-pointer text-center h-[calc((100vh-300px-48px)/15)] ${
                                                            order.order_id === selectedOrderId 
                                                              ? "bg-blue-100/90 border-l-4 border-blue-500 shadow-md" 
                                                              : "hover:bg-gray-50/90 hover:border-l-4 hover:border-gray-300"
                                                        }`}
                                                        onClick={() => handleOrderClick(order.order_id)}
                                                        onKeyDown={(e) => {
                                                            if (e.key === 'Enter' || e.key === ' ') {
                                                                e.preventDefault();
                                                                handleOrderClick(order.order_id);
                                                            }
                                                        }}
                                                        tabIndex={0}
                                                        role="row"
                                                        aria-selected={order.order_id === selectedOrderId}
                                                    >
                                                        <td className="px-4 py-2 text-black font-medium">{order.order_id}</td>
                                                        <td className="px-4 py-2 text-black">
                                                            {new Date(order.order_date).toLocaleDateString("en-GB")}
                                                        </td>
                                                        <td className="px-4 py-2 text-black">{order.customer_name}</td>
                                                        <td className="px-4 py-2">
                                                            <button 
                                                                className="text-blue-600 hover:text-blue-800 whitespace-nowrap focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-1 rounded px-2 py-1 transition-colors"
                                                                onClick={(e) => {
                                                                    e.stopPropagation();
                                                                    handleOrderClick(order.order_id);
                                                                }}
                                                                aria-label={`View items for order ${order.order_id}`}
                                                            >
                                                                View Items
                                                            </button>
                                                        </td>
                                                        <td className="px-4 py-2 text-black">
                                                            <button
                                                                className="p-1 text-blue-600 hover:text-blue-800 focus:outline-none"
                                                                onClick={(e) => handleEditClick(order, e)}
                                                                aria-label={`Edit order ${order.order_id}`}
                                                            >
                                                                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                                                    <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3Z"/>
                                                                </svg>
                                                            </button>
                                                        </td>
                                                        <td className="px-4 py-2 text-black">
                                                            <button
                                                                className="flex justify-center items-center h-full w-full hover:bg-gray-100 rounded-full p-2 transition-colors focus:outline-none focus:ring-2 focus:ring-gray-300"
                                                                onClick={(e) => {
                                                                    e.stopPropagation();
                                                                    // Add delete functionality here
                                                                }}
                                                                aria-label={`Delete order ${order.order_id}`}
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
                                            )}
                                        </tbody>
                                    </table>
                                </div>
                            )}
                            {/* Pagination controls */}
                            {filteredOrders.length > 0 && (
                                <div className="flex flex-col sm:flex-row justify-between items-center bg-white/90 backdrop-blur-sm p-4 border border-gray-200">
                                    <div className="text-sm text-gray-600 mb-3 sm:mb-0">
                                        Showing <span className="font-medium">{indexOfFirstOrder + 1}</span> to{" "}
                                        <span className="font-medium">{Math.min(indexOfLastOrder, filteredOrders.length)}</span> of{" "}
                                        <span className="font-medium">{filteredOrders.length}</span>{" "}
                                        completed orders
                                    </div>
                                    <div className="flex gap-2">
                                        <button
                                            onClick={() => handlePageChange(currentPage - 1)}
                                            disabled={currentPage === 1}
                                            className="px-3 py-1 rounded bg-gray-200 text-gray-700 disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-300 focus:outline-none focus:ring-2 focus:ring-offset-1 focus:ring-gray-500 transition-colors"
                                            aria-label="Previous page"
                                        >
                                            <span aria-hidden="true"></span> Previous
                                        </button>
                                        <div className="flex items-center px-3 py-1 text-gray-600">
                                            <label htmlFor="page-number" className="sr-only">Page number</label>
                                            <input
                                                id="page-number"
                                                type="number"
                                                min="1"
                                                max={totalPages}
                                                value={currentPage}
                                                onChange={(e) => {
                                                    const page = parseInt(e.target.value);
                                                    if (!isNaN(page) && page >= 1 && page <= totalPages) {
                                                        handlePageChange(page);
                                                    }
                                                }}
                                                className="w-12 text-center border border-gray-300 rounded mx-2 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                                                aria-label={`Page ${currentPage} of ${totalPages}`}
                                            />
                                            <span>of {totalPages}</span>
                                        </div>
                                        <button
                                            onClick={() => handlePageChange(currentPage + 1)}
                                            disabled={currentPage === totalPages}
                                            className="px-3 py-1 rounded bg-gray-200 text-gray-700 disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-300 focus:outline-none focus:ring-2 focus:ring-offset-1 focus:ring-gray-500 transition-colors"
                                            aria-label="Next page"
                                        >
                                            Next <span aria-hidden="true"></span>
                                        </button>
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>
                </div>
                {/* Right Section: Foam Inserts and Best Performing Foam Sheets */}
                <div className="w-full lg:w-1/3 flex flex-col">
                    {/* Foam Inserts */}
                    <div className="bg-[#1d1d1d]/90 rounded-t-lg backdrop-blur-sm p-4">
                        <h1 className="text-2xl font-bold text-white">Foam Inserts</h1>
                    </div>
                    <div className="overflow-x-auto bg-white h-[calc(35vh-120px)] flex flex-col">
                        <div className="flex-1 overflow-y-auto">
                            <h1 className="text-lg font-semibold text-black">Display Foam Insert Brands</h1>
                        </div>
                    </div>
                    {/* Best Performing Foam Sheets */}
                    <div className="bg-[#1d1d1d]/90 rounded-t-lg backdrop-blur-sm p-4 mt-10">
                        <h1 className="text-2xl font-bold text-white">Best Performing Foam Sheets</h1>
                    </div>
                    <div className="overflow-x-auto bg-white h-[calc(56vh-185px)] flex flex-col">
                        <div className="flex-1 overflow-y-auto">
                            <h1 className="text-lg font-semibold text-black">Display Pie Chart</h1>
                        </div>
                    </div>
                </div>
            </div>
            
            {/* Edit Order Dialog */}
            {editingOrder && (
                <EditCompOrder
                    order={editingOrder}
                    onClose={() => setEditingOrder(null)}
                    onSave={handleSaveEdit}
                />
            )}
        </div>
    );
}
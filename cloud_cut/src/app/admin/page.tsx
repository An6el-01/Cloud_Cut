"use client";

import Navbar from '@/components/Navbar';
import { useEffect, useRef, useState } from "react";
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

export default function Admin() {
    const dispatch = useDispatch<AppDispatch>();
    const [archivedOrders, setArchivedOrders] = useState<{ orders: Order[], orderItems: Record<string, OrderItem[]> }>({ orders: [], orderItems: {} });
    const selectedOrderId = useSelector((state: RootState) => state.orders.selectedOrderId);
    const [showOrderItems, setShowOrderItems] = useState(false);
    const { loading, error } = useSelector((state: RootState) => state.orders);
    const selectedRowRef = useRef<HTMLTableRowElement>(null);
    const [isRefreshing, setIsRefreshing] = useState(false);

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

    const handleRefresh = () => {
        setIsRefreshing(true);
        loadArchivedOrders()
            .finally(() => {
                setIsRefreshing(false);
            });
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
                    {/* Refresh Button */}
                    <div className="bg-[#1d1d1d]/90 rounded-t-lg backdrop-blur-sm flex justify-between items-center p-4">
                        <h1 className="text-2xl font-bold text-white">Completed Orders</h1>
                        <button
                  onClick={handleRefresh}
                  className={`flex items-center gap-2 px-3.5 py-2 text-white font-medium rounded-lg transition-all duration-300 bg-gradient-to-br from-gray-700 to-gray-800 hover:from-gray-600 hover:to-gray-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-gray-500 shadow-md hover:shadow-lg disabled:opacity-70 disabled:cursor-not-allowed`}
                  disabled={isRefreshing}
                  aria-label={isRefreshing ? "Syncing orders in progress" : "Refresh orders list"}
                >
                  <span className={`${isRefreshing ? "animate-spin" : ""} text-red-400`}>
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-4.5 w-4.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.67-8.9" />
                    </svg>
                  </span>
                  <span>{isRefreshing ? "Syncing..." : "Refresh"}</span>
                </button>
                    </div>
                    {/* Table Container */}
                    <div className="bg-[#1d1d1d]/90 rounded-t-lg backdrop-blur-sm">
                        <div className="overflow-x-auto bg-white h-[calc(100vh-300px)] flex flex-col">
                            {loading ? (
                                <div className="text-center text-white py-4">
                                    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-white mx-auto" />
                                    <p className="mt-2">Loading orders...</p>
                                </div>
                            ) : error ? (
                                <div className="text-center py-4">
                                    <p className="text-red-500">{error}</p>
                                    <button
                                        onClick={handleRefresh}
                                        className="mt-2 px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600"
                                    >
                                        Retry
                                    </button>
                                </div>
                            ) : archivedOrders.orders.length === 0 ? (
                                <div className="text-center py-4">
                                    <p className="text-black">No archived orders found</p>
                                </div>
                            ) : (
                                <div className="flex-1 overflow-y-auto">
                                    <table className="w-full bg-white/90 backdrop-blur-sm border border-gray-200 table-auto h-full">
                                        <thead className="bg-gray-100/90 sticky top-0">
                                            <tr>
                                                <th className="px-4 py-4 text-center text-black text-md">Order Id</th>
                                                <th className="px-4 py-2 text-center text-black text-md whitespace-nowrap">Date Received</th>
                                                <th className="px-4 py-2 text-center text-black text-md">Customer Name</th>
                                                <th className="px-4 py-4 text-center text-black text-md">Items</th>
                                                <th className="px-4 py-4 text-center text-black text-md">Edit</th>
                                                <th className="px-4 py-4 text-center text-black text-md">Delete</th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-gray-200">
                                            {archivedOrders.orders.map((order) => (
                                                <tr
                                                    key={order.order_id}
                                                    ref={order.order_id === selectedOrderId ? selectedRowRef : null}
                                                    className={`hover:bg-gray-50/90 cursor-pointer text-center h-[calc((100vh-300px-48px)/15)] ${
                                                        order.order_id === selectedOrderId ? "bg-blue-100/90" : ""
                                                    }`}
                                                    onClick={() => handleOrderClick(order.order_id)}
                                                >
                                                    <td className="px-4 py-2 text-black">{order.order_id}</td>
                                                    <td className="px-4 py-2 text-black">
                                                        {new Date(order.order_date).toLocaleDateString("en-GB")}
                                                    </td>
                                                    <td className="px-4 py-2 text-black">{order.customer_name}</td>
                                                    <td className="px-4 py-2 text-blue-500 whitespace-nowrap">View Items</td>
                                                    <td className="px-4 py-2 text-black">
                                                        <div className='flex justify-center items-center h-full'>
                                                            <Image
                                                                src="/editPencil.png"
                                                                alt="Edit_Icon"
                                                                width={15}
                                                                height={15}
                                                            />
                                                        </div>
                                                    </td>
                                                    <td className="px-4 py-2 text-black">
                                                        <div className='flex justify-center items-center h-full'>
                                                            <Image
                                                                src="/binClosed.png"
                                                                alt="Delete_Icon"
                                                                width={15}
                                                                height={15}
                                                            />
                                                        </div>
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
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
        </div>
    );
}
"use client";

import Navbar from '@/components/Navbar';
import { useEffect, useRef, useState } from "react";
import { useDispatch, useSelector } from 'react-redux';
import { AppDispatch, RootState } from '@/redux/store';
import Image from 'next/image';
import {
    fetchOrdersFromSupabase,
    syncOrders,
    setSelectedOrderId,
    updateItemCompleted,
    selectPaginatedOrders,
} from "@/redux/slices/ordersSlice";
import { subscribeToOrders, subscribeToOrderItems } from "@/utils/supabase";

export default function Admin() {
    const dispatch = useDispatch<AppDispatch>();
    const orders = useSelector(selectPaginatedOrders);
    const totalOrders = useSelector((state: RootState) => state.orders.totalOrders);
    const selectedOrderId = useSelector((state: RootState) => state.orders.selectedOrderId);
    const { currentPage, loading, error } = useSelector(
        (state: RootState) => state.orders
    );

    const selectedRowRef = useRef<HTMLTableRowElement>(null);
    const ordersPerPage = 15;

    const totalPages = Math.ceil(totalOrders / ordersPerPage);

    const [isRefreshing, setIsRefreshing] = useState(false);

    // Subscribe to real-time updates and fetch orders on mount
    useEffect(() => {
        dispatch(fetchOrdersFromSupabase({ page: currentPage, perPage: ordersPerPage }));

        const ordersSubscription = subscribeToOrders((payload) => {
            if (payload.eventType === "INSERT" && payload.new.status === "Completed") {
                dispatch({ type: "orders/addOrder", payload: payload.new });
            } else if (payload.eventType === "UPDATE") {
                if (payload.new.status === "Completed") {
                    dispatch({ type: "orders/updateOrder", payload: payload.new });
                } else {
                    dispatch({ type: "orders/removeOrder", payload: payload.new });
                }
            } else if (payload.eventType === "DELETE") {
                dispatch({ type: "orders/removeOrder", payload: payload.old });
            }
        });

        const itemsSubscription = subscribeToOrderItems((payload) => {
            if (payload.eventType === "INSERT") {
                dispatch({ type: "orders/addOrderItem", payload: payload.new });
            } else if (payload.eventType === "UPDATE") {
                dispatch(
                    updateItemCompleted({
                        orderId: payload.new.order_id,
                        itemId: payload.new.id,
                        completed: payload.new.completed,
                    })
                );
            } else if (payload.eventType === "DELETE") {
                dispatch({ type: "orders/removeOrderItem", payload: payload.old });
            }
        });

        return () => {
            ordersSubscription.unsubscribe();
            itemsSubscription.unsubscribe();
        };
    }, [dispatch, currentPage]);

    const handleOrderClick = (orderId: string) => {
        dispatch(setSelectedOrderId(orderId));
        setTimeout(() => {
            selectedRowRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
        }, 100);
    };

    const handlePageChange = (newPage: number) => {
        if (newPage >= 1 && newPage <= totalPages) {
            dispatch(fetchOrdersFromSupabase({ page: newPage, perPage: ordersPerPage }));
        }
    };

    const handleRefresh = () => {
        setIsRefreshing(true);
        dispatch(syncOrders())
            .then(() => {
                dispatch(fetchOrdersFromSupabase({ page: 1, perPage: ordersPerPage }));
            })
            .catch((error) => {
                console.error('Error in syncOrders:', error);
            })
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
                {/* Left Section: Completed Orders Table */}
                <div className="flex-1">
                    {/* Refresh Button */}
                    <div className="bg-[#1d1d1d]/90 rounded-t-lg backdrop-blur-sm flex justify-between items-center p-4">
                        <h1 className="text-2xl font-bold text-white">Completed Orders</h1>
                        <button
                            onClick={handleRefresh}
                            className={`px-4 py-2 text-white font-semibold rounded-lg transition-all-duration-300 z-10 border-2 border-red-500 ${
                                isRefreshing
                                    ? "bg-blue-600 animate-pulse flex items-center gap-2 cursor-not-allowed"
                                    : "bg-gray-700 hover:bg-gray-600"
                            }`}
                            disabled={isRefreshing}
                            style={{ position: "relative" }}
                        >
                            {isRefreshing ? (
                                <>
                                    <span className="animate-spin">↻</span>
                                    <span>syncing...</span>
                                </>
                            ) : (
                                "Refresh Orders"
                            )}
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
                            ) : orders.length === 0 ? (
                                <div className="text-center py-4">
                                    <p className="text-black">No orders found</p>
                                    <p className="text-sm text-gray-400 mt-1">Try refreshing the page</p>
                                </div>
                            ) : (
                                <>
                                    <div className="flex-1 overflow-y-auto">
                                        <table className="w-full bg-white/90 backdrop-blur-sm border border-gray-200 table-auto h-full">
                                            <thead className="bg-gray-100/90 sticky top-0">
                                                <tr>
                                                    <th className="px-4 py-4 text-center text-black text-md">Order Id</th>
                                                    <th className="px-4 py-2 text-center text-black text-md whitespace-nowrap">Date Received</th>
                                                    <th className="px-4 py-4 text-center text-black text-md whitespace-nowrap">Customer Name</th>
                                                    <th className="px-4 py-4 text-center text-black text-md">Items</th>
                                                    <th className="px-4 py-4 text-center text-black text-md">Edit</th>
                                                    <th className="px-4 py-4 text-center text-black text-md">Delete</th>
                                                </tr>
                                            </thead>
                                            <tbody className="divide-y divide-gray-200">
                                                {orders.map((order) => (
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
                                                        <td className="px-4 py-2 text-black">View Items</td>
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
                                                        <td className="px-4 py-2 text-black ">
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
                                    <div className="flex justify-between items-center bg-white/90 backdrop-blur-sm p-4 border border-gray-200">
                                        <div className="text-sm text-gray-600">
                                            Showing {(currentPage - 1) * ordersPerPage + 1} to{" "}
                                            {Math.min(currentPage * ordersPerPage, totalOrders)} of {totalOrders}{" "}
                                            completed Orders
                                        </div>
                                        <div className="flex gap-2">
                                            <button
                                                onClick={() => handlePageChange(currentPage - 1)}
                                                disabled={currentPage === 1}
                                                className="px-3 py-2 rounded bg-gray-200 text-gray-700 disabled:opacity-50 disabled:cursor-not-allowed"
                                            >
                                                Previous
                                            </button>
                                            <span className="px-3 py-1 text-gray-600">
                                                Page {currentPage} of {totalPages}
                                            </span>
                                            <button
                                                onClick={() => handlePageChange(currentPage + 1)}
                                                disabled={currentPage === totalPages}
                                                className="px-3 py-1 rounded bg-gray-200 text-gray-700 disabled:opacity-50 disabled:cursor-not-allowed"
                                            >
                                                Next
                                            </button>
                                        </div>
                                    </div>
                                </>
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
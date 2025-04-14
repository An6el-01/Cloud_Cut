"use client";

import NavBar from "@/components/Navbar";
import OrderFinished from "@/components/orderFinished";
import { useEffect, useRef, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import { AppDispatch, RootState } from "@/redux/store";
import {
    setSelectedOrderId,
    updateItemCompleted,
    updateOrderStatus,
    setCurrentView,
} from "@/redux/slices/ordersSlice";
import {
    fetchOrdersFromSupabase,
    syncOrders,
} from "@/redux/thunks/ordersThunks";
import {
    selectPackingOrders,
    selectOrderItemsById,
    selectOrderProgress,
    selectCurrentViewTotal,
} from "@/redux/slices/ordersSelectors";
import { subscribeToOrders, subscribeToOrderItems } from "@/utils/supabase";
import { OrderItem, Order } from "@/types/redux";
import { supabase } from "@/utils/supabase";

// Define OrderWithPriority type
type OrderWithPriority = Order & { calculatedPriority: number };

export default function Packing() {
    const dispatch = useDispatch<AppDispatch>();
    const orders = useSelector(selectPackingOrders);
    const totalOrders = useSelector(selectCurrentViewTotal);
    const selectedOrderId = useSelector((state: RootState) => state.orders.selectedOrderId);
    const selectedOrderItems = useSelector(selectOrderItemsById(selectedOrderId || ''));
    const { currentPage, loading, error } = useSelector((state: RootState) => state.orders);
    const selectedRowRef = useRef<HTMLTableRowElement>(null);
    const ordersPerPage = 15;
    const totalPages = Math.ceil(totalOrders / ordersPerPage);
    const selectedOrder = orders.find((o) => o.order_id === selectedOrderId)
    const [isRefreshing, setIsRefreshing] = useState(false);
    const [showOrderFinishedDialog, setShowOrderFinishedDialog] = useState(false);
    const [pendingItemToComplete, setPendingItemToComplete] = useState<{ orderId: string;itemId: string;completed: boolean; } | null>(null);
    const [showWarning, setShowWarning] = useState(false);

    const orderProgress = useSelector((state: RootState) =>
        orders.reduce((acc, order) => {
            acc[order.order_id] = selectOrderProgress(order.order_id)(state);
            return acc;
        }, {} as Record<string, string>)
    );

    const orderItemsById = useSelector((state: RootState) =>
        orders.reduce((acc, order) => {
            acc[order.order_id] = selectOrderItemsById(order.order_id)(state);
            return acc;
        }, {} as Record<string, OrderItem[]>)
    );

    useEffect(() => {
        // Set the current view first
        dispatch(setCurrentView('packing'));

        dispatch(fetchOrdersFromSupabase({
            page: currentPage,
            perPage: ordersPerPage,
            manufactured: true,
            packed: false,
            status: "Pending",
            view: 'packing'
        }));

        const ordersSubscription = subscribeToOrders((payload) => {
            if (payload.eventType === 'INSERT' &&
                payload.new.status === 'Pending' &&
                payload.new.manufactured === true &&
                payload.new.packed === false) {
                dispatch({ type: "orders/addOrder", payload: payload.new });
            } else if (payload.eventType === 'UPDATE') {
                if (payload.new.status === "Pending" &&
                    payload.new.manufactured === true &&
                    payload.new.packed === false) {
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
        }
    }, [dispatch, currentPage]);

    const handleOrderClick = (orderId: string) => {
        dispatch(setSelectedOrderId(orderId));
        setTimeout(() => {
            selectedRowRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
        }, 100);
    }

    const handlePageChange = (newPage: number) => {
        if (newPage >= 1 && newPage <= totalPages) {
            dispatch(fetchOrdersFromSupabase({
                page: newPage,
                perPage: ordersPerPage,
                manufactured: true,
                packed: false,
                status: "Pending",
                view: 'packing'
            }));
        }
    };

    const handleToggleCompleted = (orderId: string, itemId: string, completed: boolean) => {
        // If marking as incomplete, just do it directly
        if (!completed) {
            dispatch(updateItemCompleted({ orderId, itemId, completed }));
            return;
        }

        // Count how many items are already completed
        const completedItems = selectedOrderItems.filter(item =>
            item.completed || item.id === itemId // Count the current item if it's being marked as completed
        );

        // Check if this is the last item to complete
        if (completedItems.length === selectedOrderItems.length && completed) {
            // Store the pending item completion details
            setPendingItemToComplete({
                orderId,
                itemId,
                completed
            });
            // Show confirmation dialog
            setShowOrderFinishedDialog(true);
        } else {
            // Not the last item, just mark it as completed
            dispatch(updateItemCompleted({ orderId, itemId, completed }));
        }
    };

    const handleMarkCompleted = (orderId: string) => {
        // Close the confirmation dialog
        setShowOrderFinishedDialog(false);

        // If there's a pending item to complete
        if (pendingItemToComplete) {
            // Mark the item as completed
            dispatch(updateItemCompleted(pendingItemToComplete));

            console.log(`Marking order ${orderId} as completed`);
            // Show loading state
            setIsRefreshing(true);

            // Update the order status in Redux
            dispatch(updateOrderStatus({
                orderId,
                status: "Completed"
            }));

            // Directly update both status and packed in Supabase in a single operation
            (async () => {
                try {
                    const { error } = await supabase
                        .from('orders')
                        .update({
                            status: "Completed",
                            packed: true,
                            updated_at: new Date().toISOString()
                        })
                        .eq('order_id', orderId);

                    if (error) {
                        console.error('Error updating order status in Supabase:', error);
                    } else {
                        console.log(`Successfully updated order ${orderId} as Completed and packed`);
                    }
                } catch (err) {
                    console.error('Failed to update order status:', err);
                }
            })();

            // Refresh the orders list to remove the completed order after a delay
            setTimeout(() => {
                console.log(`Refreshing orders after marking ${orderId} as completed`);
                dispatch(fetchOrdersFromSupabase({
                    page: currentPage,
                    perPage: ordersPerPage,
                    manufactured: true,
                    packed: false,
                    status: "Pending",
                    view: 'packing'
                }))
                    .finally(() => {
                        setIsRefreshing(false);
                        // Clear the pending item
                        setPendingItemToComplete(null);
                    });
            }, 2000); // Increased delay to ensure Supabase update completes
        }
    };

    // Function to handle cancellation of the confirmation dialog
    const handleCancelOrderFinished = () => {
        // Close the dialog
        setShowOrderFinishedDialog(false);
        // Clear the pending item
        setPendingItemToComplete(null);
    };

    // Function to handle the "Mark Order Complete" button click
    const handleCompleteOrderClick = () => {
        if (!selectedOrder) return;
        
        // Check if all items are completed
        const allItemsCompleted = selectedOrderItems.every(item => item.completed);
        
        if (allItemsCompleted) {
            // Show the OrderFinished dialog
            setShowOrderFinishedDialog(true);
        } else {
            // Show warning message with timeout
            setShowWarning(true);
            setTimeout(() => {
                setShowWarning(false);
            }, 4000);
        }
    };

    const handleRefresh = () => {
        setIsRefreshing(true);
        dispatch(syncOrders())
            .then(() => {
                //Fetch the first page of completed orders after sync
                dispatch(fetchOrdersFromSupabase({
                    page: 1,
                    perPage: ordersPerPage,
                    manufactured: true,
                    packed: false,
                    status: "Pending",
                    view: 'packing'
                }));
            })
            .catch((error) => {
                console.error('Error in syncOrders:', error);
            })
            .finally(() => {
                setIsRefreshing(false);
            });
    };

    return (
        <div className="min-h-screen">
            <NavBar />
            <div className="container mx-auto pt-32 mb-8 p-6 flex justify-center gap-8">
                {/**Packing Orders Section */}
                <div className="flex-1 max-w-3xl">
                    <div className="bg-[#1d1d1d]/90 rounded-t-lg flex justify-between items-center backdrop-blur-sm p-4">
                        <h1 className="text-2xl font-bold text-white">Orders Ready For Packing</h1>
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
                    <div className="overflow-x-auto bg-white h-[calc(100vh-300px)] flex flex-col">
                        {loading ? (
                            <div className="flex-1 flex flex-col items-center justify-center bg-gray-50 p-6">
                                <div className="w-12 h-12 rounded-full border-4 border-gray-300 border-t-blue-600 animate-spin mb-4"></div>
                                <p className="text-gray-700 font-medium">Loading orders...</p>
                                <p className="text-gray-500 text-sm mt-1">Retrieving data from database</p>
                            </div>
                        ) : error ? (
                            <div className="text-center py-4">
                                <p className="text-red-500">{error}</p>
                                <button
                                    onClick={handleRefresh}
                                    className="mt-2 px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600"
                                >Retry
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
                                                <th className="px-4 py-4 text-center text-black text-md">Order ID</th>
                                                <th className="px-4 py-4 text-center text-black text-md">Customer Name</th>
                                                <th className="px-4 py-4 text-center text-black text-md">Priority</th>
                                                <th className="px-4 py-4 text-center text-black text-md whitespace-nowrap">Order Date</th>
                                                <th className="px-4 py-4 text-center text-black text-md">Progress</th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-gray-200">
                                            {isRefreshing ? (
                                                // Skeleton loading rows while refreshing
                                                [...Array(5)].map((_, index) => (
                                                    <tr key={`skeleton-${index}`} className="animate-pulse">
                                                        <td className="px-4 py-5">
                                                            <div className="h-4 bg-gray-200 rounded w-20 mx-auto"></div>
                                                        </td>
                                                        <td className="px-4 py-5">
                                                            <div className="h-4 bg-gray-200 rounded w-28 mx-auto"></div>
                                                        </td>
                                                        <td className="px-4 py-5">
                                                            <div className="h-4 bg-gray-200 rounded w-8 mx-auto"></div>
                                                        </td>
                                                        <td className="px-4 py-5">
                                                            <div className="h-4 bg-gray-200 rounded w-24 mx-auto"></div>
                                                        </td>
                                                        <td className="px-4 py-5">
                                                            <div className="h-4 bg-gray-200 rounded w-12 mx-auto"></div>
                                                        </td>
                                                    </tr>
                                                ))
                                            ) : (
                                                orders.map((order) => {
                                                    //Get the items for this specific order
                                                    const orderItems = orderItemsById[order.order_id] || [];
                                                    // Use the calculated priority property if it exists
                                                    const displayPriority = 'calculatedPriority' in order
                                                        ? (order as OrderWithPriority).calculatedPriority
                                                        : (orderItems.length > 0
                                                            ? Math.max(...orderItems.map((item) => item.priority || 0))
                                                            : 0);

                                                    return (
                                                        <tr
                                                            key={order.order_id}
                                                            ref={order.order_id === selectedOrderId ? selectedRowRef : null}
                                                            className={`transition-all duration-200 cursor-pointer text-center h-[calc((100vh-300px-48px)/15)] ${
                                                                order.order_id === selectedOrderId 
                                                                ? "bg-blue-100/90 border-l-4 border-blue-500 shadow-md" 
                                                                : "hover:bg-gray-50/90 hover:border-l-4 hover:border-gray-300"
                                                            }`}
                                                            onClick={() => handleOrderClick(order.order_id)}
                                                        >
                                                            <td className="px-4 py-2 text-black">{order.order_id}</td>
                                                            <td className="px-4 py-2 text-black">{order.customer_name}</td>
                                                            <td className="px-4 py-2 text-black">{displayPriority}</td>
                                                            <td className="px-4 py-2 text-black">
                                                                {new Date(order.order_date).toLocaleDateString("en-GB")}
                                                            </td>
                                                            <td className="px-4 py-2 text-black">{orderProgress[order.order_id]}</td>
                                                        </tr>
                                                    );
                                                })
                                            )}
                                        </tbody>
                                    </table>
                                </div>
                                <div className="flex justify-between items-center bg-white/90 backdrop-blur-sm p-4 border border-gray-200">
                                    <div className="text-sm text-gray-600">
                                        Showing {(currentPage - 1) * ordersPerPage + 1} to {" "}
                                        {Math.min(currentPage * ordersPerPage, totalOrders)} of {totalOrders}{" "} pending orders
                                    </div>
                                    <div className="flex gap-2">
                                        <button
                                            onClick={() => handlePageChange(currentPage - 1)}
                                            disabled={currentPage === 1}
                                            className="px-3 py-1 rounded bg-gray-200 text-gray-700 disabled:opacity-50 disabled:cursor-not-allowed"
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
                {/**Order Details Section */}
                <div className="flex-1 max-w-2xl">
                    <div className="bg-black/70 rounded-t-lg">
                        <h1 className="text-2xl font-bold text-white p-4 flex justify-center">Order Details</h1>
                    </div>
                    <div className="bg-black/70 border border-gray-200 p-6 h-[calc(100vh-300px)] overflow-y-auto">
                        {selectedOrder ? (
                            <div className="space-y-6 text-white">
                                <div className="grid grid-cols-2 gap-4">
                                    <div>
                                        <p className="text-sm text-gray-400 underline">Order Date:</p>
                                        <p className="font-medium">{new Date(selectedOrder.order_date).toLocaleDateString("en-GB")}</p>
                                    </div>
                                    <div>
                                        <p className="text-sm text-gray-400 underline">Status:</p>
                                        <p className="font-medium">{selectedOrder.status}</p>
                                    </div>
                                    <div>
                                        <p className="text-sm text-gray-400 underline">Despatch Cloud:</p>
                                        <a 
                                            href={`https://shadowfoam.despatchcloud.net/orders/edit?id=${selectedOrder.id}`}
                                            target="_blank"
                                            rel="noopener noreferrer" 
                                            className="font-medium text-blue-400 hover:text-blue-300 transition-colors"
                                        >
                                            View in Despatch Cloud
                                        </a>
                                    </div>
                                   
                                    <div>
                                        <p className="text-sm text-gray-400 underline">Customer Name:</p>
                                        <p className="font-medium">{selectedOrder.customer_name}</p>
                                    </div>
                                </div>
                                <div>
                                    <div className="flex justify-between items-center mb-4">
                                        <h2 className="font-semibold text-lg">Items:</h2>
                                        
                                        {/* Progress indicator repositioned */}
                                        {selectedOrderItems.length > 0 && (
                                            <div className="flex items-center gap-3">
                                                <div className="flex items-center gap-2">
                                                    <span className="text-sm text-gray-300">
                                                        {selectedOrderItems.filter(item => item.completed).length} of {selectedOrderItems.length} items
                                                    </span>
                                                    <div className="w-24 bg-gray-700 rounded-full h-2">
                                                        <div 
                                                            className="bg-green-500 h-2 rounded-full transition-all duration-500 ease-out"
                                                            style={{ 
                                                                width: `${selectedOrderItems.length > 0 
                                                                    ? (selectedOrderItems.filter(item => item.completed).length / selectedOrderItems.length) * 100 
                                                                    : 0}%` 
                                                            }}
                                                            aria-hidden="true"
                                                        ></div>
                                                    </div>
                                                </div>
                                                
                                                {/* Complete Order Button moved above */}
                                                <button
                                                    onClick={handleCompleteOrderClick}
                                                    className="group px-4 py-1.5 bg-gradient-to-br from-green-500 to-green-600 rounded-md text-white text-sm font-medium hover:from-green-600 hover:to-green-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-gray-800 focus:ring-green-500 transition-all duration-200 shadow-sm hover:shadow-md flex items-center gap-1.5"
                                                    aria-label="Mark order as completed"
                                                    disabled={selectedOrderItems.length === 0}
                                                >
                                                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                                        <path d="M12 22c5.523 0 10-4.477 10-10S17.523 2 12 2 2 6.477 2 12s4.477 10 10 10z"/>
                                                        <path d="m9 12 2 2 4-4"/>
                                                    </svg>
                                                    Complete Order
                                                </button>
                                            </div>
                                        )}
                                    </div>
                                    
                                    {/* Warning message moved here - above the table */}
                                    {showWarning && (
                                        <div 
                                            className="mb-4 px-4 py-2 bg-amber-600/40 border border-amber-400 rounded-md text-amber-200 text-sm flex items-center gap-2 animate-fade-in"
                                            role="alert"
                                            aria-live="polite"
                                        >
                                            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-amber-300 flex-shrink-0" viewBox="0 0 20 20" fill="currentColor">
                                                <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                                            </svg>
                                            <p>All items must be completed before the order can be marked as complete.</p>
                                        </div>
                                    )}
                                    
                                    {/* Add loading indicator for order items */}
                                    {selectedOrderId && selectedOrderItems.length === 0 && !loading ? (
                                        <div className="flex flex-col items-center justify-center p-8 bg-gray-900/30 rounded-lg border border-gray-700 animate-pulse">
                                            <div className="w-10 h-10 border-4 border-gray-600 border-t-blue-400 rounded-full animate-spin mb-4"></div>
                                            <p className="text-blue-300 font-medium">Loading order items...</p>
                                        </div>
                                    ) : (
                                        <div className="overflow-x-auto bg-gray-900/30 rounded-lg border border-gray-700">
                                            <table className="w-full text-white">
                                                <thead className="bg-gray-800/50">
                                                    <tr>
                                                        <th className="px-4 py-3 text-left text-sm font-medium text-gray-300">Name</th>
                                                        <th className="px-6 py-3 text-center text-sm font-medium text-gray-300 whitespace-nowrap">Foam Sheet</th>
                                                        <th className="px-4 py-3 text-center text-sm font-medium text-gray-300">Quantity</th>
                                                        <th className="px-4 py-3 text-center text-sm font-medium text-gray-300">Priority</th>
                                                        <th className="px-4 py-3 text-center text-sm font-medium text-gray-300">Complete</th>
                                                    </tr>
                                                </thead>
                                                <tbody className="divide-y divide-gray-700/50">
                                                    {selectedOrderItems.map((item) => (
                                                        <tr key={item.id} className="hover:bg-gray-800/30 transition-colors">
                                                            <td className="px-4 py-3 text-left">{item.item_name}</td>
                                                            <td className="px-4 py-3 text-center whitespace-nowrap">{item.foamsheet}</td>
                                                            <td className="px-4 py-3 text-center">{item.quantity}</td>
                                                            <td className="px-4 py-3 text-center">{item.priority}</td>
                                                            <td className="px-4 py-3 text-center">
                                                                <div className="flex justify-center">
                                                                    <label className="relative inline-flex items-center cursor-pointer">
                                                                        <input
                                                                            type="checkbox"
                                                                            checked={item.completed}
                                                                            onChange={(e) => handleToggleCompleted(
                                                                                selectedOrder.order_id,
                                                                                item.id,
                                                                                e.target.checked
                                                                            )}
                                                                            className="sr-only peer"
                                                                            aria-label={`Mark ${item.item_name} as ${item.completed ? 'incomplete' : 'complete'}`}
                                                                        />
                                                                        <div className="w-5 h-5 border-2 border-gray-400 rounded peer-checked:bg-green-500 peer-checked:border-green-500 peer-focus:ring-2 peer-focus:ring-green-400/50 transition-all flex items-center justify-center">
                                                                            {item.completed && (
                                                                                <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                                                                    <path d="M12 22c5.523 0 10-4.477 10-10S17.523 2 12 2 2 6.477 2 12s4.477 10 10 10z"/>
                                                                                    <path d="m9 12 2 2 4-4"/>
                                                                                </svg>
                                                                            )}
                                                                        </div>
                                                                    </label>
                                                                </div>
                                                            </td>
                                                        </tr>
                                                    ))}
                                                </tbody>
                                            </table>
                                        </div>
                                    )}
                                    
                                    {/* No items selected state */}
                                    {!selectedOrderId && (
                                        <div className="flex items-center justify-center h-full">
                                            <p className="text-white text-lg">No order selected. Please choose an order</p>
                                        </div>
                                    )}
                                </div>
                            </div>
                        ) : (
                            <div className="flex items-center justify-center h-full">
                                <p className="text-white text-lg">No order selected. Please choose an order</p>
                            </div>
                        )}
                    </div>
                </div>
            </div>

            {/* Order Finished Confirmation Dialog */}
            {showOrderFinishedDialog && selectedOrder && (
                <OrderFinished
                    isOpen={showOrderFinishedDialog}
                    onClose={handleCancelOrderFinished}
                    onConfirm={handleMarkCompleted}
                    orderId={selectedOrder.order_id}
                    id={selectedOrder.id.toString()}
                />
            )}
        </div>
    )
}

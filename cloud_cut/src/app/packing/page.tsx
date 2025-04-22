"use client";

import NavBar from "@/components/Navbar";
import StartPacking from "@/components/orderStartedPacking";
import { useEffect, useMemo, useRef, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import { AppDispatch, RootState } from "@/redux/store";
import {
    setSelectedOrderId,
    updateItemCompleted,
    updateOrderStatus,
    setCurrentView,
    updateOrderPickingStatus,
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
import { subscribeToOrders, subscribeToOrderItems, getCurrentUser } from "@/utils/supabase";
import { OrderItem, Order } from "@/types/redux";
import { supabase } from "@/utils/supabase";
import { store } from "@/redux/store";

// Define OrderWithPriority type
type OrderWithPriority = Order & { calculatedPriority: number };

export default function Packing() {
    const dispatch = useDispatch<AppDispatch>();
    const orders = useSelector(selectPackingOrders);
    const totalOrders = useSelector(selectCurrentViewTotal);
    const selectedOrderId = useSelector((state: RootState) => state.orders.selectedOrderId);
    const selectedItemsSelector = useMemo(() => selectOrderItemsById(selectedOrderId || ''), [selectedOrderId]);
    const selectedOrderItems = useSelector(selectedItemsSelector);
    const { currentPage, loading, error } = useSelector((state: RootState) => state.orders);
    const selectedRowRef = useRef<HTMLTableRowElement>(null);
    const ordersPerPage = 15;
    const totalPages = Math.ceil(totalOrders / ordersPerPage);
    const selectedOrder = orders.find((o) => o.order_id === selectedOrderId)
    const [isRefreshing, setIsRefreshing] = useState(false);
    const [showOrderFinishedDialog, setShowOrderFinishedDialog] = useState(false);
    const [pendingItemToComplete, setPendingItemToComplete] = useState<{ orderId: string;itemId: string;completed: boolean; } | null>(null);
    const [showWarning, setShowWarning] = useState(false);
    const [currentUserName, setCurrentUserName] = useState<string | null>(null);
    const [activeTab, setActiveTab] = useState<'orders' | 'retail'>('orders');
    const [retailPackFilter, setRetailPackFilter] = useState('');
    const [selectedRetailPack, setSelectedRetailPack] = useState<string | null>(null);
    const [ordersWithRetailPacks, setOrdersWithRetailPacks] = useState<Record<string, Order[]>>({});
    const [loadingRetailPackOrders, setLoadingRetailPackOrders] = useState(false);

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

    useEffect(() => {
        const initialize = async () => {
            try {
                const currentUser = await getCurrentUser();
                console.log('Current user from auth:', currentUser);

                // Fetch the user's Name
                if (currentUser) {
                    const {data, error} = await supabase
                        .from('profiles')
                        .select('name')
                        .eq('id', currentUser.id)
                        .single();

                    if (error) {
                        console.error('Error fetching user profile:', error);
                        return;
                    }
                    
                    console.log('User profile data:', data);
                    if (data && data.name) {
                        setCurrentUserName(data.name as string);
                        console.log('Set current user name to:', data.name);
                    } else {
                        console.warn('User profile exists but name is missing');
                    }
                } else {
                    console.warn('No current user found');
                }
            } catch (error) {
                console.error('Error in initialize function:', error);
            }
        };
        
        initialize();
    }, []);

    const handleOrderClick = async (orderId: string) => {
        
        try {
            // Set loading state
            setIsRefreshing(true);
            
            // First set the active tab to orders
            setActiveTab('orders');
            
            // Get current state to check for order items
            const state = store.getState();
            
            // Directly set the selected order so the UI can prepare for it
            dispatch(setSelectedOrderId(orderId));
            
            // Query all packing orders with proper filters to calculate pagination
            const { data: packingOrders, error } = await supabase
                .from('orders')
                .select('*')
                .eq('status', 'Pending')
                .eq('manufactured', true)
                .eq('packed', false);
                
            if (error) {
                console.error('Error fetching packing orders:', error);
                setIsRefreshing(false);
                return;
            }
                
            console.log(`Fetched ${packingOrders?.length || 0} total packing orders`);
            
            if (!packingOrders || packingOrders.length === 0) {
                console.error('No packing orders found');
                setIsRefreshing(false);
                return;
            }
            
            // Verify the order exists in the fetched orders
            const orderExists = packingOrders.some(order => order.order_id === orderId);
            if (!orderExists) {
                console.error(`Order ${orderId} not found in packing orders`);
                setIsRefreshing(false);
                return;
            }
            
            console.log(`Order ${orderId} found in packing orders`);
            
            // Sort the orders the SAME WAY as they appear in your table
            const sortedOrders = [...packingOrders].sort((a, b) => {
                // Get items for these orders to determine priority
                const aItems = state.orders.orderItems[a.order_id as string] || [];
                const bItems = state.orders.orderItems[b.order_id as string] || [];
                
                // Calculate max priority for each order
                const aMaxPriority = aItems.length > 0 
                    ? Math.max(...aItems.map((item: OrderItem) => item.priority || 0)) 
                    : 0;
                const bMaxPriority = bItems.length > 0
                    ? Math.max(...bItems.map((item: OrderItem) => item.priority || 0))
                    : 0;
                
                // Sort by priority (highest first)
                return bMaxPriority - aMaxPriority;
            });
            
            
            // Find the index of our target order in the sorted list
            const orderIndex = sortedOrders.findIndex(order => order.order_id === orderId);
            console.log(`Order ${orderId} is at index ${orderIndex} in the sorted list`);
            
            // Calculate which page it should be on (1-indexed)
            const targetPage = Math.floor(orderIndex / ordersPerPage) + 1;
            console.log(`Target page for order: ${targetPage}`);
            
            // If we're already on the right page, no need to navigate
            if (targetPage === currentPage) {
                
                // Scroll to the row
                setTimeout(() => {
                    console.log('Attempting to scroll to selected row');
                    if (selectedRowRef.current) {
                        selectedRowRef.current.scrollIntoView({ behavior: "smooth", block: "center" });
                    } else {
                        console.log('Selected row not found - but we are on the right page');
                        console.log('Current orders:', orders.map(o => o.order_id).join(', '));
                    }
                }, 100);
            } else {
                
                await dispatch(fetchOrdersFromSupabase({
                    page: targetPage,
                    perPage: ordersPerPage,
                    manufactured: true,
                    packed: false,
                    status: "Pending",
                    view: 'packing'
                }));
                
                console.log(`Navigated to page ${targetPage}`);
                
                // Set selected order ID again after navigation
                setTimeout(() => {
                    console.log(`Re-setting selected order ID to ${orderId} after navigation`);
                    dispatch(setSelectedOrderId(orderId));
                    
                    // Scroll to the selected row
                    setTimeout(() => {
                        console.log('Attempting to scroll to selected row after navigation');
                        if (selectedRowRef.current) {
                            selectedRowRef.current.scrollIntoView({ behavior: "smooth", block: "center" });
                            console.log('Scrolled to selected row');
                        } else {
                            console.log('Selected row not found after navigation');
                            console.log('Current orders after navigation:', orders.map(o => o.order_id).join(', '));
                        }
                    }, 500);
                }, 200);
            }
        } catch (error) {
            console.error('Error in handleOrderClick:', error);
        } finally {
            setIsRefreshing(false);
        }
    };

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


    const handleMarkCompleted = (orderId: string) => {
        // Close the confirmation dialog
        setShowOrderFinishedDialog(false);

        console.log(`Marking order ${orderId} as completed`);
        // Show loading state
        setIsRefreshing(true);

        // If there's a pending item to complete
        if (pendingItemToComplete) {
            // Mark the item as completed
            dispatch(updateItemCompleted(pendingItemToComplete));

            // Update the order status in Redux
            dispatch(updateOrderStatus({
                orderId,
                status: "Completed"
            }));

            // Clear the pending item
            setPendingItemToComplete(null);
        }

        // Refresh the orders list to reflect the changes (now the order should be gone)
        console.log(`Refreshing orders after marking ${orderId} as completed`);
        
        // Add a short delay to ensure database operations have completed
        setTimeout(() => {
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
            });
        }, 1000);
    };

    // Function to handle cancellation of the confirmation dialog
    const handleCancelOrderFinished = () => {
        // Close the dialog
        setShowOrderFinishedDialog(false);
        // Clear the pending item
        setPendingItemToComplete(null);
    };

    // Function to handle the "" button click
    const handleStartPackingClick = () => {
        if (!selectedOrder) return;
        
        // Debug log to see the value of currentUserName
        console.log('Current user name before dispatch:', currentUserName);
        
        // Set the order status to "Picking"
        dispatch(updateOrderPickingStatus({
            orderId: selectedOrder.order_id,
            picking: true,
            user_picking: currentUserName || 'N/A',
        }));
        
        // Also manually update the local state for immediate UI feedback
        const updatedOrders = orders.map(order => {
            if (order.order_id === selectedOrder.order_id) {
                return {
                    ...order,
                    picking: true,
                    user_picking: currentUserName || 'N/A'
                };
            }
            return order;
        });
        
        // Log the status after a small delay to allow state to update
        setTimeout(() => {
            // Find the order after state update
            const updatedOrder = updatedOrders.find((o: Order) => o.order_id === selectedOrder.order_id);
            console.log(`Order Picking Status: ${updatedOrder?.picking}`);
            console.log(`Order User Picking Status: ${updatedOrder?.user_picking}`);
        }, 1000);
        
        // Show the OrderFinished dialog
        setShowOrderFinishedDialog(true);
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
    //Function to get the items by retail pack
    const itemsByRetailPack = useSelector((state: RootState) => {
        const allOrderItems = Object.values(state.orders.orderItems).flat();

        return allOrderItems.reduce((acc: Record<string, number>, item: OrderItem) => {
            if (item.item_name.includes('Retail Pack') && !item.completed) {
                acc[item.item_name] = (acc[item.item_name] || 0) + 1;
            }
            return acc;
        }, {});
    });

    const handleRetailPackClick = (retailPack: string) => {
        setSelectedRetailPack(retailPack);
    };

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
    };

    // Get all order items from the state
    const allOrderItems = useSelector((state: RootState) => state.orders.orderItems);

    // Function to find orders with retail pack
    const findOrdersWithRetailPack = (retailPack: string | null) => {
        if (!retailPack) return [];
        
        // Return cached orders if already fetched
        if (ordersWithRetailPacks[retailPack]) {
            return ordersWithRetailPacks[retailPack];
        }
        
        // Find all order IDs that have this retail pack
        const orderIdsWithRetailPack = new Set<string>();
        
        // Check each order's items for the retail pack name
        Object.entries(allOrderItems).forEach(([orderId, items]) => {
            if (items.some(item => item.item_name === retailPack && !item.completed)) {
                orderIdsWithRetailPack.add(orderId);
            }
        });
        
        // Convert Set to Array
        const orderIdsArray = Array.from(orderIdsWithRetailPack);
        
        // Initialize with empty array to avoid undefined
        if (!ordersWithRetailPacks[retailPack]) {
            setOrdersWithRetailPacks(prev => ({
                ...prev,
                [retailPack]: []
            }));
        }
        
        // If we have order IDs, fetch them from the database
        if (orderIdsArray.length > 0) {
            // Fetch order data from supabase in the background
            setLoadingRetailPackOrders(true);
            
            const fetchOrders = async () => {
                try {
                    const { data: fetchedOrders, error } = await supabase
                        .from('orders')
                        .select('*')
                        .in('order_id', orderIdsArray)
                        .eq('status', 'Pending')
                        .eq('manufactured', true)
                        .eq('packed', false);
                        
                    if (error) {
                        console.error('Error fetching orders for retail pack:', error);
                        return;
                    }
                    
                    console.log(`Fetched ${fetchedOrders?.length || 0} orders for retail pack ${retailPack}`);
                    
                    if (fetchedOrders) {
                        // Type casting to ensure we're setting Order[] type
                        const typedOrders = fetchedOrders as unknown as Order[];
                        setOrdersWithRetailPacks(prev => ({
                            ...prev,
                            [retailPack]: typedOrders
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
        
        // Return whatever we currently have (might be empty initially)
        return ordersWithRetailPacks[retailPack] || [];
    };

    // Function to get quantity of a specific retail pack in an order
    const getRetailPackQuantityInOrder = (orderId: string, retailPack: string) => {
        const items = allOrderItems[orderId] || [];
        return items
            .filter(item => item.item_name === retailPack && !item.completed)
            .reduce((sum, item) => sum + item.quantity, 0);
    };

    // Function to render the orders with retail pack table content
    const renderOrdersWithRetailPack = (retailPack: string | null) => {
        if (!retailPack) {
            return (
                <tr>
                    <td colSpan={4} className="px-6 py-10 text-center">
                        <div className="flex flex-col items-center justify-center text-gray-800">
                            <svg xmlns="http://www.w3.org/2000/svg" className="h-12 w-12 mb-3 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                            </svg>
                            <p className="text-lg font-medium">No retail pack selected</p>
                            <p className="text-sm text-gray-500 mt-1">Please select a retail pack to see orders</p>
                        </div>
                    </td>
                </tr>
            );
        }
        
        if (loadingRetailPackOrders) {
            return (
                <tr>
                    <td colSpan={4} className="px-6 py-10 text-center">
                        <div className="flex flex-col items-center justify-center text-gray-800">
                            <div className="w-12 h-12 rounded-full border-4 border-gray-300 border-t-blue-600 animate-spin mb-4"></div>
                            <p className="text-lg font-medium">Loading orders...</p>
                            <p className="text-sm text-gray-500 mt-1">Retrieving orders with this retail pack</p>
                        </div>
                    </td>
                </tr>
            );
        }
        
        const ordersWithPack = findOrdersWithRetailPack(retailPack);
        
        if (ordersWithPack.length === 0) {
            return (
                <tr>
                    <td colSpan={4} className="px-6 py-10 text-center">
                        <div className="flex flex-col items-center justify-center text-gray-800">
                            <svg xmlns="http://www.w3.org/2000/svg" className="h-12 w-12 mb-3 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                            </svg>
                            <p className="text-lg font-medium">No orders found</p>
                            <p className="text-sm text-gray-500 mt-1">No pending packing orders contain this retail pack</p>
                        </div>
                    </td>
                </tr>
            );
        }
        
        return ordersWithPack.map((order, index) => {
            // Get the maximum priority from order items
            const items = allOrderItems[order.order_id] || [];
            const maxPriority = items.length > 0
                ? Math.max(...items.map((item: OrderItem) => item.priority || 0))
                : 0;

            return (
                <tr 
                    key={order.order_id}
                    className={`transition-colors duration-150 hover:bg-blue-50 cursor-pointer shadow-sm ${index % 2 === 0 ?
                    `bg-white` : `bg-gray-50`}`}
                    onClick={() => {
                        handleOrderClick(order.order_id);
                        setActiveTab('orders');
                    }}
                    tabIndex={0}
                    role="button"
                    onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ''){
                            e.preventDefault();
                            handleOrderClick(order.order_id);
                            setActiveTab('orders');
                        }
                    }}
                    aria-label={`View details for order ${order.order_id} from ${order.customer_name}`}
                >
                    <td className="px-6 py-4 text-left">
                        <div className="flex items-center">
                            <span className="text-black text-lg">{order.order_id}</span>
                        </div>
                    </td>
                    <td className="px-6 py-4 text-left">
                        <span className="text-black text-lg">{order.customer_name}</span>
                    </td>
                    <td className="px-6 py-4 text-center">
                        <span className={`inline-flex items-center justify-center min-w-[2.5rem] px-3 py-1 shadow-sm rounded-full text-lg text-black`}>{maxPriority}</span>
                    </td>
                    <td className="px-6 py-4 text-center">
                        <span>{getRetailPackQuantityInOrder(order.order_id, retailPack)}</span>
                    </td>
                </tr>
            );
        });
    };

    return (
        <div className="min-h-screen">
            <NavBar />

            {/**Pill Section*/}
            <div className="container mx-auto pt-28 flex justify-center gap-8">
                <div className="flex justify-center">
                    <div className="relative bg-[#2b3544] rounded-full shadow-xl p-1 inline-flex border border-gray-700 w-[320px]">
                        {/* Sliding background that moves based on active tab */}
                        <div className={`sliding-pill ${activeTab === 'orders' ? 'pill-first' : 'pill-second'}`}></div>
                        
                        {/* Orders Queue Tab */}
                        <button 
                            onClick={() => setActiveTab('orders')}
                            className="relative rounded-full font-medium transition-all duration-300 z-10 flex-1 py-2 px-3"
                        >
                            <span className={`relative z-10 flex items-center justify-center gap-1.5 whitespace-nowrap ${
                                activeTab === 'orders' ? 'text-white font-semibold' : 'text-gray-300 hover:text-white'
                            }`}>
                                <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
                                </svg>
                                Orders Queue
                            </span>
                        </button>
                        
                        {/* Retail Packs Tab */}
                        <button 
                            onClick={() => setActiveTab('retail')}
                            className="relative rounded-full font-medium transition-all duration-300 z-10 flex-1 py-2 px-3"
                        >
                            <span className={`relative z-10 flex items-center justify-center gap-1.5 whitespace-nowrap ${
                                activeTab === 'retail' ? 'text-white font-semibold' : 'text-gray-300 hover:text-white'
                            }`}>
                                <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M16 11V7a4 4 0 00-8 0v4M5 9h14l1 12H4L5 9z" />
                                </svg>
                                Retail Packs
                            </span>
                        </button>
                    </div>
                </div>
            </div>
            
            {/* Content sections with conditional rendering */}
            {activeTab === 'orders' && (
                <div className="container mx-auto pt-10 mb-8 p-6 flex justify-center gap-8">  
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
                                                                    ? "bg-blue-200/90 border-l-4 border-blue-500 shadow-md" 
                                                                    : order.picking
                                                                      ? "bg-red-200/90 border-l-4 border-red-500 shadow-md"
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
                                                    
                                                    {/* Complete Order Button moved above */}
                                                    <button
                                                        onClick={handleStartPackingClick}
                                                        className={`group px-4 py-1.5 rounded-md text-sm font-medium transition-all duration-200 shadow-sm hover:shadow-md flex items-center gap-1.5
                                                            ${selectedOrder?.picking 
                                                            ? 'bg-gradient-to-br from-gray-400 to-gray-500 text-gray-100 opacity-75 cursor-not-allowed' 
                                                            : 'bg-gradient-to-br from-green-500 to-green-600 text-white hover:from-green-600 hover:to-green-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-gray-800 focus:ring-green-500'
                                                            }`}
                                                        aria-label={selectedOrder?.picking ? "Order is already being picked" : "Start picking this order"}
                                                        disabled={selectedOrderItems.length === 0 || selectedOrder?.picking}
                                                        title={selectedOrder?.picking ? `Currently being picked by ${selectedOrder.user_picking}` : "Start picking this order"}
                                                    >
                                                        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                                            <path d="M12 22c5.523 0 10-4.477 10-10S17.523 2 12 2 2 6.477 2 12s4.477 10 10 10z"/>
                                                            <path d="m9 12 2 2 4-4"/>
                                                        </svg>
                                                        {selectedOrder?.picking ? `Being picked by ${selectedOrder.user_picking}` : "Start Picking"}
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
                                                <table className="w-full text-white border-collapse">
                                                    <thead className="bg-gray-800/70">
                                                        <tr>
                                                            <th className="px-6 py-4 text-left text-sm font-semibold text-gray-200 uppercase tracking-wider border-b border-gray-700">Name</th>
                                                            <th className="px-6 py-4 text-center text-sm font-semibold text-gray-200 uppercase tracking-wider border-b border-gray-700">Quantity</th>
                                                        </tr>
                                                    </thead>
                                                    <tbody className="divide-y divide-gray-700/50 bg-gray-900/20">
                                                        {selectedOrderItems.map((item) => (
                                                            <tr key={item.id} className="hover:bg-gray-800/40 transition-colors duration-150">
                                                                <td className="px-6 py-4 text-left text-gray-200 font-medium">{item.item_name}</td>
                                                                <td className="px-6 py-4 text-center text-gray-300">{item.quantity}</td>
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
            )}

            {/* Retail Packs Tab Active Section*/}
            {activeTab === 'retail' && (
                <div className="container mx-auto pt-6 pb-8 px-4 flex flex-col lg:flex-row gap-6 max-w-[1520px]">
                {/**Retail Packs Section */}        
                    <div className="flex-1 w-full h-[calc(100vh-300px)] overflow-hidden">
                        <div className="bg-black/90 rounded-xl shadow-xl overflow-hidden h-full flex flex-col">
                            <div className="px-6 py-5 bg-black/90">
                                <h2 className="text-2xl font-bold text-white text-center">Retail Packs</h2>
                            </div>
                            <div className="flex-1 overflow-auto p-4">
                                <div className="h-full">
                                    <table className="w-full h-full bg-white/90 rounded-lg shadow-lg overflow-hidden">
                                        <thead className="bg-[#1d1d1d] sticky top-0 z-10">
                                            <tr>
                                                <th className="px-6 py-4 text-left text-lg font-semibold text-gray-200">Retail Pack</th>
                                                <th className="px-6 py-4 text-center text-lg font-semibold text-gray-200">Quantity</th>
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
                                                //Render Retail Packs and their quantities
                                                Object.keys(itemsByRetailPack).length === 0 ? (
                                                    <tr>
                                                        <td colSpan={2} className="px-6 py-10 text-center">
                                                            <div className="flex flex-col items-center justify-center text-black">
                                                                <svg xmlns="http://www.w3.org/2000/svg" className="h-12 w-12 mb-3 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4" />
                                                                </svg>
                                                                <p className="text-lg font-medium">No retail packs found</p>
                                                                <p className="text-sm text-gray-500 mt-1">There are no retail packs in the orders ready for packing</p>
                                                            </div>
                                                        </td>
                                                    </tr>
                                                ) : (
                                                    <>
                                                        {Object.entries(itemsByRetailPack)
                                                            .filter(([itemName]) => {
                                                                if (!retailPackFilter) return true;
                                                                return itemName.toLowerCase().includes(retailPackFilter.toLowerCase());
                                                            })
                                                            .sort(([itemNameA, quantityA], [itemNameB, quantityB]) => {
                                                                // Sort alphabetically by item name
                                                                return quantityB - quantityA;
                                                            })
                                                            .map(([itemName, quantity], index) => (
                                                                <tr 
                                                                    key={itemName} 
                                                                    className={`transition-colors duration-150 
                                                                        ${selectedRetailPack === itemName ? 'bg-blue-50' : (index % 2 === 0 ? 'bg-white' : 'bg-gray-50')} 
                                                                        hover:bg-blue-50 cursor-pointer shadow-sm`}
                                                                    onClick={() => handleRetailPackClick(itemName)}
                                                                >
                                                                    <td className="px-6 py-5 text-left">
                                                                        <div className="flex items-center space-x-3">
                                                                            <div className={`w-4 h-4 rounded-full mr-3 ${getRetailPackColorClass(itemName)}`}></div>
                                                                            <span className="text-black text-lg">
                                                                                {itemName}
                                                                            </span>
                                                                        </div>
                                                                    </td>
                                                                    <td className="px-6 py-5 text-center">
                                                                        <span className="inline-flex items-center justify-center min-w-[2.5rem] px-3 py-1 shadow-sm rounded-full text-lg text-black">
                                                                            {quantity}
                                                                        </span>
                                                                    </td>
                                                                </tr>
                                                            ))}
                                                    </>
                                                )
                                            )}
                                        </tbody>
                                    </table>
                                </div>
                            </div>
                        </div>
                    </div>

                    {/*Retail Packs Order Details Section */}
                    <div className="flex-1 w-full h-[calc(100vh-300px)] overflow-hidden">
                        <div className="bg-black/90 rounded-xl shadow-xl overflow-hidden e h-full flex flex-col">
                            <div className="px-6 py-5 bg-black/90">
                                <h2 className="text-2xl font-bold text-white text-center">
                                    {selectedRetailPack ? (
                                        <div className="flex items-center justify-center">
                                            <span className="relative">
                                                Orders with<span className="font-semibold relative inline-flex items-center">
                                                    <span className={`inline-block w-4 h-4 rounded-full ${(selectedRetailPack)}`}></span>
                                                    {selectedRetailPack}
                                                </span>
                                            </span> 
                                        </div>
                                    ) : (
                                        <span className="relative inline-block">Select a Retail Pack</span>
                                    )}
                                </h2>
                            </div>
                            <div className="flex-1 overflow-auto p-4">
                                <div className="h-full">
                                    <div className="overflow-x-auto rounded-lg border border-white/20 shadow-lg h-full">
                                        <table className="w-full h-full bg-white/90 rounded-lg shadow-lg overflow-hidden">
                                            <thead className="bg-[#1d1d1d] sticky top-0 z-10">
                                                <tr>
                                                    <th className="px-6 py-4 text-left text-lg font-semibold text-gray-200">Order ID</th>
                                                    <th className="px-6 py-4 text-left text-lg font-semibold text-gray-200">Customer Name</th>
                                                    <th className="px-6 py-4 text-center text-lg font-semibold text-gray-200">Priority</th>
                                                    <th className="px-6 py-4 text-center text-lg font-semibold text-gray-200">Quantity</th>
                                                </tr>
                                            </thead>
                                            <tbody className="divide-y divide-gray-300">
                                                {renderOrdersWithRetailPack(selectedRetailPack)}
                                            </tbody>
                                        </table>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* Order Finished Confirmation Dialog */}
            {showOrderFinishedDialog && selectedOrder && (
                <StartPacking
                    isOpen={showOrderFinishedDialog}
                    onClose={handleCancelOrderFinished}
                    onConfirm={handleMarkCompleted}
                    selectedOrder={selectedOrder}
                    selectedOrderItems={selectedOrderItems}
                    id={selectedOrder.id.toString()}
                />
            )}
        </div>
    )
}

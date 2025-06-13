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
import * as Sentry from "@sentry/nextjs";
import RetailPackConfirm from "@/components/retailPackConfirm";

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
    const [showStartPackingModal, setShowStartPackingModal] = useState(false);
    const [pendingItemToComplete, setPendingItemToComplete] = useState<{ orderId: string;itemId: string;completed: boolean; } | null>(null);
    const [showWarning, setShowWarning] = useState(false);
    const [currentUserName, setCurrentUserName] = useState<string | null>(null);
    const [activeTab, setActiveTab] = useState<'orders' | 'retail'>('orders');
    const [retailPackFilter, setRetailPackFilter] = useState('');
    const [selectedRetailPack, setSelectedRetailPack] = useState<string | null>(null);    
    const [ordersWithRetailPacks, setOrdersWithRetailPacks] = useState<Record<string, Order[]>>({});
    const [loadingRetailPackOrders, setLoadingRetailPackOrders] = useState(false);
    const [retailPackPage, setRetailPackPage] = useState(1);
    const retailPacksPerPage = 15;
    const [retailPackTableBPage, setRetailPackTableBPage] = useState(1);
    const [allRetailPacksChecked, setAllRetailPacksChecked] = useState(false);
    const [checkedOrders, setCheckedOrders] = useState<Set<string>>(new Set());
    const [orderIdsForMarkCompleted, setOrderIdsForMarkCompleted] = useState<string[]>([]);
    const [currentOrderProgress, setCurrentOrderProgress] = useState<string>('0');
    const [showRetailPackConfirmDialog, setShowRetailPackConfirmDialog] = useState(false);
    const [checkedRetailPacks, setCheckedRetailPacks] = useState<Record<string, boolean>>({});
    const [pendingRetailPackOrders, setPendingRetailPackOrders] = useState<RetailPackOrders>([]);
    
    type RetailPackOrders = { retailPackName: string; orderIds: string[] }[];

    const orderProgress = useSelector((state: RootState) =>
        state.orders.allOrders.reduce((acc, order) => {
            acc[order.order_id] = selectOrderProgress(order.order_id)(state);
            return acc;
        }, {} as Record<string, string>)
    );

    const orderItemsById = useSelector((state: RootState) =>
        state.orders.allOrders.reduce((acc, order) => {
            acc[order.order_id] = selectOrderItemsById(order.order_id)(state);
            return acc;
        }, {} as Record<string, OrderItem[]>)
    );

    // Calculate priorities for all orders
    const orderPriorities = useSelector((state: RootState) =>
        state.orders.allOrders.reduce((acc, order) => {
            const orderItems = state.orders.orderItems[order.order_id] || [];
            acc[order.order_id] = orderItems.length > 0
                ? Math.max(...orderItems.map((item) => item.priority || 0))
                : 0;
            return acc;
        }, {} as Record<string, number>)
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
        Sentry.startSpan({
            name: 'handleOrderClick-Packing',
            op: 'ui.interaction.function'
        }, async () => {
            try {
                // Set loading state
                setIsRefreshing(true);
                
                // First set the active tab to orders
                setActiveTab('orders');
                
                // Get current state to check for order items
                const state = store.getState();
                
                // Directly set the selected order so the UI can prepare for it
                dispatch(setSelectedOrderId(orderId));
                
                // Fetch packing orders from Supabase
                const { data: packingOrders, error: ordersError } = await supabase
                    .from('orders')
                    .select('*')
                    .eq('status', 'Pending')
                    .eq('manufactured', true)
                    .eq('packed', false)
                    .order('order_date', { ascending: false });
                
                if (ordersError) {
                    throw ordersError;
                }
                
                // Check if the order exists in the fetched data
                const orderExists = packingOrders.some(order => order.order_id === orderId);
                
                if (!orderExists) {
                    return;
                }
                
                // Sort orders by priority
                const sortedOrders = [...packingOrders].sort((a, b) => {
                    const orderItemsA = state.orders.orderItems[a.order_id as string] as OrderItem[] || [];
                    const orderItemsB = state.orders.orderItems[b.order_id as string] as OrderItem[] || [];
                    
                    const priorityA = orderItemsA.length > 0 ? Math.min(...orderItemsA.map(item => item.priority ?? 10)) : 10;
                    const priorityB = orderItemsB.length > 0 ? Math.min(...orderItemsB.map(item => item.priority ?? 10)) : 10;
                    
                    return priorityA - priorityB;
                });
                
                // Find the index of the selected order in the sorted list
                const orderIndex = sortedOrders.findIndex(order => order.order_id === orderId);
                
                // Calculate which page the order should be on
                const targetPage = Math.floor(orderIndex / ordersPerPage) + 1;
                
                if (targetPage !== currentPage) {
                    // Navigate to the correct page
                    await handlePageChange(targetPage);
                    
                    // Re-set the selected order ID after navigation
                    dispatch(setSelectedOrderId(orderId));
                    
                    // Wait for the DOM to update with the new page
                    await new Promise(resolve => setTimeout(resolve, 100));
                    
                    // Attempt to scroll to the selected row after navigation
                    const selectedRow = document.getElementById(`order-row-${orderId}`);
                    if (selectedRow) {
                        selectedRow.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    }
                } else {
                    // Wait for the DOM to update
                    await new Promise(resolve => setTimeout(resolve, 100));
                    
                    // Scroll to the selected row
                    const selectedRow = document.getElementById(`order-row-${orderId}`);
                    if (selectedRow) {
                        selectedRow.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    }
                }
            } catch (error) {
                Sentry.captureException(error);
            } finally {
                setIsRefreshing(false);
            }
        });
    };

    const handlePageChange = (newPage: number) => {
        Sentry.startSpan({
            name: 'handlePageChange-Packing',
            op: 'ui.navigation'
        }, async () => {
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
    });
};

    const handleMarkCompleted = (orderId: string) => {
        Sentry.startSpan({
            name: 'handleMarkCompleted-Packing',
            op: 'ui.interaction.function'
        }, async () => {

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
        });       
    };

    // Function to handle cancellation of the confirmation dialog
    const handleCancelOrderFinished = () => {
        Sentry.startSpan({
            name: 'handleCancelOrderFinished-Packing',
            op: 'ui.interaction.function'
        }, async () => {
            // Close the dialog
            setShowOrderFinishedDialog(false);
            // Clear the pending item
            setPendingItemToComplete(null);
        });
    };

    // Function to handle the "Start Picking" button click
    const handleStartPackingClick = () => {
        Sentry.startSpan({
            name: 'handleStartPackingClick-Packing',
            op: 'ui.interaction.function'
        }, async () => {
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
            
            // Show the StartPacking modal
            setShowStartPackingModal(true);
        });        
    };

    const handleRefresh = () => {
        Sentry.startSpan({
            name: 'handleRefresh-Packing',
            op: 'ui.interaction.function'
        }, async () => {
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
        });
    };
    //Function to get the items by retail pack
    const itemsByRetailPack = useSelector((state: RootState) => {
        // Debug log for all orders in packing view
        console.log('All orders in packing view:', state.orders.allOrders);

        const allOrderItems = state.orders.allOrders.flatMap((order: Order) => {
            const orderItems = state.orders.orderItems[order.order_id] || [];
            // Debug log for each order's items
            console.log(`Items for order ${order.order_id}:`, orderItems);
            return orderItems;
        });

        // Debug log for all items
        console.log('All order items:', allOrderItems);

        const retailPackItems = allOrderItems.reduce((acc: Record<string, number>, item: OrderItem) => {
            if (item.item_name.includes('Retail Pack')) {
                // Debug log for each retail pack item
                console.log('Processing retail pack item:', {
                    itemName: item.item_name,
                    quantity: item.quantity,
                    orderId: item.order_id,
                    skuId: item.sku_id,
                    completed: item.completed
                });
                acc[item.item_name] = (acc[item.item_name] || 0) + item.quantity;
            }
            return acc;
        }, {} as Record<string, number>);

        // Debug log for final retail pack quantities
        console.log('Retail pack quantities:', retailPackItems);
        return retailPackItems;
    });

    const handleRetailPackClick = (retailPack: string) => {
        console.log('Retail pack clicked:', retailPack);
        setSelectedRetailPack(retailPack);
        // Switch to orders tab
        setActiveTab('orders');
        // Find orders that contain this retail pack
        findOrdersWithRetailPack(retailPack);
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
            console.log('Using cached orders for retail pack:', retailPack, ordersWithRetailPacks[retailPack]);
            return ordersWithRetailPacks[retailPack];
        }
        
        // Find all order IDs that have this retail pack
        const orderIdsWithRetailPack = new Set<string>();
        
        // Debug log for all order items
        console.log('Searching for orders with retail pack:', retailPack);
        console.log('All order items available:', allOrderItems);
        
        // Check each order's items for the retail pack name
        Object.entries(allOrderItems).forEach(([orderId, items]) => {
            const matchingItems = items.filter(item => item.item_name === retailPack);
            console.log(`Checking order ${orderId} for ${retailPack}:`, {
                allItems: items,
                matchingItems: matchingItems,
                completedItems: matchingItems.filter(item => item.completed),
                uncompletedItems: matchingItems.filter(item => !item.completed)
            });
            
            if (matchingItems.length > 0) {
                console.log('Found matching items in order:', {
                    orderId,
                    items: matchingItems.map(item => ({
                        itemName: item.item_name,
                        quantity: item.quantity,
                        completed: item.completed
                    }))
                });
                orderIdsWithRetailPack.add(orderId);
            }
        });
        
        // Debug log for found order IDs
        console.log('Order IDs with retail pack:', Array.from(orderIdsWithRetailPack));
        
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
                    
                    console.log(`Fetched ${fetchedOrders?.length || 0} orders for retail pack ${retailPack}:`, fetchedOrders);
                    
                    if (fetchedOrders) {
                        // Type casting to ensure we're setting Order[] type
                        const typedOrders = fetchedOrders as unknown as Order[];
                        
                        // Sort orders by priority using the orderPriorities from Redux state
                        const sortedOrders = [...typedOrders].sort((a, b) => {
                            const priorityA = orderPriorities[a.order_id] || 0;
                            const priorityB = orderPriorities[b.order_id] || 0;
                            return priorityA - priorityB;
                        });
                        
                        console.log('Sorted orders by priority:', sortedOrders.map(order => ({
                            orderId: order.order_id,
                            priority: orderPriorities[order.order_id]
                        })));
                        
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
        
        // Return whatever we currently have (might be empty initially)
        return ordersWithRetailPacks[retailPack] || [];
    };

    // Function to compute the total number of retail packs after filtering
    const getFilteredRetailPacks = () => {
        return Object.entries(itemsByRetailPack)
            .filter(([itemName]) => {
                if (!retailPackFilter) return true;
                return itemName.toLowerCase().includes(retailPackFilter.toLowerCase());
            })
            .sort(([itemNameA, quantityA], [itemNameB, quantityB]) => {
                // Sort by quantity (highest first)
                return quantityB - quantityA;
            });
    };

    // Function to get retail packs for Table A
    const getTableARetailPacks = () => {
        const filteredPacks = getFilteredRetailPacks();
        const startIndex = (retailPackPage - 1) * retailPacksPerPage;
        const endIndex = Math.min(startIndex + retailPacksPerPage, filteredPacks.length);
        
        // Table A gets the first 10 items of the current page
        return filteredPacks.slice(startIndex, endIndex);
    };

    // Function to get retail packs for Table B
    const getTableBRetailPacks = () => {
        const filteredPacks = getFilteredRetailPacks();
        const totalPacks = filteredPacks.length;
        
        // Table B starts at the 11th item, and provides items from its own page
        const tableBStartIndex = retailPacksPerPage + (retailPackTableBPage - 1) * retailPacksPerPage;
        const tableBEndIndex = Math.min(tableBStartIndex + retailPacksPerPage, totalPacks);
        
        // Only return items if Table A is full (has 10 items)
        if (totalPacks <= retailPacksPerPage) {
            return [];
        }
        
        return filteredPacks.slice(tableBStartIndex, tableBEndIndex);
    };

    // Calculate total pages for each table
    const calculateTotalPages = () => {
        const filteredPacks = getFilteredRetailPacks();
        const totalItems = filteredPacks.length;
        
        // Table A always has at least 1 page
        const tableATotalPages = Math.ceil(Math.min(totalItems, retailPacksPerPage) / retailPacksPerPage) || 1;
        
        // Table B only has pages if there are more than 10 items total
        let tableBTotalPages = 0;
        if (totalItems > retailPacksPerPage) {
            // Calculate how many additional pages are needed for Table B
            tableBTotalPages = Math.ceil((totalItems - retailPacksPerPage) / retailPacksPerPage);
        }
        
        return { tableATotalPages, tableBTotalPages };
    };

    // Handle Table A page changes
    const handleTableAPageChange = (newPage: number) => {
        if (newPage >= 1) {
            const { tableATotalPages } = calculateTotalPages();
            if (newPage <= tableATotalPages) {
                setRetailPackPage(newPage);
            }
        }
    };

    // Handle Table B page changes
    const handleTableBPageChange = (newPage: number) => {
        if (newPage >= 1) {
            const { tableBTotalPages } = calculateTotalPages();
            if (newPage <= tableBTotalPages) {
                setRetailPackTableBPage(newPage);
            }
        }
    };
    
    // Add a new selector to get sorted orders
    const sortedOrders = useSelector((state: RootState) => {
        // Get all orders in the packing view
        const allOrders = state.orders.allOrders;
        
        // Sort all orders by priority
        return [...allOrders].sort((a, b) => {
            const priorityA = orderPriorities[a.order_id] || 0;
            const priorityB = orderPriorities[b.order_id] || 0;
            return priorityA - priorityB;
        });
    });

    const markAllRetailPacksAsPacked = async (retailPackOrders: RetailPackOrders) => {
        Sentry.startSpan({
            name: 'markAllRetailPacksAsPacked',
        }, async () => {
            setIsRefreshing(true);

            try{
                for (const { retailPackName, orderIds } of retailPackOrders) {
                    // Update Supabase
                    const { error } = await supabase
                        .from('order_items')
                        .update({ completed: true })
                        .in('order_id', orderIds)
                        .eq('item_name', retailPackName);

                    if (error) {
                        console.error(`Error updating order_items for ${retailPackName}:`, error);
                        continue;
                    }

                    // update Redux for each orderId
                    orderIds.forEach(orderId => {
                        // Find the items in Redux for this order and retail pack
                        const items = allOrderItems[orderId]?.filter(item => item.item_name === retailPackName) || [];
                        items.forEach(item => {
                            dispatch(updateItemCompleted({
                                orderId,
                                itemId: item.id,
                                completed: true,
                            }));
                        });
                    });
                }
            } catch (err) {
                    console.error('Error in markAllRetailPacksAsPacked:', err);
                } finally {
                    setIsRefreshing(false);
                }
            });
    };

    // Reset checkedRetailPacks when the page changes
    useEffect(() => {
        setCheckedRetailPacks({});
    }, [retailPackPage]);


    // Calculate pagination for sorted orders
    const startIndex = (currentPage - 1) * ordersPerPage;
    const endIndex = startIndex + ordersPerPage;
    const paginatedOrders = sortedOrders.slice(startIndex, endIndex);

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
                            <div className="flex items-center">
                                <h1 className="text-2xl font-bold text-white">
                                    {selectedRetailPack ? `${selectedRetailPack} Orders` : 'Orders Ready For Packing'}
                                </h1>
                                {selectedRetailPack && (
                                    <div className="ml-4 flex items-center">                                        
                                        <button 
                                            onClick={() => setSelectedRetailPack(null)} 
                                            className="px-2 py-1 bg-gray-700 text-white rounded-md hover:bg-gray-600 flex items-center text-sm"
                                        >
                                            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                            </svg>
                                            Clear
                                        </button>
                                    </div>
                                )}
                            </div>
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
                            ) : !selectedRetailPack && orders.length === 0 ? (
                                <div className="text-center py-4">
                                    <p className="text-black">No orders found</p>
                                    <p className="text-sm text-gray-400 mt-1">Try refreshing the page</p>
                                </div>
                            ) : (
                                <>
                                    <div className="flex-1 overflow-y-auto min-h-[400px]">
                                        <table className="w-full bg-white/90 backdrop-blur-sm border border-gray-200 table-auto">
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
                                                ) : loadingRetailPackOrders && selectedRetailPack ? (
                                                    // Loading state for fetching retail pack orders
                                                    [...Array(3)].map((_, index) => (
                                                        <tr key={`loading-retail-${index}`} className="animate-pulse">
                                                            <td className="px-4 py-5">
                                                                <div className="h-4 bg-blue-100 rounded w-20 mx-auto"></div>
                                                            </td>
                                                            <td className="px-4 py-5">
                                                                <div className="h-4 bg-blue-100 rounded w-28 mx-auto"></div>
                                                            </td>
                                                            <td className="px-4 py-5">
                                                                <div className="h-4 bg-blue-100 rounded w-8 mx-auto"></div>
                                                            </td>
                                                            <td className="px-4 py-5">
                                                                <div className="h-4 bg-blue-100 rounded w-24 mx-auto"></div>
                                                            </td>
                                                            <td className="px-4 py-5">
                                                                <div className="h-4 bg-blue-100 rounded w-12 mx-auto"></div>
                                                            </td>
                                                        </tr>
                                                    ))
                                                ) : (
                                                    // Render paginated orders
                                                    (selectedRetailPack ? findOrdersWithRetailPack(selectedRetailPack) : paginatedOrders).map((order) => (
                                                        <tr
                                                            key={order.order_id}
                                                            id={`order-row-${order.order_id}`}
                                                            ref={order.order_id === selectedOrderId ? selectedRowRef : null}
                                                            className={`transition-all duration-200 cursor-pointer text-center h-14 ${
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
                                                            <td className="px-4 py-2 text-black">{orderPriorities[order.order_id]}</td>
                                                            <td className="px-4 py-2 text-black">
                                                                {new Date(order.order_date).toLocaleDateString("en-GB")}
                                                            </td>
                                                            <td className="px-4 py-2 text-black">
                                                                {orderProgress[order.order_id]}
                                                            </td>
                                                        </tr>
                                                    ))
                                                )}
                                                {selectedRetailPack && findOrdersWithRetailPack(selectedRetailPack).length === 0 && !isRefreshing && (
                                                    <tr>
                                                        <td colSpan={5} className="px-6 py-10 text-center">
                                                            <div className="flex flex-col items-center justify-center h-40 text-black">
                                                                <svg xmlns="http://www.w3.org/2000/svg" className="h-12 w-12 mb-3 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9.172 16.172a4 4 0 015.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                                                                </svg>
                                                                <p className="text-lg font-medium">No orders found with {selectedRetailPack}</p>
                                                                <p className="text-sm text-gray-500 mt-1">Try selecting a different retail pack</p>
                                                            </div>
                                                        </td>
                                                    </tr>
                                                )}
                                            </tbody>
                                        </table>
                                    </div>
                                    <div className="flex justify-between items-center bg-white/90 backdrop-blur-sm p-4 border border-gray-200">
                                        <div className="text-sm text-gray-600">
                                            {selectedRetailPack ? (
                                                `Showing ${findOrdersWithRetailPack(selectedRetailPack).length} orders with ${selectedRetailPack}`
                                            ) : (
                                                `Showing ${(currentPage - 1) * ordersPerPage + 1} to ${Math.min(currentPage * ordersPerPage, totalOrders)} of ${totalOrders} pending orders`
                                            )}
                                        </div>
                                        {!selectedRetailPack && (
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
                                        )}
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
                                                        {(() => {
                                                            // Group items by SKU
                                                            const groupedItems = selectedOrderItems.reduce((acc, item) => {
                                                                const key = item.sku_id;
                                                                if (!acc[key]) {
                                                                    acc[key] = {
                                                                        ...item,
                                                                        quantity: 0
                                                                    };
                                                                }
                                                                acc[key].quantity += item.quantity;
                                                                return acc;
                                                            }, {} as Record<string, OrderItem>);

                                                            // Convert grouped items to array and sort them
                                                            return Object.values(groupedItems)
                                                                .sort((a, b) => a.item_name.localeCompare(b.item_name))
                                                                .map((item) => (
                                                                    <tr key={item.sku_id} className="hover:bg-gray-800/40 transition-colors duration-150">
                                                                        <td className="px-6 py-4 text-left text-gray-200 font-medium">{item.item_name}</td>
                                                                        <td className="px-6 py-4 text-center text-gray-300">{item.quantity}</td>
                                                                    </tr>
                                                                ));
                                                        })()}
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
                                                                onClick={() => handleRetailPackClick(itemName)}
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
                                                                onClick={() => handleRetailPackClick(itemName)}
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
            )}

            {/* Add StartPacking Modal */}
            {showStartPackingModal && selectedOrder && (
                <StartPacking
                    isOpen={showStartPackingModal}
                    onClose={() => setShowStartPackingModal(false)}
                    onConfirm={(orderId) => {
                        setShowStartPackingModal(false);
                        handleMarkCompleted(orderId);
                    }}
                    selectedOrder={selectedOrder}
                    selectedOrderItems={selectedOrderItems}
                    id={String(selectedOrder.id)}
                />
            )}

            {/** Retail Pack Confirmation Dialog */}
            {showRetailPackConfirmDialog && (
                <RetailPackConfirm
                    isOpen={showRetailPackConfirmDialog}
                    onClose={() => {
                        setShowRetailPackConfirmDialog(false);
                        setPendingRetailPackOrders([]);
                    }}
                    onConfirm={() => {
                        markAllRetailPacksAsPacked(pendingRetailPackOrders);
                        setShowRetailPackConfirmDialog(false);
                        setPendingRetailPackOrders([]);
                    }}
                    orderIdsForMarkCompleted={orderIdsForMarkCompleted}
                    retailPackOrders={pendingRetailPackOrders}
                />
            )}
        </div>
    )
}

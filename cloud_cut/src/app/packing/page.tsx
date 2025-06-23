"use client";

import NavBar from "@/components/Navbar";
import StartPacking from "@/components/orderStartedPacking";
import { useEffect, useMemo, useRef, useState, useCallback } from "react";
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
import { createPortal } from "react-dom";

// Define OrderWithPriority type
type OrderWithPriority = Order & { calculatedPriority: number };
// Define Types used by Dropdown Component
type SortField = 'retail_pack' | 'medium_sheets' | 'accessories' | 'all';
type SortDirection = 'asc' | 'desc'; 

// Custom Dropdown Component
const FilterDropdown = ({
    sortConfig,
    onSortChange,
} : {
    sortConfig: {field: SortField, direction: SortDirection},
    onSortChange: (field: SortField) => void
}) => {
    const [isOpen, setIsOpen] = useState(false);
    const buttonRef = useRef<HTMLButtonElement>(null);
    const dropdownRef = useRef<HTMLDivElement>(null);

    //Handle click outside
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

    //Handle escape key
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

    //Cleanup on unmount
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

    //Handle option selection
    const handleOptionClick = (field: SortField) => {
        onSortChange(field);
        setIsOpen(false);
    };

    return(
        <div className="relative">
            {/**Button trigger */}
            <button
                ref={buttonRef}
                type="button"
                className="inline-flex justify-between items-center w-full rounded-md border border-gray-300 shadow-sm px-4 py-2 bg-white text-sm font-medium text-gray-700
                hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-1 focus:ring-blue-500"
                id="sort-menu-button"
                aria-expanded={isOpen}
                aria-haspopup="true"
                onClick={async () => {toggleDropdown()}}
            >
                {sortConfig.field === 'medium_sheets' ? 'Filter: Medium Sheets' :
                sortConfig.field === 'retail_pack' ? 'Filter: Retail Pack' : 
                sortConfig.field === 'accessories' ? 'Filter: Accessories' : 'Filter: All'}
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" className="ml-2 -mr-1 h-5 w-5 text-gray-400" aria-hidden="true">
                    <path d="M6 9l6 6 6-6"/>
                </svg>
            </button>

            {/**Dropdown Menu Portal */}
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
                            className={`${sortConfig.field === 'all' ? 'bg-gray-100 text-gray-900' : 'text-gray-700'} flex justify-between items-center w-full
                            px-4 py-2 text-sm hover:bg-gray-100`}
                            role="menuitem"
                            tabIndex={-1}
                            onClick={async () => {handleOptionClick('all')}}
                        >
                            All Orders
                        </button>
                        <button
                            className={`${sortConfig.field === 'medium_sheets' ? 'bg-gray-100 text-gray-900' : 'text-gray-700'} flex justify-between items-center w-full
                            px-4 py-2 text-sm hover:bg-gray-100`}
                            role="menuitem"
                            tabIndex={-1}
                            onClick={async () => {handleOptionClick('medium_sheets')}}
                        >
                            Medium Sheets
                        </button>
                        <button
                            className={`${sortConfig.field === 'retail_pack' ? 'bg-gray-100 text-gray-900' : 'text-gray-700'} flex justify-between items-center w-full
                            px-4 py-2 text-sm hover:bg-gray-100`}
                            role="menuitem"
                            tabIndex={-1}
                            onClick={async () => {handleOptionClick('retail_pack')}}
                        >
                            Retail Pack
                        </button>
                        <button
                            className={`${sortConfig.field === 'accessories' ? 'bg-gray-100 text-gray-900' : 'text-gray-700'} flex justify-between items-center w-full px-4 py-2 text-sm hover:bg-gray-100`}
                            role="menuitem"
                            tabIndex={-1}
                            onClick={async () => {handleOptionClick('accessories')}}
                        >
                            Accessories
                        </button>
                    </div>
                </div>,
                document.body
            )}
        </div>
    );
};

export default function Packing() {
    const dispatch = useDispatch<AppDispatch>();
    const orders = useSelector(selectPackingOrders);
    const totalOrders = useSelector(selectCurrentViewTotal);
    const selectedOrderId = useSelector((state: RootState) => state.orders.selectedOrderId);
    const selectedItemsSelector = useMemo(() => selectOrderItemsById(selectedOrderId || ''), [selectedOrderId]);
    const selectedOrderItems = useSelector(selectedItemsSelector);
    const { currentPage, loading, error } = useSelector((state: RootState) => state.orders);
    const selectedRowRef = useRef<HTMLTableRowElement>(null);
    const tableContainerRef = useRef<HTMLDivElement>(null);
    const ordersPerPage = 15;
    const totalPages = Math.ceil(totalOrders / ordersPerPage);
    const allOrders = useSelector((state: RootState) =>  state.orders.allOrders);
    const selectedOrder = allOrders.find((o) => o.order_id === selectedOrderId)
    const [isRefreshing, setIsRefreshing] = useState(false);
    const [showOrderFinishedDialog, setShowOrderFinishedDialog] = useState(false);
    const [showStartPackingModal, setShowStartPackingModal] = useState(false);
    const [pendingItemToComplete, setPendingItemToComplete] = useState<{ orderId: string;itemId: string;completed: boolean; } | null>(null);
    const [showWarning, setShowWarning] = useState(false);
    const [currentUserName, setCurrentUserName] = useState<string | null>(null);
    const [activeTab, setActiveTab] = useState<'orders' | 'retail'>('orders');
    const [selectedRetailPack, setSelectedRetailPack] = useState<string | null>(null);    
    const [ordersWithRetailPacks, setOrdersWithRetailPacks] = useState<Record<string, Order[]>>({});
    const [loadingRetailPackOrders, setLoadingRetailPackOrders] = useState(false);
    const [pendingOrderToSelect, setPendingOrderToSelect] = useState<string | null>(null);
    const [searchTerm, setSearchTerm] = useState('');
    const [filteredOrders, setFilteredOrders] = useState<Order[]>([]);
    
    // Sorting functionality
    const [sortConfig, setSortConfig] = useState<{field: SortField, direction: SortDirection}>({
        field: 'all',
        direction: 'desc'
    });

    // Request a sort by field
    const handleFilterChange = useCallback((field: SortField) => {
        Sentry.startSpan({
            name: 'handleFilterChange-Packing',
            op: 'ui.interaction.filtering'
        }, async () => {
            // The dropdown now controls filtering. Direction is not used for filtering.
            setSortConfig({ field, direction: 'desc' });
        });
    }, []);
    
    // Get all order items from the state
    const allOrderItems = useSelector((state: RootState) => state.orders.orderItems);

    useEffect(() => {
        let result = [...allOrders];

        // Apply search filter
        if (searchTerm) {
            const lowerCaseSearchTerm = searchTerm.toLowerCase();
            result = result.filter(order =>
                order.order_id.toLowerCase().includes(lowerCaseSearchTerm) ||
                order.customer_name.toLowerCase().includes(lowerCaseSearchTerm)
            );
        }

        // Apply filter for medium sheets or retail packs
        if (sortConfig.field === 'medium_sheets') {
            result = result.filter(order => {
                const items = allOrderItems[order.order_id] || [];
                const mediumSheets = items.filter(item => item.item_name?.toLowerCase().includes('medium sheet')).reduce((sum: number, item: OrderItem) => sum + item.quantity, 0);
                return mediumSheets > 0;
            });
        } else if (sortConfig.field === 'retail_pack') {
            result = result.filter(order => {
                const items = allOrderItems[order.order_id] || [];
                const retailPack = items.filter(item => item.item_name?.toLowerCase().includes('retail pack')).reduce((sum: number, item: OrderItem) => sum + item.quantity, 0);
                return retailPack > 0;
            });
        } else if (sortConfig.field === 'accessories') {
            result = result.filter(order => {
                const items = allOrderItems[order.order_id] || [];
                // Filter items that don't have SKUs starting with SFI, SFS, SFP, SFC
                const accessories = items.filter(item => {
                    if (!item.sku_id) return false;
                    const sku = item.sku_id.toUpperCase();
                    return !sku.startsWith('SFI') && !sku.startsWith('SFS') && !sku.startsWith('SFP') && !sku.startsWith('SFC');
                });
                return accessories.length > 0;
            });
        }

        // Apply sorting
        result.sort((a, b) => {
            const itemsA = allOrderItems[a.order_id] || [];
            const itemsB = allOrderItems[b.order_id] || [];
            const priorityA = itemsA.length > 0 ? Math.max(...itemsA.map((item) => item.priority || 0)) : 0;
            const priorityB = itemsB.length > 0 ? Math.max(...itemsB.map((item) => item.priority || 0)) : 0;
            if (priorityA !== priorityB) {
                return priorityA - priorityB;
            }
            return 0; // No secondary sort
        });

        setFilteredOrders(result);
    }, [allOrders, searchTerm, sortConfig, allOrderItems]);

    // Calculate pagination for sorted orders
    const startIndex = (currentPage - 1) * ordersPerPage;
    const endIndex = startIndex + ordersPerPage;
    const paginatedOrders = filteredOrders.slice(startIndex, endIndex);

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
    }, [currentPage]);

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
                setIsRefreshing(true);
                setActiveTab('orders');
                const orderIndex = filteredOrders.findIndex(order => order.order_id === orderId);
                const targetPage = Math.floor(orderIndex / ordersPerPage) + 1;
                if (targetPage !== currentPage) {
                    setPendingOrderToSelect(orderId);
                    handlePageChange(targetPage);
                } else {
                    dispatch(setSelectedOrderId(orderId));
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
                            const itemsA = allOrderItems[a.order_id] || [];
                            const itemsB = allOrderItems[b.order_id] || [];
                            const priorityA = itemsA.length > 0 ? Math.max(...itemsA.map((item) => item.priority || 0)) : 0;
                            const priorityB = itemsB.length > 0 ? Math.max(...itemsB.map((item) => item.priority || 0)) : 0;
                            return priorityA - priorityB;
                        });
                        
                        console.log('Sorted orders by priority:', sortedOrders.map(order => {
                            const items = allOrderItems[order.order_id] || [];
                            const priority = items.length > 0 ? Math.max(...items.map((item) => item.priority || 0)) : 0;
                            return {
                                orderId: order.order_id,
                                priority: priority
                            };
                        }));
                        
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

    useEffect(() => {
        if (pendingOrderToSelect) {
            dispatch(setSelectedOrderId(pendingOrderToSelect));
            setTimeout(() => {
                const selectedRow = document.getElementById(`order-row-${pendingOrderToSelect}`);
                if (selectedRow) {
                    selectedRow.scrollIntoView({ behavior: 'smooth', block: 'center' });
                }
            }, 100);
            setPendingOrderToSelect(null);
        }
    }, [orders, currentPage, pendingOrderToSelect, dispatch]);

    //Clear Search Function
    const handleClearSearch = () => {
        return Sentry.startSpan({
            name: 'handleClearSearch-Admin',
            op: 'ui.interaction.search'
        }, async () => {
            setSearchTerm("");
        });
    }


    return (
        <div className="min-h-screen">
            <NavBar />
            {/* Content sections with conditional rendering */}
            {activeTab === 'orders' && (
                <div className="container mx-auto pt-40 mb-8 p-6 flex justify-center gap-8">  
                    {/**Packing Orders Section */}
                    <div className="flex-1 max-w-3xl">
                        <div className="bg-[#1d1d1d]/90 rounded-t-lg flex flex-wrap justify-between items-center backdrop-blur-sm p-4 gap-4">
                            <h1 className="text-2xl font-bold text-white">
                                Orders Queue
                            </h1>
                            <div className="flex flex-col sm:flex-row items-center gap-4 w-full sm:w-auto">

                                {/**Search Bar */}
                                <div className="relative w-full sm:w-64">
                                    <input
                                        type="text"
                                        placeholder="Search by Order ID or Customer Name"
                                        value={searchTerm}
                                        onChange={(e) => setSearchTerm(e.target.value)}
                                        className="w-full pl-10 pr-10 py-2 text-sm text-black bg-white/90 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                                        aria-label="Search packing orders"
                                    />
                                    <div className="absolute inset-y-0 left-0 flex items-center pl-3 pointer-events-none">
                                        <svg className="w-4 h-4 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"></path>
                                        </svg>
                                    </div>
                                    {searchTerm && (
                                        <button
                                            onClick={async () => {handleClearSearch()}}
                                            className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
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

                                {/**Sorting Dropdown*/}
                                <div className="w-full sm:w-56">
                                    <FilterDropdown
                                        sortConfig={sortConfig}
                                        onSortChange={handleFilterChange}
                                    />
                                </div>
                            </div>
                        </div>
                        <div className="overflow-x-auto bg-white h-[calc(100vh-300px)] flex flex-col" ref={tableContainerRef}>
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
                            ) : !selectedRetailPack && filteredOrders.length === 0 ? (
                                <div className="text-center py-4">
                                    <p className="text-black">No orders found</p>
                                    <p className="text-sm text-gray-400 mt-1">Try refreshing the page or changing your filter</p>
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
                                                            <td className="px-4 py-2 text-black">
                                                                {(() => {
                                                                    const items = allOrderItems[order.order_id] || [];
                                                                    return items.length > 0 ? Math.max(...items.map((item) => item.priority || 0)) : 0;
                                                                })()}
                                                            </td>
                                                            <td className="px-4 py-2 text-black">
                                                                {new Date(order.order_date).toLocaleDateString("en-GB")}
                                                            </td>
                                                            <td className="px-4 py-2 text-black">
                                                                {(() => {
                                                                    const state = store.getState() as RootState;
                                                                    return selectOrderProgress(order.order_id)(state);
                                                                })()}
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
                                                `Showing ${(currentPage - 1) * ordersPerPage + 1} to ${Math.min(currentPage * ordersPerPage, filteredOrders.length)} of ${filteredOrders.length} pending orders`
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
        </div>
    )
}

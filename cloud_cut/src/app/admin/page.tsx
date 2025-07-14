"use client";

import React, { useState, useEffect, useRef, useCallback } from 'react';
import Navbar from '@/components/Navbar';
import { useDispatch, useSelector } from 'react-redux';
import { AppDispatch, RootState } from '@/redux/store';
import Image from 'next/image';
import { setSelectedOrderId } from "@/redux/slices/ordersSlice";
import { subscribeToOrders, subscribeToOrderItems, supabase } from "@/utils/supabase";
import { RealtimePostgresChangesPayload } from "@supabase/supabase-js";
import OrderItemsOverlay from '@/components/OrderItemsOverlay';
import { Order, OrderItem } from '@/types/redux';
import { createPortal } from 'react-dom';
import EditCompOrder from '@/components/editCompOrder';
import DeleteCompletedOrder from '@/components/DeleteCompletedOrder';
import * as Sentry from '@sentry/nextjs';
import { fetchPendingOrdersForAdmin, fetchCompletedOrdersForAdmin, syncOrders } from '@/redux/thunks/ordersThunks';
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from 'recharts';
import { useRouter } from 'next/navigation';
import { selectOrderItemsById, selectAdminPendingOrders } from '@/redux/slices/ordersSelectors';

// Define types used by the dropdown component
type SortField = 'order_id' | 'order_date' | 'customer_name' | 'priority';
type SortDirection = 'asc' | 'desc';
type OrderWithPriority = Order & { calculatedPriority: number };

// Custom dropdown component using portal
const SortDropdown = ({ 
    sortConfig, 
    onSortChange,
    currentTab
}: { 
    sortConfig: {field: SortField, direction: SortDirection}, 
    onSortChange: (field: SortField) => void,
    currentTab: 'Completed Orders' | 'Pending Orders'
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
                onClick={async () => {
                    await Sentry.startSpan({
                        name: 'toggleSortDropdown-admin',
                    }, async () => {
                        toggleDropdown();
                    })
                }}
            >
                {sortConfig.field === 'order_id' ? 'Sort: Order ID' : 
                sortConfig.field === 'order_date' ? 'Sort: Date' : 
                sortConfig.field === 'customer_name' ? 'Sort: Customer' : 'Sort: Priority'}
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
                            onClick={async () => {
                                await Sentry.startSpan({
                                    name: 'handleSortDropDownOptionClick-admin-order_id',
                                }, async () => {
                                    handleOptionClick('order_id');
                                })
                            }}
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
                            onClick={async () => {
                                await Sentry.startSpan({
                                    name: 'handleSortDropDownOptionClick-admin-order_date',
                                }, async () => {
                                    handleOptionClick('order_date');
                                })
                            }}
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
                            onClick={async () => {
                                await Sentry.startSpan({
                                    name: 'handleSortDropDownOptionClick-admin-customer_name',
                                }, async () => {
                                    handleOptionClick('customer_name');
                                })
                            }}
                        >
                            Customer Name
                            {sortConfig.field === 'customer_name' && (
                                <span className="text-blue-600">
                                    {sortConfig.direction === 'asc' ? '↑' : '↓'}
                                </span>
                            )}
                        </button>
                        {currentTab === 'Pending Orders' && (
                            <button
                                className={`${sortConfig.field === 'priority' ? 'bg-gray-100 text-gray-900' : 'text-gray-700'} flex justify-between items-center w-full px-4 py-2 text-sm hover:bg-gray-100`}
                                role="menuitem"
                                tabIndex={-1}
                                onClick={async () => {
                                    await Sentry.startSpan({
                                        name: 'handleSortDropDownOptionClick-admin-priority',
                                    }, async () => {
                                        handleOptionClick('priority');
                                    })
                                }}
                            >
                                Priority
                                {sortConfig.field === 'priority' && (
                                    <span className="text-blue-600">
                                        {sortConfig.direction === 'asc' ? '↑' : '↓'}
                                    </span>
                                )}
                            </button>
                        )}
                    </div>
                </div>,
                document.body
            )}
        </div>
    );
};

// --- FOAM SHEET COLOR MAPPING UTILITY ---
// Maps foam sheet names (e.g., 'Blue 30mm', 'Blue 50mm') to hex codes for the pie chart
const FOAM_SHEET_COLOR_HEX: Record<string, string> = {
  'Blue 30mm': '#2563eb',      // Blue
  'Blue 50mm': '#60a5fa',      // Lighter Blue
  'Red 30mm': '#ef4444',       // Red
  'Red 50mm': '#f87171',       // Lighter Red
  'Green 30mm': '#22c55e',     // Green
  'Green 50mm': '#4ade80',     // Lighter Green
  'Orange 30mm': '#f59e42',    // Orange
  'Orange 50mm': '#fdba74',    // Lighter Orange
  'Black 30mm': '#222',        // Black
  'Black 50mm': '#4a4a4a',     // Grayish Black
  'Yellow 30mm': '#fbbf24',    // Yellow
  'Yellow 50mm': '#fde047',    // Lighter Yellow
  'Purple 30mm': '#a855f7',    // Purple
  'Purple 50mm': '#c4b5fd',    // Lighter Purple
  'Pink 30mm': '#ec4899',      // Pink
  'Pink 50mm': '#f9a8d4',      // Lighter Pink
  'Teal 30mm': '#14b8a6',      // Teal
  'Teal 50mm': '#5eead4',      // Lighter Teal
  'Grey 30mm': '#64748b',      // Slate
  'Grey 50mm': '#cbd5e1',      // Lighter Slate
};
const OTHERS_COLOR = '#aab1bf'; // Gray for 'Others'

function getFoamSheetColorHex(name: string): string {
  // Try exact match
  if (FOAM_SHEET_COLOR_HEX[name]) return FOAM_SHEET_COLOR_HEX[name];
  // Try to match color and depth with flexible spacing/case
  const match = Object.keys(FOAM_SHEET_COLOR_HEX).find(
    key => key.toLowerCase() === name.toLowerCase()
  );
  if (match) return FOAM_SHEET_COLOR_HEX[match];
  // If 'Others', use neutral
  if (name === 'Others') return OTHERS_COLOR;
  // Fallback: try to match just color
  const color = name.split(' ')[0];
  const fallback = Object.keys(FOAM_SHEET_COLOR_HEX).find(key => key.startsWith(color));
  if (fallback) return FOAM_SHEET_COLOR_HEX[fallback];
  return OTHERS_COLOR;
}

export default function Admin() {
    const dispatch = useDispatch<AppDispatch>();
    const { archivedOrders, archivedOrderItems, archivedOrdersLoading, archivedOrdersError } = useSelector((state: RootState) => state.orders);
    const selectedOrderId = useSelector((state: RootState) => state.orders.selectedOrderId);
    const [showOrderItems, setShowOrderItems] = useState(false);
    const { loading, error } = useSelector((state: RootState) => state.orders);
    const selectedRowRef = useRef<HTMLTableRowElement>(null);
    const [isRefreshing, setIsRefreshing] = useState(false);
    const [currentSlide, setCurrentSlide] = useState(0);
    const { orderItems } = useSelector((state: RootState) => state.orders);
    const router = useRouter();
    const [orderTableTab, setOrderTableTab] = useState<'Completed Orders' | 'Pending Orders'>('Pending Orders');
    const activeOrders = useSelector(selectAdminPendingOrders);

    // Pagination state
    const [currentPage, setCurrentPage] = useState(1);
    const [pendingOrdersPage, setPendingOrdersPage] = useState(1);
    const [completedOrdersPage, setCompletedOrdersPage] = useState(1);
    const ordersPerPage = 15;

    const handleOrderTableTabChange = (tab: 'Completed Orders' | 'Pending Orders') => {
        const canAccessTab = (() => {
            switch (tab) {
                case 'Completed Orders':
                    return true;
                case 'Pending Orders':
                    return true;
            }
        })();

        if (!canAccessTab) {
            console.log(`Access denied to tab: ${tab}`);
            return;
        }
        setOrderTableTab(tab);
    }
    
    //Combine all items from both tables
    const allOrderItems = [
        ...Object.values(orderItems || {}).flat(),
        ...Object.values(archivedOrderItems || {}).flat()
    ];

    //Aggregate by foam sheet, excluding 'N/A'
    const foamSheetMap: Record<string, number> = {};
    allOrderItems.forEach(item => {
        const sheet = item.foamsheet || 'Unknown';
        if (sheet === 'N/A') return; // Exclude N/A
        foamSheetMap[sheet] = (foamSheetMap[sheet] || 0) + (item.quantity || 0);
    });


    // Prepare data for PieChart
    const foamSheetData = Object.entries(foamSheetMap)
        .map(([name, value]) => ({ name, value }))
        .sort((a, b) => b.value - a.value);


    //Optionally, limit to top N and group the rest as 'Others'
    const TOP_N = 5;
    const topFoamSheets =  foamSheetData.slice(0, TOP_N);
    const othersValue = foamSheetData.slice(TOP_N).reduce((sum, d) => sum + d.value, 0);
    const pieChartData = [
        ...topFoamSheets,
        ...(othersValue > 0 ? [{ name: 'Others', value: othersValue }]: [])
    ];

    
    // New state to track editing state
    const [editingOrder, setEditingOrder] = useState<Order | null>(null);
    
    // Delete order state
    const [orderToDelete, setOrderToDelete] = useState<string | null>(null);
    const [showDeleteDialog, setShowDeleteDialog] = useState(false);
    
    // Search functionality
    const [searchTerm, setSearchTerm] = useState("");
    const [filteredOrders, setFilteredOrders] = useState<Order[]>([]);
    const [filteredPendingOrders, setFilteredPendingOrders] = useState<Order[]>([]);
    const [combinedSearchResults, setCombinedSearchResults] = useState<(Order & { orderType: 'pending' | 'completed' })[]>([]);
    const [searchResultsPage, setSearchResultsPage] = useState(1);
    
    // Sorting functionality
    const [sortConfig, setSortConfig] = useState<{field: SortField, direction: SortDirection}>({
        field: 'order_date',
        direction: 'desc'
    });
    
    // Calculate pagination values based on current view
    const isSearchMode = searchTerm.trim().length > 0;
    
    // Pagination for search results
    const searchResultsStartIndex = (searchResultsPage - 1) * ordersPerPage;
    const searchResultsEndIndex = searchResultsStartIndex + ordersPerPage;
    const paginatedSearchResults = combinedSearchResults.slice(searchResultsStartIndex, searchResultsEndIndex);
    const totalSearchPages = Math.ceil(combinedSearchResults.length / ordersPerPage);
    
    // Calculate pagination values based on filtered orders
    const indexOfLastOrder = completedOrdersPage * ordersPerPage;
    const indexOfFirstOrder = indexOfLastOrder - ordersPerPage;
    const completedOrders = filteredOrders.slice(indexOfFirstOrder, indexOfLastOrder);
    const totalPages = Math.ceil(filteredOrders.length / ordersPerPage);

    // Calculate pagination for pending orders
    const pendingOrdersStartIndex = (pendingOrdersPage - 1) * ordersPerPage;
    const pendingOrdersEndIndex = pendingOrdersStartIndex + ordersPerPage;
    const paginatedPendingOrders = filteredPendingOrders.slice(pendingOrdersStartIndex, pendingOrdersEndIndex);
    const totalPendingPages = Math.ceil(filteredPendingOrders.length / ordersPerPage);

    const brands = [
        {name: 'DeWalt', image: '/dewalt.png'},
        {name: 'Milwaukee', image: '/milwaukee.png'},
        {name: 'Makita', image: '/makita.png'},
        {name: 'Peli', image: '/peli.png'},
        {name: 'Erbauer', image: '/erbauer.png'},
        {name: 'Festool', image: '/festool.png'},
        {name: 'Bosch', image: '/bosch.png'},
        {name: 'Stanley', image: '/stanley.png'},
        {name: 'Halfords', image: '/halfords.png'},
        {name: 'Husky', image: '/husky.png'},
        {name: 'Einhell', image: '/einhell.png'},
        {name: 'Magnusson', image: '/magnusson.png'},
        {name: 'OX', image: '/ox.png'},
        {name: 'Klein', image: '/klein.png'},
        {name: 'Craftsman', image: '/craftsman.png'},
        {name: 'Trend', image: '/trend.png'},
        {name: 'Ryobi', image: '/ryobi.png'},
        {name: 'Nuprol', image: '/nuprol.png'},
        {name: 'Hikoki', image: '/hikoki.png'},
        {name: 'Ridgid', image: '/ridgid.png'},
        {name: 'Toughbuilt', image: '/toughbilt.png'},
        {name: 'Facom', image: '/facom.png'},
        {name: 'AEG', image: '/AEG.png'},
        {name: 'Tanos', image: '/tanos.png'},
        {name: 'JCB', image: '/jcb.png'},
        {name: 'Panasonic', image: '/panasonic.png'},
        {name: 'Flex', image: '/flex.png'},
        {name: 'Sortimo', image: '/sortimo.png'},
        {name: 'Reisser', image: '/reisser.png'},
        {name: 'QBRICK', image: '/qbrick.png'},
        {name: 'Rothenberger', image: '/rothenberger.png'},
        {name: 'V-TUF', image: '/vtuf.png'},
        {name: 'Engelbert Strauss', image: '/strauss.png'},
        {name: 'Metabo', image: '/metabo.png'},
        {name: 'Industrial by Hornbach', image: '/industrial.png'},
        {name: 'Keter', image: '/keter.png'},
        {name: 'Hart', image: '/hart.png'},
        {name: 'Worx', image: '/worx.png'},
        {name: 'Wisent', image: '/wisent.png'},
        {name: 'Würth', image: '/wurth.png'},
        {name: 'HASTA', image: '/hasta.png'},
    ]


    // Fetch both pending and completed orders on component mount
    useEffect(() => {
        console.log('Admin component mounted - fetching initial data...');
        
        // Fetch both datasets when component first loads
        Promise.all([
            dispatch(fetchPendingOrdersForAdmin({
                page: pendingOrdersPage,
                perPage: ordersPerPage
            })),
            dispatch(fetchCompletedOrdersForAdmin({
                page: completedOrdersPage,
                perPage: ordersPerPage
            }))
        ]).then(() => {
            console.log('Initial admin data loaded successfully');
        }).catch((error) => {
            console.error('Error loading initial admin data:', error);
        });
    }, [dispatch]); // Only run once on mount

    // Fetch completed orders when pagination changes
    useEffect(() => {
        if (completedOrdersPage > 1) { // Skip page 1 since it's handled on mount
            dispatch(fetchCompletedOrdersForAdmin({
                page: completedOrdersPage,
                perPage: ordersPerPage
            }));
        }
    }, [dispatch, completedOrdersPage, ordersPerPage]);

    // Fetch pending orders when pagination changes
    useEffect(() => {
        if (pendingOrdersPage > 1) { // Skip page 1 since it's handled on mount
            dispatch(fetchPendingOrdersForAdmin({
                page: pendingOrdersPage,
                perPage: ordersPerPage
            }));
        }
    }, [dispatch, pendingOrdersPage, ordersPerPage]);

    // Filter and sort orders when dependencies change
    useEffect(() => {
        Sentry.startSpan({
            name: 'filterAndSortOrdersUseEffect-Admin',
            op: 'data.processing'
        }, async () => {
            // Handle search mode - combine both datasets
            if (searchTerm.trim()) {
                    const lowerSearchTerm = searchTerm.toLowerCase();
                
                // Filter and mark completed orders
                const filteredCompleted = (archivedOrders || [])
                    .filter(order => 
                            order.order_id.toLowerCase().includes(lowerSearchTerm) ||
                            order.customer_name.toLowerCase().includes(lowerSearchTerm)
                    )
                    .map(order => ({ ...order, orderType: 'completed' as const }));

                // Filter and mark pending orders
                const filteredPending = (activeOrders || [])
                    .filter(order =>
                        order.order_id.toLowerCase().includes(lowerSearchTerm) ||
                        order.customer_name.toLowerCase().includes(lowerSearchTerm)
                    )
                    .map(order => ({ ...order, orderType: 'pending' as const }));

                // Combine and sort results
                const combined = [...filteredCompleted, ...filteredPending];
                
                // Apply sorting to combined results
                combined.sort((a, b) => {
                    let fieldA: any, fieldB: any;
                    
                    switch (sortConfig.field) {
                        case 'order_id':
                            fieldA = a.order_id;
                            fieldB = b.order_id;
                            break;
                        case 'order_date':
                            fieldA = a.order_date;
                            fieldB = b.order_date;
                            break;
                        case 'customer_name':
                            fieldA = a.customer_name;
                            fieldB = b.customer_name;
                            break;
                        case 'priority':
                            // For mixed results, handle priority carefully
                            if (a.orderType === 'pending' && b.orderType === 'pending') {
                                const priorityA = 'calculatedPriority' in a ? (a as OrderWithPriority).calculatedPriority : 10;
                                const priorityB = 'calculatedPriority' in b ? (b as OrderWithPriority).calculatedPriority : 10;
                                fieldA = priorityA;
                                fieldB = priorityB;
                            } else {
                                // Fallback to order_date for mixed or completed orders
                            fieldA = a.order_date;
                            fieldB = b.order_date;
                            }
                            break;
                        default:
                            return 0;
                    }
                    
                    // Handle null/undefined values
                    if (fieldA == null && fieldB == null) return 0;
                    if (fieldA == null) return sortConfig.direction === 'asc' ? -1 : 1;
                    if (fieldB == null) return sortConfig.direction === 'asc' ? 1 : -1;
                    
                    if (fieldA < fieldB) {
                        return sortConfig.direction === 'asc' ? -1 : 1;
                    }
                    if (fieldA > fieldB) {
                        return sortConfig.direction === 'asc' ? 1 : -1;
                    }
                    return 0;
                });

                setCombinedSearchResults(combined);
                setSearchResultsPage(1); // Reset to first page when search changes
            } else {
                // Clear search results when no search term
                setCombinedSearchResults([]);
                setSearchResultsPage(1);
            }

            // Handle completed orders (for non-search mode)
            if (archivedOrders) {
                let result = [...archivedOrders];

                // Apply search filter only in non-search mode
                if (!searchTerm.trim()) {
                    setFilteredOrders(result);
                }
            }

            // Handle pending orders (for non-search mode)
            if (activeOrders) {
                let result = [...activeOrders];

                // Apply search filter only in non-search mode
                if (!searchTerm.trim()) {
                    setFilteredPendingOrders(result);
                }
            }
        });
    }, [archivedOrders, activeOrders, searchTerm, sortConfig]);

    // Set up real-time updates for archived orders
    useEffect(() => {
        const subscription = subscribeToOrders((payload: RealtimePostgresChangesPayload<Order>) => {
            if (payload.eventType === "INSERT" && payload.new.status === "Archived") {
                dispatch(fetchCompletedOrdersForAdmin({
                    page: completedOrdersPage,
                    perPage: ordersPerPage
                }));
            } else if (payload.eventType === "UPDATE" && payload.new.status === "Archived") {
                dispatch(fetchCompletedOrdersForAdmin({
                    page: completedOrdersPage,
                    perPage: ordersPerPage
                }));
            } else if (payload.eventType === "DELETE") {
                dispatch(fetchCompletedOrdersForAdmin({
                    page: completedOrdersPage,
                    perPage: ordersPerPage
                }));
            }
        });

        const itemsSubscription = subscribeToOrderItems((payload: RealtimePostgresChangesPayload<OrderItem>) => {
            if (payload.eventType === "INSERT" || payload.eventType === "UPDATE" || payload.eventType === "DELETE") {
                dispatch(fetchCompletedOrdersForAdmin({
                    page: completedOrdersPage,
                    perPage: ordersPerPage
                }));
            }
        });

        return () => {
            subscription.unsubscribe();
            itemsSubscription.unsubscribe();
        };
    }, [dispatch, completedOrdersPage, ordersPerPage]);
    

    
    // Clear search
    const handleClearSearch = () => {
        return Sentry.startSpan({
            name: 'handleClearSearch-Admin',
            op: 'ui.interaction.search'
        }, async () => {
            setSearchTerm("");
            setCombinedSearchResults([]);
            setSearchResultsPage(1);
        });
    };

    const handleOrderClick = (orderId: string) => {
        return Sentry.startSpan({
            name: 'handleOrderClick-Admin',
            op: 'ui.interaction.function'
        }, async () => {
            dispatch(setSelectedOrderId(orderId));
            setShowOrderItems(true);
            setTimeout(() => {
                selectedRowRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
            }, 100);
        });
    };

        // Handle edit button click
    const handleEditClick = (order: Order, e: React.MouseEvent) => {
        return Sentry.startSpan({
            name: 'handleEditClick-Admin',
            op: 'ui.interaction.edit'
        }, async () => {
            e.stopPropagation(); // Prevent triggering the row click
            setEditingOrder(order);
        });
    };
    
    // Handle page change
    const handlePageChange = (pageNumber: number) => {
        return Sentry.startSpan({
            name: 'handlePageChange-Admin',
            op: 'ui.navigation'
        }, async () => {
            if (isSearchMode) {
                if (pageNumber >= 1 && pageNumber <= totalSearchPages) {
                    setSearchResultsPage(pageNumber);
                    window.scrollTo(0, 0);
                }
            } else if (orderTableTab === 'Completed Orders') {
                if (pageNumber >= 1 && pageNumber <= totalPages) {
                    setCompletedOrdersPage(pageNumber);
                    window.scrollTo(0, 0);
                }
            } else {
                if (pageNumber >= 1 && pageNumber <= totalPendingPages) {
                    setPendingOrdersPage(pageNumber);
                    window.scrollTo(0, 0);
                }
            }
        });
    };

    const handleRefresh = () => {
        // Prevent multiple simultaneous refreshes
        if (isRefreshing) {
            console.log('Refresh already in progress, skipping...');
            return;
        }

        Sentry.startSpan({
            name: 'handleRefresh-Admin',
            op: 'ui.interaction.function'
        }, async () => {
            setIsRefreshing(true);
            console.log('Starting admin refresh...');
            
            try {
                // Perform full sync from DespatchCloud
                console.log('Step 1: Syncing orders from DespatchCloud...');
                await dispatch(syncOrders()).unwrap();
                console.log('Step 1 completed: Orders synced successfully');
                
                // Wait a moment for database to stabilize
                await new Promise(resolve => setTimeout(resolve, 1000));
                
                // After sync, refresh both pending and completed orders sequentially to avoid race conditions
                console.log('Step 2: Refreshing pending orders...');
                await dispatch(fetchPendingOrdersForAdmin({
                    page: pendingOrdersPage,
                    perPage: ordersPerPage
                })).unwrap();
                console.log('Step 2 completed: Pending orders refreshed');
                
                console.log('Step 3: Refreshing completed orders...');
                await dispatch(fetchCompletedOrdersForAdmin({
                    page: completedOrdersPage,
                    perPage: ordersPerPage
                })).unwrap();
                console.log('Step 3 completed: Completed orders refreshed');
                
                console.log('Admin refresh completed successfully');
            } catch (error) {
                console.error('Error during admin refresh:', error);
                // You might want to show a user-friendly error message here
                alert(`Refresh failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
            } finally {
                setIsRefreshing(false);
                console.log('Admin refresh finished');
            }
        });
    };

    // Open delete confirmation dialog
    const handleDeleteClick = (orderId: string, e: React.MouseEvent) => {
        e.stopPropagation();
        setOrderToDelete(orderId);
        setShowDeleteDialog(true);
    };

    // Handle delete confirmation
    const handleConfirmDelete = async (orderId: string) => {
        try {
            // First, delete items from archived_order_items
            const { error: itemsError } = await supabase
                .from('archived_order_items')
                .delete()
                .eq('order_id', orderId);

            if (itemsError) {
                console.error('Error deleting order items:', itemsError);
                throw new Error(`Failed to delete order items: ${itemsError.message}`);
            }

            // Then, delete the order from archived_orders
            const { error: orderError } = await supabase
                .from('archived_orders')
                .delete()
                .eq('order_id', orderId);

            if (orderError) {
                console.error('Error deleting order:', orderError);
                throw new Error(`Failed to delete order: ${orderError.message}`);
            }

            // Refresh the orders list
            dispatch(fetchCompletedOrdersForAdmin({
                page: completedOrdersPage,
                perPage: ordersPerPage
            }));
            
            // Close the dialog
            setShowDeleteDialog(false);
            setOrderToDelete(null);
            
            // Clear selected order if it's the one being deleted
            if (selectedOrderId === orderId) {
                dispatch(setSelectedOrderId(null));
            }
        } catch (err) {
            console.error('Error in handleConfirmDelete:', err);
            // Close the dialog even if there's an error
            setShowDeleteDialog(false);
            setOrderToDelete(null);
        }
    };

    // Request a sort by field
    const handleSortChange = useCallback((field: SortField) => {
        return Sentry.startSpan({
            name: 'handleSortChange-Admin',
            op: 'ui.interaction.sorting'
        }, async () => {
            // If clicking the same field, toggle direction
            const direction = sortConfig.field === field && sortConfig.direction === 'desc' ? 'asc' : 'desc';
            setSortConfig({ field, direction });
        });
    }, [sortConfig]);
    
    //Function to handle going to the next slide on carousel
    const nextSlide = useCallback(() => {
        setCurrentSlide((prev) => (prev + 1) % Math.ceil(brands.length / 2));
    }, [brands.length]);
    
    //Function to handle going to the previous slide on carousel
    const prevSlide = () => {
        setCurrentSlide((prev) => (prev - 1 + Math.ceil(brands.length / 2)) % Math.ceil(brands.length / 2));
    };
    
    // Add auto-slide functionality
    useEffect(() => {
        const timer = setInterval(() => {
            nextSlide();
        }, 5000);

        // Cleanup on unmount or when nextSlide changes
        return () => clearInterval(timer);
    }, [nextSlide]);

    // Get order items for active orders - simplified to avoid memoization issues
    const orderItemsById = useSelector((state: RootState) => {
        const result: Record<string, OrderItem[]> = {};
        activeOrders.forEach((order: Order) => {
            result[order.order_id] = selectOrderItemsById(order.order_id)(state);
        });
        return result;
    });

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
                        items={
                            isSearchMode
                                ? (() => {
                                    const result = combinedSearchResults.find(order => order.order_id === selectedOrderId);
                                    if (result?.orderType === 'completed') {
                                        return archivedOrderItems[selectedOrderId] || [];
                                    } else {
                                        return orderItems[selectedOrderId] || [];
                                    }
                                })()
                                : orderTableTab === 'Completed Orders' 
                                ? archivedOrderItems[selectedOrderId!] || []
                                : orderItems[selectedOrderId!] || []
                        }
                    />
                )}
                {/* Left Section: Orders Table */}
                <div className="flex-1">
                    {/* Header and search */}
                    <div className="bg-[#1d1d1d]/90 rounded-t-lg backdrop-blur-sm p-4">
                        <div className="flex flex-col space-y-3 md:space-y-0 md:flex-row justify-between items-start md:items-center">
                            <h1 className="text-2xl font-bold text-white">
                                {isSearchMode ? 'Search Results' : 
                                    (orderTableTab === 'Completed Orders' ? 'Completed Orders' : 'Pending Orders')}
                            </h1>
                            <div className="flex flex-col space-y-2 sm:space-y-0 sm:flex-row sm:space-x-3 w-full md:w-auto">
                                {/* Search results counter */}
                                {searchTerm && (
                                    <div className="text-sm text-gray-300 self-start sm:self-center sm:mr-4" aria-live="polite">
                                        Found {combinedSearchResults.length} {combinedSearchResults.length === 1 ? 'result' : 'results'} for &quot;{searchTerm}&quot;
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
                                            aria-label="Search orders"
                                        />
                                        <div className="absolute inset-y-0 left-0 flex items-center pl-3 pointer-events-none">
                                            <svg className="w-4 h-4 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"></path>
                                            </svg>
                                        </div>
                                        {searchTerm && (
                                            <button
                                                onClick={async () => {
                                                    await Sentry.startSpan({
                                                        name: 'handleClearSearch-admin',
                                                    }, async () => {
                                                        handleClearSearch();
                                                    })
                                                }}
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
                                            currentTab={isSearchMode ? 'Pending Orders' : orderTableTab}
                                        />
                                    </div>
                                    
                                    {/* Refresh button */}
                                    <button
                                        onClick={async () => {
                                            await Sentry.startSpan({
                                                name: 'handleRefresh-admin',
                                            }, async () => {
                                                handleRefresh();
                                            })
                                        }}
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
                                                {/**Navigation Tabs - Always visible, disabled during search */}
                        <div className="mt-4 mb-2">
                            <div>
                                <button
                                    className={`px-4 py-2 text-md font-medium ${
                                        isSearchMode 
                                            ? 'text-gray-400 border-b-2 border-transparent cursor-not-allowed opacity-60' 
                                            : orderTableTab === 'Pending Orders' 
                                                ? 'text-white border-b-2 border-white' 
                                                : 'text-gray-500 border-b-2 border-transparent hover:text-gray-300'
                                    } bg-transparent focus:outline-none transition-colors`}
                                    style={{ marginBottom: '-1px' }}
                                    onClick={isSearchMode ? undefined : () => handleOrderTableTabChange('Pending Orders')}
                                    disabled={isSearchMode}
                                    title={isSearchMode ? "Clear search to switch tabs" : "Switch to Pending Orders"}
                                >
                                    Pending Orders
                                </button>
                                <button
                                    className={`px-4 py-2 text-md font-medium ${
                                        isSearchMode 
                                            ? 'text-gray-400 border-b-2 border-transparent cursor-not-allowed opacity-60' 
                                            : orderTableTab === 'Completed Orders' 
                                                ? 'text-white border-b-2 border-white' 
                                                : 'text-gray-500 border-b-2 border-transparent hover:text-gray-300'
                                    } bg-transparent focus:outline-none transition-colors`}
                                    style={{ marginBottom: '-1px' }}
                                    onClick={isSearchMode ? undefined : () => handleOrderTableTabChange('Completed Orders')}
                                    disabled={isSearchMode}
                                    title={isSearchMode ? "Clear search to switch tabs" : "Switch to Completed Orders"}
                                >
                                    Completed Orders
                                </button>
                            </div>
                        </div>
                    </div>
                    
                    {/* Table Container */}
                    <div className="bg-[#1d1d1d]/90 rounded-t-lg backdrop-blur-sm relative" style={{ zIndex: 1 }}>
                        <div className="overflow-x-auto bg-white h-[calc(97vh-300px)] flex flex-col">
                            {(loading || (orderTableTab === 'Completed Orders' && archivedOrdersLoading) || 
                              (orderTableTab === 'Pending Orders' && loading)) ? (
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
                                    <p className="text-red-600 font-medium mb-2">Error loading orders: {archivedOrdersError || error}</p>
                                    <p className="text-gray-600 mb-4">Please try refreshing the orders. If the issue persists, contact support.</p>
                                    <button
                                        onClick={async () => {
                                            await Sentry.startSpan({
                                                name: 'handleRefresh-admin',
                                            }, async () => {
                                                handleRefresh();
                                            })
                                        }}
                                        className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 transition-colors"
                                    >
                                        Retry
                                    </button>
                                </div>
                            ) : isSearchMode ? (
                                // Search Results Table
                                combinedSearchResults.length === 0 ? (
                                <div className="flex-1 flex flex-col items-center justify-center bg-gray-50 p-6">
                                    <div className="text-gray-400 mb-4">
                                            <svg xmlns="http://www.w3.org/2000/svg" className="h-16 w-16" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                                            </svg>
                                    </div>
                                            <p className="text-black font-medium mb-1">No matching orders found</p>
                                            <p className="text-gray-500 text-sm">Try a different search term or clear the search</p>
                                            <button 
                                                onClick={async () => {
                                                    await Sentry.startSpan({
                                                        name: 'handleClearSearch-admin',
                                                    }, async () => {
                                                        handleClearSearch();
                                                    })
                                                }}
                                                className="mt-4 px-4 py-2 bg-gray-200 text-gray-800 rounded hover:bg-gray-300 focus:outline-none focus:ring-2 focus:ring-gray-500 focus:ring-offset-2 transition-colors"
                                            >
                                                Clear Search
                                            </button>
                                    </div>
                                ) : (
                                    <div className="flex-1 overflow-y-auto">
                                        <table 
                                            className="w-full bg-white/90 backdrop-blur-sm border border-gray-200 table-auto h-full"
                                            role="grid"
                                            aria-label="Search Results"
                                        >
                                            <thead className="bg-gray-100/90 sticky top-0">
                                                <tr>
                                                    <th scope="col" className="px-4 py-4 text-center text-black text-md font-semibold">Order ID</th>
                                                    <th scope="col" className="px-4 py-2 text-center text-black text-md font-semibold">Customer Name</th>
                                                    <th scope="col" className="px-4 py-2 text-center text-black text-md font-semibold whitespace-nowrap">Order Date</th>
                                                    <th scope="col" className="px-4 py-2 text-center text-black text-md font-semibold">Type</th>
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
                                                                <div className="h-4 bg-gray-200 rounded w-20 mx-auto"></div>
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
                                                    paginatedSearchResults.map((order) => (
                                                        <tr
                                                            key={`${order.orderType}-${order.order_id}`}
                                                            ref={order.order_id === selectedOrderId ? selectedRowRef : null}
                                                            className={`transition-colors duration-150 cursor-pointer text-center h-[calc((100vh-300px-48px)/15)] ${
                                                                order.order_id === selectedOrderId 
                                                                  ? "bg-blue-100/90 border-l-4 border-blue-500 shadow-md" 
                                                                  : "hover:bg-gray-50/90 hover:border-l-4 hover:border-gray-300"
                                                            }`}
                                                            onClick={async () => {
                                                                await Sentry.startSpan({
                                                                    name: 'handleOrderRowClick-admin-search',
                                                                }, async () => {
                                                                    handleOrderClick(order.order_id);
                                                                })
                                                            }}
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
                                                            <td className="px-4 py-2 text-black">{order.customer_name}</td>
                                                            <td className="px-4 py-2 text-black">
                                                                {new Date(order.order_date).toLocaleDateString("en-GB")}
                                                            </td>
                                                            <td className="px-4 py-2">
                                                                <span className={`px-2 py-1 text-xs font-medium rounded-full ${
                                                                    order.orderType === 'completed' 
                                                                        ? 'bg-green-100 text-green-800' 
                                                                        : 'bg-yellow-100 text-yellow-800'
                                                                }`}>
                                                                    {order.orderType === 'completed' ? 'Completed' : 'Pending'}
                                                                </span>
                                                            </td>
                                                            <td className="px-4 py-2">
                                                                <button 
                                                                    className="text-blue-600 hover:text-blue-800 whitespace-nowrap focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-1 rounded px-2 py-1 transition-colors"
                                                                    onClick={async (e) => {
                                                                        e.stopPropagation();
                                                                        await Sentry.startSpan({
                                                                            name: 'handleViewItemsButtonClick-admin-search',
                                                                        }, async () => {
                                                                            handleOrderClick(order.order_id);
                                                                        })
                                                                    }}
                                                                    aria-label={`View items for order ${order.order_id}`}
                                                                >
                                                                    View Items
                                                                </button>
                                                            </td>
                                                            <td className="px-4 py-2 text-black">
                                                                <button
                                                                    className="p-1 text-blue-600 hover:text-blue-800 focus:outline-none"
                                                                    onClick={async (e) => {
                                                                        e.stopPropagation();
                                                                        await Sentry.startSpan({
                                                                            name: 'handleEditButtonClick-admin-search',
                                                                        }, async () => {
                                                                            handleEditClick(order, e);
                                                                        })
                                                                    }}
                                                                    aria-label={`Edit order ${order.order_id}`}
                                                                >
                                                                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                                                        <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3Z"/>
                                                                    </svg>
                                                                </button>
                                                            </td>
                                                            <td className="px-4 py-2 text-black">
                                                                <button
                                                                    className={`flex justify-center items-center h-full w-full rounded-full p-2 transition-colors focus:outline-none focus:ring-2 focus:ring-gray-300 ${
                                                                        order.orderType === 'completed' 
                                                                            ? 'hover:bg-gray-100 cursor-pointer' 
                                                                            : 'opacity-50 cursor-not-allowed'
                                                                    }`}
                                                                    onClick={(e) => {
                                                                        e.stopPropagation();
                                                                        if (order.orderType === 'completed') {
                                                                            Sentry.startSpan({
                                                                                name: 'handleDeleteButtonClick-admin-search',
                                                                            }, async () => {
                                                                                handleDeleteClick(order.order_id, e);
                                                                            });
                                                                        }
                                                                    }}
                                                                    disabled={order.orderType === 'pending'}
                                                                    title={order.orderType === 'pending' ? 'Cannot delete pending orders' : `Delete order ${order.order_id}`}
                                                                    aria-label={order.orderType === 'pending' ? 'Delete not available for pending orders' : `Delete order ${order.order_id}`}
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
                                )
                            ) : ((orderTableTab === 'Completed Orders' && filteredOrders.length === 0) || 
                                 (orderTableTab === 'Pending Orders' && filteredPendingOrders.length === 0)) ? (
                                <div className="flex-1 flex flex-col items-center justify-center bg-gray-50 p-6">
                                    <div className="text-gray-400 mb-4">
                                        <svg xmlns="http://www.w3.org/2000/svg" className="h-16 w-16" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8m-9 4h4" />
                                        </svg>
                                    </div>
                                            <p className="text-black font-medium mb-1">
                                                {orderTableTab === 'Completed Orders' ? 'No completed orders found' : 'No pending orders found'}
                                            </p>
                                            <p className="text-gray-500 text-sm">
                                                {orderTableTab === 'Completed Orders' 
                                                    ? 'Orders marked as complete will appear here' 
                                                    : 'Pending orders will appear here'}
                                            </p>
                                </div>
                            ) : orderTableTab === 'Completed Orders' ? (
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
                                                completedOrders.map((order) => (
                                                    <tr
                                                        key={order.order_id}
                                                        ref={order.order_id === selectedOrderId ? selectedRowRef : null}
                                                        className={`transition-colors duration-150 cursor-pointer text-center h-[calc((100vh-300px-48px)/15)] ${
                                                            order.order_id === selectedOrderId 
                                                              ? "bg-blue-100/90 border-l-4 border-blue-500 shadow-md" 
                                                              : "hover:bg-gray-50/90 hover:border-l-4 hover:border-gray-300"
                                                        }`}
                                                        onClick={async () => {
                                                            await Sentry.startSpan({
                                                                name: 'handleOrderRowClick-admin',
                                                            }, async () => {
                                                                handleOrderClick(order.order_id);
                                                            })
                                                        }}
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
                                                                onClick={async (e) => {
                                                                    e.stopPropagation();
                                                                    await Sentry.startSpan({
                                                                        name: 'handleViewItemsButtonClick-admin',
                                                                    }, async () => {
                                                                        handleOrderClick(order.order_id);
                                                                    })
                                                                }}
                                                                aria-label={`View items for order ${order.order_id}`}
                                                            >
                                                                View Items
                                                            </button>
                                                        </td>
                                                        <td className="px-4 py-2 text-black">
                                                            <button
                                                                className="p-1 text-blue-600 hover:text-blue-800 focus:outline-none"
                                                                onClick={async (e) => {
                                                                    e.stopPropagation();
                                                                    await Sentry.startSpan({
                                                                        name: 'handleEditButtonClick-admin',
                                                                    }, async () => {
                                                                        handleEditClick(order, e);
                                                                    })
                                                                }}
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
                                                                    Sentry.startSpan({
                                                                        name: 'handleDeleteButtonClick-admin',
                                                                    }, async () => {
                                                                        handleDeleteClick(order.order_id, e);
                                                                    });
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
                            ) : (
                                <div className="flex-1 overflow-y-auto">
                                    <table className="w-full bg-white/90 backdrop-blur-sm border border-gray-200 table-auto h-full">
                                        <thead className="bg-gray-100/90 sticky top-0">
                                            <tr>
                                                <th className="px-4 py-4 text-center text-black text-md">Order ID</th>
                                                <th className="px-4 py-2 text-center text-black text-md">Customer Name</th>
                                                <th className="px-4 py-2 text-center text-black text-md">Priority</th>
                                                <th className="px-4 py-2 text-center text-black text-md">Order Date</th>
                                                <th className="px-4 py-2 text-center text-black">Status</th>
                                                <th className="px-4 py-2 text-center text-black">Edit</th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-gray-200">
                                            {isRefreshing ? (
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
                                                        <td className="px-4 py-5">
                                                           <div className="h-4 bg-gray-200 rounded w-8 mx-auto"></div>
                                                        </td>
                                                    </tr>
                                                ))
                                            ) : (
                                                paginatedPendingOrders.map((order) => {
                                                    return (
                                                        <tr
                                                            key={order.order_id}
                                                            ref={order.order_id === selectedOrderId ? selectedRowRef : null}
                                                            className={`transition-all duration-200 cursor-pointer text-center h-[calc((100vh-300px-48px)/15)] ${order.order_id === selectedOrderId ? "bg-blue-200/90 border-1-4 border-blue-500 shadow-md" : "hover:bg-gray-100/90 hover:border-1-4 hover:border-gray-300"}`}
                                                            onClick={async () => {
                                                                handleOrderClick(order.order_id);
                                                            }}
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
                                                            <td className="px-4 py-2 text-black">{order.customer_name}</td>
                                                            <td className="px-4 py-2 text-black">
                                                                {(() => {
                                                                    const items = orderItemsById[order.order_id] || [];
                                                                    return 'calculatedPriority' in order
                                                                        ? (order as OrderWithPriority).calculatedPriority
                                                                        : Math.max(...items.map(item => item.priority || 0));
                                                                })()}
                                                            </td>
                                                            <td className="px-4 py-2 text-black">{new Date(order.order_date).toLocaleDateString("en-GB")}</td>
                                                            <td className="px-4 py-2 text-black">{order.status}</td>
                                                            <td>
                                                                <button
                                                                    className="p-1 text-blue-600 hover:text-blue-800 focus:outline-none"
                                                                    onClick={async (e) => {
                                                                        e.stopPropagation();
                                                                        await Sentry.startSpan({
                                                                            name: 'handleEditButtonClick-admin',
                                                                        }, async () => {
                                                                            handleEditClick(order, e);
                                                                        })
                                                                    }}
                                                                    aria-label={`Edit order ${order.order_id}`}
                                                                >
                                                                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                                                        <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3Z"/>
                                                                    </svg>
                                                                </button>
                                                            </td>
                                                        </tr>
                                                    )
                                                })
                                            )}
                                        </tbody>
                                    </table>
                                </div>
                            )}
                            {/* Pagination controls */}
                            {((isSearchMode && combinedSearchResults.length > 0) ||
                              (orderTableTab === 'Completed Orders' && filteredOrders.length > 0) || 
                              (orderTableTab === 'Pending Orders' && filteredPendingOrders.length > 0)) && (
                                <div className="flex flex-col sm:flex-row justify-between items-center bg-white/90 backdrop-blur-sm p-4 border border-gray-200">
                                    <div className="text-sm text-gray-600 mb-3 sm:mb-0">
                                        {isSearchMode ? (
                                            <>
                                                Showing <span className="font-medium">{searchResultsStartIndex + 1}</span> to{" "}
                                                <span className="font-medium">{Math.min(searchResultsEndIndex, combinedSearchResults.length)}</span> of{" "}
                                                <span className="font-medium">{combinedSearchResults.length}</span>{" "}
                                                search results
                                            </>
                                        ) : orderTableTab === 'Completed Orders' ? (
                                            <>
                                                Showing <span className="font-medium">{indexOfFirstOrder + 1}</span> to{" "}
                                                <span className="font-medium">{Math.min(indexOfLastOrder, filteredOrders.length)}</span> of{" "}
                                                <span className="font-medium">{filteredOrders.length}</span>{" "}
                                                completed orders
                                            </>
                                        ) : (
                                            <>
                                                Showing <span className="font-medium">{pendingOrdersStartIndex + 1}</span> to{" "}
                                                <span className="font-medium">{Math.min(pendingOrdersEndIndex, filteredPendingOrders.length)}</span> of{" "}
                                                <span className="font-medium">{filteredPendingOrders.length}</span>{" "}
                                                pending orders
                                            </>
                                        )}
                                    </div>
                                        <div className="flex gap-2">
                                            <button
                                                onClick={async () => {
                                                    await Sentry.startSpan({
                                                        name: 'handlePageChange-Previous-admin',
                                                    }, async () => {
                                                    const currentPage = isSearchMode ? searchResultsPage : 
                                                        (orderTableTab === 'Completed Orders' ? completedOrdersPage : pendingOrdersPage);
                                                    handlePageChange(currentPage - 1);
                                                    })
                                                }}
                                            disabled={
                                                isSearchMode ? searchResultsPage === 1 :
                                                (orderTableTab === 'Completed Orders' ? completedOrdersPage : pendingOrdersPage) === 1
                                            }
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
                                                max={isSearchMode ? totalSearchPages : 
                                                    (orderTableTab === 'Completed Orders' ? totalPages : totalPendingPages)}
                                                value={isSearchMode ? searchResultsPage : 
                                                    (orderTableTab === 'Completed Orders' ? completedOrdersPage : pendingOrdersPage)}
                                                    onChange={(e) => {
                                                        const page = parseInt(e.target.value);
                                                    const maxPages = isSearchMode ? totalSearchPages : 
                                                        (orderTableTab === 'Completed Orders' ? totalPages : totalPendingPages);
                                                        if (!isNaN(page) && page >= 1 && page <= maxPages) {
                                                            handlePageChange(page);
                                                        }
                                                    }}
                                                    className="w-12 text-center border border-gray-300 rounded mx-2 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                                                aria-label={`Page ${isSearchMode ? searchResultsPage : 
                                                    (orderTableTab === 'Completed Orders' ? completedOrdersPage : pendingOrdersPage)} of ${isSearchMode ? totalSearchPages : 
                                                    (orderTableTab === 'Completed Orders' ? totalPages : totalPendingPages)}`}
                                                />
                                            <span>of {isSearchMode ? totalSearchPages : 
                                                (orderTableTab === 'Completed Orders' ? totalPages : totalPendingPages)}</span>
                                            </div>
                                            <button
                                                onClick={async () => {
                                                    await Sentry.startSpan({
                                                        name: 'handlePageChange-Next-admin',
                                                    }, async () => {
                                                    const currentPage = isSearchMode ? searchResultsPage : 
                                                        (orderTableTab === 'Completed Orders' ? completedOrdersPage : pendingOrdersPage);
                                                    handlePageChange(currentPage + 1);
                                                })
                                            }}
                                            disabled={
                                                isSearchMode ? searchResultsPage === totalSearchPages :
                                                (orderTableTab === 'Completed Orders' ? completedOrdersPage : pendingOrdersPage) === 
                                                (orderTableTab === 'Completed Orders' ? totalPages : totalPendingPages)
                                            }
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
                    <div className="relative bg-white h-[250px] sm:h-[300px] lg:h-[calc(38vh-120px)] flex flex-col">
                        {/**Carousel Container */}
                        <div className="flex-1 overflow-hidden relative">
                            <div
                                className="flex transition-transform duration-500 ease-in-out h-full mt-5 "
                                style={{ transform: `translateX(-${currentSlide * 100}%)` }}
                            >
                                {/* Group brands into pairs */}
                                {Array.from({ length: Math.ceil(brands.length / 2) }, (_, i) => brands.slice(i * 2, (i + 1) * 2)).map((brandPair, index) => (
                                    <div key={index} className="min-w-full h-full flex justify-around items-center px-4">
                                        {brandPair.map((brand, brandIndex) => (
                                            <div 
                                                key={`${index}-${brandIndex}`} 
                                                className="w-1/2 h-full flex items-center justify-center relative px-2 cursor-pointer hover:scale-105 transition-transform duration-200"
                                                onClick={() => {
                                                    router.push(`/inserts?brand=${encodeURIComponent(brand.name)}`);
                                                }}
                                            >
                                                <Image
                                                    src={brand.image}
                                                    alt={`${brand.name} logo`}
                                                    width={120}
                                                    height={120}
                                                    sizes="(max-width: 640px) 80px, (max-width: 768px) 100px, 120px"
                                                    priority={index === 0}
                                                    className="object-contain w-auto h-auto max-w-[80%] max-h-[80%] sm:max-w-[85%] sm:max-h-[85%] lg:max-w-[90%] lg:max-h-[90%]"
                                                />
                                            </div>
                                        ))}
                                    </div>
                                ))}
                            </div>
                            {/**Navigation Buttons */}
                            <button
                                onClick={() => {
                                    prevSlide();
                                }}
                                className="absolute left-2 top-2/3 transform -translate-y-1/2 bg-gray-800/50 text-white p-2 rounded-full hover:bg-gray-800"
                            >
                                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                    <path d="m15 18-6-6 6-6"/>
                                </svg>
                            </button>
                            <button
                                onClick={() => {
                                    nextSlide();
                                }}
                                className="absolute right-2 top-2/3 transform -translate-y-1/2 bg-gray-800/50 text-white p-2 rounded-full hover:bg-gray-800"
                            >
                                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                    <path d="m9 18 6-6-6-6"/>
                                </svg>
                            </button>
                        </div>
                        {/**View More Button */}
                        <div className="flex justify-center py-4">
                            <button className="bg-gradient-to-r from-red-800 to-red-600 text-white px-6 py-2 rounded-full flex items-center space-x-2 hover:from-red-700 hover:to-red-500 " onClick={() => {
                                router.push('/inserts');
                            }}>
                                <span>View More</span>
                                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                        <path d="M5 12h14"/>
                                        <path d="m12 5 7 7-7 7"/>
                                    </svg>
                            </button>
                        </div>
                    </div>
                    {/* Best Performing Foam Sheets */}
                    <div className="bg-[#1d1d1d]/90 rounded-t-lg backdrop-blur-sm p-4 mt-4 lg:mt-5">
                        <h1 className="text-2xl font-bold text-white">Best Performing Foam Sheets</h1>
                    </div>
                    <div className="bg-white rounded-b-lg shadow-lg p-4 sm:p-6 flex flex-col justify-center">
                        <div className="flex flex-col sm:flex-row gap-4 sm:gap-8 lg:gap-11 justify-center items-center">
                            {/* Legend */}
                            <div className="flex flex-row sm:flex-col gap-2 sm:gap-3 justify-center flex-wrap ml-11">
                                {pieChartData.map((entry) => (
                                    <div key={entry.name} className="flex items-center gap-2 min-w-[100px]">
                                        <div 
                                            className="w-6 h-3 rounded-full border border-gray-300" 
                                            style={{ backgroundColor: getFoamSheetColorHex(entry.name) }}
                                        />
                                        <span className="text-xs sm:text-sm text-gray-700">{entry.name}</span>
                                    </div>
                                ))}
                            </div>
                            {/* Chart */}
                            <div className="w-full sm:flex-1 h-[200px] sm:h-[calc(53vh-250px)]">
                                <ResponsiveContainer width="100%" height="100%">
                                    <PieChart>
                                        <Pie
                                            data={pieChartData}
                                            dataKey="value"
                                            nameKey="name"
                                            cx="70%"
                                            cy="50%"
                                            outerRadius={80}
                                            fill="#8884d8"
                                            paddingAngle={2}
                                        >
                                            {pieChartData.map((entry, index) => (
                                                <Cell 
                                                    key={`cell-${index}`} 
                                                    fill={getFoamSheetColorHex(entry.name)}
                                                />
                                            ))}
                                        </Pie>
                                        <Tooltip 
                                            formatter={(value, name) => [`${value} sheets`, name]}
                                            contentStyle={{ 
                                                backgroundColor: 'rgba(255, 255, 255, 0.9)',
                                                border: '1px solid #ccc',
                                                borderRadius: '4px',
                                                fontSize: '12px'
                                            }}
                                        />
                                    </PieChart>
                                </ResponsiveContainer>
                            </div>
                        </div>
                        <div className="flex justify-center py-3 sm:py-4">
                            <button 
                                onClick={() => router.push('/analytics')}
                                className="bg-gradient-to-r from-red-800 to-red-600 text-white px-6 py-2 rounded-full flex items-center space-x-2 hover:from-red-700 hover:to-red-500 ">
                                <span>View Analytics</span>
                                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                    <path d="M5 12h14"/>
                                    <path d="m12 5 7 7-7 7"/>
                                </svg>
                            </button>
                        </div>
                    </div>
                </div>
            </div>
            
            {/* Edit Order Dialog */}
            {editingOrder && (
                <EditCompOrder
                    order={editingOrder as Order}
                    onClose={() => setEditingOrder(null)}
                    onSave={() => {
                        if (orderTableTab === 'Completed Orders') {
                            dispatch(fetchCompletedOrdersForAdmin({
                                page: completedOrdersPage,
                                perPage: ordersPerPage
                            }));
                        } else {
                            dispatch(fetchPendingOrdersForAdmin({
                                page: pendingOrdersPage,
                                perPage: ordersPerPage
                            }));
                        }
                    }}
                />
            )}

            {/* Delete Confirmation Dialog */}
            {showDeleteDialog && orderToDelete && (
                <DeleteCompletedOrder
                    isOpen={showDeleteDialog}
                    orderId={orderToDelete}
                    onClose={() => setShowDeleteDialog(false)}
                    onConfirm={handleConfirmDelete}
                />
            )}
        </div>
    );
}
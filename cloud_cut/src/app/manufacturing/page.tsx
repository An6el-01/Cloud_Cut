"use client";

import Navbar from "@/components/Navbar";
import ManuConfirm from "@/components/manuConfirm";
import { useEffect, useMemo, useRef, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import { AppDispatch, RootState } from "@/redux/store";
import { setSelectedOrderId, updateItemCompleted, updateOrderManufacturedStatus, setCurrentView } from "@/redux/slices/ordersSlice";
import { fetchOrdersFromSupabase, syncOrders, exportPendingOrdersCSV } from "@/redux/thunks/ordersThunks";
import {
  selectManufacturingOrders,
  selectOrderItemsById,
  selectCurrentViewTotal,
} from "@/redux/slices/ordersSelectors";
import { subscribeToOrders, subscribeToOrderItems } from "@/utils/supabase";
import { OrderItem, Order, NestingItem, ProcessedNestingData, NestingResult, NestingPlacement, NestingPart } from "@/types/redux";
import { inventoryMap } from '@/utils/inventoryMap';
import { supabase } from "@/utils/supabase";
import { store } from "@/redux/store";
import * as Sentry from "@sentry/nextjs";
import { getSupabaseClient } from "@/utils/supabase";
import { NestingProcessor } from '@/nesting/nestingProcessor';

// Define OrderWithPriority type
type OrderWithPriority = Order & { calculatedPriority: number };

export default function Manufacturing() {
  const dispatch = useDispatch<AppDispatch>();
  const orders = useSelector(selectManufacturingOrders); // Use manufacturing-specific selector
  const allOrders = useSelector((state: RootState) => state.orders.allOrders); // Add allOrders selector
  const totalOrders = useSelector(selectCurrentViewTotal); // Use view-specific total
  const selectedOrderId = useSelector((state: RootState) => state.orders.selectedOrderId);
  const userProfile = useSelector((state: RootState) => state.auth.userProfile);   // Get user profile to check for role
  const isOperatorRole = userProfile?.role === 'Operator';
  const selectedItemsSelector = useMemo(() => selectOrderItemsById(selectedOrderId || ''), [selectedOrderId]);
  const selectedOrderItems = useSelector(selectedItemsSelector);
  const { currentPage, loading, error, } = useSelector((state: RootState) => state.orders);
  const selectedRowRef = useRef<HTMLTableRowElement>(null);
  const ordersPerPage = 15;
  const totalPages = Math.ceil(totalOrders / ordersPerPage);
  const selectedOrder = orders.find((o) => o.order_id === selectedOrderId);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [isNesting, setIsNesting] = useState(false);
  const [showManuConfirmDialog, setShowManuConfirmDialog] = useState(false);
  const [showMediumSheetConfirmDialog, setShowMediumSheetConfirmDialog] = useState(false);
  const [pendingItemToComplete, setPendingItemToComplete] = useState<{
    orderId: string;
    itemId: string;
    completed: boolean;
  } | null>(null);
  const [showWarning, setShowWarning] = useState(false);
  const [activeTab, setActiveTab] = useState<'orders' | 'medium'>('orders');
  const [selectedFoamSheet, setSelectedFoamSheet] = useState<string | null>(null);
  const [sheetFilter, setSheetFilter] = useState('');
  const [mediumSheetPage, setMediumSheetPage] = useState(1);
  const mediumSheetsPerPage = 7;
  const [pendingManufacturedOrders, setPendingManufacturedOrders] = useState<Set<string>>(new Set());
  const [checkedOrders, setCheckedOrders] = useState<Set<string>>(new Set());
  const [allMediumSheetOrdersChecked, setAllMediumSheetOrdersChecked] = useState(false);
  const [orderIdsToPacking, setOrderIdsToPacking] = useState<string[]>([]);
  const [orderIdsToMarkCompleted, setOrderIdsToMarkCompleted] = useState<string[]>([]);
  const [currentOrderProgress, setCurrentOrderProgress] = useState<string>('0');
  const [selectedMediumSheetQuantity, setSelectedMediumSheetQuantity] = useState<number>(0);
  const [selectedMediumSheet, setSelectedMediumSheet] = useState<string>();
  const [selectedNestingRow, setSelectedNestingRow] = useState<string | null>(null);
  const [firstColTab, setFirstColTab] = useState<'Nesting Queue' | 'Completed Cuts' | 'Work In Progress' | 'Orders Queue'>(
    'Orders Queue'
  );
  const [nestingQueueData, setNestingQueueData] = useState<Record<string, ProcessedNestingData>>({});
  const [nestingLoading, setNestingLoading] = useState(false);

  const [hoveredInsert, setHoveredInsert] = useState<{
    partKey: string;
    mouseX: number;
    mouseY: number;
  } | null>(null);
  const [damagedInserts, setDamagedInserts] = useState<Record<string, boolean>>({});
  const svgContainerRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const [currentMediumStock, setCurrentMediumStock] = useState(0)
  const [adjustedMediumSheetQuantity, setAdjustedMediumSheetQuantity] = useState(selectedMediumSheetQuantity || 0)
  const [nestLocks, setNestLocks] = useState<Record<string, boolean>>({});

  // Improved function for tab changes that completely prevents changes for operators
  const handleFirstColTabChange = (tab: 'Nesting Queue' | 'Completed Cuts' | 'Work In Progress' | 'Orders Queue') => {
    // Operators can ONLY have 'Orders Queue'
    if (isOperatorRole) {
      console.log('Operator role detected - restricting to Orders Queue tab only');
      return; // Block all tab changes for operators
    }
    // Allow tab changes for other roles
    setFirstColTab(tab);
  };

  const NESTED_ORDER_COLOURS = [
    '#2196F3',
    '#F44336',
    '#4CAF50',
    '#FF9800',
    '#9C27B0',
    '#607D8B',
    '#FF5722',
    '#E91E63',
    '#00BCD4',
  ];

  //Helper to get a color for an order (by index)
  const getOrderColor = (orderId: string, index: number) => {
    // Assign color based on the order's position in the uniqueOrders list (index)
    return NESTED_ORDER_COLOURS[index % NESTED_ORDER_COLOURS.length];
  }

  const getPolygonCentroid = (pointsArr: {x: number, y: number}[]) => {
    let x = 0, y = 0, len = pointsArr.length;
    for (let i = 0; i < len; i++) {
      x += pointsArr[i].x;
      y += pointsArr[i].y;
    }
    return { x: x / len, y: y / len };
  }

  // Get all order items from the state
  const allOrderItems = useSelector((state: RootState) => state.orders.orderItems);
  // State to track orders with medium sheets
  const [ordersWithMediumSheets, setOrdersWithMediumSheets] = useState<Record<string, Order[]>>({});
  const [loadingMediumSheetOrders, setLoadingMediumSheetOrders] = useState(false);
  // Get the current view from Redux store
  const currentView = useSelector((state: RootState) => state.orders.currentView);
  // State for finished_stock values by SKU
  const [finishedStockBySku, setFinishedStockBySku] = useState<Record<string, number>>({});

  // Add this useEffect to enforce 'Orders Queue' for operators on component mount
  // and whenever user role changes
  useEffect(() => {
    if (isOperatorRole) {
      console.log('Enforcing Orders Queue tab for Operator role');
      setFirstColTab('Orders Queue');
    }
  }, [isOperatorRole]);

  // Helper function to filter items by SKU
  const filterItemsBySku = (items: OrderItem[]) => {
    return items.filter(item => {
      const sku = item.sku_id.toUpperCase();
      // Check for specific medium sheet patterns
      const validMediumSheetPatterns = ['SFS-100/50/30', 'SFS-100/50/50', 'SFS-100/50/70'];
      const isMediumSheet = validMediumSheetPatterns.some(pattern => sku.includes(pattern));

      // Check for specific retail pack SKUs (exact matches only)
      const validRetailPackSkus = ['SFP30E', 'SFP50E', 'SFP30P', 'SFP50P', 'SFP30T', 'SFP50T'];
      const isRetailPack = validRetailPackSkus.includes(sku);

      // Include items that are either:
      // 1. SFI or SFC items (manufacturing items)
      // 2. Medium sheets with our specific patterns
      // 3. Specific retail pack SKUs
      return sku.startsWith('SFI') || sku.startsWith('SFC') || isMediumSheet || isRetailPack;
    });
  };

  // Use useSelector to get order items for each order in the table
  const orderItemsById = useSelector((state: RootState) =>
    orders.reduce((acc, order) => {
      acc[order.order_id] = selectOrderItemsById(order.order_id)(state);
      return acc;
    }, {} as Record<string, OrderItem[]>)
  );

  // Track medium sheets by SKU and quantity from ALL orders, not just displayed ones
  const itemsByMediumSheet = useSelector((state: RootState) => {
    // Get all order items from the state, not just the ones for the current page
    const allOrderItems = Object.values(state.orders.orderItems).flat();

    // Define valid medium sheet patterns
    const validMediumSheetPatterns = ['SFS-100/50/30', 'SFS-100/50/50', 'SFS-100/50/70'];

    const result = allOrderItems.reduce((acc: Record<string, number>, item: OrderItem) => {
      // Check if this is a valid medium sheet SKU
      const isMediumSheet = validMediumSheetPatterns.some(pattern =>
        item.sku_id.startsWith('SFS-') && item.sku_id.includes(pattern) && !item.completed
      );

      if (isMediumSheet) {
        
        // Add the item quantity to the total for this SKU
        acc[item.sku_id] = (acc[item.sku_id] || 0) + item.quantity;
      }
      return acc;
    }, {});

    return result;
  });

  // Format medium sheet SKU to display the actual product name from inventory
  const formatMediumSheetName = (sku: string): string => {
    // Check if this SKU exists in our inventory map
    const productName = inventoryMap.get(sku);
    if (productName) {
      return productName;
    }

    // Fallback to formatting the SKU if not found in inventory
    const parts = sku.split('-');
    if (parts.length >= 3) {
      const color = parts[1];
      const thickness = parts[2];
      return `${color} [${thickness}]`;
    }

    // For SFSxxY format (where xx is thickness and Y is color code)
    if (sku.startsWith('SFS') && sku.length >= 5) {
      // Extract color code (usually the last character)
      const colorCode = sku.charAt(sku.length - 1);
      // Extract thickness (usually numbers between SFC and color code)
      const thickness = sku.substring(3, sku.length - 1);

      // Map color codes to color names
      const colorMap: Record<string, string> = {
        'K': 'BLACK',
        'B': 'BLUE',
        'G': 'GREEN',
        'O': 'ORANGE',
        'PK': 'PINK',
        'M': 'MAUVE',
        'P': 'PURPLE',
        'R': 'RED',
        'T': 'TAN',
        'Y': 'YELLOW',
        'E': 'GREY'
      };

      const color = colorMap[colorCode] || colorCode;
      return `${color} [${thickness}mm]`;
    }
    return sku; // Return original if no formatting could be applied
  };

  // Function to get the appropriate color for the foam sheet indicator
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

    // Fallback color if no match is found
    return 'bg-gray-400';
  };

  // Function to find orders that contain a specific medium sheet
  const findOrdersWithMediumSheet = (sku: string | null) => {
    // Use separate tracking span instead of wrapping with return
    Sentry.startSpan({
      name: 'findOrdersWithMediumSheet',
      op: 'data.query'
    }, async () => {
      // Just track without changing return type
    });

    if (!sku) return [];

    // Return cached orders if already fetched
    if (ordersWithMediumSheets[sku]) {
      return ordersWithMediumSheets[sku];
    }

    // Find all order IDs from the order items that have this SKU
    const orderIdsWithSheet = new Set<string>();

    // Loop through all order items to find orders with this sheet SKU
    Object.entries(allOrderItems).forEach(([orderId, items]) => {
      if (items.some(item => item.sku_id === sku && !item.completed)) {
        orderIdsWithSheet.add(orderId);
      }
    });

    // Convert Set to Array
    const orderIdsArray = Array.from(orderIdsWithSheet);

    // Initialize with empty array to avoid undefined
    if (!ordersWithMediumSheets[sku]) {
      setOrdersWithMediumSheets(prev => ({
        ...prev,
        [sku]: []
      }));
    }

    // If we have order IDs, get them from the Redux store
    if (orderIdsArray.length > 0) {
      setLoadingMediumSheetOrders(true);

      try {
        // Get orders from Redux state instead of making a new query
        const ordersFromStore = orders.filter(order => 
          orderIdsArray.includes(order.order_id)
        );


        if (ordersFromStore.length > 0) {
          setOrdersWithMediumSheets(prev => ({
            ...prev,
            [sku]: ordersFromStore
          }));
        }
      } catch (err) {
        console.error('Error in findOrdersWithMediumSheet:', err);
      } finally {
        setLoadingMediumSheetOrders(false);
      }
    }

    // Return whatever we currently have (might be empty initially)
    return ordersWithMediumSheets[sku] || [];
  };

  // Function to get quantity of a specific medium sheet in an order
  const getMediumSheetQuantityInOrder = (orderId: string, sku: string) => {
    const items = allOrderItems[orderId] || [];
    return items
      .filter(item => item.sku_id === sku && !item.completed)
      .reduce((sum, item) => sum + item.quantity, 0);
  };

  // Function to handle clicking on a medium sheet row
  const handleMediumSheetClick = (sku: string) => {
    // Toggle selection: if clicking the same sheet, deselect it; otherwise select the new sheet
    const newSelectedSheet = selectedFoamSheet === sku ? null : sku;
    setSelectedFoamSheet(newSelectedSheet);

    // Update the selected medium sheet quantity
    if (newSelectedSheet) {
      setSelectedMediumSheetQuantity(itemsByMediumSheet[newSelectedSheet] || 0);
      setSelectedMediumSheet(newSelectedSheet);
    } else {
      setSelectedMediumSheetQuantity(0);
      setSelectedMediumSheet('N/A');
    }

    // Reset any checkboxes and processing states
    setAllMediumSheetOrdersChecked(false);
    setCheckedOrders(new Set());

    if (newSelectedSheet) {
      // If a sheet was selected (not deselected), force a refresh of the orders data
      setLoadingMediumSheetOrders(true);

      // Clear any cached orders data for this sheet to force a fresh fetch
      setOrdersWithMediumSheets(prev => {
        const newState = { ...prev };
        // Remove the cached data to force a refetch
        if (newSelectedSheet in newState) {
          delete newState[newSelectedSheet];
        }
        return newState;
      });

      // Immediately call findOrdersWithMediumSheet to trigger a fresh fetch
      findOrdersWithMediumSheet(newSelectedSheet);
    }
  };

  // Custom order progress selector that only considers filtered items
  const filteredOrderProgress = orders.reduce((acc, order) => {
    const items = orderItemsById[order.order_id] || [];
    const filteredItems = filterItemsBySku(items);
    if (filteredItems.length === 0) {
      acc[order.order_id] = "N/A";
    } else {
      const completedCount = filteredItems.filter(item => item.completed).length;
      acc[order.order_id] = `${completedCount}/${filteredItems.length}`;
    }
    return acc;
  }, {} as Record<string, string>);

  // This needs to be done on the syncOrders Thunk and not here!!!

  // Function to automatically mark orders with no manufacturing items as manufactured
  // Leave this as is for now (syncOrders Thunk Breaks if this is deleted)
  const autoMarkOrdersWithNoManufacturingItems = async () => {
    return Sentry.startSpan({
      name: 'autoMarkOrdersWithNoManufacturingItems',
      op: 'automated.process'
    }, async () => {
      console.log("Checking for orders with no manufacturing items...");

      // Make sure orders and their items are fully loaded
      if (loading || isRefreshing) {
        console.log("Orders are still loading, skipping auto-mark process");
        return;
      }

      // First, handle orders with no items at all
      const ordersWithNoItems = orders.filter(order => {
        const items = orderItemsById[order.order_id] || [];
        return items.length === 0;
      });

      // Then handle orders with items but none that need manufacturing
      const ordersWithNonManufacturingItems = orders.filter(order => {
        const items = orderItemsById[order.order_id] || [];
        // Only process orders that have items but none require manufacturing
        const filteredItems = filterItemsBySku(items);
        return items.length > 0 && filteredItems.length === 0;
      });

      // Combine both lists
      const ordersToProcess = [...ordersWithNoItems, ...ordersWithNonManufacturingItems];

      if (ordersToProcess.length > 0) {
        console.log(`Found ${ordersToProcess.length} orders to auto-process (${ordersWithNoItems.length} with no items, ${ordersWithNonManufacturingItems.length} with no manufacturing items)`);

        // Process each order sequentially
        for (const order of ordersToProcess) {
          try {
            console.log(`Auto-marking order ${order.order_id} as manufactured`);
            await dispatch(updateOrderManufacturedStatus({
              orderId: order.order_id,
              manufactured: true
            }));
            // Wait a short time between orders to prevent overwhelming the database
            await new Promise(resolve => setTimeout(resolve, 500));
          } catch (error) {
            console.error(`Error auto-marking order ${order.order_id} as manufactured:`, error);
          }
        }

        // Refresh the orders list after processing all orders
        console.log("Refreshing order list after auto-marking orders");
        dispatch(fetchOrdersFromSupabase({
          page: currentPage,
          perPage: ordersPerPage,
          manufactured: false,
          packed: false,
          status: "Pending",
          view: 'manufacturing'
        }));
      } else {
        console.log("No orders found that need auto-processing");
      }
    });
  };

  useEffect(() => {
    // Set the current view first
    dispatch(setCurrentView('manufacturing'));

    // Fetch orders for the current page
    dispatch(fetchOrdersFromSupabase({
      page: currentPage,
      perPage: ordersPerPage,
      manufactured: false,
      packed: false,
      status: "Pending",
      view: 'manufacturing'
    }));

    // Subscribe to real-time order updates
    const ordersSubscription = subscribeToOrders((payload) => {
      if (payload.eventType === "UPDATE") {
        // Handle order update
        if (payload.new.manufactured !== payload.old.manufactured) {
          // If manufactured status changed, refresh orders
          dispatch(fetchOrdersFromSupabase({
            page: currentPage,
            perPage: ordersPerPage,
            manufactured: false,
            packed: false,
            status: "Pending",
            view: 'manufacturing'
          }));

          // If we're in the medium sheets tab, refresh the view
          if (activeTab === 'medium' && selectedFoamSheet) {
            // Force refresh by temporarily clearing and resetting
            const currentSheet = selectedFoamSheet;
            setSelectedFoamSheet(null);
            setTimeout(() => setSelectedFoamSheet(currentSheet), 100);
          }
        }
      }
    });

    const itemsSubscription = subscribeToOrderItems((payload) => {
      if (payload.eventType === "INSERT") {
        dispatch({ type: "orders/addOrderItem", payload: payload.new });
      } else if (payload.eventType === "UPDATE") {
        // Only update if the item exists and the completed status has changed
        const currentItem = selectedOrderItems?.find(item => item.id === payload.new.id);
        if (currentItem && currentItem.completed !== payload.new.completed) {
          dispatch(
            updateItemCompleted({
              orderId: payload.new.order_id,
              itemId: payload.new.id,
              completed: payload.new.completed,
            })
          );

          // If we're in the medium sheets tab and this change affects our current view, 
          // refresh the medium sheet view
          if (activeTab === 'medium' && selectedFoamSheet &&
            payload.new.sku_id === selectedFoamSheet) {
            // Force refresh the list of orders with this medium sheet
            setOrdersWithMediumSheets(prev => {
              const newState = { ...prev };
              // Remove the cached data to force a refetch
              if (selectedFoamSheet in newState) {
                delete newState[selectedFoamSheet];
              }
              return newState;
            });
          }
        }
      } else if (payload.eventType === "DELETE") {
        dispatch({ type: "orders/removeOrderItem", payload: payload.old });
      }
    });

    return () => {
      ordersSubscription.unsubscribe();
      itemsSubscription.unsubscribe();
    };
  }, [dispatch, currentPage]);

  // Run auto-processing when view is set to manufacturing
  useEffect(() => {
    if (currentView === 'manufacturing' && orders.length > 0) {
      // Add a slight delay to ensure state is settled
      const timer = setTimeout(() => {
        autoMarkOrdersWithNoManufacturingItems();
      }, 1500);

      return () => clearTimeout(timer);
    }
  }, [currentView, orders.length]);
  
  // Function to handle clicking on an order row in the 'Orders With' section
  const handleOrderClick = async (orderId: string) => {
    try {
      // Set loading state
      setIsRefreshing(true);

      // First set the active tab to orders
      setActiveTab('orders');

      // Directly fetch the order to verify it exists
      const { data: orderData, error: orderError } = await supabase
        .from('orders')
        .select('*')
        .eq('order_id', orderId)
        .single();

      if (orderError) {
        console.error('Error fetching order:', orderError);
        setIsRefreshing(false);
        return;
      }

      // Fetch all orders directly from Supabase with the same sorting as the UI
      const { data: allOrders, error } = await supabase
        .from('orders')
        .select('*')
        .eq('status', 'Pending')
        .eq('manufactured', false)
        .eq('packed', false)
        .order('order_date', { ascending: false });

      if (error) {
        console.error('Error fetching all orders:', error);
        setIsRefreshing(false);
        return;
      }

      // Sort the orders the SAME WAY as they appear in your table
      const state = store.getState();
      const sortedOrders = [...(allOrders || [])].sort((a, b) => {
        // Get items for these orders to determine priority
        const aItems = state.orders.orderItems[a.order_id as string] || [];
        const bItems = state.orders.orderItems[b.order_id as string] || [];

        // Calculate max priority for each order
        const aMaxPriority = aItems.length > 0
          ? Math.min(...aItems.map((item: OrderItem) => item.priority ?? 10))
          : 10;
        const bMaxPriority = bItems.length > 0
          ? Math.min(...bItems.map((item: OrderItem) => item.priority ?? 10))
          : 10;

        // Sort by priority (lowest first)
        return aMaxPriority - bMaxPriority;
      });

      // Find the index of our target order in the sorted list
      const orderIndex = sortedOrders.findIndex(order => order.order_id === orderId);

      if (orderIndex === -1) {
        console.error(`Order ${orderId} not found in sorted list`);
        setIsRefreshing(false);
        return;
      }

      // Calculate which page it should be on (1-indexed)
      const targetPage = Math.floor(orderIndex / ordersPerPage) + 1;

      // If we're already on the right page, no need to navigate
      if (targetPage === currentPage) {
        // Just select the order and scroll to it
        dispatch(setSelectedOrderId(orderId));

        // Scroll to the row
        setTimeout(() => {
          if (selectedRowRef.current) {
            selectedRowRef.current.scrollIntoView({ behavior: "smooth", block: "center" });
          }
        }, 100);
      } else {
        // Navigate to the target page
        await dispatch(fetchOrdersFromSupabase({
          page: targetPage,
          perPage: ordersPerPage,
          manufactured: false,
          packed: false,
          status: "Pending",
          view: 'manufacturing'
        }));

        // Set selected order ID after navigation
        setTimeout(() => {
          dispatch(setSelectedOrderId(orderId));

          // Scroll to the selected row
          setTimeout(() => {
            if (selectedRowRef.current) {
              selectedRowRef.current.scrollIntoView({ behavior: "smooth", block: "center" });
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
        manufactured: false,
        packed: false,
        status: "Pending",
        view: 'manufacturing'
      }));
    }
  };

  // Function to handle toggling an item in an order as completed.
  const handleToggleCompleted = (orderId: string, itemId: string, completed: boolean) => {
    return Sentry.startSpan({
      name: 'handleToggleCompleted-Manufacturing',
      op: 'ui.interaction.function'
    }, async () => {
      // If marking as incomplete, just do it directly
      if (!completed) {
        dispatch(updateItemCompleted({ orderId, itemId, completed }));
        return;
      }

      // Get the relevant items (they're already filtered in the store)
      const relevantItems = selectedOrderItems;
      const filteredItems = filterItemsBySku(relevantItems);

      // Count how many filtered items are already completed
      const completedFilteredItems = filteredItems.filter(item =>
        item.completed || item.id === itemId // Count the current item if it's being marked as completed
      );

      // Check if this is the last filtered item to complete
      if (completedFilteredItems.length === filteredItems.length && completed) {
        console.log("Manufacturing: Last filtered item completion detected, setting up dialog", {
          orderId,
          itemId,
          filteredItems: filteredItems.length,
          completedFilteredItems: completedFilteredItems.length
        });

        // Store the pending item to complete
        setPendingItemToComplete({
          orderId,
          itemId,
          completed
        });

        // Calculate fresh progress for this order
        const freshProgress = calculateOrderProgress(orderId);
        console.log("Manufacturing: Calculated fresh progress:", freshProgress);
        setCurrentOrderProgress(freshProgress);

        // Set the arrays directly without resetting first
        const orderIdsForPacking: string[] = [orderId];
        const orderIdsForCompleted: string[] = [];

        // Update state with these arrays
        setOrderIdsToPacking(orderIdsForPacking);
        setOrderIdsToMarkCompleted(orderIdsForCompleted);

        // Log the updated order arrays state before showing dialog
        console.log("Manufacturing: Current order arrays state before showing dialog:", {
          orderIdsToPacking: orderIdsForPacking,
          orderIdsToMarkCompleted: orderIdsForCompleted
        });

        // Show confirmation dialog
        setShowManuConfirmDialog(true);
      } else {
        // Not the last filtered item, just mark it as completed
        dispatch(updateItemCompleted({ orderId, itemId, completed }));
      }
    });
  };

  const handleManufactureOrder = (orderId: string) => {
    // Close the confirmation dialog immediately
    setShowManuConfirmDialog(false);
    setPendingItemToComplete(null);

    return Sentry.startSpan({
      name: 'handleManufactureOrder',
      op: 'business.function'
    }, async () => {
      console.log("Manufacturing: handleManufactureOrder called with: ", {
        orderId,
      });

      // Mark order as manufactured
      setPendingManufacturedOrders(prev => new Set(prev).add(orderId));

      console.log(`Manufacturing: Marking Order ${orderId} as manufactured`);
      // Show loading state
      setIsRefreshing(true);

      try{
        // Update the manufactured status in Redux and Supabase
        dispatch(updateOrderManufacturedStatus({ orderId, manufactured: true }));
      } catch (error) {
        console.error("Error marking order as manufactured (handleManufactureOrder):", error);
      }

      // Refresh the orders list after a delay to ensure updates complete
      setTimeout(() => {
        console.log('Refreshing orders after processing');

        // Refresh orders data
        dispatch(fetchOrdersFromSupabase({
          page: currentPage,
          perPage: ordersPerPage,
          manufactured: false,
          packed: false,
          status: 'Pending',
          view: 'manufacturing'
        }))
        .finally(() => {
          setIsRefreshing(false);
          // Clear pending states
          setPendingManufacturedOrders(new Set());
          setCheckedOrders(new Set());
        });
      }, 2000);
    });
  };

  const handleMarkManufactured = (packingOrderIds: string[], markCompletedOrderIds: string[]) => {
    return Sentry.startSpan({
      name: 'handleMarkManufactured',
      op: 'business.function'
    }, async () => {
      console.log("Manufacturing: handleMarkManufactured called with:", {
        packingOrderIds,
        markCompletedOrderIds,
        orderIdsToPacking,
        orderIdsToMarkCompleted
      });

      // Close the confirmation dialog
      setShowManuConfirmDialog(false);

      // Reset the orderIds arrays immediately
      setOrderIdsToPacking([]);
      setOrderIdsToMarkCompleted([]);

      console.log("Manufacturing: Dialog closed, beginning order processing");

      // Process orders that should be marked as manufactured (ready for packing)
      for (const orderId of packingOrderIds) {
        // Add this order to pending manufactured orders for UI feedback
        setPendingManufacturedOrders(prev => new Set(prev).add(orderId));

        console.log(`Manufacturing: Marking order ${orderId} as manufactured`);
        // Show loading state
        setIsRefreshing(true);

        try {
          // Update the manufactured status in Redux and Supabase
          dispatch(updateOrderManufacturedStatus({ orderId, manufactured: true }));
        } catch (error) {
          console.error("Error marking order as manufactured (handleMarkManufactured):", error);
        }
      }

      // Process orders where only specific items should be marked as completed
      for (const orderId of markCompletedOrderIds) {
        // Find the items with the current medium sheet SKU
        const orderItems = allOrderItems[orderId] || [];
        const mediumSheetItems = orderItems.filter(item =>
          item.sku_id === selectedFoamSheet && !item.completed
        );

        // Mark each medium sheet item as completed
        for (const item of mediumSheetItems) {
          try {
            dispatch(updateItemCompleted({
              orderId,
              itemId: item.id,
              completed: true
            }));
          } catch (error) {
            console.error(`Error marking item ${item.id} as completed:`, error);
          }
        }
      }

      // Refresh the orders list after a delay to ensure updates complete
      setTimeout(() => {
        console.log(`Refreshing orders after processing`);

        // Refresh orders data
        dispatch(fetchOrdersFromSupabase({
          page: currentPage,
          perPage: ordersPerPage,
          manufactured: false,
          packed: false,
          status: "Pending",
          view: 'manufacturing'
        }))
          .finally(() => {
            setIsRefreshing(false);
            // Clear pending states
            setPendingItemToComplete(null);
            setPendingManufacturedOrders(new Set());
            setCheckedOrders(new Set());
            setAllMediumSheetOrdersChecked(false);

            // Refresh medium sheets view if active
            if (activeTab === 'medium' && selectedFoamSheet) {
              // Force refresh by temporarily clearing and resetting the selected foam sheet
              const currentSheet = selectedFoamSheet;
              setSelectedFoamSheet(null);
              setTimeout(() => setSelectedFoamSheet(currentSheet), 100);
            }
          });
      }, 2000);
    });
  };

  const handleRefresh = () => {
    setIsRefreshing(true);
    dispatch(syncOrders())
      .then(() => {
        // Fetch the first page of orders after syncing with the correct filters
        dispatch(fetchOrdersFromSupabase({
          page: 1,
          perPage: ordersPerPage,
          manufactured: false,
          packed: false,
          status: "Pending",
          view: 'manufacturing'
        }));
      })
      .catch((error) => {
        console.error('Error in syncOrders:', error);
      })
      .finally(() => {
        setIsRefreshing(false);
      });
  };

  const handleExportCSV = () => {
    setIsExporting(true);
    dispatch(exportPendingOrdersCSV())
      .catch((error) => {
        console.error("Error exporting CSV:", error);
      })
      .finally(() => {
        setIsExporting(false);
      })
  }

  const handleMediumSheetPageChange = (newPage: number) => {
    if (newPage >= 1) {
      setMediumSheetPage(newPage);
    }
  };

  // Function to mark all orders with the selected medium sheet as manufactured
  const markAllMediumSheetOrdersAsManufactured = () => {
    Sentry.startSpan({
      name: 'markAllMediumSheetOrdersAsManufactured',
    }, async () => {
      console.log('markAllMediumSheetOrdersAsManufactured');
      if (selectedFoamSheet) {
        // Toggle the main checkbox state
        const newCheckedState = !allMediumSheetOrdersChecked;
        setAllMediumSheetOrdersChecked(newCheckedState);

        // Get all orders with the selected medium sheet
        const ordersWithSheet = findOrdersWithMediumSheet(selectedFoamSheet);

        // Create a new Set for checked orders
        const newCheckedOrders = new Set(checkedOrders);

        // If toggling to checked state, add all orders to the checked set
        // If toggling to unchecked state, remove all orders from the checked set
        ordersWithSheet.forEach(order => {
          if (newCheckedState) {
            newCheckedOrders.add(order.order_id);
          } else {
            newCheckedOrders.delete(order.order_id);
          }
        });

        // Update the checked orders state
        setCheckedOrders(newCheckedOrders);

        // If we're checking the main checkbox, process all orders for manufacturing actions
        if (newCheckedState) {
          // Arrays to store order IDs based on their status
          const orderIdsForPacking: string[] = [];
          const orderIdsForMarkCompleted: string[] = [];

          // Process each order with this medium sheet
          for (const order of ordersWithSheet) {
            // Get all items for this order
            const orderItems = allOrderItems[order.order_id] || [];

            // Get all manufacturing items (items with SKU starting with SFI, SFC, or SFS)
            const manufacturingItems = orderItems.filter(item =>
              (item.sku_id.startsWith('SFI') ||
                item.sku_id.startsWith('SFC') ||
                item.sku_id.startsWith('SFS')) &&
              !item.completed
            );

            // Get items with the current medium sheet SKU
            const mediumSheetItems = orderItems.filter(item =>
              item.sku_id === selectedFoamSheet && !item.completed
            );

            // Case A: The medium sheet is the ONLY item in the order that needs manufacturing
            const isOnlyManufacturingItem = manufacturingItems.length === mediumSheetItems.length;

            // Case B: The medium sheet is the LAST item left to be manufactured
            const isLastManufacturingItem =
              manufacturingItems.every(item =>
                mediumSheetItems.some(mediumItem => mediumItem.id === item.id)
              );

            // If either case is true, add to packing array, otherwise add to mark completed
            if (isOnlyManufacturingItem || isLastManufacturingItem) {
              orderIdsForPacking.push(order.order_id);
            } else {
              orderIdsForMarkCompleted.push(order.order_id);
            }
          }

          // Store the arrays in state and show the confirmation dialog
          setOrderIdsToPacking(orderIdsForPacking);
          setOrderIdsToMarkCompleted(orderIdsForMarkCompleted);

          // Log the results
          console.log('Manufacturing: Batch Order Processing:', {
            orderIdsForPacking,
            orderIdsForMarkCompleted,
            totalOrders: orderIdsForPacking.length + orderIdsForMarkCompleted.length
          });

          // Show the confirmation dialog if we have any orders to process
          if (orderIdsForPacking.length > 0 || orderIdsForMarkCompleted.length > 0) {
            // For batch processing, we don't need a specific progress value
            console.log("Manufacturing: Setting up batch processing confirmation dialog");
            setCurrentOrderProgress('0');

            // Log the state just before showing the dialog
            setTimeout(() => {
              console.log("Manufacturing: State just before showing batch dialog:", {
                orderIdsToPacking,
                orderIdsToMarkCompleted,
                currentOrderProgress: '0',
                showConfirmDialog: false // Will be set to true next
              });
            }, 0);

            setShowMediumSheetConfirmDialog(true);

            // Log that we've triggered the dialog
            console.log("Manufacturing: Batch confirmation dialog triggered");
          }
        }
      }
    });
  }

  // Add a useEffect to refresh orders data when selectedFoamSheet changes
  useEffect(() => {
    if (selectedFoamSheet && activeTab === 'medium') {
      // Force refresh of orders with this medium sheet
      setLoadingMediumSheetOrders(true);

      // Call findOrdersWithMediumSheet to trigger a fresh fetch
      const ordersWithSheet = findOrdersWithMediumSheet(selectedFoamSheet);

      // If we already have data, we're done loading
      if (ordersWithSheet.length > 0) {
        setLoadingMediumSheetOrders(false);
      }
    }
  }, [selectedFoamSheet, activeTab]);

  // Add calculateOrderProgress function
  const calculateOrderProgress = (orderId: string): string => {
    const items = allOrderItems[orderId] || [];
    if (items.length === 0) return '0';
    const completedCount = items.filter(item => item.completed).length;
    return ((completedCount / items.length) * 100).toString();
  };

  // Fetch orders when the component mounts or when page changes
  useEffect(() => {
    const fetchOrders = async () => {
      try {
        await dispatch(fetchOrdersFromSupabase({
          page: currentPage,
          perPage: ordersPerPage,
          manufactured: false,
          status: "Pending",
          view: "manufacturing"
        }));
      } catch (error) {
        console.error('Error fetching orders:', error);
      }
    };

    fetchOrders();
  }, [dispatch, currentPage, ordersPerPage]);


  // Fetch finished_stock values for all SKUs on mount
  useEffect(() => {
    const fetchFinishedStock = async () => {
      const supabase = getSupabaseClient();
      const { data, error } = await supabase
        .from('finished_stock')
        .select('sku, stock');
      if (!error && data) {
        const stockMap: Record<string, number> = {};
        (data as any[]).forEach((item) => {
          if (typeof item.sku === 'string' && typeof item.stock === 'number') {
            stockMap[item.sku] = item.stock;
          }
        });
        setFinishedStockBySku(stockMap);
      }
    };
    fetchFinishedStock();
  }, []);

  // Update handleTriggerNesting to set the state
  const handleTriggerNesting = async () => {
    console.log('handleTriggerNesting');
    
    // Set loading state
    setIsNesting(true);
    setNestingLoading(true);
    
    try {
      // Get all orders with manufacturing items
      const manufacturingOrders = orders.filter((order: Order) => {
        const items = orderItemsById[order.order_id] || [];
        return items.some(item => item.sku_id.startsWith('SFI') && !item.completed);
      });

      // Create a map to store items by foam sheet
      const itemsByFoamSheet: Record<string, NestingItem[]> = {};

      // Process each order
      manufacturingOrders.forEach((order: Order) => {
        const items = orderItemsById[order.order_id] || [];
        
        // Filter for SFI items that aren't completed
        const manufacturingItems = items.filter(item => 
          item.sku_id.startsWith('SFI') && !item.completed
        );

        // Group items by foam sheet
        manufacturingItems.forEach(item => {
          if (!itemsByFoamSheet[item.foamsheet]) {
            itemsByFoamSheet[item.foamsheet] = [];
          }

          itemsByFoamSheet[item.foamsheet].push({
            sku: item.sku_id,
            itemName: item.item_name,
            quantity: item.quantity,
            orderId: order.order_id,
            customerName: order.customer_name,
            priority: item.priority,
            svgUrl: ['noMatch']
          });
        });
      });

      // Log the organized data
      console.log('Items have been organized by foam sheet');

      // Process each foam sheet's items to add SVG URLs and run nesting
      const processedItemsByFoamSheet: Record<string, ProcessedNestingData> = {};
      const nestingProcessor = new NestingProcessor();
      
      for (const [foamSheet, items] of Object.entries(itemsByFoamSheet)) {
        try {
          // First fetch SVGs
          const itemsWithSvgs = await fetchSvgFiles(items);
          
          // Then run nesting
          const nestingResult = await nestingProcessor.processNesting(itemsWithSvgs);
          
          // Store both items and nesting result
          processedItemsByFoamSheet[foamSheet] = {
            items: itemsWithSvgs,
            nestingResult: nestingResult
          };
        } catch (error) {
          console.error(`Error processing foam sheet ${foamSheet}:`, error);
          // If there's an error, use the original items with no nesting result
          processedItemsByFoamSheet[foamSheet] = {
            items: items.map(item => ({
            ...item,
            svgUrl: ['noMatch']
            })),
            nestingResult: null
          };
        }
      }

      // Set the state with the processed nesting queue data
      setNestingQueueData(processedItemsByFoamSheet as Record<string, ProcessedNestingData>);
      console.log('Processed nesting queue data with SVGs and nesting results:', processedItemsByFoamSheet);

      // Return the processed data
      return processedItemsByFoamSheet;
    } catch (error) {
      console.error('Error in handleTriggerNesting:', error);
    } finally {
      // Clear loading states
      setIsNesting(false);
      setNestingLoading(false);
    }
  }

  // Function that fetches the svg files from the storage bucket depending on the sku
  const fetchSvgFiles = async (itemsByFoamSheet: NestingItem[]) => {
    try {
      // List all SVG files in the bucket
      console.log('Attempting to list files from storage bucket...');
      const { data: svgList, error: svgListError } = await supabase.storage
        .from('inserts')
        .list('', { 
          limit: 1000,
          sortBy: { column: 'name', order: 'asc' }
        });
      
      if (svgListError) {
        console.error('Storage bucket error:', svgListError);
        throw svgListError;
      }

      // Get all SVG file names (without .svg), lowercased and trimmed
      const svgNames = (svgList || [])
        .filter(file => file.name.endsWith('.svg'))
        .map(file => file.name.replace(/\.svg$/, '').trim());

      // Process each item in itemsByFoamSheet
      const itemsWithSvg = itemsByFoamSheet.map(item => {
        const skuOriginal = String(item.sku);
        const sku = skuOriginal.toLowerCase().trim();
        // Remove last three characters from SKU for matching and convert to uppercase
        const shortenedSku = (sku.length > 3 ? sku.slice(0, -3) : sku).toUpperCase();
        
        // Find all SVGs that are a prefix of the shortened SKU
        const matchingSvgs = svgNames.filter(svgName => shortenedSku.startsWith(svgName));
        
        // Pick the longest prefix (most specific match)
        let matchedSvg = null;
        if (matchingSvgs.length > 0) {
          matchedSvg = matchingSvgs.reduce((a, b) => (a.length > b.length ? a : b));
        }

        let svgUrls: string[] = [];
        if (matchedSvg) {
          const { data: urlData } = supabase.storage
            .from('inserts')
            .getPublicUrl('/' + matchedSvg + '.svg');
          if (urlData?.publicUrl) {
            svgUrls.push(urlData.publicUrl);
          }
        } else {
          //No match, try trimmed version (first 8 characters of shortenedSku)
          const trimmedShortenedSku = shortenedSku.slice(0, -1);
          //Find all SVGs that start with the trimmed shortened SKU
          const partSvgs = svgNames.filter(svgName => svgName.startsWith(trimmedShortenedSku));
          if (partSvgs.length > 0) {
            partSvgs.forEach((svgName) => {
              const { data: urlData } = supabase.storage
                .from('inserts')
                .getPublicUrl('/' + svgName + '.svg');
              if (urlData?.publicUrl) {
                svgUrls.push(urlData.publicUrl);
              }
            });
          }
        }

        return {
          ...item,
          svgUrl: svgUrls.length > 0 ? svgUrls : ['noMatch']
        };
      });

      return itemsWithSvg;
    } catch (error) {
      console.error('Error fetching SVG files:', error);
      // Return original items with 'noMatch' for svgUrl
      return itemsByFoamSheet.map(item => ({
        ...item,
        svgUrl: ['noMatch']
      }));
    }
  }

  // Add this function to calculate total items for a foam sheet
  const calculateTotalItems = (items: NestingItem[]): number => {
    return items.reduce((total, item) => total + item.quantity, 0);
  };

  // Helper to calculate the area of a polygon
  function polygonArea(points: { x: number, y: number }[]): number {
    let area = 0;
    for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
      area += (points[j].x + points[i].x) * (points[j].y - points[i].y);
    }
    return Math.abs(area / 2);
  }

  // Update the table content in the first section
  const renderNestingQueueTable = () => {
    if (Object.keys(nestingQueueData).length === 0) {
      return (
        <tr>
          <td colSpan={6} className="px-6 py-10 text-center">
            <div className="flex flex-col items-center justify-center text-gray-800">
              <svg xmlns="http://www.w3.org/2000/svg" className="h-12 w-12 mb-3 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
              <p className="text-lg font-medium">No items in nesting queue</p>
              <p className="text-sm text-gray-500 mt-1">Click "Start Nesting" to process items</p>
            </div>
          </td>
        </tr>
      );
    }

    return Object.entries(nestingQueueData).map(([foamSheet, data], index) => {
      // Calculate the lowest priority from all items in this foam sheet
      const lowestPriority = Math.min(...data.items.map((item: NestingItem) => item.priority || 10));

      // --- Yield calculation ---
      // Always use the fallback bin polygon (standard foam sheet size)
      const binPolygon = [
        { x: 0, y: 0 },
        { x: 1000, y: 0 },
        { x: 1000, y: 2000 },
        { x: 0, y: 2000 },
        { x: 0, y: 0 }
      ];
      const binArea = polygonArea(binPolygon);
      // Get all placed parts (first sheet only)
      const placements = data.nestingResult?.placements?.[0]?.parts || [];
      const totalPartsArea = placements.reduce((sum, part) => {
        if (part.polygons && part.polygons[0]) {
          return sum + polygonArea(part.polygons[0]);
        }
        return sum;
      }, 0);
      const yieldPercent = binArea > 0 ? (totalPartsArea / binArea) * 100 : 0;
      // --- End yield calculation ---

      // --- Time calculation For Parts---
      // Each piece takes 1 min 45 sec (105 seconds)
      const totalPieces = calculateTotalItems(data.items);
      const totalSeconds = totalPieces * 105;
      const minutes = Math.floor(totalSeconds / 60);
      const seconds = totalSeconds % 60;
      const timeString = `${minutes}m ${seconds}s`;
      // --- End time calculation ---

      // --- Nesting ID ---
      const nestingId = `NST-${index + 1}`;
      // --- End Nesting ID ---

      // --- Lock state ---
      const isLocked = !!nestLocks[foamSheet];
      // --- End Lock state ---

      return (
        <tr
          key={foamSheet}
          onClick={() => {
            setSelectedNestingRow(foamSheet);
            setSelectedMediumSheet(formatMediumSheetName(foamSheet));
          }}
          className={`transition-colors duration-150 hover:bg-blue-50 cursor-pointer shadow-sm ${
            selectedNestingRow === foamSheet 
              ? 'bg-blue-200 border-l-4 border-blue-500' 
              : index % 2 === 0 ? 'bg-white' : 'bg-gray-50'
          }`}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              setSelectedNestingRow(foamSheet);
              setSelectedMediumSheet(formatMediumSheetName(foamSheet));
            }
          }}
          aria-selected={selectedNestingRow === foamSheet}
        >
          <td className="px-6 py-4 text-left">
            <div className="flex items-center justify-center">
              <div className={`w-4 h-4 rounded-full mr-3 ${getSheetColorClass(formatMediumSheetName(foamSheet))}`}></div>
              <span className="text-black text-lg">
                {formatMediumSheetName(foamSheet)}
              </span>
            </div>
          </td>
          <td className="px-6 py-4 text-center">{nestingId}</td>
          <td className="px-6 py-4 text-center">
            <span className="inline-flex items-center justify-center min-w-[2.5rem] px-3 py-1 shadow-sm rounded-full text-lg text-black">
              {totalPieces}
            </span>
          </td>
          {/* <td className="px-6 py-4 text-center text-lg font-semibold text-black">
            {lowestPriority}
          </td> */}
          <td className="px-6 py-4 text-center">
            {yieldPercent > 0 ? `${yieldPercent.toFixed(1)}%` : '—'}
          </td>
          <td className="px-6 py-4 text-center">{timeString}</td>
           {/* Lock icon column */}
           <td className="px-6 py-4 text-center">
            <button
              type="button"
              aria-label={isLocked ? 'Unlock nest' : 'Lock nest'}
              onClick={e => {
                e.stopPropagation();
                setNestLocks(prev => ({ ...prev, [foamSheet]: !isLocked }));
              }}
              className="focus:outline-none"
            >
              {isLocked ? (
                // Locked icon
                <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                  <rect x="5" y="11" width="14" height="8" rx="2" fill="#e5e7eb" stroke="#374151" />
                  <path d="M7 11V7a5 5 0 0110 0v4" stroke="#374151" strokeWidth="2" fill="none" />
                  <circle cx="12" cy="15" r="1.5" fill="#374151" />
                </svg>
              ) : (
                // Unlocked icon
                <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                  <rect x="5" y="11" width="14" height="8" rx="2" fill="#e5e7eb" stroke="#374151" />
                  <path d="M7 11V7a5 5 0 0110 0" stroke="#374151" strokeWidth="2" fill="none" />
                  <circle cx="12" cy="15" r="1.5" fill="#374151" />
                </svg>
              )}
            </button>
          </td>
        </tr>
      );
    });
  };

  // Function to calculate bounding box for the polygon
  function getBoundingBox(points: { x: number, y: number}[]) {
    const xs = points.map(p => p.x);
    const ys = points.map(p => p.y);

    return{
      minX: Math.min(...xs),
      maxX: Math.max(...xs),
      minY: Math.min(...ys),
      maxY: Math.max(...ys),
    };
  }

  const handleConfirmMediumSheet = async () => {
    if (!selectedFoamSheet) return;

    // Get all orders with this medium sheet
    const ordersWithSheet = allOrders.filter(order => {
      const items = allOrderItems[order.order_id] || [];
      return items.some(item => item.sku_id === selectedFoamSheet && !item.completed);
    });
  
    // Arrays to store order IDs based on their status
    const orderIdsForPacking: string[] = [];
    const orderIdsForMarkCompleted: string[] = [];
  
    for (const order of ordersWithSheet) {
      const orderItems = allOrderItems[order.order_id] || [];
      const manufacturingItems = orderItems.filter(item =>
        (item.sku_id.startsWith('SFI') ||
          item.sku_id.startsWith('SFC') ||
          item.sku_id.startsWith('SFS')) &&
        !item.completed
      );
      const mediumSheetItems = orderItems.filter(item =>
        item.sku_id === selectedFoamSheet && !item.completed
      );
  
      const isOnlyManufacturingItem = manufacturingItems.length === mediumSheetItems.length;
      const isLastManufacturingItem =
        manufacturingItems.every(item =>
          mediumSheetItems.some(mediumItem => mediumItem.id === item.id)
        );
  
      if (isOnlyManufacturingItem || isLastManufacturingItem) {
        orderIdsForPacking.push(order.order_id);
      } else {
        orderIdsForMarkCompleted.push(order.order_id);
      }
    }
  
    // Process orders to be moved to packing
    for (const orderId of orderIdsForPacking) {
      await dispatch(updateOrderManufacturedStatus({ orderId, manufactured: true }));
    }
  
    // Process orders where only the medium sheet item should be marked as completed
    for (const orderId of orderIdsForMarkCompleted) {
      const orderItems = allOrderItems[orderId] || [];
      const mediumSheetItems = orderItems.filter(item =>
        item.sku_id === selectedFoamSheet && !item.completed
      );
      for (const item of mediumSheetItems) {
        await dispatch(updateItemCompleted({
          orderId,
          itemId: item.id,
          completed: true
        }));
      }
    }
  
    // Optionally, refresh orders or show a notification
    await dispatch(fetchOrdersFromSupabase({
      page: currentPage,
      perPage: ordersPerPage,
      manufactured: false,
      packed: false,
      status: "Pending",
      view: 'manufacturing'
    }));

    // Debugging logs
    if (selectedFoamSheet) {
      const currentStock = finishedStockBySku[selectedFoamSheet] ?? 0;
      const qty = selectedMediumSheetQuantity || 0;
      const totalToCut = (() => {
        const needed = Math.max(0, qty - currentStock);
        let adjusted = needed;
        if (needed > 0 && needed % 4 !== 0) {
          adjusted = Math.ceil(needed / 4) * 4;
        }
        return adjusted;
      })();
      const newStockValue = currentStock + totalToCut - qty;
      console.log(`[DEBUG] New stock value for medium sheet '${selectedFoamSheet}':`, newStockValue);

      // Update the stock in Supabase
      const supabase = getSupabaseClient();
      const { error: stockUpdateError } = await supabase
        .from('finished_stock')
        .update({ stock: newStockValue })
        .eq('sku', selectedFoamSheet);
      if (stockUpdateError) {
        console.error(`[ERROR] Failed to update stock for medium sheet '${selectedFoamSheet}':`, stockUpdateError);
      } else {
        console.log(`[DEBUG] Stock for medium sheet '${selectedFoamSheet}' updated in database to:`, newStockValue);
      }

      // Update local state if setFinishedStockBySku is available
      if (typeof setFinishedStockBySku === 'function') {
        setFinishedStockBySku((prev: Record<string, number>) => ({
          ...prev,
          [selectedFoamSheet]: newStockValue
        }));
        console.log(`[DEBUG] Local finishedStockBySku updated for '${selectedFoamSheet}' to:`, newStockValue);
      }
    }

    // Log completed value for each updated order item
    for (const orderId of orderIdsToMarkCompleted) {
      const orderItems = allOrderItems[orderId] || [];
      const mediumSheetItems = orderItems.filter(item =>
        item.sku_id === selectedFoamSheet && !item.completed
      );
      for (const item of mediumSheetItems) {
        console.log(`[DEBUG] Order item completed: orderId=${orderId}, itemId=${item.id}, completed=true`);
      }
    }

    // Log manufactured value for each order
    for (const orderId of orderIdsToPacking) {
      console.log(`[DEBUG] Order manufactured: orderId=${orderId}, manufactured=true`);
      // Log all items in this order with sku starting with SFS
      const orderItems = allOrderItems[orderId] || [];
      const sfsItems = orderItems.filter(item => item.sku_id.startsWith('SFS'));
      sfsItems.forEach(item => {
        console.log(`[DEBUG] SFS item in order: orderId=${orderId}, itemId=${item.id}, sku=${item.sku_id}, completed=${item.completed}`);
      });
    }

    // After all processing and debug logs, reset the state for Medium Sheet Order Details section
    setCurrentMediumStock(0);
    setSelectedMediumSheetQuantity(0);
    setSelectedFoamSheet(null);
  }

  // Update the table in the first section to show nesting queue data
  return (
    <div className="min-h-screen">
      <Navbar />

      {/**Pill Section*/}
      <div className="container mx-auto pt-28 flex justify-center gap-8">
        <div className="flex justify-center">
          <div className="relative bg-[#2b3544] rounded-full shadow-xl p-1 inline-flex border border-gray-700 w-[360px]">
            {/* Sliding background that moves based on active tab */}
            <div className={`sliding-pill ${activeTab === 'orders' ? 'pill-first' : 'pill-second'}`}></div>

            {/* Orders Queue Tab */}
            <button
              onClick={async () => {
                await Sentry.startSpan({
                  name: 'setActiveTab-Orders',
                }, async () => {
                  setActiveTab('orders');
                });
              }}
              className="relative rounded-full font-medium transition-all duration-300 z-10 flex-1 py-2 px-3"
            >
              <span className={`relative z-10 flex items-center justify-center gap-1.5 whitespace-nowrap ${activeTab === 'orders' ? 'text-white font-semibold' : 'text-gray-300 hover:text-white'
                }`}>
                <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M14.121 14.121L19 19m-7-7l7-7m-7 7l-2.879 2.879M12 12L9.121 9.121m0 5.758a3 3 0 10-4.243-4.243 3 3 0 004.243 4.243z" />
                </svg>
                CNC
              </span>
            </button>

            {/* Medium Sheets Tab */}
            <button
              onClick={async () => {
                await Sentry.startSpan({
                  name: 'setActiveTab-MediumSheets',
                }, async () => {
                  setActiveTab('medium');
                  // If there's a selected foam sheet, refresh its orders
                  if (selectedFoamSheet) {
                    setLoadingMediumSheetOrders(true);
                    // Clear cache to force refresh
                    setOrdersWithMediumSheets(prev => {
                      const newState = { ...prev };
                      if (selectedFoamSheet in newState) {
                        delete newState[selectedFoamSheet];
                      }
                      return newState;
                    });
                    // Trigger refresh by calling findOrdersWithMediumSheet
                    findOrdersWithMediumSheet(selectedFoamSheet);
                  }
                });
              }}
              className="relative rounded-full font-medium transition-all duration-300 z-10 flex-1 py-2 px-3"
            >
              <span className={`relative z-10 flex items-center justify-center gap-1.5 whitespace-nowrap ${activeTab === 'medium' ? 'text-white font-semibold' : 'text-gray-300 hover:text-white'}`}>
                <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
                Medium Sheets
              </span>
            </button>
          </div>
        </div>
      </div>

      {/* CNC Tab Active Section */}
      {activeTab === 'orders' && (
        <div className="w-full flex justify-center pt-10 mb-8 px-4 min-h-[calc(100vh-300px)]">
          <div className="flex flex-col lg:flex-row gap-6 max-w-[2800px] w-full justify-center">
            {/* First Column Section */}
            <div className="flex-[1.2] min-w-0 max-w-[870px] flex flex-col bg-[#1d1d1d]/90 rounded-xl shadow-xl">
              {/* Orders Queue content (move your Orders Queue JSX here) */}
              <div className="bg-[#1d1d1d]/90 rounded-t-lg backdrop-blur-sm p-4">
                <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
                  <h1 className="text-2xl font-bold text-white">
                    {firstColTab === 'Orders Queue' && 'Orders Queue'}
                    {firstColTab === 'Nesting Queue' && 'Nesting Queue'}
                    {firstColTab === 'Completed Cuts' && 'Completed Cuts'}
                    {firstColTab === 'Work In Progress' && 'Work In Progress'}
                  </h1>

                  <div className="flex flex-wrap items-center gap-3">
                    <div className="flex items-center gap-4">
                      {/** Refresh Button */}
                      <button
                        onClick={async () => Sentry.startSpan({
                          name: 'handleRefresh-Orders',
                        }, async () => {
                          handleRefresh();
                        })}
                        className={`flex items-center gap-2 px-3.5 py-2 text-white font-medium rounded-lg transition-all duration-300 bg-gradient-to-br from-gray-700 to-gray-800 hover:from-gray-600 hover:to-gray-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-gray-500 shadow-md hover:shadow-lg disabled:opacity-70 disabled:cursor-not-allowed`}
                        disabled={isRefreshing}
                        aria-label={isRefreshing ? "Syncing orders in progress" : "Refresh orders list"}
                      >
                        <span className={`${isRefreshing ? "animate-spin" : ""} text-red-400`}>
                          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8" />
                            <path d="M21 3v5h-5" />
                            <path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16" />
                            <path d="M8 16H3v5" />
                          </svg>
                        </span>
                        <span>{isRefreshing ? "Syncing..." : "Refresh"}</span>
                      </button>
                      {/** Export CSV Button */}
                      <button
                        onClick={async () => Sentry.startSpan({
                          name: 'handleExportCSV-Orders',
                        }, async () => {
                          handleExportCSV();
                        })}
                        className={`flex items-center gap-2 px-3.5 py-2 text-white font-medium rounded-lg transition-all duration-300 bg-gradient-to-br from-green-600 to-green-700 hover:from-green-500 hover:to-green-600 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-green-500 shadow-md hover:shadow-lg disabled:opacity-70 disabled:cursor-not-allowed`}
                        disabled={isExporting || orders.length === 0}
                        aria-label={isExporting ? "Exporting orders..." : "Export orders to CSV"}
                      >
                        <span className={`${isExporting ? "animate-spin" : ""} text-white`}>
                          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                            <polyline points="7 10 12 15 17 10" />
                            <line x1="12" y1="15" x2="12" y2="3" />
                          </svg>
                        </span>
                        <span>{isExporting ? "Exporting..." : "Export CSV"}</span>
                      </button>
                      {/** Nesting Button */}
                      <button
                        onClick={async () => Sentry.startSpan({
                          name: 'handleTriggerNesting-Orders',
                        }, async () => {
                          handleTriggerNesting();
                        })}
                        className={`flex items-center gap-2 px-3.5 py-2 text-white font-medium rounded-lg transition-all duration-300 bg-gradient-to-br from-purple-600 to-purple-700 hover:from-purple-500 hover:to-purple-600 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-purple-500 shadow-md hover:shadow-lg disabled:opacity-70 disabled:cursor-not-allowed`}
                        disabled={isNesting || orders.length === 0}
                        aria-label={isNesting ? "Processing nesting..." : "Start Nesting"}
                      >
                        <span className={`${isNesting ? "animate-spin" : ""} text-white`}>
                          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <circle cx="12" cy="12" r="3" />
                            <path d="M12 3v3" />
                            <path d="M12 18v3" />
                            <path d="M3 12h3" />
                            <path d="M18 12h3" />
                            <path d="M4.93 4.93l2.12 2.12" />
                            <path d="M16.95 16.95l2.12 2.12" />
                            <path d="M4.93 19.07l2.12-2.12" />
                            <path d="M16.95 7.05l2.12-2.12" />
                          </svg>
                        </span>
                        <span>{isNesting ? "Processing..." : "Start Nesting"}</span>
                      </button>
                    </div>
                  </div>
                </div>
                {/* Navigation Tabs */}
                <div className="mt-4 mb-2">
                  <div className="">
                    <button
                      className={`px-4 py-2 text-md font-medium ${firstColTab === 'Orders Queue' ? 'text-white border-b-2 border-white' : 'text-gray-500 border-b-2 border-transparent'} bg-transparent focus:outline-none`}
                      style={{ marginBottom: '-1px' }}
                      onClick={() => handleFirstColTabChange('Orders Queue')}
                    >
                      Orders Queue
                    </button>
                    <button
                      className={`px-4 py-2 text-md font-bold ${firstColTab === 'Nesting Queue' ? 'text-white border-b-2 border-white' : 'text-gray-500 border-b-2 border-transparent'} bg-transparent focus:outline-none ${isOperatorRole ? 'opacity-50 cursor-not-allowed pointer-events-none' : ''}`}
                      style={{ marginBottom: '-1px' }}
                      onClick={() => handleFirstColTabChange('Nesting Queue')}
                      disabled={isOperatorRole}
                      aria-disabled={isOperatorRole}
                    >
                      Nesting Queue
                    </button>
                    <button
                      className={`px-4 py-2 text-md font-medium ${firstColTab === 'Completed Cuts' ? 'text-white border-b-2 border-white' : 'text-gray-500 border-b-2 border-transparent'} bg-transparent focus:outline-none ${isOperatorRole ? 'opacity-50 cursor-not-allowed pointer-events-none' : ''}`}
                      style={{ marginBottom: '-1px' }}
                      onClick={() => handleFirstColTabChange('Completed Cuts')}
                      disabled={isOperatorRole}
                      aria-disabled={isOperatorRole}
                    >
                      Completed Cuts
                    </button>
                    <button
                      className={`px-4 py-2 text-md font-medium ${firstColTab === 'Work In Progress' ? 'text-white border-b-2 border-white' : 'text-gray-500 border-b-2 border-transparent'} bg-transparent focus:outline-none ${isOperatorRole ? 'opacity-50 cursor-not-allowed pointer-events-none' : ''}`}
                      style={{ marginBottom: '-1px' }}
                      onClick={() => handleFirstColTabChange('Work In Progress')}
                      disabled={isOperatorRole}
                      aria-disabled={isOperatorRole}
                    >
                      Work In Progress
                    </button>
                  </div>
                </div>
              </div>
              <div className="overflow-x-auto bg-white h-[calc(93vh-300px)] flex flex-col">
                {firstColTab == 'Nesting Queue' ? (
                  <div className="flex-1 flex flex-col items-center justify-center bg-gray-50 p-2">
                    <table className="w-full bg-white/90 backdrop-blur-sm table-auto h-full">
                    <thead className="bg-gray-100/90 sticky top-0">
                        <tr>
                          <th className="px-6 py-4 text-center text-lg font-semibold text-black">Foam Sheet</th>
                          <th className="px-6 py-4 text-center text-lg font-semibold text-black">Nesting ID</th>
                          <th className="px-6 py-4 text-center text-lg font-semibold text-black">Pieces</th>
                          {/* <th className="px-6 py-4 text-center text-lg font-semibold text-black">Priority</th> */}
                          <th className="px-6 py-4 text-center text-lg font-semibold text-black">Yield</th>
                          <th className="px-6 py-4 text-center text-lg font-semibold text-black">Time</th>
                          <th className="px-6 py-4 text-center text-lg font-semibold text-black">Lock</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-200">
                        {renderNestingQueueTable()}
                      </tbody>
                    </table>
                  </div>
                ) : firstColTab == "Completed Cuts" ? (
                  <div className= "flex-1 flex flex-col items-center justify-center bg-gray-50 p-2">
                    <table className="w-full bg-white/90 backdrop-blur-sm table-auto h-full">
                      <thead className="bg-gray-100/90 sticky top-0">
                        <tr>
                          <th className="px-6 py-4 text-center text-lg font-semibold text-black">Foam Sheet</th>
                          <th className="px-6 py-4 text-center text-lg font-semibold text-black">Nesting ID</th>
                          <th className="px-6 py-4 text-center text-lg font-semibold text-black">Pieces</th>
                          <th className="px-6 py-4 text-center text-lg font-semibold text-black">Yield</th>
                        </tr>
                      </thead>
                      <tbody>
                        <td colSpan={6} className="px-6 py-10 text-center">
                          <div className="flex flex-col items-center justify-center text-gray-800">
                            <svg xmlns="http://www.w3.org/2000/svg" className="h-12 w-12 mb-3 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                            </svg>
                              <p className="text-lg font-medium">No completed cuts found</p>
                              <p className="text-sm text-gray-500 mt-1">Mark nests as completed in the nesting queue to see them here.</p>
                          </div>
                        </td>
                      </tbody>
                    </table>
                  </div>
                  
                ) : firstColTab == "Work In Progress" ? (
                  <div className="flex-1 flex flex-col items-center justify-center bg-gray-50 p-2">
                    <table className="w-full bg-white/90 backdrop-blur-sm table-auto h-full">
                      <thead className="bg-gray-100/90 sticky top-0">
                        <tr>
                          <th className = "px-6 py-4 text-center text-lg font-semibold text-black">Order ID</th>
                          <th className = "px-6 py-4 text-center text-lg font-semibold text-black">Order Date</th>
                          <th className = "px-6 py-4 text-center text-lg font-semibold text-black"> Trolley</th>
                          <th className = "px-6 py-4 text-center text-lg font-semibold text-black">Priority</th>
                          <th className = "px-6 py-4 text-center text-lg font-semibold text-black"></th>
                        </tr>
                      </thead>
                      <tbody>
                        <td colSpan={6} className="px-6 py-10 text-center">
                          <div className="flex flex-col items-center justify-center text-gray-800">
                            <svg xmlns="http://www.w3.org/2000/svg" className="h-12 w-12 mb-3 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                            </svg>
                            <p className="text-lg font-medium">No work in progress orders available</p>
                            <p className="text-sm text-gray-500 mt-1">Mark orders as manufactured in the orders queue to see them here.</p>
                          </div>
                        </td>
                      </tbody>
                    </table>
                  </div>
                ) : loading ? (
                  <div className="flex-1 flex flex-col items-center justify-center bg-gray-50 p-6">
                    <div className="w-12 h-12 rounded-full border-4 border-gray-300 border-t-blue-600 animate-spin mb-4"></div>
                    <p className="text-gray-700 font-medium">Loading orders...</p>
                    <p className="text-gray-500 text-sm mt-1">Retrieving data from database</p>
                  </div>
                ) : error ? (
                  <div className="text-center py-4">
                    <p className="text-red-500">{error}</p>
                    <button
                      onClick={async () => {
                        await Sentry.startSpan({
                          name: 'handleRefresh-Orders2',
                        }, async () => {
                          handleRefresh();
                        })
                      }}
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
                            <th className="px-4 py-4 text-center text-black text-md">Order ID</th>
                            <th className="px-4 py-2 text-center text-black text-md whitespace-nowrap">
                              Customer Name
                            </th>
                            <th className="px-4 py-2 text-center text-black text-md">Priority</th>
                            <th className="px-4 py-2 text-center text-black text-md whitespace-nowrap">
                              Order Date
                            </th>
                            <th className="px-4 py-2 text-center text-black text-md">Progress</th>
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
                              return (
                                <tr
                                  key={order.order_id}
                                  ref={order.order_id === selectedOrderId ? selectedRowRef : null}
                                  className={`transition-all duration-200 cursor-pointer text-center h-[calc((100vh-300px-48px)/15)] ${order.order_id === selectedOrderId
                                      ? "bg-blue-200/90 border-l-4 border-blue-500 shadow-md"
                                      : "hover:bg-gray-100/90 hover:border-l-4 hover:border-gray-300"
                                    }`}
                                  onClick={async () => {
                                    await Sentry.startSpan({
                                      name: 'handleRowOrderClick-Manufacturing',
                                    }, async () => {
                                      handleOrderClick(order.order_id);
                                    })
                                  }}
                                >
                                  <td className="px-4 py-2 text-black">{order.order_id}</td>
                                  <td className="px-4 py-2 text-black">{order.customer_name}</td>
                                  <td className="px-4 py-2 text-black">
                                    {(() => {
                                      const items = orderItemsById[order.order_id] || [];
                                      const filteredItems = filterItemsBySku(items);

                                      if (filteredItems.length === 0) return 'N/A';

                                      return 'calculatedPriority' in order
                                        ? (order as OrderWithPriority).calculatedPriority
                                        : Math.max(...filteredItems.map(item => item.priority || 0));
                                    })()}
                                  </td>
                                  <td className="px-4 py-2 text-black">
                                    {new Date(order.order_date).toLocaleDateString("en-GB")}
                                  </td>
                                  <td className="px-4 py-2 text-black">{filteredOrderProgress[order.order_id]}</td>
                                </tr>
                              );
                            })
                          )}
                        </tbody>
                      </table>
                    </div>
                    <div className="flex justify-between items-center bg-white/90 backdrop-blur-sm p-4 border border-gray-200">
                      <div className="text-sm text-gray-600">
                        Showing {(currentPage - 1) * ordersPerPage + 1} to{" "}
                        {Math.min(currentPage * ordersPerPage, totalOrders)} of {totalOrders}{" "}
                        pending orders
                      </div>
                      <div className="flex gap-2">
                        <button
                          onClick={async () => {
                            await Sentry.startSpan({
                              name: 'manufacturingPageChange-Previous',
                            }, async () => {
                              handlePageChange(currentPage - 1);
                            })
                          }}
                          disabled={currentPage === 1}
                          className="px-3 py-1 rounded bg-gray-200 text-gray-700 disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          Previous
                        </button>
                        <span className="px-3 py-1 text-gray-600">
                          Page {currentPage} of {totalPages}
                        </span>
                        <button
                          onClick={async () => {
                            await Sentry.startSpan({
                              name: 'manufacturingPageChange-Next',
                            }, async () => {
                              handlePageChange(currentPage + 1);
                            })
                          }}
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
            {/* Nesting Visualization Section */}
            {firstColTab !== 'Orders Queue' && firstColTab !== 'Work In Progress' && (
              <div className="flex-1 min-w-0 max-w-96 flex flex-col bg-black/70 rounded-xl shadow-xl p-3">
                {/** Nesting Visualization Title */}
                <div className="rounded-t-lg">
                  <h1 className="text-2xl font-bold text-white p-4 flex justify-center">
                    Nesting Visualization
                  </h1>
                </div>
                <div className="h-full overflow-y-auto">
                  {nestingLoading ? (
                    <div className="flex flex-col items-center justify-center h-full text-gray-400">
                      <div className="w-12 h-12 rounded-full border-4 border-gray-600 border-t-purple-500 animate-spin mb-4"></div>
                      <p className="text-lg font-medium">Processing Nesting...</p>
                      <p className="text-sm mt-1">Calculating optimal cuts and generating visualization</p>
                    </div>
                  ) : selectedNestingRow ? (
                    (() => {
                      // Get all parts for the current placement
                      const allParts = nestingQueueData[selectedNestingRow as string].nestingResult?.placements.flatMap((placement: NestingPlacement) => placement.parts) || [];
                      // Gather all points after translation/rotation
                      let allPoints: { x: number, y: number }[] = [];
                      allParts.forEach((part: NestingPart) => {
                        if (part.polygons && part.polygons[0]) {
                          const angle = (part.rotation || 0) * Math.PI / 180;
                          const cos = Math.cos(angle);
                          const sin = Math.sin(angle);
                          part.polygons[0].forEach(pt => {
                            const x = pt.x * cos - pt.y * sin + (part.x || 0);
                            const y = pt.x * sin + pt.y * cos + (part.y || 0);
                            allPoints.push({ x, y });
                          });
                        }
                      });
                      const PADDING = 10; // 10mm padding
                      const VIEWBOX_WIDTH = 1000 + 2 * PADDING; // mm
                      const VIEWBOX_HEIGHT = 2000 + 2 * PADDING; // mm
                      const viewBox = `0 0 ${VIEWBOX_WIDTH} ${VIEWBOX_HEIGHT}`;
                      // Compute bounding box of all points
                      let minX = Math.min(...allPoints.map(p => p.x));
                      let minY = Math.min(...allPoints.map(p => p.y));
                      let maxX = Math.max(...allPoints.map(p => p.x));
                      let maxY = Math.max(...allPoints.map(p => p.y));
                      // Compute scale to fit portrait viewBox
                      const polyWidth = maxX - minX;
                      const polyHeight = maxY - minY;
                      const scale = Math.min(
                        VIEWBOX_WIDTH / polyWidth,
                        VIEWBOX_HEIGHT / polyHeight
                      );
                      // Compute translation to center polygons in the viewBox
                      const offsetX = (VIEWBOX_WIDTH - polyWidth * scale) / 2 - minX * scale;
                      const offsetY = (VIEWBOX_HEIGHT - polyHeight * scale) / 2 - minY * scale;
                      return (
                        <div ref={svgContainerRef} style={{ position: 'relative', width: '100%', height: '100%' }}>
                          <svg
                            ref={svgRef}
                            width="100%"
                            height="100%"
                            viewBox={viewBox}
                            style={{ background: '#18181b', borderRadius: 12, width: '100%', height: '100%' }}
                          >
                            {/* Render algorithm binPolygon as a green background if available */}
                            {(() => {
                              // Try to get the actual binPolygon from the nesting result
                              const placements = nestingQueueData[selectedNestingRow as string]?.nestingResult?.placements;
                              const binPoly = placements && placements.length > 0 && placements[0].binPolygon
                                ? placements[0].binPolygon
                                : null;
                              // Fallback to config binPolygon
                              const fallbackBin = [
                                { x: PADDING, y: PADDING },
                                { x: 1000 + PADDING, y: PADDING },
                                { x: 1000 + PADDING, y: 2000 + PADDING },
                                { x: PADDING, y: 2000 + PADDING },
                                { x: PADDING, y: PADDING }
                              ];
                              const poly = binPoly && Array.isArray(binPoly) && binPoly.length >= 4 ? binPoly : fallbackBin;
                              const pointsStr = poly.map(pt => `${pt.x},${pt.y}`).join(' ');
                              return (
                                <polygon
                                  points={pointsStr}
                                  fill="green"
                                  opacity="0.2"
                                />
                              );
                            })()}
                            <g transform={`scale(1,-1) translate(0, -${VIEWBOX_HEIGHT})`}>
                              {nestingQueueData[selectedNestingRow as string].nestingResult?.placements.map((placement: NestingPlacement, placementIndex: number) => (
                                <g key={placementIndex}>
                                  {placement.parts.map((part: NestingPart, partIndex: number) => {
                                    if (!part.polygons || !part.polygons[0]) return null;
                                    // Find the order index for this part's orderId in uniqueOrders
                                    const uniqueOrders = (() => {
                                      const items = nestingQueueData[selectedNestingRow as string]?.items || [];
                                      const grouped = items.reduce((acc: Record<string, { orderId: string; customerName: string; items: NestingItem[] }>, item: NestingItem) => {
                                        const key = `${item.orderId}-${item.customerName}`;
                                        if (!acc[key]) {
                                          acc[key] = { orderId: item.orderId, customerName: item.customerName, items: [] };
                                        }
                                        acc[key].items.push(item);
                                        return acc;
                                      }, {});
                                      return Object.values(grouped);
                                    })();
                                    const orderIndex = uniqueOrders.findIndex(o => o.orderId === part.orderId);
                                    const fillColor = getOrderColor(part.orderId || '', orderIndex);
                                    // Scale and center each polygon
                                    const pointsArr = part.polygons[0].map(pt => {
                                      const angle = (part.rotation || 0) * Math.PI / 180;
                                      const cos = Math.cos(angle);
                                      const sin = Math.sin(angle);
                                      let x = pt.x * cos - pt.y * sin + (part.x || 0) + PADDING;
                                      let y = pt.x * sin + pt.y * cos + (part.y || 0) + PADDING;
                                      return { x, y };
                                    });
                                    const points = pointsArr.map(pt => `${pt.x},${pt.y}`).join(' ');
                                    // Unique key for this part
                                    const partKey = `${part.orderId || ''}-${partIndex}`;
                                    // Centroid for tooltip
                                    const centroid = getPolygonCentroid(pointsArr);
                                    return (
                                      <>
                                        <polygon
                                          key={partIndex}
                                          points={points}
                                          fill={fillColor}
                                          fillOpacity={0.7}
                                          stroke="#fff"
                                          strokeWidth="2"
                                          style={{ cursor: 'pointer' }}
                                          onMouseEnter={() => setHoveredInsert({ partKey, mouseX: centroid.x, mouseY: centroid.y })}
                                          onMouseMove={() => setHoveredInsert({ partKey, mouseX: centroid.x, mouseY: centroid.y })}
                                          onMouseLeave={e => {
                                            if (!(e.relatedTarget && (e.relatedTarget as HTMLElement).classList.contains('insert-tooltip'))) {
                                              setHoveredInsert(null);
                                            }
                                          }}
                                        />
                                        <text
                                          x={centroid.x}
                                          y={centroid.y}
                                          textAnchor="middle"
                                          dominantBaseline="middle"
                                          fontSize={`${40 * scale}px`}
                                          fill='#fff'
                                          fontWeight='bold'
                                          pointerEvents='none'
                                          transform={`scale(1,-1) translate(0, -${2 * centroid.y})`}
                                        >
                                          {orderIndex + 1}
                                        </text>
                                      </>
                                    );
                                  })}
                                </g>
                              ))}
                            </g>
                          </svg>
                          {/* Tooltip overlay for hovered insert */}
                          {hoveredInsert && svgRef.current && svgContainerRef.current && (() => {
                            const tooltipWidth = 140;
                            const tooltipHeight = 44;
                            const svgRect = svgRef.current.getBoundingClientRect();
                            const containerRect = svgContainerRef.current.getBoundingClientRect();
                            const vb = svgRef.current.viewBox.baseVal;
                            const scaleX = svgRect.width / vb.width;
                            const scaleY = svgRect.height / vb.height;
                            // Flip y for tooltip
                            const pixelX = hoveredInsert.mouseX * scaleX;
                            const pixelY = (VIEWBOX_HEIGHT - hoveredInsert.mouseY) * scaleY;
                            let left = pixelX - tooltipWidth / 2;
                            let top = pixelY - tooltipHeight - 12;
                            left = Math.max(0, Math.min(left, svgRect.width - tooltipWidth));
                            top = Math.max(0, Math.min(top, svgRect.height - tooltipHeight));
                            return (
                              <div
                                className="insert-tooltip"
                                style={{
                                  position: 'absolute',
                                  left: left,
                                  top: top,
                                  zIndex: 10,
                                  pointerEvents: 'auto',
                                  width: tooltipWidth,
                                  minHeight: tooltipHeight,
                                  background: 'rgba(30,30,30,0.98)',
                                  color: '#fff',
                                  borderRadius: 8,
                                  padding: '10px 18px',
                                  boxShadow: '0 2px 12px rgba(0,0,0,0.35)',
                                  fontSize: 15,
                                  display: 'flex',
                                  alignItems: 'center',
                                  gap: 10,
                                  minWidth: 120,
                                  transition: 'opacity 0.15s',
                                }}
                                onMouseEnter={() => setHoveredInsert(hoveredInsert)}
                                onMouseLeave={() => setHoveredInsert(null)}
                              >
                                <span>Damaged?</span>
                                <input
                                  type="checkbox"
                                  checked={!!damagedInserts[hoveredInsert.partKey]}
                                  onChange={e => setDamagedInserts(prev => ({ ...prev, [hoveredInsert.partKey]: e.target.checked }))}
                                  style={{
                                    accentColor: '#F44336',
                                    width: 18,
                                    height: 18,
                                    borderRadius: 4,
                                    border: '2px solid #fff',
                                    background: '#222',
                                    cursor: 'pointer',
                                  }}
                                />
                              </div>
                            );
                          })()}
                        </div>
                      );
                    })()
                  ) : (
                    <div className="flex flex-col items-center justify-center h-full text-gray-400">
                      <svg xmlns="http://www.w3.org/2000/svg" className="h-12 w-12 mb-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                      </svg>
                      <p className="text-lg font-medium">No nest selected</p>
                      <p className="text-sm mt-1">Select a nest from the nesting queue to view its visualization</p>
                    </div>
                  )}
                </div>
              </div>
            )}
            {/* Third Column Section */}
            <div className="flex-[1.2] min-w-0 max-w-[700px] flex flex-col bg-black/70 rounded-xl shadow-xl">
              <div className="bg-black/70 rounded-t-lg">
                <h1 className="text-2xl font-bold text-white p-4 flex justify-center">
                  {firstColTab === 'Orders Queue' && 'Order Details'}
                  {firstColTab === 'Nesting Queue' && 'Cut Details'}
                  {firstColTab === 'Completed Cuts' && 'Cut Details'}
                  {firstColTab === 'Work In Progress' && 'Order Details'}
                </h1>
              </div>
              <div className="bg-black/70 border border-gray-200 p-6 h-[calc(100vh-300px)] overflow-y-auto">
                {firstColTab === 'Nesting Queue' ? (
                  <div className="overflow-x-auto h-full flex flex-col bg-black/70 rounded-xl shadow-xl">
                    <table className="w-full text-white border-separate border-spacing-y-2">
                      <thead>
                        <tr>
                          <th className="px-6 py-3 text-center text-lg font-semibold text-white underline"> </th>
                          <th className="px-6 py-3 text-center text-lg font-semibold text-white underline">Customer Name</th>
                          <th className="px-6 py-3 text-center text-lg font-semibold text-white underline">Order ID</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(() => {
                          // Get the selected foam sheet from the nesting queue table
                          const selectedFoamSheet = Object.keys(nestingQueueData).find(sheet => 
                            formatMediumSheetName(sheet) === selectedMediumSheet
                          );

                          if (!selectedFoamSheet || !nestingQueueData[selectedFoamSheet]) {
                            return (
                              <tr>
                                <td colSpan={3} className="px-6 py-4 text-center text-lg font-semibold text-white h-[calc(100vh-500px)]">
                                  <div className="flex items-center justify-center h-full">
                                    <p className="text-white text-lg">No nest selected. Please choose a nest from the nesting queue.</p>
                                  </div>
                                </td>
                              </tr>
                            );
                          }

                          // Get items for the selected foam sheet
                          const items = nestingQueueData[selectedFoamSheet];

                          // Group items by order ID and customer name
                          const groupedItems = items.items.reduce((acc: Record<string, { orderId: string; customerName: string; items: NestingItem[] }>, item: NestingItem) => {
                            const key = `${item.orderId}-${item.customerName}`;
                            if (!acc[key]) {
                              acc[key] = {
                                orderId: item.orderId,
                                customerName: item.customerName,
                                items: []
                              };
                            }
                            acc[key].items.push(item);
                            return acc;
                          }, {});

                          const uniqueOrders = Object.values(groupedItems) as Array<{ orderId: string; customerName: string; items: NestingItem[] }>;

                          if (uniqueOrders.length === 0) {
                            return (
                              <tr>
                                <td colSpan={2} className="px-6 py-4 text-center text-lg font-semibold text-white">
                                  No orders found for this foam sheet
                                </td>
                              </tr>
                            );
                          }

                          return uniqueOrders.map((order: { orderId: string; customerName: string; items: NestingItem[] }, index: number) => (
                            <tr key={`${order.orderId}-${index}`} className="hover:bg-gray-800/30 transition-colors">
                              <td className="px-6 py-4 text-center text-md font-semibold">
                              <span className= "inline-block w-4 h-4 mr-4">
                                {index + 1}
                              </span>
                              <span
                                  className="inline-block w-10 h-3 rounded-full"
                                  style={{ backgroundColor: getOrderColor(order.orderId, index)}}
                                  title={`Order color for ${order.customerName}`}
                                ></span>
                              </td>
                              <td className="px-3 py-4 text-center text-md font-semibold text-white">
                                {order.customerName || '(No Name in Order)'}
                              </td>
                              <td className="px-6 py-4 text-center text-md font-semibold text-white">
                                {order.orderId}
                              </td>
                            </tr>
                          ));
                        })() as React.ReactNode}
                      </tbody>
                    </table>
                  </div>
                ) : firstColTab === 'Completed Cuts' ? (
                  <div className="overflow-x-auto h-full flex flex-col bg-black/70 rounded-xl shadow-xl">
                    <table className="w-full text-white border-separate border-spacing-y-2">
                      <thead>
                        <tr>
                          <th className="px-6 py-3 text-center text-lg font-semibold text-white underline">
                            Customer Name
                          </th>
                          <th className="px-6 py-3 text-center text-lg font-semibold text-white underline">
                            Order Id
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        <tr>
                          <td colSpan={2} className="px-6 py-4 text-center text-lg font-semibold text-white h-[calc(100vh-500px)]">
                            <div className="flex items-center justify-center h-full">
                              <p className="text-white text-lg">No completed cuts found. Please mark cuts as completed in the nesting queue.</p>
                            </div>
                          </td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                ) : firstColTab === 'Work In Progress' ? (
                  <div className="overflow-x-auto h-full flex flex-col bg-black/70 rounded-xl shadow-xl">
                    <table className="w-full text-white border-separate border-spacing-y-2">
                      <thead>
                        <tr>
                          <th className="px-6 py-3 text-center text-lg font-semibold text-white underline">
                            Foam Sheet
                          </th>
                          <th className="px-6 py-3 text-center text-lg font-semibold text-white underline">
                            Item Name
                          </th>
                          <th className="px-6 py-3 text-center text-lg font-semibold text-white underline">
                            Status
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        <tr>
                          <td colSpan={3} className="px-6 py-4 text-center text-lg font-semibold text-white h-[calc(100vh-500px)]">
                            <div className="flex items-center justify-center h-full">
                              <p className="text-white text-lg">No completed cuts found. Please mark cuts as completed in the nesting queue.</p>
                            </div>
                          </td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                ) : firstColTab !== 'Orders Queue' ? (
                  <div className="flex items-center justify-center h-full">
                    <p className="text-white text-lg">No data</p>
                  </div>
                ) : selectedOrder ? (
                  <div className="space-y-6 text-white">
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <p className="text-sm text-gray-400 underline">Order Date:</p>
                        <p className="font-medium">
                          {new Date(selectedOrder.order_date).toLocaleDateString("en-GB")}
                        </p>
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

                        {/* Progress indicator */}
                        {filterItemsBySku(selectedOrderItems).length > 0 && (
                          <div className="flex items-center gap-3">
                            <div className="flex items-center gap-2">
                              <span className="text-sm text-gray-300">
                                {filterItemsBySku(selectedOrderItems).filter(item => item.completed).length}/{filterItemsBySku(selectedOrderItems).length}
                              </span>
                              <div className="w-24 bg-gray-700 rounded-full h-2">
                                <div
                                  className="bg-green-500 h-2 rounded-full transition-all duration-500 ease-out"
                                  style={{
                                    width: `${filterItemsBySku(selectedOrderItems).length > 0
                                      ? (filterItemsBySku(selectedOrderItems).filter(item => item.completed).length / filterItemsBySku(selectedOrderItems).length) * 100
                                      : 0}%`
                                  }}
                                  aria-hidden="true"
                                ></div>
                              </div>
                            </div>
                          </div>
                        )}
                      </div>

                      {/* Warning message when not all items are completed */}
                      {showWarning && (
                        <div
                          className="mb-4 px-4 py-2 bg-amber-600/40 border border-amber-400 rounded-md text-amber-200 text-sm flex items-center gap-2 animate-fade-in"
                          role="alert"
                          aria-live="polite"
                        >
                          <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-amber-300 flex-shrink-0" viewBox="0 0 20 20" fill="currentColor">
                            <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                          </svg>
                          <p>All items must be completed before the order can be marked as manufactured.</p>
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
                              {filterItemsBySku(selectedOrderItems).map((item) => (
                                <tr key={item.id} className="hover:bg-gray-800/30 transition-colors">
                                  <td className="px-4 py-3 text-left">{item.item_name}</td>
                                  <td className="px-4 py-3 whitespace-nowrap text-center">{item.foamsheet}</td>
                                  <td className="px-4 py-3 text-center">{item.quantity}</td>
                                  <td className="px-4 py-3 text-center">{item.priority}</td>
                                  <td className="px-4 py-3 text-center">
                                    <div className="flex justify-center">
                                      <label className="relative inline-flex items-center cursor-pointer">
                                        <input
                                          type="checkbox"
                                          checked={item.completed}
                                          onChange={async (e) => {
                                            await Sentry.startSpan({
                                              name: 'ToggleItemCompletion-OrderDetails-Manufacturing',
                                              op: 'ui.interaction.checkbox'
                                            }, async () => {
                                              handleToggleCompleted(
                                                selectedOrder?.order_id || '',
                                                item.id,
                                                e.target.checked
                                              );
                                            });
                                          }}
                                          className="sr-only peer"
                                          aria-label={`Mark ${item.item_name} as ${item.completed ? 'incomplete' : 'complete'}`}
                                        />
                                        <div className="w-5 h-5 border-2 border-gray-400 rounded peer-checked:bg-green-500 peer-checked:border-green-500 peer-focus:ring-2 peer-focus:ring-green-400/50 transition-all flex items-center justify-center">
                                          {item.completed && (
                                            <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                              <path d="M12 22c5.523 0 10-4.477 10-10S17.523 2 12 2 2 6.477 2 12s4.477 10 10 10z" />
                                              <path d="m9 12 2 2 4-4" />
                                            </svg>
                                          )}
                                        </div>
                                      </label>
                                    </div>
                                  </td>
                                </tr>
                              ))}

                              {/* No relevant items message */}
                              {selectedOrderItems.length > 0 &&
                                filterItemsBySku(selectedOrderItems).length === 0 && (
                                  <tr>
                                    <td colSpan={5} className="px-4 py-8 text-center">
                                      <div className="flex flex-col items-center justify-center">
                                        <svg xmlns="http://www.w3.org/2000/svg" className="h-8 w-8 text-yellow-300 mb-2" viewBox="0 0 20 20" fill="currentColor">
                                          <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
                                        </svg>
                                        <p className="text-yellow-300 font-medium">No items with SKUs starting with SFI or SFC found in this order.</p>
                                        <p className="text-gray-400 text-sm mt-1">Only items with specific SKUs can be manufactured.</p>
                                      </div>
                                    </td>
                                  </tr>
                                )}
                            </tbody>
                          </table>
                        </div>
                      )}

                      {/* No order selected state */}
                      {!selectedOrderId && (
                        <div className="flex items-center justify-center h-full">
                          <p className="text-white text-lg">No order selected. Please choose an order.</p>
                        </div>
                      )}
                    </div>
                  </div>
                ) : (
                  <div className="flex items-center justify-center h-full">
                    <p className="text-white text-lg">No order selected. Please choose an order.</p>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/** Medium Sheets Tab Active Section */}
      {activeTab === 'medium' && (
        <div className="container mx-auto pt-6 pb-8 px-4 flex flex-col lg:flex-row gap-6 max-w-[1520px]">
          {/**Medium Sheets Section */}
          <div className="flex-1 max-w-3xl">
            <div className="bg-[#1d1d1d]/90 rounded-t-lg backdrop-blur-sm p-4">
              <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
                <h2 className="text-2xl font-bold text-white text-center">Medium Sheets</h2>
              </div>
            </div>

            <div className="overflow-x-auto bg-white h-[calc(92vh-270px)] flex flex-col">
              {loading ? (
                <div className="flex-1 flex flex-col items-center justify-center bg-gray-50 p-6">
                  <div className="w-12 h-12 rounded-full border-4 border-gray-300 border-t-blue-600 animate-spin mb-4"></div>
                  <p className="text-gray-700 font-medium">Loading Medium Sheets...</p>
                </div>
              ) : error ? (
                <div className="text-center py-4">
                  <p className="text-lg font-medium">Oops! Something went wrong</p>
                  <p className="text-red-500">Error: {error}</p>
                  <p className="text-gray-500">Please try refreshing the orders in the manufacturing queue. If the issue persists, contact support.</p>
                </div>
              ) : (
                <>
                  <div className="flex-1 overflow-y-auto">
                    <table className="w-full bg-white/90 backdrop-blur-sm border border-gray-200 table-auto h-full">
                      <thead className="bg-gray-100/90 sticky top-0 ">
                        <tr>
                          <th className="px-6 py-4 text-left text-lg font-semibold text-black">Foam Sheet</th>
                          <th className="px-6 py-4 text-center text-lg font-semibold text-black whitespace-nowrap">Stock Level</th>
                          <th className="px-6 py-4 text-center text-lg font-semibold text-black">Qty</th>
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
                              {/* <td>
                                  <div className="h-4 bg-gray-600 rounded w-20 mx-auto opacity-40"></div>
                                </td> */}
                              <td>
                                <div className="h-4 bg-gray-600 rounded w-20 mx-auto opacity-40"></div>
                              </td>
                            </tr>
                          ))
                        ) : (
                          // Render medium sheet items and their quantities
                          Object.keys(itemsByMediumSheet).length === 0 ? (
                            <tr>
                              <td colSpan={3} className="h-[400px] p-0">
                                <div className="flex flex-col items-center justify-center h-full w-full text-black">
                                  <svg xmlns="http://www.w3.org/2000/svg" className="h-12 w-12 mb-3 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4" />
                                  </svg>
                                  <p className="text-lg font-semibold">Great Work! All Medium Sheets Completed!</p>
                                  <p className="text-gray-700 mt-1">No medium sheets left to manufacture.</p>
                                </div>
                              </td>
                            </tr>
                          ) : (
                            <>
                              {Object.entries(itemsByMediumSheet)
                                .filter(([sku]) => {
                                  if (!sheetFilter) return true;
                                  const formattedName = formatMediumSheetName(sku).toLowerCase();
                                  return formattedName.includes(sheetFilter.toLowerCase()) ||
                                    sku.toLowerCase().includes(sheetFilter.toLowerCase());
                                })
                                .sort(([skuA, quantityA], [skuB, quantityB]) => {
                                  // Sort by quantity in descending order
                                  return quantityB - quantityA;
                                })
                                // Apply pagination to medium sheets
                                .slice(
                                  (mediumSheetPage - 1) * mediumSheetsPerPage,
                                  mediumSheetPage * mediumSheetsPerPage
                                )
                                .map(([sku, quantity], index) => (
                                  <tr
                                    key={sku}
                                    className={`transition-colors duration-150 
                                      ${selectedFoamSheet === sku
                                        ? 'bg-blue-200'
                                        : index % 2 === 0 ? 'bg-white' : 'bg-gray-50'
                                      } hover:bg-blue-50 cursor-pointer shadow-sm`}
                                    onClick={async () => {
                                      await Sentry.startSpan({
                                        name: 'handleRowClick-MediumSheets',
                                      }, async () => {
                                        handleMediumSheetClick(sku);
                                      })
                                    }}
                                    tabIndex={0}
                                    role="button"
                                    aria-pressed={selectedFoamSheet === sku}
                                    onKeyDown={(e) => {
                                      if (e.key === 'Enter' || e.key === ' ') {
                                        e.preventDefault();
                                        handleMediumSheetClick(sku);
                                      }
                                    }}
                                  >
                                    <td className="px-6 py-5 text-left">
                                      <div className="flex items-center">
                                        <div className={`w-4 h-4 rounded-full mr-3 ${getSheetColorClass(formatMediumSheetName(sku))}`}></div>
                                        <span className="text-black text-lg">
                                          {formatMediumSheetName(sku)}
                                        </span>
                                      </div>
                                    </td>

                                    <td className="px-6 py-5 text-center">
                                      <div className="flex items-center justify-center">
                                        <span className="inline-flex items-center justify-center min-w-[2.5rem] px-3 py-1 shadow-sm rounded-full text-lg text-black">
                                          {finishedStockBySku[sku] !== undefined ? finishedStockBySku[sku] : '—'}
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
                  {/*Pagination controls*/}
                  <div className="flex justify-between items-center bg-white/90 backdrop-blur-sm p-4 border border-gray-200">
                    <div className="text-sm text-gray-600">
                      {Object.keys(itemsByMediumSheet).filter(sku => {
                        if (!sheetFilter) return true;
                        return formatMediumSheetName(sku).toLowerCase().includes(sheetFilter.toLowerCase());
                      }).length} medium sheets found
                    </div>
                    <div className="flex gap-2">
                      <button
                        onClick={async () => {
                          await Sentry.startSpan({
                            name: 'MediumSheetPageChange-Previous',
                          }, async () => {
                            handleMediumSheetPageChange(mediumSheetPage - 1);
                          })
                        }}
                        disabled={mediumSheetPage === 1}
                        className="px-3 py-1 rounded bg-gray-200 text-gray-700 disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        Previous
                      </button>
                      <span>
                        Page {mediumSheetPage} of {Math.max(1, Math.ceil(Object.keys(itemsByMediumSheet).filter(sku => {
                          if (!sheetFilter) return true;
                          return formatMediumSheetName(sku).toLowerCase().includes(sheetFilter.toLowerCase());
                        }).length / mediumSheetsPerPage))}
                      </span>
                      <button
                        onClick={async () => {
                          await Sentry.startSpan({
                            name: 'MediumSheetPageChange-Next',
                          }, async () => {
                            handleMediumSheetPageChange(mediumSheetPage + 1);
                          })
                        }}
                        disabled={mediumSheetPage >= Math.ceil(Object.keys(itemsByMediumSheet).filter(sku => {
                          if (!sheetFilter) return true;
                          return formatMediumSheetName(sku).toLowerCase().includes(sheetFilter.toLowerCase());
                        }).length / mediumSheetsPerPage)}
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

          {/**Medium Sheets Order Details Section */}
          <div className="flex-1 w-full h-[calc(100vh-300px)] overflow-hidden">
            <div className="bg-black/90 rounded-xl shadow-xl overflow-hidden e h-full w-full flex flex-col">
              <div className="px-6 py-5  bg-black/90">
                <h2 className="text-2xl font-bold text-white text-center">
                  Confirm Completion
                </h2>
              </div>
              <div className="flex-1 overflow-auto p-4">
                <div className="h-full">   
                  <div className="overflow-x-auto rounded-lg border border-white/20 shadow-lg h-full">
                    <div className="w-full h-full bg-white/90 rounded-xl shadow-lg p-8 flex flex-col items-center justify-center">
                      <h2
                        id="dialog-title"
                        className="text-2xl font-bold text-gray-900 dark:text-white mb-6 text-center tracking-tight"
                      >
                        {selectedFoamSheet ? (
                          <div className="flex items-center justify-center">
                            <span className="relative">
                              <span className="font-semibold relative inline-block">{formatMediumSheetName(selectedFoamSheet)}
                              </span>
                            </span>
                          </div>
                        ) : (
                          <span className="relative inline-block">
                            Select a Medium Sheet
                          </span>
                        )}
                      </h2>
                      <div className="w-full max-w-3xl bg-gray-50 rounded-lg shadow-inner p-8 mb-6 border border-gray-200 flex flex-col gap-6">
                        <div className="flex items-center justify-between">
                          <span className="text-xl font-medium text-gray-700">Stock:</span>
                          <span className="text-xl font-semibold text-gray-900">
                            {selectedFoamSheet ? (finishedStockBySku[selectedFoamSheet] ?? '-') : '-'}
                          </span>
                        </div>
                        <div className="flex items-center justify-between">
                          <span className="text-xl font-medium text-gray-700">To Cut:</span>
                          <span className="flex items-center gap-4">
                            <span className="text-xl font-semibold text-gray-900">
                              {selectedFoamSheet
                                ? (() => {
                                    const stock = finishedStockBySku[selectedFoamSheet] ?? 0;
                                    const needed = Math.max(0, selectedMediumSheetQuantity - stock);
                                    let adjusted = needed;
                                    if (needed > 0 && needed % 4 !== 0) {
                                      adjusted = Math.ceil(needed / 4) * 4;
                                    }
                                    return adjusted;
                                  })()
                                : '-'}
                            </span>
                            <span className="text-lg font-semibold text-red-700">
                              {selectedFoamSheet
                                ? (() => {
                                    const stock = finishedStockBySku[selectedFoamSheet] ?? 0;
                                    const needed = Math.max(0, selectedMediumSheetQuantity - stock);
                                    let adjusted = needed;
                                    if (needed > 0 && needed % 4 !== 0) {
                                      adjusted = Math.ceil(needed / 4) * 4;
                                    }
                                    const numSheets = adjusted > 0 ? adjusted / 4 : 0;
                                    return `2X1: ${numSheets}`;
                                  })()
                                : ''}
                            </span>
                          </span>
                        </div>
                        <div className="flex items-center justify-between">
                          <span className="text-xl font-medium text-gray-700">Total Medium Sheets:</span>
                          <span className="text-xl font-semibold text-gray-900">
                            {selectedMediumSheetQuantity || '-'}
                          </span>
                        </div>
                      </div>
                      <button
                        type="button"
                        className="mt-2 px-6 py-2.5 rounded-lg text-white font-semibold bg-gradient-to-br from-green-600 to-green-700 hover:from-green-500 hover:to-green-600 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-green-500 shadow-md hover:shadow-lg transition-all duration-200"
                        onClick={handleConfirmMediumSheet}
                      >
                        Confirm Processing
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/** Manu Confirmation Dialog */}
      {showManuConfirmDialog && (
        <ManuConfirm
          isOpen={showManuConfirmDialog}
          onClose={() => {
            console.log("Manufacturing: ManuConfirm onClose triggered");
            setShowManuConfirmDialog(false);
            setPendingItemToComplete(null);
          }}
          onConfirm={handleManufactureOrder}
          orderId={selectedOrderId}
        />
      )}
    </div>
  );
}
"use client";

import Navbar from "@/components/Navbar";
import ManuConfirm from "@/components/manuConfirm";
import DxfConverterButton from "@/components/DxfConverterButton";
import { useEffect, useMemo, useRef, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import { AppDispatch, RootState } from "@/redux/store";
import { getAccessPermissions, UserAccess } from '@/utils/accessControl';
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
import { fetchInventory, reduceStock } from '@/utils/despatchCloud';
import { getFoamSheetFromSKU, parseSfcDimensions, getSfcFoamSheetInfo, getRetailPackInfo, getRetailPackDimensions, getStarterKitInfo, getStarterKitDimensions, getMixedPackInfo } from '@/utils/skuParser';
import RouteProtection from '@/components/RouteProtection';

// Define OrderWithPriority type
type OrderWithPriority = Order & { calculatedPriority: number };

export default function Manufacturing() {
  const dispatch = useDispatch<AppDispatch>();
  const orders = useSelector(selectManufacturingOrders); // Use manufacturing-specific selector
  const allOrders = useSelector((state: RootState) => state.orders.allOrders); // Add allOrders selector
  const totalOrders = useSelector(selectCurrentViewTotal); // Use view-specific total
  const selectedOrderId = useSelector((state: RootState) => state.orders.selectedOrderId);
  const userProfile = useSelector((state: RootState) => state.auth.userProfile);   // Get user profile to check for role
  const selectedStation = useSelector((state: RootState) => state.auth.selectedStation);
  
  // Get access permissions based on role and selected station
  const userAccess: UserAccess = {
    role: userProfile?.role || '',
    selectedStation: selectedStation
  };
  
  const accessPermissions = getAccessPermissions(userAccess);
  const isOperatorRole = userProfile?.role === 'Operator';
  const selectedItemsSelector = useMemo(() => selectOrderItemsById(selectedOrderId || ''), [selectedOrderId]);
  const selectedOrderItems = useSelector(selectedItemsSelector);
  const { currentPage, loading, error, } = useSelector((state: RootState) => state.orders);
  const selectedRowRef = useRef<HTMLTableRowElement>(null);
  const ordersPerPage = 15;
  const totalPages = Math.ceil(totalOrders / ordersPerPage);
  const selectedOrder = orders.find((o: Order) => o.order_id === selectedOrderId);
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
  const [firstColTab, setFirstColTab] = useState<'Nesting Queue' | 'Completed Cuts' | 'Work In Progress'>(
    'Nesting Queue'
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

  // Add state for selected sheet in visualization
  const [selectedSheetIndex, setSelectedSheetIndex] = useState<number>(0);

  // Improved function for tab changes that prevents changes based on access permissions
  const handleFirstColTabChange = (tab: 'Nesting Queue' | 'Completed Cuts' | 'Work In Progress') => {
    // Check access permissions for the requested tab
    const canAccessTab = (() => {
      switch (tab) {
        case 'Nesting Queue':
          return true;
        case 'Completed Cuts':
          return true;
        case 'Work In Progress':
          return true;
        default:
          return false;
      }
    })();

    if (!canAccessTab) {
      console.log(`Access denied to tab: ${tab}`);
      return; // Block tab changes for unauthorized access
    }
    
    // Allow tab changes for authorized users
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

  // Add this useEffect to enforce appropriate tab based on access permissions
  useEffect(() => {
    // If user doesn't have access to nesting queue, completed cuts, or work in progress,
    // force them to stay on Orders Queue
    if (!accessPermissions.canAccessNestingQueue && 
        !accessPermissions.canAccessCompletedCuts && 
        !accessPermissions.canAccessWorkInProgress) {
      console.log('Enforcing Nesting Queue tab due to access restrictions');
      setFirstColTab('Nesting Queue');
    }
  }, [accessPermissions]);

  // Helper function to filter items by SKU
  const filterItemsBySku = (items: OrderItem[]) => {
    return items.filter((item: OrderItem) => {
      const sku = item.sku_id.toUpperCase();
      // Check for specific medium sheet patterns
      const validMediumSheetPatterns = ['SFS-100/50/30', 'SFS-100/50/50', 'SFS-100/50/70'];
      const isMediumSheet = validMediumSheetPatterns.some(pattern => sku.includes(pattern));

      // Check for specific retail pack SKUs (exact matches only)
      const validRetailPackSkus = ['SFP30E', 'SFP50E', 'SFP30P', 'SFP50P', 'SFP30T', 'SFP50T'];
      const isRetailPack = validRetailPackSkus.includes(sku);

      // Include items that are either:
      // 1. SFI, SFC, SFP, or SFSK items (manufacturing items)
      // 2. Medium sheets with our specific patterns
      // 3. Specific retail pack SKUs
      return sku.startsWith('SFI') || sku.startsWith('SFC') || sku.startsWith('SFP') || sku.startsWith('SFSK') || isMediumSheet || isRetailPack;
    });
  };

  // Use useSelector to get order items for each order in the table
  const orderItemsById = useSelector((state: RootState) =>
    orders.reduce((acc: Record<string, OrderItem[]>, order: Order) => {
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
        'K': 'Black', 'B': 'Blue', 'G': 'Green', 'O': 'Orange', 'P': 'Purple',
        'R': 'Red', 'T': 'Teal', 'Y': 'Yellow', 'E': 'Grey'
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
        return items.some(item => (item.sku_id.startsWith('SFI') || item.sku_id.startsWith('SFC') || item.sku_id.startsWith('SFP') || item.sku_id.startsWith('SFSK')) && !item.completed);
      });

      // Create a map to store items by foam sheet
      const itemsByFoamSheet: Record<string, NestingItem[]> = {};

      // Process each order
      manufacturingOrders.forEach((order: Order) => {
        const items = orderItemsById[order.order_id] || [];
        
        // Filter for SFI, SFC, SFP, and SFSK items that aren't completed
        const manufacturingItems = items.filter(item => 
          (item.sku_id.startsWith('SFI') || item.sku_id.startsWith('SFC') || item.sku_id.startsWith('SFP') || item.sku_id.startsWith('SFSK')) && !item.completed
        );

        // Group items by foam sheet
        manufacturingItems.forEach(item => {
          // Expand mixed packs into one item per depth
          if (item.sku_id.startsWith('SFSKMP')) {
            const mixedPackInfo = getMixedPackInfo(item.sku_id);
            if (mixedPackInfo) {
              mixedPackInfo.depths.forEach(depth => {
                const foamSheet = `${mixedPackInfo.color} ${depth}mm`;
                const expandedItem = {
                  sku: item.sku_id,
                  itemName: item.item_name,
                  quantity: item.quantity,
                  orderId: order.order_id,
                  customerName: order.customer_name,
                  priority: item.priority,
                  foamSheet,
                  depth,
                  dimensions: mixedPackInfo.dimensions,
                  isMixedPack: true,
                  svgUrl: ['noMatch']
                };
                if (!itemsByFoamSheet[foamSheet]) itemsByFoamSheet[foamSheet] = [];
                itemsByFoamSheet[foamSheet].push(expandedItem);
              });
              return; // Skip the rest of the loop for this item
            }
          }
          // For all other items, use the previous logic
          let foamSheet = (typeof item === 'object' && 'foamSheet' in item && item.foamSheet) ? item.foamSheet : item.foamsheet;
          const foamSheetKey = String(foamSheet);
          if (!itemsByFoamSheet[foamSheetKey]) {
            itemsByFoamSheet[foamSheetKey] = [];
          }
          itemsByFoamSheet[foamSheetKey].push({
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
        // Handle SFC items differently - they don't have SVG files
        if (item.sku.startsWith('SFC')) {
          return {
            ...item,
            svgUrl: ['custom'] // Mark as custom for SFC items
          };
        }

        // Handle retail pack items differently - they don't have SVG files
        if (item.sku.startsWith('SFP')) {
          return {
            ...item,
            svgUrl: ['retail'] // Mark as retail for retail pack items
          };
        }

        // Handle mixed pack items differently - they don't have SVG files
        if (item.sku.startsWith('SFSKMP')) {
          return {
            ...item,
            svgUrl: ['mixedPack'] // Mark as mixed pack for mixed pack items
          };
        }

        // Handle starter kit items differently - they don't have SVG files
        if (item.sku.startsWith('SFSK')) {
          return {
            ...item,
            svgUrl: ['starter'] // Mark as starter for starter kit items
          };
        }

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

  // Helper to calculate the area of a polygon
  function polygonArea(points: { x: number, y: number }[]): number {
    let area = 0;
    for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
      area += (points[j].x + points[i].x) * (points[j].y - points[i].y);
    }
    return Math.abs(area / 2);
  }

  // Update the table content in the first section to handle multiple sheets
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

    const allRows: JSX.Element[] = [];
    let globalIndex = 0;

    // Calculate yield for each foam sheet
    const foamSheetYields = Object.entries(nestingQueueData).map(([foamSheet, data]) => {
      const nestingResult = data.nestingResult;
      const sheets = nestingResult?.placements || [];
      // Use the first sheet's yield as representative (or 0 if none)
      let yieldPercent = 0;
      if (sheets.length > 0) {
        const binPolygon = [
          { x: 0, y: 0 },
          { x: 1000, y: 0 },
          { x: 1000, y: 2000 },
          { x: 0, y: 2000 },
          { x: 0, y: 0 }
        ];
        const binArea = polygonArea(binPolygon);
        const placements = sheets[0].parts || [];
        const totalPartsArea = placements.reduce((sum, part) => {
          if (part.polygons && part.polygons[0]) {
            return sum + polygonArea(part.polygons[0]);
          }
          return sum;
        }, 0);
        yieldPercent = binArea > 0 ? (totalPartsArea / binArea) * 100 : 0;
      }
      return { foamSheet, data, yieldPercent };
    });

    // Sort by yield descending
    foamSheetYields.sort((a, b) => b.yieldPercent - a.yieldPercent);

    foamSheetYields.forEach(({ foamSheet, data }) => {
      const nestingResult = data.nestingResult;
      const sheets = nestingResult?.placements || [];
      globalIndex++;
      const nestingId = `NST-${globalIndex}`;
      const isLocked = !!nestLocks[`${foamSheet}-0`];
      if (sheets.length === 0) {
        // No sheets case - show a single row with no nesting data
        allRows.push(
          <tr
            key={`${foamSheet}-no-sheets`}
            onClick={() => {
              setSelectedNestingRow(foamSheet);
              setSelectedMediumSheet(formatMediumSheetName(foamSheet));
              setSelectedSheetIndex(0);
            }}
            className={`transition-colors duration-150 hover:bg-blue-50 cursor-pointer shadow-sm ${
              selectedNestingRow === foamSheet 
                ? 'bg-blue-200 border-l-4 border-blue-500' 
                : globalIndex % 2 === 0 ? 'bg-white' : 'bg-gray-50'
            }`}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                setSelectedNestingRow(foamSheet);
                setSelectedMediumSheet(formatMediumSheetName(foamSheet));
                setSelectedSheetIndex(0);
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
            <td className="px-6 py-4 text-center text-gray-500">—</td>
            <td className="px-6 py-4 text-center text-gray-500">—</td>
            <td className="px-6 py-4 text-center text-gray-500">—</td>
            <td className="px-6 py-4 text-center text-gray-500">—</td>
            <td className="px-6 py-4 text-center">
              <button
                type="button"
                aria-label={isLocked ? 'Unlock nest' : 'Lock nest'}
                onClick={e => {
                  e.stopPropagation();
                  setNestLocks(prev => ({ ...prev, [`${foamSheet}-0`]: !isLocked }));
                }}
                className="focus:outline-none"
              >
                {isLocked ? (
                  <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                    <rect x="5" y="11" width="14" height="8" rx="2" fill="#e5e7eb" stroke="#374151" />
                    <path d="M7 11V7a5 5 0 0110 0v4" stroke="#374151" strokeWidth="2" fill="none" />
                    <circle cx="12" cy="15" r="1.5" fill="#374151" />
                  </svg>
                ) : (
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
        return;
      }

      // Multiple sheets case - show one row per sheet
      sheets.forEach((sheet, sheetIndex) => {
        globalIndex++;
        const nestingId = `NST-${globalIndex}`;

        // Log placement details for multi-sheet results
        if (sheets.length > 1) {
          console.log(`📦 MULTI-SHEET DEBUGGING - Sheet ${sheetIndex + 1}/${sheets.length} for foam ${foamSheet}:`);
          console.log(`   - Sheet ID: ${sheet.sheet || sheet.sheetid || 'unknown'}`);
          console.log(`   - Parts count: ${sheet.parts?.length || 0}`);
          console.log(`   - Placements:`, sheet.parts?.map(part => ({
            id: part.id,
            x: part.x,
            y: part.y,
            rotation: part.rotation || 0,
            orderId: part.orderId,
            customerName: part.customerName,
            itemName: part.itemName,
            polygonCount: part.polygons?.length || 0,
            firstPolygonPoints: part.polygons?.[0]?.length || 0
          })) || []);
        }

        // Calculate yield for this specific sheet
        const binPolygon = [
          { x: 0, y: 0 },
          { x: 1000, y: 0 },
          { x: 1000, y: 2000 },
          { x: 0, y: 2000 },
          { x: 0, y: 0 }
        ];
        const binArea = polygonArea(binPolygon);
        const placements = sheet.parts || [];
        const totalPartsArea = placements.reduce((sum, part) => {
          if (part.polygons && part.polygons[0]) {
            return sum + polygonArea(part.polygons[0]);
          }
          return sum;
        }, 0);
        const yieldPercent = binArea > 0 ? (totalPartsArea / binArea) * 100 : 0;

        // Calculate time for this sheet
        // const totalPieces = placements.length;
        // const totalSeconds = totalPieces * 105;
        // const minutes = Math.floor(totalSeconds / 60);
        // const seconds = totalSeconds % 60;
        // const timeString = `${minutes}m ${seconds}s`;

        // Actual time calculation
        const totalPieces = placements.length;

        // Calculate total time for this sheet
        let totalTimeSeconds = 0;

        // Extract foam depth from foam sheet name
        const getFoamDepth = (foamSheetName: string): number => {
          const match = foamSheetName.match(/(\d+)mm/);
          if (match) {
            return parseInt(match[1]);
          }
          // Fallback: try to extract from formatted name
          const formattedName = formatMediumSheetName(foamSheetName);
          const formattedMatch = formattedName.match(/\[(\d+)mm\]/);
          if (formattedMatch) {
            return parseInt(formattedMatch[1]);
          }
          return 30; // Default to 30mm if not found
        };

        const foamDepth = getFoamDepth(foamSheet);

        // Calculate corner time based on foam depth
        const getCornerTime = (depth: number): number => {
          if (depth <= 30) return 2;
          if (depth <= 50) return 3.5;
          if (depth <= 70) return 4.5;
          return 4.5; // Default for depths > 70mm
        };

        const cornerTimePerCorner = getCornerTime(foamDepth);
        placements.forEach((part: NestingPart, partIndex: number) => {
          if (part.polygons && part.polygons[0]) {
            const points = part.polygons[0];
            
            // Use simplified bounding box approach for more realistic perimeter calculation
            const xCoords = points.map(p => p.x);
            const yCoords = points.map(p => p.y);
            const minX = Math.min(...xCoords);
            const maxX = Math.max(...xCoords);
            const minY = Math.min(...yCoords);
            const maxY = Math.max(...yCoords);
            
            const width = maxX - minX; // in mm
            const height = maxY - minY; // in mm
            
            // Calculate realistic perimeter (rectangular approximation for time estimation)
            const actualPerimeter = (width + height) * 2;
            
            // Count corners using more selective approach
            let cornerCount = 0;
            const angleThresholdDegrees = 45; // Only count significant direction changes
            const angleThresholdRadians = angleThresholdDegrees * (Math.PI / 180);
            const minSegmentLength = 5; // Ignore very small segments under 5mm
            
            for (let i = 0; i < points.length; i++) {
              const prevPoint = points[(i - 1 + points.length) % points.length];
              const currentPoint = points[i];
              const nextPoint = points[(i + 1) % points.length];
              
              // Calculate vectors and their lengths
              const vec1x = currentPoint.x - prevPoint.x;
              const vec1y = currentPoint.y - prevPoint.y;
              const vec2x = nextPoint.x - currentPoint.x;
              const vec2y = nextPoint.y - currentPoint.y;
              
              const mag1 = Math.sqrt(vec1x * vec1x + vec1y * vec1y);
              const mag2 = Math.sqrt(vec2x * vec2x + vec2y * vec2y);
              
              // Only consider corners where both segments are significant length
              if (mag1 > minSegmentLength && mag2 > minSegmentLength) {
                // Calculate angle between vectors
                const dot = vec1x * vec2x + vec1y * vec2y;
                const cosAngle = dot / (mag1 * mag2);
                const angle = Math.acos(Math.max(-1, Math.min(1, cosAngle)));
                
                // Count as corner if angle change is significant
                if (angle > angleThresholdRadians) {
                  cornerCount++;
                }
              }
            }
            
            // Apply realistic corner count bounds
            if (cornerCount < 4) {
              cornerCount = 4; // Minimum for simple rectangular shapes
            } else if (cornerCount > 12) {
              cornerCount = 12; // Cap for complex shapes to avoid unrealistic times
            }
            
            // Calculate time: cutting speed is 16mm per second, so time = distance / speed
            const perimeterTime = actualPerimeter / 16; // perimeter in mm / 16 mm/s = seconds
            const partCornerTime = cornerCount * cornerTimePerCorner;
            const partTime = perimeterTime + partCornerTime;
          
            totalTimeSeconds += partTime;
          }
        });

        // Format time string
        const formatTime = (seconds: number): string => {
          const totalMinutes = Math.floor(seconds / 60);
          const remainingSeconds = Math.floor(seconds % 60);
          const hours = Math.floor(totalMinutes / 60);
          const minutes = totalMinutes % 60;
          
          if (hours > 0) {
            return `${hours}h ${minutes}m ${remainingSeconds}s`;
          } else {
            return `${minutes}m ${remainingSeconds}s`;
          }
        };

        const timeString = formatTime(totalTimeSeconds);

        // Lock state for this specific sheet
        const lockKey = `${foamSheet}-${sheetIndex}`;
        const isLocked = !!nestLocks[lockKey];

        // Sheet display name
        const sheetDisplayName = formatMediumSheetName(foamSheet);

        allRows.push(
          <tr
            key={`${foamSheet}-${sheetIndex}`}
            onClick={() => {
              setSelectedNestingRow(foamSheet);
              setSelectedMediumSheet(formatMediumSheetName(foamSheet));
              setSelectedSheetIndex(sheetIndex);
            }}
            className={`transition-colors duration-150 hover:bg-blue-50 cursor-pointer shadow-sm ${
              selectedNestingRow === foamSheet && selectedSheetIndex === sheetIndex
                ? 'bg-blue-200 border-l-4 border-blue-500' 
                : globalIndex % 2 === 0 ? 'bg-white' : 'bg-gray-50'
            }`}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                setSelectedNestingRow(foamSheet);
                setSelectedMediumSheet(formatMediumSheetName(foamSheet));
                setSelectedSheetIndex(sheetIndex);
              }
            }}
            aria-selected={selectedNestingRow === foamSheet && selectedSheetIndex === sheetIndex}
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
            <td className="px-6 py-4 text-center">
              {yieldPercent > 0 ? `${yieldPercent.toFixed(1)}%` : '—'}
            </td>
            <td className="px-6 py-4 text-center">{timeString}</td>
            <td className="px-6 py-4 text-center">
              <button
                type="button"
                aria-label={isLocked ? 'Unlock nest' : 'Lock nest'}
                onClick={e => {
                  e.stopPropagation();
                  setNestLocks(prev => ({ ...prev, [lockKey]: !isLocked }));
                }}
                className="focus:outline-none"
              >
                {isLocked ? (
                  <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                    <rect x="5" y="11" width="14" height="8" rx="2" fill="#e5e7eb" stroke="#374151" />
                    <path d="M7 11V7a5 5 0 0110 0v4" stroke="#374151" strokeWidth="2" fill="none" />
                    <circle cx="12" cy="15" r="1.5" fill="#374151" />
                  </svg>
                ) : (
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
    });

    return allRows;
  };

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

    // Update the stock in DespatchCloud for 2X1 Sheets if needed
    if (selectedFoamSheet) {
      try {
        // Calculate the number of sheets to cut (this is the same logic as in line 2765)
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
        const numSheets = totalToCut > 0 ? totalToCut / 4 : 0;

        if (numSheets > 0) {
          console.log(`[DEBUG] Need to cut ${numSheets} sheets for medium sheet '${selectedFoamSheet}'`);

          // Get the last three digits of the medium sheet SKU
          const mediumSheetLastThree = selectedFoamSheet.slice(-3);
          console.log(`[DEBUG] Last three digits of medium sheet SKU: ${mediumSheetLastThree}`);

          // Find matching 2X1 sheets in Supabase finished_stock table
          try {
            const { data: matching2X1Sheets, error: fetchError } = await supabase
              .from('finished_stock')
              .select('sku, stock')
              .ilike('sku', `SFS${mediumSheetLastThree}`);

            if (fetchError) {
              console.error(`[ERROR] Failed to fetch 2X1 sheets from Supabase:`, fetchError);
            } else {
              console.log(`[DEBUG] Found ${matching2X1Sheets?.length || 0} matching 2X1 sheets in Supabase:`, matching2X1Sheets);

              if (matching2X1Sheets && matching2X1Sheets.length > 0) {
                // Use the first matching 2X1 sheet
                const matching2X1Sheet = matching2X1Sheets[0] as { sku: string; stock: number };
                console.log(`[DEBUG] Using 2X1 sheet: ${matching2X1Sheet.sku} (Stock: ${matching2X1Sheet.stock})`);

                // Check if we have enough stock
                if (matching2X1Sheet.stock >= numSheets) {
                  // Book out the stock from DespatchCloud
                  try {
                    // First, we need to get the DespatchCloud inventory ID for this SKU
                    // We'll need to make a targeted search for this specific SKU
                    const inventoryResponse = await fetchInventory(1, 100, { sku: matching2X1Sheet.sku }, 'name_az', false);
                    
                    const matchingInventoryItem = inventoryResponse.data.find(item => 
                      item.sku === matching2X1Sheet.sku
                    );

                    if (matchingInventoryItem) {
                      console.log(`[DEBUG] Found matching inventory item in DespatchCloud: ${matchingInventoryItem.sku} (ID: ${matchingInventoryItem.id})`);
                      
                      const bookOutResult = await reduceStock(matchingInventoryItem.id, numSheets);
                      console.log(`[DEBUG] Successfully booked out ${numSheets} sheets from 2X1 sheet '${matching2X1Sheet.sku}'`, bookOutResult);

                      // Update the stock in Supabase for the 2X1 sheet
                      try {
                        const currentStock = Number(matching2X1Sheet.stock) || 0;
                        const newStock = Math.max(0, currentStock - numSheets);
                        
                        console.log(`[DEBUG] Updating 2X1 sheet stock in Supabase: ${matching2X1Sheet.sku} from ${currentStock} to ${newStock}`);

                        // Update the stock in Supabase
                        const { error: updateError } = await supabase
                          .from('finished_stock')
                          .update({ 
                            stock: newStock,
                            updated_at: new Date().toISOString()
                          })
                          .eq('sku', matching2X1Sheet.sku);

                        if (updateError) {
                          console.error(`[ERROR] Failed to update stock in Supabase for 2X1 sheet '${matching2X1Sheet.sku}':`, updateError);
                        } else {
                          console.log(`[DEBUG] Successfully updated stock in Supabase for 2X1 sheet '${matching2X1Sheet.sku}' to ${newStock}`);

                          // Update local state if the 2X1 sheet is in our finishedStockBySku
                          if (finishedStockBySku[matching2X1Sheet.sku] !== undefined) {
                            setFinishedStockBySku((prev: Record<string, number>) => ({
                              ...prev,
                              [matching2X1Sheet.sku]: newStock
                            }));
                            console.log(`[DEBUG] Updated local finishedStockBySku for 2X1 sheet '${matching2X1Sheet.sku}' to ${newStock}`);
                          }
                        }
                      } catch (supabaseError) {
                        console.error(`[ERROR] Error updating 2X1 sheet stock in Supabase:`, supabaseError);
                      }
                    } else {
                      console.warn(`[WARNING] Could not find matching inventory item in DespatchCloud for SKU '${matching2X1Sheet.sku}'`);
                    }
                  } catch (bookOutError) {
                    console.error(`[ERROR] Failed to book out stock for 2X1 sheet '${matching2X1Sheet.sku}':`, bookOutError);
                  }
                } else {
                  console.warn(`[WARNING] Insufficient stock for 2X1 sheet '${matching2X1Sheet.sku}'. Required: ${numSheets}, Available: ${matching2X1Sheet.stock}`);
                }
              } else {
                console.warn(`[WARNING] No matching 2X1 sheet found for medium sheet '${selectedFoamSheet}' (last three digits: ${mediumSheetLastThree})`);
              }
            }
          } catch (supabaseError) {
            console.error(`[ERROR] Error fetching 2X1 sheets from Supabase:`, supabaseError);
          }
        } else {
          console.log(`[DEBUG] No sheets need to be cut for medium sheet '${selectedFoamSheet}'`);
        }
      } catch (error) {
        console.error(`[ERROR] Error processing 2X1 sheet booking for medium sheet '${selectedFoamSheet}':`, error);
      }
    }

    // After all processing and debug logs, reset the state for Medium Sheet Order Details section
    setCurrentMediumStock(0);
    setSelectedMediumSheetQuantity(0);
    setSelectedFoamSheet(null);
  }

  // const handleExportNestingVisualization = () => {
  //   // Export the nesting visualization as an SVG file
  //   if (!selectedNestingRow || !nestingQueueData[selectedNestingRow]) {
  //     console.warn('No nesting row selected for export');
  //     return;
  //   }

  //   try {
  //     // Get the nesting data for the selected row and sheet
  //     const nestingData = nestingQueueData[selectedNestingRow];
  //     const placements = nestingData.nestingResult?.placements || [];
      
  //     if (placements.length === 0 || selectedSheetIndex >= placements.length) {
  //       console.warn('No placement data available for export');
  //       return;
  //     }

  //     const selectedSheet = placements[selectedSheetIndex];
  //     const sheetsToExport = [selectedSheet]; // Export only the selected sheet

  //     // Generate SVG content
  //     const svgContent = generateSVG(sheetsToExport, selectedNestingRow);
      
  //     // Create and download the file
  //     const blob = new Blob([svgContent], { type: 'image/svg+xml' });
  //     const url = URL.createObjectURL(blob);
  //     const link = document.createElement('a');
  //     link.href = url;
  //     const sheetSuffix = placements.length > 1 ? `_sheet${selectedSheetIndex + 1}` : '';
  //     link.download = `nesting_${selectedNestingRow}${sheetSuffix}_${new Date().toISOString().split('T')[0]}.svg`;
  //     document.body.appendChild(link);
  //     link.click();
  //     document.body.removeChild(link);
  //     URL.revokeObjectURL(url);
      
  //     console.log('SVG file exported successfully');
  //   } catch (error) {
  //     console.error('Error exporting SVG file:', error);
  //   }
  // }

// // Helper function to generate DXF content for AutoCAD 2010 (AC1024)
// const generateDXF = (placements: NestingPlacement[], foamSheetName: string): string => {
//   const PADDING = 10; // 10mm padding
//   const VIEWBOX_WIDTH = 1000 + 2 * PADDING; // mm
//   const VIEWBOX_HEIGHT = 2000 + 2 * PADDING; // mm

//   let dxfLines: string[] = [];

//   // Initialize handle counter. Handles are hexadecimal.
//   // Start from 1, or a higher number if you have known fixed handles for root objects.
//   let currentHandle = 1;

//   // Helper to get next handle and increment
//   const getNextHandle = (): string => {
//     return (currentHandle++).toString(16).toUpperCase();
//   };

//   // DXF Header for AutoCAD 2010
//   dxfLines.push('0');
//   dxfLines.push('SECTION');
//   dxfLines.push('2');
//   dxfLines.push('HEADER');
//   dxfLines.push('9');
//   dxfLines.push('$ACADVER');
//   dxfLines.push('1');
//   dxfLines.push('AC1024'); // AutoCAD 2010
//   dxfLines.push('9');
//   dxfLines.push('$DWGCODEPAGE');
//   dxfLines.push('3');
//   dxfLines.push('ANSI_1252');
//   dxfLines.push('9');
//   dxfLines.push('$INSBASE');
//   dxfLines.push('10');
//   dxfLines.push('0.0');
//   dxfLines.push('20');
//   dxfLines.push('0.0');
//   dxfLines.push('30');
//   dxfLines.push('0.0');
//   dxfLines.push('9');
//   dxfLines.push('$EXTMIN');
//   dxfLines.push('10');
//   dxfLines.push('0.0');
//   dxfLines.push('20');
//   dxfLines.push('0.0');
//   dxfLines.push('30');
//   dxfLines.push('0.0');
//   dxfLines.push('9');
//   dxfLines.push('$EXTMAX');
//   dxfLines.push('10');
//   dxfLines.push(VIEWBOX_WIDTH.toString());
//   dxfLines.push('20');
//   dxfLines.push(VIEWBOX_HEIGHT.toString());
//   dxfLines.push('30');
//   dxfLines.push('0.0');
//   dxfLines.push('9');
//   dxfLines.push('$LIMMIN');
//   dxfLines.push('10');
//   dxfLines.push('0.0');
//   dxfLines.push('20');
//   dxfLines.push('0.0');
//   dxfLines.push('9');
//   dxfLines.push('$LIMMAX');
//   dxfLines.push('10');
//   dxfLines.push(VIEWBOX_WIDTH.toString());
//   dxfLines.push('20');
//   dxfLines.push(VIEWBOX_HEIGHT.toString());
//   dxfLines.push('9');
//   dxfLines.push('$ORTHOMODE');
//   dxfLines.push('70');
//   dxfLines.push('0');
//   dxfLines.push('9');
//   dxfLines.push('$LTSCALE');
//   dxfLines.push('40');
//   dxfLines.push('1.0');
//   dxfLines.push('9');
//   dxfLines.push('$ATTMODE');
//   dxfLines.push('70');
//   dxfLines.push('1');
//   dxfLines.push('9');
//   dxfLines.push('$TEXTSIZE');
//   dxfLines.push('40');
//   dxfLines.push('2.5');
//   dxfLines.push('9');
//   dxfLines.push('$TRACEWID');
//   dxfLines.push('40');
//   dxfLines.push('0.05');
//   dxfLines.push('9');
//   dxfLines.push('$TEXTSTYLE');
//   dxfLines.push('7');
//   dxfLines.push('STANDARD');
//   dxfLines.push('9');
//   dxfLines.push('$CLAYER');
//   dxfLines.push('8');
//   dxfLines.push('0');
//   dxfLines.push('9');
//   dxfLines.push('$DIMASZ');
//   dxfLines.push('40');
//   dxfLines.push('2.5');
//   dxfLines.push('9');
//   dxfLines.push('$DIMLFAC');
//   dxfLines.push('40');
//   dxfLines.push('1.0');
//   dxfLines.push('9');
//   dxfLines.push('$DIMSCALE');
//   dxfLines.push('40');
//   dxfLines.push('1.0');
//   dxfLines.push('9');
//   dxfLines.push('$DIMTXT');
//   dxfLines.push('40');
//   dxfLines.push('2.5');
//   // ADD $HANDSEED here, before ENDSEC of HEADER
//   dxfLines.push('9');
//   dxfLines.push('$HANDSEED');
//   dxfLines.push('5'); // Group 5 for handle
//   dxfLines.push(getNextHandle()); // Assign first handle to $HANDSEED, which will be 1
//   dxfLines.push('0');
//   dxfLines.push('ENDSEC');

//   // CLASSES section for R13+ compatibility (add handles)
//   dxfLines.push('0');
//   dxfLines.push('SECTION');
//   dxfLines.push('2');
//   dxfLines.push('CLASSES');
  
//   dxfLines.push('0');
//   dxfLines.push('CLASS');
//   dxfLines.push('5'); dxfLines.push(getNextHandle()); // Handle for this CLASS object
//   dxfLines.push('100'); dxfLines.push('AcDbClass'); // Subclass marker
//   dxfLines.push('1');
//   dxfLines.push('ACDBDICTIONARYWDFLT');
//   dxfLines.push('2');
//   dxfLines.push('AcDbDictionaryWithDefault');
//   dxfLines.push('3');
//   dxfLines.push('ObjectDBX Classes');
//   dxfLines.push('90');
//   dxfLines.push('0');
//   dxfLines.push('91');
//   dxfLines.push('1');
//   dxfLines.push('280');
//   dxfLines.push('0');
//   dxfLines.push('281');
//   dxfLines.push('0');
  
//   dxfLines.push('0');
//   dxfLines.push('CLASS');
//   dxfLines.push('5'); dxfLines.push(getNextHandle()); // Handle for this CLASS object
//   dxfLines.push('100'); dxfLines.push('AcDbClass');
//   dxfLines.push('1');
//   dxfLines.push('MATERIAL');
//   dxfLines.push('2');
//   dxfLines.push('AcDbMaterial');
//   dxfLines.push('3');
//   dxfLines.push('ObjectDBX Classes');
//   dxfLines.push('90');
//   dxfLines.push('1153');
//   dxfLines.push('91');
//   dxfLines.push('3');
//   dxfLines.push('280');
//   dxfLines.push('0');
//   dxfLines.push('281');
//   dxfLines.push('0');
  
//   dxfLines.push('0');
//   dxfLines.push('CLASS');
//   dxfLines.push('5'); dxfLines.push(getNextHandle()); // Handle for this CLASS object
//   dxfLines.push('100'); dxfLines.push('AcDbClass');
//   dxfLines.push('1');
//   dxfLines.push('VISUALSTYLE');
//   dxfLines.push('2');
//   dxfLines.push('AcDbVisualStyle');
//   dxfLines.push('3');
//   dxfLines.push('ObjectDBX Classes');
//   dxfLines.push('90');
//   dxfLines.push('4095');
//   dxfLines.push('91');
//   dxfLines.push('24');
//   dxfLines.push('280');
//   dxfLines.push('0');
//   dxfLines.push('281');
//   dxfLines.push('0');
//   dxfLines.push('0');
//   dxfLines.push('ENDSEC');

//   // DXF Tables for AutoCAD (add handles)
//   dxfLines.push('0');
//   dxfLines.push('SECTION');
//   dxfLines.push('2');
//   dxfLines.push('TABLES');

//   // Viewport table (required for Illustrator compatibility)
//   dxfLines.push('0');
//   dxfLines.push('TABLE');
//   dxfLines.push('5'); dxfLines.push(getNextHandle()); // Handle for VPORT Table
//   dxfLines.push('100'); dxfLines.push('AcDbSymbolTable');
//   dxfLines.push('2');
//   dxfLines.push('VPORT');
//   dxfLines.push('70');
//   dxfLines.push('1');
  
//   dxfLines.push('0');
//   dxfLines.push('VPORT');
//   dxfLines.push('5'); dxfLines.push(getNextHandle()); // Handle for *Active VPORT
//   dxfLines.push('100'); dxfLines.push('AcDbSymbolTableRecord');
//   dxfLines.push('100'); dxfLines.push('AcDbViewportTableRecord');
//   dxfLines.push('2');
//   dxfLines.push('*Active');
//   dxfLines.push('70');
//   dxfLines.push('0');
//   dxfLines.push('10');
//   dxfLines.push('0.0');
//   dxfLines.push('20');
//   dxfLines.push('0.0');
//   dxfLines.push('11');
//   dxfLines.push('1.0');
//   dxfLines.push('21');
//   dxfLines.push('1.0');
//   dxfLines.push('12');
//   dxfLines.push('0.0');
//   dxfLines.push('22');
//   dxfLines.push('0.0');
//   dxfLines.push('13');
//   dxfLines.push('0.0');
//   dxfLines.push('23');
//   dxfLines.push('0.0');
//   dxfLines.push('14');
//   dxfLines.push('1.0');
//   dxfLines.push('24');
//   dxfLines.push('1.0');
//   dxfLines.push('15');
//   dxfLines.push('0.0');
//   dxfLines.push('25');
//   dxfLines.push('0.0');
//   dxfLines.push('16');
//   dxfLines.push('0.0');
//   dxfLines.push('26');
//   dxfLines.push('0.0');
//   dxfLines.push('36');
//   dxfLines.push('1.0');
//   dxfLines.push('17'); // Camera position X
//   dxfLines.push('108.0815506271596');
//   dxfLines.push('27'); // Camera position Y
//   dxfLines.push('148.5000119155985');
//   dxfLines.push('37'); // Camera position Z
//   dxfLines.push('0.0');
//   dxfLines.push('40'); // View Height
//   dxfLines.push('302.940024307821');
//   dxfLines.push('41'); // Aspect ratio
//   dxfLines.push('1.42206311037954');
//   dxfLines.push('42'); // Lens length
//   dxfLines.push('50.0');
//   dxfLines.push('43');
//   dxfLines.push('0.0');
//   dxfLines.push('44');
//   dxfLines.push('0.0');
//   dxfLines.push('50');
//   dxfLines.push('0.0');
//   dxfLines.push('51');
//   dxfLines.push('0.0');
//   dxfLines.push('71');
//   dxfLines.push('0');
//   dxfLines.push('72');
//   dxfLines.push('100');
//   dxfLines.push('73');
//   dxfLines.push('1');
//   dxfLines.push('74');
//   dxfLines.push('1');
//   dxfLines.push('75');
//   dxfLines.push('0');
//   dxfLines.push('76');
//   dxfLines.push('0');
//   dxfLines.push('77');
//   dxfLines.push('0');
//   dxfLines.push('78');
//   dxfLines.push('0');
//   dxfLines.push('281');
//   dxfLines.push('0');
//   dxfLines.push('65');
//   dxfLines.push('1');
//   dxfLines.push('110');
//   dxfLines.push('0.0');
//   dxfLines.push('120');
//   dxfLines.push('0.0');
//   dxfLines.push('130');
//   dxfLines.push('0.0');
//   dxfLines.push('111');
//   dxfLines.push('1.0');
//   dxfLines.push('121');
//   dxfLines.push('0.0');
//   dxfLines.push('131');
//   dxfLines.push('0.0');
//   dxfLines.push('112');
//   dxfLines.push('0.0');
//   dxfLines.push('122');
//   dxfLines.push('1.0');
//   dxfLines.push('132');
//   dxfLines.push('0.0');
//   dxfLines.push('79');
//   dxfLines.push('0');
//   dxfLines.push('0');
//   dxfLines.push('ENDTAB');

//   // Layer table (add handles)
//   dxfLines.push('0');
//   dxfLines.push('TABLE');
//   dxfLines.push('5'); dxfLines.push(getNextHandle()); // Handle for LAYER Table
//   dxfLines.push('100'); dxfLines.push('AcDbSymbolTable');
//   dxfLines.push('2');
//   dxfLines.push('LAYER');
//   dxfLines.push('70');
//   dxfLines.push('3');

//   // Default layer
//   dxfLines.push('0');
//   dxfLines.push('LAYER');
//   dxfLines.push('5'); dxfLines.push(getNextHandle()); // Handle for Layer '0'
//   dxfLines.push('100'); dxfLines.push('AcDbSymbolTableRecord');
//   dxfLines.push('100'); dxfLines.push('AcDbLayerTableRecord');
//   dxfLines.push('2');
//   dxfLines.push('0');
//   dxfLines.push('70');
//   dxfLines.push('0');
//   dxfLines.push('62');
//   dxfLines.push('7');
//   dxfLines.push('6');
//   dxfLines.push('CONTINUOUS');
//   dxfLines.push('330'); dxfLines.push(dxfLines[dxfLines.lastIndexOf('5') - 1]); // Owner handle (handle of LAYER Table)

//   // PARTS layer
//   dxfLines.push('0');
//   dxfLines.push('LAYER');
//   dxfLines.push('5'); dxfLines.push(getNextHandle()); // Handle for Layer 'PARTS'
//   dxfLines.push('100'); dxfLines.push('AcDbSymbolTableRecord');
//   dxfLines.push('100'); dxfLines.push('AcDbLayerTableRecord');
//   dxfLines.push('2');
//   dxfLines.push('PARTS');
//   dxfLines.push('70');
//   dxfLines.push('0');
//   dxfLines.push('62');
//   dxfLines.push('1');
//   dxfLines.push('6');
//   dxfLines.push('CONTINUOUS');
//   dxfLines.push('330'); dxfLines.push(dxfLines[dxfLines.lastIndexOf('5') - 1]); // Owner handle (handle of LAYER Table)

//   // BIN layer
//   dxfLines.push('0');
//   dxfLines.push('LAYER');
//   dxfLines.push('5'); dxfLines.push(getNextHandle()); // Handle for Layer 'BIN'
//   dxfLines.push('100'); dxfLines.push('AcDbSymbolTableRecord');
//   dxfLines.push('100'); dxfLines.push('AcDbLayerTableRecord');
//   dxfLines.push('2');
//   dxfLines.push('BIN');
//   dxfLines.push('70');
//   dxfLines.push('0');
//   dxfLines.push('62');
//   dxfLines.push('2');
//   dxfLines.push('6');
//   dxfLines.push('CONTINUOUS');
//   dxfLines.push('330'); dxfLines.push(dxfLines[dxfLines.lastIndexOf('5') - 1]); // Owner handle (handle of LAYER Table)

//   dxfLines.push('0');
//   dxfLines.push('ENDTAB');

//   // Linetype table (add handles)
//   dxfLines.push('0');
//   dxfLines.push('TABLE');
//   dxfLines.push('5'); dxfLines.push(getNextHandle()); // Handle for LTYPE Table
//   dxfLines.push('100'); dxfLines.push('AcDbSymbolTable');
//   dxfLines.push('2');
//   dxfLines.push('LTYPE');
//   dxfLines.push('70');
//   dxfLines.push('1');
  
//   dxfLines.push('0');
//   dxfLines.push('LTYPE');
//   dxfLines.push('5'); dxfLines.push(getNextHandle()); // Handle for LTYPE 'CONTINUOUS'
//   dxfLines.push('100'); dxfLines.push('AcDbSymbolTableRecord');
//   dxfLines.push('100'); dxfLines.push('AcDbLinetypeTableRecord');
//   dxfLines.push('2');
//   dxfLines.push('CONTINUOUS');
//   dxfLines.push('70');
//   dxfLines.push('0');
//   dxfLines.push('3');
//   dxfLines.push('Solid line');
//   dxfLines.push('72');
//   dxfLines.push('65');
//   dxfLines.push('73');
//   dxfLines.push('0');
//   dxfLines.push('40');
//   dxfLines.push('0.0'); // Total pattern length for empty pattern
//   dxfLines.push('330'); dxfLines.push(dxfLines[dxfLines.lastIndexOf('5') - 1]); // Owner handle (handle of LTYPE Table)
//   dxfLines.push('0');
//   dxfLines.push('ENDTAB');

//   // Style table (add handles)
//   dxfLines.push('0');
//   dxfLines.push('TABLE');
//   dxfLines.push('5'); dxfLines.push(getNextHandle()); // Handle for STYLE Table
//   dxfLines.push('100'); dxfLines.push('AcDbSymbolTable');
//   dxfLines.push('2');
//   dxfLines.push('STYLE');
//   dxfLines.push('70');
//   dxfLines.push('1');
  
//   dxfLines.push('0');
//   dxfLines.push('STYLE');
//   dxfLines.push('5'); dxfLines.push(getNextHandle()); // Handle for STYLE 'STANDARD'
//   dxfLines.push('100'); dxfLines.push('AcDbSymbolTableRecord');
//   dxfLines.push('100'); dxfLines.push('AcDbTextStyleTableRecord');
//   dxfLines.push('2');
//   dxfLines.push('STANDARD');
//   dxfLines.push('70');
//   dxfLines.push('0');
//   dxfLines.push('40');
//   dxfLines.push('0.0');
//   dxfLines.push('41');
//   dxfLines.push('1.0');
//   dxfLines.push('50');
//   dxfLines.push('0.0');
//   dxfLines.push('71');
//   dxfLines.push('0');
//   dxfLines.push('42');
//   dxfLines.push('2.5');
//   dxfLines.push('3');
//   dxfLines.push(''); // Font file name (empty for default)
//   dxfLines.push('4');
//   dxfLines.push(''); // Big font file name (empty)
//   dxfLines.push('330'); dxfLines.push(dxfLines[dxfLines.lastIndexOf('5') - 1]); // Owner handle (handle of STYLE Table)
//   dxfLines.push('0');
//   dxfLines.push('ENDTAB');

//   dxfLines.push('0');
//   dxfLines.push('ENDSEC');

//   // BLOCKS section (required for Illustrator compatibility, add handles if blocks were present)
//   // For now, it's empty, but if you add blocks, they would need handles.
//   dxfLines.push('0');
//   dxfLines.push('SECTION');
//   dxfLines.push('2');
//   dxfLines.push('BLOCKS');
//   dxfLines.push('0');
//   dxfLines.push('ENDSEC');

//   // DXF Entities
//   dxfLines.push('0');
//   dxfLines.push('SECTION');
//   dxfLines.push('2');
//   dxfLines.push('ENTITIES');
  
//   // Add bin boundary as LWPOLYLINE (add handle and owner)
//   const binPolygon = [
//     { x: PADDING, y: PADDING },
//     { x: 1000 + PADDING, y: PADDING },
//     { x: 1000 + PADDING, y: 2000 + PADDING },
//     { x: PADDING, y: 2000 + PADDING }
//   ];

//   dxfLines.push('0');
//   dxfLines.push('LWPOLYLINE');
//   dxfLines.push('5'); dxfLines.push(getNextHandle()); // Handle for the BIN LWPOLYLINE
//   dxfLines.push('100'); dxfLines.push('AcDbEntity'); // Subclass marker
//   dxfLines.push('8');
//   dxfLines.push('BIN'); // Layer name
//   dxfLines.push('100'); dxfLines.push('AcDbPolyline'); // Subclass marker
//   dxfLines.push('90'); // Number of vertices
//   dxfLines.push(binPolygon.length.toString());
//   dxfLines.push('70'); // Polyline flags
//   dxfLines.push('1'); // Flag 1 = Closed polyline

//   binPolygon.forEach(point => {
//     dxfLines.push('10'); // X coordinate
//     dxfLines.push(point.x.toString());
//     dxfLines.push('20'); // Y coordinate
//     dxfLines.push(point.y.toString());
//   });

//   // Add all parts from placements (add handle and owner)
//   placements.forEach((placement: NestingPlacement) => {
//     placement.parts.forEach((part: NestingPart) => {
//       if (!part.polygons || !part.polygons[0]) return;

//       // Transform polygon points (apply rotation and translation)
//       const transformedPoints = part.polygons[0].map(pt => {
//         const angle = (part.rotation || 0) * Math.PI / 180;
//         const cos = Math.cos(angle);
//         const sin = Math.sin(angle);
//         const x = pt.x * cos - pt.y * sin + (part.x || 0) + PADDING;
//         const y = pt.x * sin + pt.y * cos + (part.y || 0) + PADDING;
//         return { x, y };
//       });

//       // Adjust polygon closure logic for LWPOLYLINE.
//       // For LWPOLYLINE with flag 1 (closed), the last point should NOT be a repeat of the first.
//       // The DXF reader closes the loop automatically.
//       let pointsForLWPolyline = [...transformedPoints];

//       if (pointsForLWPolyline.length > 0 &&
//           pointsForLWPolyline[0].x === pointsForLWPolyline[pointsForLWPolyline.length - 1].x &&
//           pointsForLWPolyline[0].y === pointsForLWPolyline[pointsForLWPolyline.length - 1].y) {
//           pointsForLWPolyline.pop(); // Remove the duplicate closing point
//       }
      
//       // Ensure there are enough points after processing
//       if (pointsForLWPolyline.length < 2) {
//           console.warn('Skipping part due to insufficient points for LWPOLYLINE after processing:', part);
//           return; // Skip this part if it's not a valid polyline
//       }

//       // Add part as LWPOLYLINE
//       dxfLines.push('0');
//       dxfLines.push('LWPOLYLINE');
//       dxfLines.push('5'); dxfLines.push(getNextHandle()); // Handle for this PART LWPOLYLINE
//       dxfLines.push('100'); dxfLines.push('AcDbEntity'); // Subclass marker
//       dxfLines.push('8');
//       dxfLines.push('PARTS'); // Layer name
//       dxfLines.push('100'); dxfLines.push('AcDbPolyline'); // Subclass marker
//       dxfLines.push('90'); // Number of vertices
//       dxfLines.push(pointsForLWPolyline.length.toString());
//       dxfLines.push('70'); // Polyline flags
//       dxfLines.push('1'); // Flag 1 = Closed polyline

//       pointsForLWPolyline.forEach(point => {
//         dxfLines.push('10'); // X coordinate
//         dxfLines.push(point.x.toString());
//         dxfLines.push('20'); // Y coordinate
//         dxfLines.push(point.y.toString());
//       });
//     });
//   });

//   dxfLines.push('0');
//   dxfLines.push('ENDSEC');

//   // OBJECTS section (add a minimal root dictionary)
//   dxfLines.push('0');
//   dxfLines.push('SECTION');
//   dxfLines.push('2');
//   dxfLines.push('OBJECTS');

//   // Root Dictionary - essential for handle-based DXF.
//   // Its handle is typically 1 (if $HANDSEED starts at 1) and its owner is 0 (null).
//   dxfLines.push('0');
//   dxfLines.push('DICTIONARY');
//   dxfLines.push('5'); dxfLines.push(getNextHandle()); // Assign a handle for the root dictionary
//   dxfLines.push('102'); dxfLines.push('{ACAD_REACTORS'); // Begin reactors group (optional but often present)
//   dxfLines.push('330'); dxfLines.push('1'); // Reactor to the root dictionary itself (or another handle)
//   dxfLines.push('102'); dxfLines.push('}'); // End reactors group
//   dxfLines.push('330'); dxfLines.push('0'); // Owner handle (0 for root dictionary)
//   dxfLines.push('100'); dxfLines.push('AcDbDictionary'); // Subclass marker
//   dxfLines.push('280'); dxfLines.push('1'); // Hard-pointer owner flag
//   dxfLines.push('281'); dxfLines.push('0'); // Cloned dictionary (0 = No, 1 = Yes)

//   dxfLines.push('0');
//   dxfLines.push('ENDSEC');

//   dxfLines.push('0');
//   dxfLines.push('EOF');

//   // Use CRLF line endings for maximum compatibility
//   return dxfLines.join('\r\n');
// }
  const generateSVG = (placements: NestingPlacement[], foamSheetName: string): string => {
    const PADDING = 10; // 10mm padding
    const VIEWBOX_WIDTH = 1000 + 2 * PADDING; // 1020mm total width
    const VIEWBOX_HEIGHT = 2000 + 2 * PADDING; // 2020mm total height
    
    // Get the selected sheet's placement data
    const selectedSheet = placements[0]; // We're only exporting one sheet
    const allParts = selectedSheet.parts || [];
    
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
    
    // Compute bounding box of all points
    let minX = allPoints.length > 0 ? Math.min(...allPoints.map(p => p.x)) : 0;
    let minY = allPoints.length > 0 ? Math.min(...allPoints.map(p => p.y)) : 0;
    let maxX = allPoints.length > 0 ? Math.max(...allPoints.map(p => p.x)) : 1000;
    let maxY = allPoints.length > 0 ? Math.max(...allPoints.map(p => p.y)) : 2000;
    
    // Compute scale to fit the specified viewBox dimensions
    const polyWidth = maxX - minX;
    const polyHeight = maxY - minY;
    const scale = Math.min(
      VIEWBOX_WIDTH / polyWidth,
      VIEWBOX_HEIGHT / polyHeight
    );
    
    // Compute translation to center polygons in the viewBox
    const offsetX = (VIEWBOX_WIDTH - polyWidth * scale) / 2 - minX * scale;
    const offsetY = (VIEWBOX_HEIGHT - polyHeight * scale) / 2 - minY * scale;
    
    // Generate unique order colors
    const uniqueOrders = (() => {
      const items = nestingQueueData[foamSheetName]?.items || [];
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
    
    // SVG header
    let svgContent = `<?xml version="1.0" encoding="UTF-8"?>
<svg width="${VIEWBOX_WIDTH}mm" height="${VIEWBOX_HEIGHT}mm" viewBox="0 0 ${VIEWBOX_WIDTH} ${VIEWBOX_HEIGHT}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <style>
      .viewbox { stroke: #000000; stroke-width: 2; fill: #ffffff; }
      .part { stroke: #000000; stroke-width: 1; fill: none; }
    </style>
  </defs>`;
    
    // Add viewbox boundary
    const viewboxPolygon = [
      { x: PADDING, y: PADDING },
      { x: 1000 + PADDING, y: PADDING },
      { x: 1000 + PADDING, y: 2000 + PADDING },
      { x: PADDING, y: 2000 + PADDING }
    ];
    const viewboxPoints = viewboxPolygon.map(pt => `${pt.x},${pt.y}`).join(' ');
    svgContent += `
  <polygon points="${viewboxPoints}" class="viewbox" />`;
    
    // Add all parts
    selectedSheet.parts.forEach((part: NestingPart, partIndex: number) => {
      if (!part.polygons || !part.polygons[0]) return;
      
      // Transform polygon points
      const transformedPoints = part.polygons[0].map(pt => {
        const angle = (part.rotation || 0) * Math.PI / 180;
        const cos = Math.cos(angle);
        const sin = Math.sin(angle);
        const x = pt.x * cos - pt.y * sin + (part.x || 0) + PADDING;
        const y = pt.x * sin + pt.y * cos + (part.y || 0) + PADDING;
        return { x, y };
      });
      
      const points = transformedPoints.map(pt => `${pt.x},${pt.y}`).join(' ');
      
      // Add part polygon (outline only, no fill)
      svgContent += `
  <polygon points="${points}" class="part" />`;
    });
    
    svgContent += `
</svg>`;
    
    return svgContent;
  }

  // Update the table in the first section to show nesting queue data
  return (
    <RouteProtection requiredPermission="canAccessManufacturing">
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
            {(() => {
              const isCNC = selectedStation === 'CNC';
              return (
                <button
                  onClick={async () => {
                    if (isCNC) return; // Prevent navigation for CNC
                    await Sentry.startSpan({
                      name: 'setActiveTab-MediumSheets',
                    }, async () => {
                      setActiveTab('medium');
                      if (selectedFoamSheet) {
                        setLoadingMediumSheetOrders(true);
                        setOrdersWithMediumSheets(prev => {
                          const newState = { ...prev };
                          if (selectedFoamSheet in newState) {
                            delete newState[selectedFoamSheet];
                          }
                          return newState;
                        });
                        findOrdersWithMediumSheet(selectedFoamSheet);
                      }
                    });
                  }}
                  className={`relative rounded-full font-medium transition-all duration-300 z-10 flex-1 py-2 px-3 ${isCNC ? 'opacity-50 cursor-not-allowed' : ''}`}
                  disabled={isCNC || !accessPermissions.canAccessMediumSheets}
                  aria-disabled={isCNC || !accessPermissions.canAccessMediumSheets}
                  title={isCNC ? 'CNC station cannot access Medium Sheets' : undefined}
                >
                  <span className={`relative z-10 flex items-center justify-center gap-1.5 whitespace-nowrap ${activeTab === 'medium' ? 'text-white font-semibold' : 'text-gray-300 hover:text-white'}`}>
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                    </svg>
                    Medium Sheets
                  </span>
                </button>
              );
            })()}
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
                      className={`px-4 py-2 text-md font-bold ${firstColTab === 'Nesting Queue' ? 'text-white border-b-2 border-white' : 'text-gray-500 border-b-2 border-transparent'} bg-transparent focus:outline-none ${!accessPermissions.canAccessNestingQueue ? 'opacity-50 cursor-not-allowed pointer-events-none' : ''}`}
                      style={{ marginBottom: '-1px' }}
                      onClick={() => handleFirstColTabChange('Nesting Queue')}
                      disabled={!accessPermissions.canAccessNestingQueue}
                      aria-disabled={!accessPermissions.canAccessNestingQueue}
                    >
                      Nesting Queue
                    </button>
                    <button
                      className={`px-4 py-2 text-md font-medium ${firstColTab === 'Completed Cuts' ? 'text-white border-b-2 border-white' : 'text-gray-500 border-b-2 border-transparent'} bg-transparent focus:outline-none ${!accessPermissions.canAccessCompletedCuts ? 'opacity-50 cursor-not-allowed pointer-events-none' : ''}`}
                      style={{ marginBottom: '-1px' }}
                      onClick={() => handleFirstColTabChange('Completed Cuts')}
                      disabled={!accessPermissions.canAccessCompletedCuts}
                      aria-disabled={!accessPermissions.canAccessCompletedCuts}
                    >
                      Completed Cuts
                    </button>
                    <button
                      className={`px-4 py-2 text-md font-medium ${firstColTab === 'Work In Progress' ? 'text-white border-b-2 border-white' : 'text-gray-500 border-b-2 border-transparent'} bg-transparent focus:outline-none ${!accessPermissions.canAccessWorkInProgress ? 'opacity-50 cursor-not-allowed pointer-events-none' : ''}`}
                      style={{ marginBottom: '-1px' }}
                      onClick={() => handleFirstColTabChange('Work In Progress')}
                      disabled={!accessPermissions.canAccessWorkInProgress}
                      aria-disabled={!accessPermissions.canAccessWorkInProgress}
                    >
                      Work In Progress
                    </button>
                  </div>
                </div>
              </div>
              <div className="overflow-x-auto bg-white h-[calc(93vh-300px)] flex flex-col">
                {firstColTab == "Completed Cuts" ? (
                  <div className= "flex-1 flex flex-col items-center justify-center bg-gray-50 p-2">
                    <table className="w-full bg-white/90 backdrop-blur-sm table-auto h-full">
                      <thead className="bg-gray-100/90 sticky top-0">
                        <tr>
                          <th className="px-6 py-4 text-center text-lg font-semibold text-black">Foam Sheet</th>
                          <th className="px-6 py-4 text-center text-lg font-semibold text-black">Nesting ID</th>
                          <th className="px-6 py-4 text-center text-lg font-semibold text-black">Pieces</th>
                          <th className="px-6 py-4 text-center text-lg font-semibold text-black">Yield</th>
                          <th className="px-6 py-4 text-center text-lg font-semibold text-black">Time</th>
                          <th className="px-6 py-4 text-center text-lg font-semibold text-black">Sheets</th>
                          <th className="px-6 py-4 text-center text-lg font-semibold text-black">Lock</th>
                        </tr>
                      </thead>
                      <tbody>
                        <td colSpan={7} className="px-6 py-10 text-center">
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
                ) : orders.length === 0 ? (
                  <div className="text-center py-4">
                    <p className="text-black">No orders found</p>
                    <p className="text-sm text-gray-400 mt-1">Try refreshing the page</p>
                  </div>
                ) : (
                  <div className="flex-1 flex flex-col items-center justify-center bg-gray-50 p-2">
                    <table className="w-full bg-white/90 backdrop-blur-sm table-auto h-full">
                    <thead className="bg-gray-100/90 sticky top-0">
                        <tr>
                          <th className="px-6 py-4 text-center text-lg font-semibold text-black">Foam Sheet</th>
                          <th className="px-6 py-4 text-center text-lg font-semibold text-black">Nesting ID</th>
                          <th className="px-6 py-4 text-center text-lg font-semibold text-black">Pieces</th>
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
                )}
              </div>
            </div>
            {/* Nesting Visualization Section */}
            {firstColTab !== 'Work In Progress' && (
              <div className="flex-1 min-w-0 max-w-96 flex flex-col bg-black/70 rounded-xl shadow-xl p-3">
                {/** Nesting Visualization Title */}
                <div className="rounded-t-lg">
                  <div className="flex justify-between items-center p-4">
                    <h1 className="text-xl font-bold text-white">
                      Nesting Visualization
                    </h1>
                    {selectedNestingRow && (() => {
                      // Get the nesting data for the selected row and sheet
                      const nestingData = nestingQueueData[selectedNestingRow];
                      const placements = nestingData?.nestingResult?.placements || [];
                      
                      if (placements.length === 0 || selectedSheetIndex >= placements.length) {
                        return null;
                      }

                      const selectedSheet = placements[selectedSheetIndex];
                      const sheetsToExport = [selectedSheet]; // Export only the selected sheet

                      // Generate SVG content
                      const svgContent = generateSVG(sheetsToExport, selectedNestingRow);
                      
                      return (
                        <DxfConverterButton
                          svgContent={svgContent}
                          userId={userProfile?.email || ''}
                          onConversionSuccess={(dxfUrl) => {
                            console.log('DXF conversion successful:', dxfUrl);
                          }}
                          onConversionError={(error) => {
                            console.error('DXF conversion failed:', error);
                          }}
                        />
                      );
                    })()}
                  </div>
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
                      // Get the selected sheet's placement data
                      const nestingData = nestingQueueData[selectedNestingRow as string];
                      const sheets = nestingData?.nestingResult?.placements || [];
                      
                      if (sheets.length === 0 || selectedSheetIndex >= sheets.length) {
                        return (
                          <div className="flex flex-col items-center justify-center h-full text-gray-400">
                            <svg xmlns="http://www.w3.org/2000/svg" className="h-12 w-12 mb-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                            </svg>
                            <p className="text-lg font-medium">No placement data available</p>
                            <p className="text-sm mt-1">No nesting result found for this sheet</p>
                          </div>
                        );
                      }

                      const selectedSheet = sheets[selectedSheetIndex];
                      const allParts = selectedSheet.parts || [];
                      
                      // Gather all points after translation/rotation from the selected sheet only
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
                      let minX = allPoints.length > 0 ? Math.min(...allPoints.map(p => p.x)) : 0;
                      let minY = allPoints.length > 0 ? Math.min(...allPoints.map(p => p.y)) : 0;
                      let maxX = allPoints.length > 0 ? Math.max(...allPoints.map(p => p.x)) : 1000;
                      let maxY = allPoints.length > 0 ? Math.max(...allPoints.map(p => p.y)) : 2000;
                      
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
                              // Try to get the actual binPolygon from the selected sheet
                              const binPoly = selectedSheet.binPolygon;
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
                              {/* Render only the selected sheet's parts */}
                              {selectedSheet.parts.map((part: NestingPart, partIndex: number) => {
                                if (!part.polygons || !part.polygons[0]) return null;
                                
                                // Find the order index for this part's orderId in uniqueOrders
                                const uniqueOrders = (() => {
                                  const items = nestingData?.items || [];
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
                ): (
                  <>
                  </>
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
                  <div className="overflow-x-auto rounded-xl border border-slate-200/20 shadow-2xl h-full bg-gradient-to-br from-slate-800 via-slate-600 to-slate-800">
                    <div className="w-full h-full p-4 flex flex-col">
                      {/* Header */}
                      <div className="mb-4">
                        <h2 className="text-xl font-bold text-white text-center tracking-tight">
                          {selectedFoamSheet ? (
                            <div className="flex items-center justify-center gap-2">
                              <div className={`w-4 h-4 rounded-full shadow-lg ${getSheetColorClass(formatMediumSheetName(selectedFoamSheet))}`}></div>
                              <span className="text-lg">{formatMediumSheetName(selectedFoamSheet)}</span>
                            </div>
                          ) : (
                            <span className="text-slate-400">Select a Medium Sheet</span>
                          )}
                        </h2>
                      </div>

                      {selectedFoamSheet ? (
                        <>
                          {/* Cards Grid */}
                          <div className="grid grid-cols-2 gap-3 flex-1">
                            {/* Current Stock */}
                             <div className="bg-slate-800/50 backdrop-blur-sm border border-blue-500/30 rounded-lg p-3 shadow-lg hover:shadow-xl transition-all duration-200 hover:border-blue-400/50 flex flex-col">
                               <div className="flex items-center gap-2 mb-2">
                                 <div className="p-1.5 bg-blue-500/20 rounded-md">
                                   <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5 text-blue-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                     <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4" />
                                   </svg>
                                 </div>
                                 <h3 className="text-md font-semibold text-blue-300 uppercase tracking-wide">Current Stock Available</h3>
                               </div>
                               <div className="flex-1 flex items-center justify-center">
                                 <div className="text-5xl font-bold text-white font-mono">
                                   {finishedStockBySku[selectedFoamSheet] ?? 0}
                                 </div>
                               </div>
                             </div>

                              {/* Cutting Required */}
                             <div className="bg-slate-800/50 backdrop-blur-sm border border-orange-500/30 rounded-lg p-3 shadow-lg hover:shadow-xl transition-all duration-200 hover:border-orange-400/50 flex flex-col">
                               <div className="flex items-center gap-2 mb-2">
                                 <div className="p-1.5 bg-orange-500/20 rounded-md">
                                   <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5 text-orange-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                     <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.121 14.121L19 19m-7-7l7-7m-7 7l-2.879 2.879M12 12L9.121 9.121m0 5.758a3 3 0 10-4.243-4.243 3 3 0 004.243 4.243z" />
                                   </svg>
                                 </div>
                                 <h3 className="text-md font-semibold text-orange-300 uppercase tracking-wide">2X1's To Cut</h3>
                               </div>
                               <div className="flex-1 flex items-center justify-center">
                                 <div className="text-5xl font-bold text-white font-mono">
                                   {(() => {
                                     const stock = finishedStockBySku[selectedFoamSheet] ?? 0;
                                     const needed = Math.max(0, selectedMediumSheetQuantity - stock);
                                     let adjusted = needed;
                                     if (needed > 0 && needed % 4 !== 0) {
                                       adjusted = Math.ceil(needed / 4) * 4;
                                     }
                                     const numSheets = adjusted > 0 ? adjusted / 4 : 0;
                                     return numSheets;
                                   })()}
                                 </div>
                               </div>
                             </div>

                              {/* Take to Packing */}
                             <div className="bg-slate-800/50 backdrop-blur-sm border border-emerald-500/30 rounded-lg p-3 shadow-lg hover:shadow-xl transition-all duration-200 hover:border-emerald-400/50 flex flex-col">
                               <div className="flex items-center gap-2 mb-2">
                                 <div className="p-1.5 bg-emerald-500/20 rounded-md">
                                   <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                     <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
                                   </svg>
                                 </div>
                                 <h3 className="text-md font-semibold text-emerald-300 uppercase tracking-wide">Take To Packing</h3>
                               </div>
                               <div className="flex-1 flex items-center justify-center">
                                 <div className="text-5xl font-bold text-white font-mono">
                                   {selectedMediumSheetQuantity || 0}
                                 </div>
                               </div>
                             </div>

                              {/* Stock After */}
                             <div className="bg-slate-800/50 backdrop-blur-sm border border-violet-500/30 rounded-lg p-3 shadow-lg hover:shadow-xl transition-all duration-200 hover:border-violet-400/50 flex flex-col">
                               <div className="flex items-center gap-2 mb-2">
                                 <div className="p-1.5 bg-violet-500/20 rounded-md">
                                   <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5 text-violet-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                     <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                                   </svg>
                                 </div>
                                 <h3 className="text-md font-semibold text-violet-300 uppercase tracking-wide">New Stock Level</h3>
                               </div>
                               <div className="flex-1 flex items-center justify-center">
                                 <div className="text-5xl font-bold text-white font-mono">
                                   {(() => {
                                     const stock = finishedStockBySku[selectedFoamSheet] ?? 0;
                                     const needed = Math.max(0, selectedMediumSheetQuantity - stock);
                                     let adjusted = needed;
                                     if (needed > 0 && needed % 4 !== 0) {
                                       adjusted = Math.ceil(needed / 4) * 4;
                                     }
                                     const numSheets = adjusted > 0 ? adjusted / 4 : 0;
                                     const newStockLevel = stock + (numSheets * 4) - selectedMediumSheetQuantity;
                                     return newStockLevel;
                                   })()}
                                 </div>
                               </div>
                             </div>
                          </div>

                          {/* Action Button */}
                          <div className="mt-4">
                            <button
                              type="button"
                              className="w-full px-4 py-2.5 rounded-lg text-white font-semibold bg-gradient-to-r from-emerald-600 via-emerald-500 to-emerald-600 hover:from-emerald-500 hover:via-emerald-400 hover:to-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-400/50 shadow-lg hover:shadow-xl transition-all duration-200 transform hover:scale-[1.02] active:scale-[0.98]"
                              onClick={handleConfirmMediumSheet}
                            >
                              <div className="flex items-center justify-center gap-2">
                                <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                                </svg>
                                Confirm Processing
                              </div>
                            </button>
                          </div>
                        </>
                      ) : (
                        <div className="flex-1 flex items-center justify-center">
                          <div className="text-center text-slate-400">
                            <div className="w-12 h-12 mx-auto mb-3 p-3 bg-slate-800/50 rounded-full">
                              <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6 text-slate-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                              </svg>
                            </div>
                            <p className="text-sm font-medium">No medium sheet selected</p>
                            <p className="text-xs mt-1 text-slate-500">Select a sheet to view details</p>
                          </div>
                        </div>
                      )}
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
    </RouteProtection>
  );
}
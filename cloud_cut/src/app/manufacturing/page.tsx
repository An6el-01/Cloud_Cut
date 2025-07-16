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
import { subscribeToOrders, subscribeToOrderItems, supabase, getSupabaseClient, subscribeToActiveNests, subscribeToCompletedNests } from "@/utils/supabase";
import { OrderItem, Order, NestingItem, ProcessedNestingData, NestingPlacement, NestingPart } from "@/types/redux";
import { inventoryMap } from '@/utils/inventoryMap';
import { store } from "@/redux/store";
import * as Sentry from "@sentry/nextjs";
import { NestingProcessor } from '@/nesting/nestingProcessor';
import { fetchInventory, reduceStock } from '@/utils/despatchCloud';
import { getMixedPackInfo } from '@/utils/skuParser';
import RouteProtection from '@/components/RouteProtection';
import { useRouter } from "next/navigation";
import { clearActiveNests, assignNestingId } from '@/utils/manufacturingUtils';

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
  const router = useRouter();
  
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

  const [activeNests, setActiveNests] = useState<any[]>([]);
  const [completedNests, setCompletedNests] = useState<any[]>([]);

  // Fetch latest active_nests and completed_nests on mount
  useEffect(() => {
    const fetchNests = async () => {
      const supabase = getSupabaseClient();
      const { data: active, error: activeError } = await supabase
        .from('active_nests')
        .select('*');
      if (!activeError && active) setActiveNests(active);
      const { data: completed, error: completedError } = await supabase
        .from('completed_nests')
        .select('*');
      if (!completedError && completed) setCompletedNests(completed);
    };
    fetchNests();
  }, []);

  // Subscribe to real-time changes in active_nests for real-time locked status
  useEffect(() => {
    const activeNestsSubscription = subscribeToActiveNests((payload) => {
      // Refetch active_nests on any change
      getSupabaseClient()
        .from('active_nests')
        .select('*')
        .then(({ data, error }) => {
          if (!error && data) setActiveNests(data);
        });
    });
    return () => {
      activeNestsSubscription.unsubscribe();
    };
  }, []);

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
    setSelectedNestingRow(null);

    // Clear all unlocked nests before starting new nesting
    await clearActiveNests();

    // Fetch all locked nests and parse cut_details to avoid renesting
    const supabase = getSupabaseClient();
    const { data: lockedNests, error: lockedNestsError } = await supabase
      .from('active_nests')
      .select('cut_details')
      .eq('locked', true);

    let alreadyNestedItems = new Set();
    if (lockedNests && Array.isArray(lockedNests)) {
      lockedNests.forEach((nest: any) => {
        if (nest.cut_details) {
          try {
            const details = typeof nest.cut_details === 'string'
              ? JSON.parse(nest.cut_details)
              : nest.cut_details;
            (details as any[]).forEach((order: any) => {
              (order.items || []).forEach((item: any) => {
                alreadyNestedItems.add(`${order.orderId}|${item.sku}|${item.itemName}`);
              });
            });
          } catch (e) {
            console.error('Failed to parse cut_details:', e);
          }
        }
      });
    }
    
    try {
      // Get all orders with manufacturing items
      const manufacturingOrders = orders.filter((order: Order) => {
        const items = orderItemsById[order.order_id] || [];
        // Exclude items already nested
        return items.some(item => {
          const key = `${order.order_id}|${item.sku_id}|${item.item_name}`;
          return !alreadyNestedItems.has(key) &&
            (item.sku_id.startsWith('SFI') || item.sku_id.startsWith('SFC') || item.sku_id.startsWith('SFP') || item.sku_id.startsWith('SFSK')) &&
            !item.completed;
        });
      });

      // Create a map to store items by foam sheet
      const itemsByFoamSheet: Record<string, NestingItem[]> = {};

      // Process each order
      manufacturingOrders.forEach((order: Order) => {
        const items = orderItemsById[order.order_id] || [];
        // Filter for SFI, SFC, SFP, and SFSK items that aren't completed and not already nested
        const manufacturingItems = items.filter(item => {
          const key = `${order.order_id}|${item.sku_id}|${item.item_name}`;
          return !alreadyNestedItems.has(key) &&
            (item.sku_id.startsWith('SFI') || item.sku_id.startsWith('SFC') || item.sku_id.startsWith('SFP') || item.sku_id.startsWith('SFSK')) &&
            !item.completed;
        });

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
      
      // Prepare to assign non-conflicting nesting IDs
      const foamSheetKeys = Object.keys(itemsByFoamSheet);
      const newNestCount = foamSheetKeys.length;
      let assignedNestingIds: string[] = [];
      if (newNestCount > 0) {
        assignedNestingIds = await assignNestingId(Array(newNestCount).fill(''));
      }

      let nestIndex = 0;
      for (const [foamSheet, items] of Object.entries(itemsByFoamSheet)) {
        try {
          // First fetch SVGs
          const itemsWithSvgs = await fetchSvgFiles(items);
          
          // Then run nesting
          const nestingResult = await nestingProcessor.processNesting(itemsWithSvgs);
          
          // Assign a non-conflicting nestingId to this nest
          const nestingId = assignedNestingIds[nestIndex] || `NST-${nestIndex + 1}`;
          nestIndex++;

          // Store both items and nesting result, and attach nestingId if needed
          processedItemsByFoamSheet[foamSheet] = {
            items: itemsWithSvgs,
            nestingResult: nestingResult,
            // Optionally, you can add nestingId here if you want to use it elsewhere
            // nestingId: nestingId
          };
          // When saving to DB, use nestingId for this nest
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

      // Build a list of all nests (including those with no valid placements)
      const allNests: Array<{
        foamSheet: string,
        processed: ProcessedNestingData & { nestingId?: string },
        yieldPercent: string,
        timeString: string,
        pieces: number
      }> = [];
      function polygonArea(points: { x: number, y: number }[]): number {
        let area = 0;
        for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
          area += (points[j].x + points[i].x) * (points[j].y - points[i].y);
        }
        return Math.abs(area / 2);
      }
      function formatTime(seconds: number): string {
        const totalMinutes = Math.floor(seconds / 60);
        const remainingSeconds = Math.floor(seconds % 60);
        const hours = Math.floor(totalMinutes / 60);
        const minutes = totalMinutes % 60;
        if (hours > 0) {
          return `${hours}h ${minutes}m ${remainingSeconds}s`;
        } else {
          return `${minutes}m ${remainingSeconds}s`;
        }
      }
      for (const [foamSheet, processed] of Object.entries(processedItemsByFoamSheet)) {
        const nestingResult = processed.nestingResult;
        let yieldPercent = '—';
        let timeString = '';
        let pieces = 0;
        if (nestingResult && nestingResult.placements && nestingResult.placements.length > 0) {
          const placements = nestingResult.placements || [];
          const binPolygon = [
            { x: 0, y: 0 },
            { x: 1000, y: 0 },
            { x: 1000, y: 2000 },
            { x: 0, y: 2000 },
            { x: 0, y: 0 }
          ];
          const binArea = polygonArea(binPolygon);
          const totalPartsArea = placements.reduce((sum, placement) => {
            return sum + (placement.parts || []).reduce((s, part) => {
              if (part.polygons && part.polygons[0]) {
                return s + polygonArea(part.polygons[0]);
              }
              return s;
            }, 0);
          }, 0);
          yieldPercent = binArea > 0 ? `${((totalPartsArea / binArea) * 100).toFixed(1)}%` : '—';
          // --- Begin time calculation logic ---
          let totalTimeSeconds = 0;
          const getFoamDepth = (foamSheetName: string): number => {
            const match = foamSheetName.match(/(\d+)mm/);
            if (match) {
              return parseInt(match[1]);
            }
            const formattedName = formatMediumSheetName(foamSheetName);
            const formattedMatch = formattedName.match(/\[(\d+)mm\]/);
            if (formattedMatch) {
              return parseInt(formattedMatch[1]);
            }
            return 30;
          };
          const foamDepth = getFoamDepth(foamSheet);
          const getCornerTime = (depth: number): number => {
            if (depth <= 30) return 2;
            if (depth <= 50) return 3.5;
            if (depth <= 70) return 4.5;
            return 4.5;
          };
          const cornerTimePerCorner = getCornerTime(foamDepth);
          placements.forEach((placement) => {
            (placement.parts || []).forEach((part) => {
              if (part.polygons && part.polygons[0]) {
                const points = part.polygons[0];
                const xCoords = points.map(p => p.x);
                const yCoords = points.map(p => p.y);
                const minX = Math.min(...xCoords);
                const maxX = Math.max(...xCoords);
                const minY = Math.min(...yCoords);
                const maxY = Math.max(...yCoords);
                const width = maxX - minX;
                const height = maxY - minY;
                const actualPerimeter = (width + height) * 2;
                let cornerCount = 0;
                const angleThresholdDegrees = 45;
                const angleThresholdRadians = angleThresholdDegrees * (Math.PI / 180);
                const minSegmentLength = 5;
                for (let i = 0; i < points.length; i++) {
                  const prevPoint = points[(i - 1 + points.length) % points.length];
                  const currentPoint = points[i];
                  const nextPoint = points[(i + 1) % points.length];
                  const vec1x = currentPoint.x - prevPoint.x;
                  const vec1y = currentPoint.y - prevPoint.y;
                  const vec2x = nextPoint.x - currentPoint.x;
                  const vec2y = nextPoint.y - currentPoint.y;
                  const mag1 = Math.sqrt(vec1x * vec1x + vec1y * vec1y);
                  const mag2 = Math.sqrt(vec2x * vec2x + vec2y * vec2y);
                  if (mag1 > minSegmentLength && mag2 > minSegmentLength) {
                    const dot = vec1x * vec2x + vec1y * vec2y;
                    const cosAngle = dot / (mag1 * mag2);
                    const angle = Math.acos(Math.max(-1, Math.min(1, cosAngle)));
                    if (angle > angleThresholdRadians) {
                      cornerCount++;
                    }
                  }
                }
                if (cornerCount < 4) {
                  cornerCount = 4;
                } else if (cornerCount > 12) {
                  cornerCount = 12;
                }
                const perimeterTime = actualPerimeter / 16;
                const partCornerTime = cornerCount * cornerTimePerCorner;
                const partTime = perimeterTime + partCornerTime;
                totalTimeSeconds += partTime;
              }
            });
          });
          timeString = formatTime(totalTimeSeconds);
          // --- End time calculation logic ---
          pieces = placements.reduce((sum, p) => sum + (p.parts?.length || 0), 0);
        }
        allNests.push({ foamSheet, processed, yieldPercent, timeString, pieces });
      }
      // Assign non-conflicting IDs for all nests
      if (allNests.length > 0) {
        assignedNestingIds = await assignNestingId(Array(allNests.length).fill(''));
      }
      // Insert all nests and store nestingId for UI
      for (let i = 0; i < allNests.length; i++) {
        const { foamSheet, processed, yieldPercent, timeString, pieces } = allNests[i];
        const nestingId = assignedNestingIds[i] || `NST-${i + 1}`;
        const nestingResult = processed.nestingResult;
        // Build cut_details structure (may be empty)
        const orderMap: Record<string, any> = {};
        if (nestingResult && nestingResult.placements) {
          nestingResult.placements.forEach((placement) => {
            (placement.parts || []).forEach((part) => {
              const orderId = part.source?.orderId || part.orderId || '';
              const customerName = part.source?.customerName || part.customerName || '';
              const color = foamSheet.split(' ')[0];
              const key = `${orderId}|${customerName}|${color}`;
              if (!orderMap[key]) {
                orderMap[key] = {
                  customerName,
                  orderId,
                  color,
                  items: []
                };
              }
              orderMap[key].items.push({
                itemName: part.source?.itemName || part.itemName || '',
                quantity: part.source?.quantity || 1,
                sku: part.source?.sku || '',
                svgUrl: part.source?.svgUrl || [],
                x: part.x,
                y: part.y,
                priority: part.source?.priority || part.priority || 0
              });
            });
          });
        }
        const cutDetails = Object.values(orderMap);
        await supabase.from('active_nests').insert([
          {
            foamsheet: foamSheet,
            nesting_id: nestingId,
            pieces: pieces,
            yield: yieldPercent,
            time: timeString,
            nest: nestingResult ? JSON.stringify(nestingResult) : '',
            cut_details: cutDetails,
            locked: false
          }
        ]);
        // Store nestingId for UI
        processed.nestingId = nestingId;
      }

      // Return the processed data
      return processedItemsByFoamSheet;
    } catch (error) {
      console.error('Error in handleTriggerNesting:', error);
    } finally {
      // Clear loading states
      setIsNesting(false);
      setNestingLoading(false);
      // Refetch active_nests to update the nesting queue table
      try {
        const { data: active, error: activeError } = await supabase
          .from('active_nests')
          .select('*');
        if (!activeError && active) setActiveNests(active);
      } catch (fetchError) {
        console.error('Error refetching active_nests after nesting:', fetchError);
      }
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
    if (!activeNests || activeNests.length === 0) {
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

    // Sort nests by yield descending
    const sortedNests = [...activeNests].sort((a, b) => {
      const parseYield = (y: any) => {
        if (!y) return 0;
        if (typeof y === 'number') return y;
        if (typeof y === 'string') {
          const num = parseFloat(y.replace('%', ''));
          return isNaN(num) ? 0 : num;
        }
        return 0;
      };
      return parseYield(b.yield) - parseYield(a.yield);
    });
    return sortedNests.map((nest, idx) => {
      const isLocked = nest.locked === true || nest.locked === 'true';
      return (
        <tr
          key={nest.id || idx}
          className={`transition-colors duration-150 cursor-pointer shadow-sm
            ${nest.foamsheet === selectedNestingRow ? 'bg-blue-200 !hover:bg-blue-200' : isLocked ? 'bg-red-200 !hover:bg-red-200' : idx % 2 === 0 ? 'bg-white' : 'bg-gray-50'}
            ${nest.foamsheet !== selectedNestingRow ? 'hover:bg-blue-50' : ''}
          `}
          role="button"
          tabIndex={0}
          onClick={() => {
            setSelectedNestingRow(nest.foamsheet);
            setSelectedMediumSheet(formatMediumSheetName(nest.foamsheet));
            setSelectedSheetIndex(0);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              setSelectedNestingRow(nest.foamsheet);
              setSelectedMediumSheet(formatMediumSheetName(nest.foamsheet));
              setSelectedSheetIndex(0);
            }
          }}
          aria-selected={selectedNestingRow === nest.foamsheet}
        >
          <td className="px-6 py-4 text-left">
            <div className="flex items-center justify-center">
              <div className={`w-4 h-4 rounded-full mr-3 ${getSheetColorClass(formatMediumSheetName(nest.foamsheet))}`}></div>
              <span className="text-black text-lg">
                {formatMediumSheetName(nest.foamsheet)}
              </span>
            </div>
          </td>
          <td className="px-6 py-4 text-center">{nest.nesting_id}</td>
          <td className="px-6 py-4 text-center">
            <span className="inline-flex items-center justify-center min-w-[2.5rem] px-3 py-1 shadow-sm rounded-full text-lg text-black">
              {nest.pieces}
            </span>
          </td>
          <td className="px-6 py-4 text-center">
            {nest.yield}
          </td>
          <td className="px-6 py-4 text-center">{nest.time}</td>
        </tr>
      );
    });
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

  // Helper: get nesting data for selected row, from state or DB
  const getSelectedNestingData = () => {
    // Try to get from in-memory state first
    let nestingData = nestingQueueData[selectedNestingRow || ''];
    if (!nestingData && selectedNestingRow) {
      // Try to get from DB (activeNests)
      const nestRow = activeNests.find(n => n.foamsheet === selectedNestingRow);
      if (nestRow) {
        // Parse nest and cut_details from DB
        let nestingResult = null;
        let items: any[] = [];
        try {
          nestingResult = nestRow.nest ? JSON.parse(nestRow.nest) : null;
        } catch {}
        try {
          items = Array.isArray(nestRow.cut_details)
            ? nestRow.cut_details
            : (nestRow.cut_details ? JSON.parse(nestRow.cut_details) : []);
        } catch {}
        // For visualization, we need items in the format of NestingItem[]
        // For cut details, items is already the correct structure
        nestingData = { items, nestingResult };
      }
    }
    return nestingData;
  };

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
                      {/* <button
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
                      </button> */}
                      {/** Export CSV Button */}
                      {/* <button
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
                      </button> */}
                      {/** Start Cut Button */}
                      <button
                        onClick={async () => {
                          if (!selectedNestingRow) return;
                          const nestRow = activeNests.find(n => n.foamsheet === selectedNestingRow);
                          if (nestRow && nestRow.locked) return;
                          const nestingData = getSelectedNestingData();
                          if (!nestingData || !nestingData.nestingResult) return;
                          const placements = nestingData.nestingResult.placements || [];
                          if (!placements.length || selectedSheetIndex >= placements.length) return;
                          const selectedSheet = placements[selectedSheetIndex];
                          // Save to sessionStorage for cutting page to pick up
                          if (typeof window !== 'undefined') {
                            window.sessionStorage.setItem(
                              'cutting_nesting_data',
                              JSON.stringify({
                                foamSheet: selectedNestingRow,
                                sheetIndex: selectedSheetIndex,
                                nestingData: selectedSheet,
                              })
                            );
                          }
                          // Navigate to /cutting
                          router.push('/cutting');
                        }}
                        className={`flex items-center gap-2 px-3.5 py-2 text-white font-medium rounded-lg transition-all duration-300 bg-gradient-to-br from-blue-600 to-blue-700 hover:from-blue-500 hover:to-blue-600 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 shadow-md hover:shadow-lg disabled:opacity-70 disabled:cursor-not-allowed`}
                        disabled={!selectedNestingRow || (activeNests.find(n => n.foamsheet === selectedNestingRow)?.locked)}
                        aria-label={
                          !selectedNestingRow
                            ? 'Select a nest to start cutting'
                            : (activeNests.find(n => n.foamsheet === selectedNestingRow)?.locked ? 'Nest is locked' : 'Start Cut')
                        }
                      >
                        <span className="text-white">
                          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                          </svg>
                        </span>
                        <span>Start Cut</span>
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
              <div className="flex-1 min-w-0 max-w-96 flex flex-col bg-gradient-to-br from-slate-900/95 via-slate-800/90 to-slate-900/95 rounded-2xl shadow-2xl border border-slate-700/50 backdrop-blur-sm overflow-hidden">
                {/** Enhanced Header Section */}
                <div className="relative">
                  {/* Background gradient overlay */}
                  <div className="absolute inset-0 bg-gradient-to-r from-slate-600/20 via-slate-600/10 to-slate-600/20"></div>
                  
                  <div className="relative flex flex-col gap-2 p-4 border-b border-slate-700/50">
                    {/* Compact Title Row */}
                    <div className="flex items-center justify-between">
                      <div className="flex items-center">
                        <h1 className="text-lg font-bold text-white tracking-tight">
                      Nesting Visualization
                    </h1>
                      </div>
                      
                      {/* Compact Status indicator */}
                      <div className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                        selectedNestingRow 
                          ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30' 
                          : 'bg-slate-500/20 text-slate-400 border border-slate-500/30'
                      }`}>
                        {selectedNestingRow ? 'Active' : 'Inactive'}
                      </div>
                    </div>

                    {/* Compact Sheet info and export row */}
                    {selectedNestingRow && (
                      <div className="flex items-center justify-between bg-slate-800/50 rounded-md p-2 border border-slate-600/30">
                        <div className="flex items-center gap-2">
                          <div className={`w-4 h-4 rounded-full ${getSheetColorClass(formatMediumSheetName(selectedNestingRow))}`}></div>
                          <div>
                            <p className="text-white font-medium text-lg">
                              {formatMediumSheetName(selectedNestingRow)}
                            </p>
                          </div>
                        </div>
                        
                                                 {(() => {
                      // Get the nesting data for the selected row and sheet
                      const nestingData = getSelectedNestingData();
                      const placements = nestingData?.nestingResult?.placements || [];
                      
                      if (placements.length === 0 || selectedSheetIndex >= placements.length) {
                             return (
                               <div className="px-2 py-1 bg-slate-600/30 text-slate-400 text-xs rounded border border-slate-500/30">
                                 No Data
                               </div>
                             );
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
                     )}

                </div>
                </div>
                
                {/* Enhanced Visualization Content Area */}
                <div className="flex-1 overflow-hidden relative">
                  {nestingLoading ? (
                    <div className="flex flex-col items-center justify-center h-full text-slate-400 bg-slate-900/30">
                      <div className="relative mb-3">
                        <div className="w-10 h-10 rounded-full border-3 border-slate-600/30 border-t-blue-500 animate-spin"></div>
                        <div className="absolute inset-0 w-10 h-10 rounded-full border-3 border-slate-600/10 border-r-purple-500 animate-spin animation-delay-150"></div>
                      </div>
                      <div className="text-center space-y-1">
                        <p className="text-sm font-semibold text-white">Processing Nesting...</p>
                        <p className="text-xs text-slate-400 max-w-xs">Calculating optimal cuts</p>
                        <div className="flex items-center justify-center gap-1 mt-2">
                          <div className="w-1.5 h-1.5 bg-blue-500 rounded-full animate-pulse"></div>
                          <div className="w-1.5 h-1.5 bg-blue-500 rounded-full animate-pulse animation-delay-100"></div>
                          <div className="w-1.5 h-1.5 bg-blue-500 rounded-full animate-pulse animation-delay-200"></div>
                        </div>
                      </div>
                    </div>
                  ) : selectedNestingRow ? (
                    (() => {
                      // Get the selected sheet's placement data
                      const nestingData = getSelectedNestingData();
                      const sheets = nestingData?.nestingResult?.placements || [];
                      
                      if (sheets.length === 0 || selectedSheetIndex >= sheets.length) {
                        return (
                          <div className="flex flex-col items-center justify-center h-full text-slate-400 bg-slate-900/20">
                            <div className="relative mb-3">
                              <div className="w-12 h-12 bg-amber-500/10 rounded-xl flex items-center justify-center border border-amber-500/20">
                                <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6 text-amber-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" />
                            </svg>
                              </div>
                            </div>
                            <div className="text-center space-y-1 max-w-xs">
                              <h3 className="text-sm font-semibold text-white">No Placement Data</h3>
                              <p className="text-xs text-slate-400 leading-relaxed">
                                No nesting result found for this sheet
                              </p>
                              <div className="mt-2 px-2 py-1 bg-amber-500/10 border border-amber-500/20 rounded">
                                <span className="text-xs text-amber-400 font-medium">Processing Required</span>
                              </div>
                            </div>
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
                            style={{ background: 'linear-gradient(135deg, rgba(30,41,59,0.95) 0%, rgba(30,41,59,0.9) 50%, rgba(30,41,59,0.95) 100%)', width: '100%', height: '100%' }}
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
                                  fill="black"
                                  opacity="0.6"
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
                                
                                const orderIndex = uniqueOrders.findIndex(o => o.orderId === (part.source?.orderId || part.orderId));
                                const fillColor = getOrderColor(part.source?.orderId || part.orderId || '', orderIndex);
                                
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
                                const partKey = `${part.source?.orderId || part.orderId || ''}-${partIndex}`;
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
                    <div className="flex flex-col items-center justify-center h-full text-slate-400 bg-slate-900/20">
                      <div className="relative mb-3">
                        <div className="w-12 h-12 bg-slate-800/50 rounded-xl flex items-center justify-center border border-slate-700/50">
                          <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6 text-slate-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                      </svg>
                        </div>
                        <div className="absolute -top-0.5 -right-0.5 w-3 h-3 bg-slate-600 rounded-full border-2 border-slate-800"></div>
                      </div>
                      <div className="text-center space-y-1 max-w-xs">
                        <h3 className="text-sm font-semibold text-white">No Nest Selected</h3>
                        <p className="text-xs text-slate-400 leading-relaxed">
                          Select a nest from the nesting queue to view visualization
                        </p>
                        <div className="flex items-center justify-center gap-1 mt-2 text-xs text-slate-500">
                          <div className="w-1 h-1 bg-slate-500 rounded-full"></div>
                          <span>Choose from table</span>
                          <div className="w-1 h-1 bg-slate-500 rounded-full"></div>
                        </div>
                      </div>
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
                          // Find the selected nest row from the DB
                          const nestRow = activeNests.find(n => formatMediumSheetName(n.foamsheet) === selectedMediumSheet);
                          let cutDetails: any[] = [];
                          if (nestRow) {
                            try {
                              cutDetails = Array.isArray(nestRow.cut_details)
                                ? nestRow.cut_details
                                : (nestRow.cut_details ? JSON.parse(nestRow.cut_details) : []);
                            } catch {}
                          }
                          if (!nestRow || cutDetails.length === 0) {
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
                          // Assign colors to orders by their order in cutDetails
                          return cutDetails.map((order, idx) => (
                            <tr key={`${order.orderId}-${idx}`} className="hover:bg-gray-800/30 transition-colors">
                                <td className="px-6 py-4 text-center text-md font-semibold">
                                <span className="inline-block w-4 h-4 mr-4">{idx + 1}</span>
                                <span
                                    className="inline-block w-10 h-3 rounded-full"
                                  style={{ backgroundColor: getOrderColor(order.orderId, idx) }}
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
                        })()}
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
          <div className="flex-1 w-full h-[calc(100vh-290px)] overflow-hidden">
            <div className="bg-gradient-to-r from-black/90 to-black/90 shadow-xl overflow-hidden h-full w-full flex flex-col border">
              {/* Streamlined Header */}
              <div className="px-6 py-4">
                <div className="text-center text-2xl text-white">
                  {selectedFoamSheet ? (
                    <div className="inline-flex items-center justify-center gap-2">
                      <div className={`w-4 h-4 rounded-full ${getSheetColorClass(formatMediumSheetName(selectedFoamSheet))}`}></div>
                      <span className="text-xl font-semibold text-white">{formatMediumSheetName(selectedFoamSheet)}</span>
                    </div>
                  ) : (
                    <span className="text-lg text-gray-400">Select a Medium Sheet</span>
                  )}
                </div>
              </div>
              
              <div className="flex-1 p-6 overflow-hidden">
                <div className="h-full flex flex-col">
                  {selectedFoamSheet ? (
                    <div className="h-full flex flex-col">
                      {/* Input Section */}
                      <div className="flex-1 mb-2">
                        <div className= "flex items-center gap-3 mb-4">
                          <h3 className="text-lg font-semibold text-white mb-2">Input</h3>
                          <div className="flex-1 h-px bg-gradient-to-r from-red-500/50 to-transparent"></div>
                        </div>
                        
                        <div className="grid grid-cols-2 gap-4 h-[calc(100%-2rem)]">
                          {/* Current Stock Card */}
                          <div className="bg-gradient-to-br from-red-600/20 via-red-500/10 to-red-500/20 backdrop-blur-xl border border-red-400/30 rounded-lg p-6 text-center flex flex-col justify-center">
                            <div className="text-4xl font-bold text-white font-mono mb-3">
                              {finishedStockBySku[selectedFoamSheet] ?? 0}
                            </div>
                            <h4 className="text-sm font-semibold text-white uppercase tracking-wide">In Stock</h4>
                          </div>

                          {/* Cutting Required Card */}
                          <div className="bg-gradient-to-br from-red-600/20 via-red-500/10 to-red-500/20 backdrop-blur-xl border border-red-400/30 rounded-lg p-6 text-center flex flex-col justify-center">
                            <div className="text-4xl font-bold text-white font-mono mb-3">
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
                            <h4 className="text-sm font-semibold text-white uppercase tracking-wide">2X1's To Cut</h4>
                          </div>
                        </div>
                      </div>

                      {/* Output Section */}
                      <div className="flex-1 mt-8 mb-3">
                        <div className= "flex items-center gap-3 mb-4">
                          <h3 className="text-lg font-semibold text-white mb-2">Output</h3>
                          <div className="flex-1 h-px bg-gradient-to-r from-emerald-500/50 to-transparent"></div>
                        </div>
                        <div className="grid grid-cols-2 gap-4 h-[calc(100%-2rem)]">
                          {/* Medium Sheets Card */}
                          <div className="bg-gradient-to-br from-emerald-600/20 via-emerald-500/10 to-emerald-500/20 backdrop-blur-xl border border-emerald-400/30 rounded-lg p-6 text-center flex flex-col justify-center">
                            <div className="text-4xl font-bold text-white font-mono mb-3">
                              {selectedMediumSheetQuantity || 0}
                            </div>
                            <h4 className="text-sm font-semibold text-white uppercase tracking-wide">Medium Sheets To Packing</h4>
                          </div>

                          {/* New Stock Level Card */}
                          <div className="bg-gradient-to-br from-emerald-600/20 via-emerald-500/10 to-emerald-500/20 backdrop-blur-xl border border-emerald-400/30 rounded-lg p-6 text-center flex flex-col justify-center">
                            <div className="text-4xl font-bold text-white font-mono mb-3">
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
                            <h4 className="text-sm font-semibold text-white uppercase tracking-wide">New Stock Level</h4>
                          </div>
                        </div>
                      </div>

                      {/* Action Button */}
                      <div className="mt-6">
                        <button
                          type="button"
                          className="w-full px-6 py-4 rounded-lg text-white font-semibold bg-gradient-to-r from-emerald-600 to-emerald-700 hover:from-emerald-500 hover:to-emerald-600 focus:outline-none focus:ring-2 focus:ring-emerald-400/50 shadow-lg hover:shadow-xl transition-all duration-200 transform hover:scale-[1.02] active:scale-[0.98]"
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
                    </div>
                  ) : (
                    <div className="flex-1 flex items-center justify-center">
                      <div className="text-center">
                        <div className="w-16 h-16 mx-auto mb-4 p-4 bg-slate-800/50 rounded-2xl">
                          <svg xmlns="http://www.w3.org/2000/svg" className="h-8 w-8 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                          </svg>
                        </div>
                        <h3 className="text-lg font-semibold text-gray-300 mb-2">No Medium Sheet Selected</h3>
                        <p className="text-gray-400 text-sm">Select a sheet from the table to view details</p>
                      </div>
                    </div>
                  )}
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
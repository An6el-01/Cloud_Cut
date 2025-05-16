"use client";

import Navbar from "@/components/Navbar";
import ManuConfirm from "@/components/manuConfirm";
import { useEffect, useMemo, useRef, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import { AppDispatch, RootState } from "@/redux/store";
import {
  setSelectedOrderId,
  updateItemCompleted,
  updateOrderManufacturedStatus,
  setCurrentView,
} from "@/redux/slices/ordersSlice";
import {
  fetchOrdersFromSupabase,
  syncOrders,
  exportPendingOrdersCSV,
} from "@/redux/thunks/ordersThunks";
import {
  selectManufacturingOrders,
  selectOrderItemsById,
  selectCurrentViewTotal,
} from "@/redux/slices/ordersSelectors";
import { subscribeToOrders, subscribeToOrderItems } from "@/utils/supabase";
import { OrderItem, Order } from "@/types/redux";
import { inventoryMap } from '@/utils/inventoryMap';
import { supabase } from "@/utils/supabase";
import { store } from "@/redux/store";
import * as Sentry from "@sentry/nextjs";
import { getSupabaseClient } from "@/utils/supabase";

// Define OrderWithPriority type
type OrderWithPriority = Order & { calculatedPriority: number };

export default function Manufacturing() {
  const dispatch = useDispatch<AppDispatch>();
  const orders = useSelector(selectManufacturingOrders); // Use manufacturing-specific selector
  const totalOrders = useSelector(selectCurrentViewTotal); // Use view-specific total
  const selectedOrderId = useSelector((state: RootState) => state.orders.selectedOrderId);
  // Get user profile to check for role
  const userProfile = useSelector((state: RootState) => state.auth.userProfile);
  const isOperatorRole = userProfile?.role === 'Operator';

  const selectedItemsSelector = useMemo(() => selectOrderItemsById(selectedOrderId || ''), [selectedOrderId]);
  const selectedOrderItems = useSelector(selectedItemsSelector);

  const { currentPage, loading, error, } = useSelector((state: RootState) => state.orders);
  const selectedRowRef = useRef<HTMLTableRowElement>(null);
  const ordersPerPage = 15;

  // No need to filter orders since fetchOrdersFromSupabase already filters by "Completed"
  const totalPages = Math.ceil(totalOrders / ordersPerPage);

  const selectedOrder = orders.find((o) => o.order_id === selectedOrderId);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [showConfirmDialog, setShowConfirmDialog] = useState(false);
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
  const [currentOrderProgress, setCurrentOrderProgress] = useState<string | undefined>(undefined);
  const [selectedMediumSheetQuantity, setSelectedMediumSheetQuantity] = useState<number>(0);
  const [selectedMediumSheet, setSelectedMediumSheet] = useState<string>();
  const [firstColTab, setFirstColTab] = useState<'Nesting Queue' | 'Completed Cuts' | 'Work In Progress' | 'Orders Queue'>(
    'Orders Queue'
  );

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

      // Include items that are either:
      // 1. SFI or SFC items (manufacturing items)
      // 2. Medium sheets with our specific patterns
      return sku.startsWith('SFI') || sku.startsWith('SFC') || isMediumSheet;
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

    return allOrderItems.reduce((acc: Record<string, number>, item: OrderItem) => {
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

  // Get all order items from the state
  const allOrderItems = useSelector((state: RootState) => state.orders.orderItems);

  // State to track orders with medium sheets
  const [ordersWithMediumSheets, setOrdersWithMediumSheets] = useState<Record<string, Order[]>>({});
  const [loadingMediumSheetOrders, setLoadingMediumSheetOrders] = useState(false);

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

    // If we have order IDs, fetch them from the database
    if (orderIdsArray.length > 0) {
      // Fetch order data from supabase in the background
      setLoadingMediumSheetOrders(true);

      const fetchOrders = async () => {
        try {
          const { data: fetchedOrders, error } = await supabase
            .from('orders')
            .select('*')
            .in('order_id', orderIdsArray)
            .eq('status', 'Pending')
            .eq('manufactured', false);

          if (error) {
            console.error('Error fetching orders for medium sheet:', error);
            return;
          }

          console.log(`Fetched ${fetchedOrders?.length || 0} orders for medium sheet ${sku}`);

          if (fetchedOrders) {
            // Type casting to ensure we're setting Order[] type
            const typedOrders = fetchedOrders as unknown as Order[];
            setOrdersWithMediumSheets(prev => ({
              ...prev,
              [sku]: typedOrders
            }));
          }
        } catch (err) {
          console.error('Error in findOrdersWithMediumSheet:', err);
        } finally {
          setLoadingMediumSheetOrders(false);
        }
      };

      fetchOrders();
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

  useEffect(() => {
    // Only run this effect when orders or orderItemsById change
    if (orders.length > 0 && Object.keys(orderItemsById).length > 0) {
      // Debounce the function call to prevent multiple executions
      const timer = setTimeout(() => {
        autoMarkOrdersWithNoManufacturingItems();
      }, 1000);

      return () => clearTimeout(timer);
    }
  }, [orders, orderItemsById]);

  // Get the current view from Redux store
  const currentView = useSelector((state: RootState) => state.orders.currentView);

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

      // Get the relevant items (those with SKUs starting with SFI, SFC, or SFS)
      const relevantItems = filterItemsBySku(selectedOrderItems);

      // Count how many items are already completed
      const completedItems = relevantItems.filter(item =>
        item.completed || item.id === itemId // Count the current item if it's being marked as completed
      );

      // Check if this is the last item to complete
      if (completedItems.length === relevantItems.length && completed) {
        console.log("Manufacturing: Last item completion detected, setting up dialog", {
          orderId,
          itemId,
          relevantItems: relevantItems.length,
          completedItems: completedItems.length
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
        setShowConfirmDialog(true);
      } else {
        // Not the last item, just mark it as completed
        dispatch(updateItemCompleted({ orderId, itemId, completed }));
      }
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
      setShowConfirmDialog(false);

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
          console.error("Error marking order as manufactured:", error);
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

  // Function to render the orders with medium sheet table content
  const renderOrdersWithMediumSheet = (sku: string | null) => {
    if (!sku) {
      return (
        <tr>
          <td colSpan={5} className="px-6 py-10 text-center">
            <div className="flex flex-col items-center justify-center text-gray-800">
              <svg xmlns="http://www.w3.org/2000/svg" className="h-12 w-12 mb-3 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
              <p className="text-lg font-medium">No medium sheet selected</p>
              <p className="text-sm text-gray-500 mt-1">Please select a medium sheet to see orders</p>
            </div>
          </td>
        </tr>
      );
    }

    if (loadingMediumSheetOrders) {
      return (
        <tr>
          <td colSpan={5} className="px-6 py-10 text-center">
            <div className="flex flex-col items-center justify-center text-gray-800">
              <div className="w-12 h-12 rounded-full border-4 border-gray-300 border-t-blue-600 animate-spin mb-4"></div>
              <p className="text-lg font-medium">Loading orders...</p>
              <p className="text-sm text-gray-500 mt-1">Retrieving orders with this medium sheet</p>
            </div>
          </td>
        </tr>
      );
    }

    const ordersWithSheet = findOrdersWithMediumSheet(sku);

    if (ordersWithSheet.length === 0) {
      return (
        <tr>
          <td colSpan={5} className="px-6 py-10 text-center">
            <div className="flex flex-col items-center justify-center text-gray-800">
              <svg xmlns="http://www.w3.org/2000/svg" className="h-12 w-12 mb-3 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
              <p className="text-lg font-medium">No orders found</p>
              <p className="text-sm text-gray-500 mt-1">No pending orders contain this medium sheet</p>
            </div>
          </td>
        </tr>
      );
    }

    // Calculate priorities for each order for sorting
    const ordersWithPriorities = ordersWithSheet.map(order => {
      const items = allOrderItems[order.order_id] || [];
      const maxPriority = items.length > 0
        ? Math.min(...items.map(item => item.priority ?? 10))
        : 10;

      return {
        ...order,
        maxPriority
      };
    });

    // Sort orders by priority (lowest first)
    const sortedOrders = ordersWithPriorities.sort((a, b) => a.maxPriority - b.maxPriority);

    return sortedOrders.map((order, index) => {
      // Get all items for this order with the current sku
      const orderItems = allOrderItems[order.order_id] || [];
      const skuItems = orderItems.filter(item => item.sku_id === sku && !item.completed);

      // Count how many items need to be marked as completed
      const itemsToComplete = skuItems.length;

      return (
        <tr
          key={order.order_id}
          className={`transition-colors duration-150 hover:bg-blue-50 cursor-pointer shadow-sm ${index % 2 === 0 ? 'bg-white' : 'bg-gray-50'}`}
          onClick={async () => {
            await Sentry.startSpan({
              name: 'handleOrderClick-MediumSheets',
            }, async () => {
              handleOrderClick(order.order_id);
              setActiveTab('orders'); // Switch to orders tab to view details
            });
          }}
          tabIndex={0}
          role="button"
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              handleOrderClick(order.order_id);
              setActiveTab('orders');
            }
          }}
          aria-label={`View details for order ${order.order_id} from ${order.customer_name}`}
        >
          <td className="px-4 py-4 text-left">
            <div className="flex items-center">
              <span className=" text-black text-lg">{order.order_id}</span>
            </div>
          </td>
          <td className="px-4 py-4 text-center">
            <span className="text-black text-lg">{order.customer_name}</span>
          </td>
          <td className="px-4 py-4 text-center">
            <span className={`inline-flex items-center justify-center min-w-[2.5rem] px-3 py-1 shadow-sm rounded-full text-lg text-black`}>
              {order.maxPriority}
            </span>
          </td>
          <td className="px-4 py-4 text-center">
            <span className="inline-flex items-center justify-center min-w-[2.5rem] px-3 py-1 shadow-sm rounded-full text-lg text-black">
              {getMediumSheetQuantityInOrder(order.order_id, sku)}
            </span>
          </td>
          <td className="px-4 py-4 text-center">
            <div className="flex justify-center" onClick={(e) => e.stopPropagation()}>
              <label className="relative inline-flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  checked={checkedOrders.has(order.order_id)}
                  onChange={async (e) => {
                    await Sentry.startSpan({
                      name: 'ToggleItemCompletion-MediumSheets',
                      op: 'ui.interaction.checkbox'
                    }, async () => {
                      // If unchecking, remove from local state
                      if (!e.target.checked) {
                        setCheckedOrders(prev => {
                          const newSet = new Set(prev);
                          newSet.delete(order.order_id);
                          return newSet;
                        });

                        // Mark all relevant items for this SKU as not completed
                        skuItems.forEach(item => {
                          dispatch(updateItemCompleted({
                            orderId: order.order_id,
                            itemId: item.id,
                            completed: false
                          }));
                        });
                        return;
                      }

                      // Add to visual state for immediate feedback
                      setCheckedOrders(prev => new Set(prev).add(order.order_id));

                      // Get all items for this SKU that need to be marked completed
                      const allOrderSkuItems = orderItems.filter(item => item.sku_id === sku);

                      // Check if this would complete all manufacturing items in the order
                      const relevantItems = orderItems.filter(item =>
                        (item.sku_id.startsWith('SFI') || item.sku_id.startsWith('SFC') || item.sku_id.startsWith('SFS')) && !item.completed
                      );

                      const remainingItems = relevantItems.filter(item =>
                        !allOrderSkuItems.some(skuItem => skuItem.id === item.id)
                      );

                      // Determine if this order would be ready for packing or just mark completed
                      const readyForPacking = remainingItems.length === 0;

                      // Reset the array states to avoid conflicts with batch processing
                      setOrderIdsToPacking([]);
                      setOrderIdsToMarkCompleted([]);

                      // Set the orderId for individual processing
                      setSelectedOrderId(order.order_id);

                      // Store the pending item info for the single order case
                      if (skuItems.length > 0) {
                        setPendingItemToComplete({
                          orderId: order.order_id,
                          itemId: skuItems[0].id,
                          completed: true
                        });
                      }

                      // Calculate fresh progress for this order
                      const freshProgress = calculateOrderProgress(order.order_id);
                      setCurrentOrderProgress(freshProgress);

                      // Prepare the appropriate arrays based on whether this order is ready for packing
                      if (readyForPacking) {
                        setOrderIdsToPacking([order.order_id]);
                      } else {
                        setOrderIdsToMarkCompleted([order.order_id]);
                      }

                      // Show the confirmation dialog for the single order
                      setShowConfirmDialog(true);
                    });
                  }}
                  className="sr-only peer"
                  aria-label={`Mark all items for order ${order.order_id} as completed`}
                />
                <div className="w-5 h-5 border-2 border-gray-400 rounded peer-checked:bg-green-500 peer-checked:border-green-500 peer-focus:ring-2 peer-focus:ring-green-400/50 transition-all flex items-center justify-center">
                  {checkedOrders.has(order.order_id) && (
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
      );
    });
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
            setCurrentOrderProgress(undefined);

            // Log the state just before showing the dialog
            setTimeout(() => {
              console.log("Manufacturing: State just before showing batch dialog:", {
                orderIdsToPacking,
                orderIdsToMarkCompleted,
                currentOrderProgress: undefined,
                showConfirmDialog: false // Will be set to true next
              });
            }, 0);

            setShowConfirmDialog(true);

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

  // Add a function to calculate the latest progress for an order
  const calculateOrderProgress = (orderId: string): string => {
    // Get all items for this order from the global allOrderItems
    const items = allOrderItems[orderId] || [];
    const filteredItems = filterItemsBySku(items);

    if (filteredItems.length === 0) {
      return "N/A";
    } else {
      const completedCount = filteredItems.filter(item => item.completed).length;
      return `${completedCount}/${filteredItems.length}`;
    }
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

  // State for finished_stock values by SKU
  const [finishedStockBySku, setFinishedStockBySku] = useState<Record<string, number>>({});

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

  return (
    <div className="min-h-screen">
      <Navbar />

      {/**Pill Section*/}
      <div className="container mx-auto pt-28 flex justify-center gap-8">
        <div className="flex justify-center">
          <div className="relative bg-[#2b3544] rounded-full shadow-xl p-1 inline-flex border border-gray-700 w-[320px]">
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
                Orders Queue
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
              <span className={`relative z-10 flex items-center justify-center gap-1.5 whitespace-nowrap ${activeTab === 'medium' ? 'text-white font-semibold' : 'text-gray-300 hover:text-white'
                }`}>
                <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
                Medium Sheets
              </span>
            </button>
          </div>
        </div>
      </div>

      {/* Content sections with conditional rendering */}
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
                {firstColTab !== 'Orders Queue' ? (
                  <div className="flex-1 flex flex-col items-center justify-center bg-gray-50 p-6">
                    <p className="text-gray-700 font-medium text-lg">No data</p>
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
              <div className="flex-1 min-w-0 max-w-[500px] flex flex-col bg-black/70 rounded-xl shadow-xl">
                <div className="rounded-t-lg">
                  <h1 className="text-2xl font-bold text-white p-4 flex justify-center">
                    Nesting Visualization
                  </h1>
                </div>
                <div className=" border border-gray-200 p-6 h-full overflow-y-auto">
                  {/* Visualization content here */}
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
                  <div className="overflow-x-auto h-full flex flex-col justify-start">
                    <table className="w-full text-white border-separate border-spacing-y-2">
                      <thead>
                        <tr>
                          <th className="px-6 py-3 text-center text-md font-semibold text-white underline">Customer Name</th>
                          <th className="px-6 py-3 text-center text-md font-semibold text-white underline">Order Id</th>
                        </tr>
                      </thead>
                      <tbody>
                        {/* No data rows for now */}
                      </tbody>
                    </table>
                  </div>
                ) : firstColTab === 'Completed Cuts' ? (
                  <div className="overflow-x-auto h-full flex flex-col bg-black/70 rounded-xl shadow-xl">
                    <table className="w-full text-white border-separate border-spacing-y-2">
                      <thead>
                        <tr>
                          <th className="px-6 py-3 text-center text-md font-semibold text-white underline">
                            Customer Name
                          </th>
                          <th className="px-6 py-3 text-center text-md font-semibold text-white underline">
                            Order Id
                          </th>
                        </tr>
                      </thead>
                    </table>
                  </div>
                ) : firstColTab === 'Work In Progress' ? (
                  <div className="overflow-x-auto h-full flex flex-col bg-black/70 rounded-xl shadow-xl">
                    <table className="w-full text-white border-separate border-spacing-y-2">
                      <thead>
                        <tr>
                          <th className="px-6 py-3 text-center text-md font-semibold text-white underline">
                            Foam Sheet
                          </th>
                          <th className="px-6 py-3 text-center text-md font-semibold text-white underline">
                            Item Name
                          </th>
                          <th className="px-6 py-3 text-center text-md font-semibold text-white underline">
                            Status
                          </th>
                        </tr>
                      </thead>
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

      {/* Medium Sheets Tab Active Section */}
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
                  {selectedFoamSheet ? (
                    <div className="flex items-center justify-center">
                      <span className="relative">
                        Orders with <span className="font-semibold relative inline-block">{formatMediumSheetName(selectedFoamSheet)}
                        </span>
                      </span>
                    </div>
                  ) : (
                    <span className="relative inline-block">
                      Select a Medium Sheet
                    </span>
                  )}
                </h2>
              </div>
              <div className="flex-1 overflow-auto p-4">
                <div className="h-full">
                  <div className="overflow-x-auto rounded-lg border border-white/20 shadow-lg h-full">
                    <table className="w-full h-full bg-white/90">
                      <thead className="bg-[#1d1d1d] sticky top-0 z-10">
                        <tr>
                          <th className="px-4 py-4 text-left text-lg font-semibold text-gray-200">Order ID</th>
                          <th className="px-4 py-4 text-center text-lg font-semibold text-gray-200">Customer</th>
                          <th className="px-4 py-4 text-center text-lg font-semibold text-gray-200">Priority</th>
                          <th className="px-4 py-4 text-center text-lg font-semibold text-gray-200">Qty</th>
                          <th className="px-4 py-4 text-center">
                            <div className="flex justify-center" onClick={(e) => e.stopPropagation()}>
                              <label className={`relative inline-flex items-center ${selectedFoamSheet ? 'cursor-pointer' : 'cursor-not-allowed opacity-50'}`}>
                                <input
                                  type="checkbox"
                                  checked={allMediumSheetOrdersChecked}
                                  onChange={() => {
                                    markAllMediumSheetOrdersAsManufactured();
                                  }}
                                  className="sr-only peer"
                                  aria-label="Mark all medium sheet orders as manufactured"
                                  aria-disabled={!selectedFoamSheet}
                                  disabled={!selectedFoamSheet}
                                />
                                <div className="w-5 h-5 border-2 border-gray-200 rounded peer-checked:bg-green-500 peer-checked:border-green-500 peer-focus:ring-2 peer-focus:ring-green-400/50 transition-all flex items-center justify-center">
                                  {allMediumSheetOrdersChecked && (
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
                        {renderOrdersWithMediumSheet(selectedFoamSheet)}
                      </tbody>
                      <tfoot>
                        <tr>

                        </tr>
                      </tfoot>
                    </table>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Confirmation Dialog */}
      {showConfirmDialog && (
        <ManuConfirm
          isOpen={showConfirmDialog}
          onClose={() => {
            console.log("Manufacturing: ManuConfirm onClose triggered, current dialog state:", {
              orderIdsToPacking,
              orderIdsToMarkCompleted,
              currentOrderProgress,
              pendingItemToComplete
            });
            setShowConfirmDialog(false);
            // Clear any pending item state
            setPendingItemToComplete(null);
            // Reset all checkbox states
            setAllMediumSheetOrdersChecked(false);
            setCheckedOrders(new Set());
            // Reset progress
            setCurrentOrderProgress(undefined);
            // Reset order arrays
            setOrderIdsToPacking([]);
            setOrderIdsToMarkCompleted([]);

            // Log state after resetting
            console.log("Manufacturing: State after dialog close:", {
              showConfirmDialog: false,
              pendingItemToComplete: null,
              orderIdsToPacking: [],
              orderIdsToMarkCompleted: [],
              currentOrderProgress: undefined
            });
          }}
          onConfirm={handleMarkManufactured}
          orderId={selectedOrderId}
          orderIdsToPacking={orderIdsToPacking}
          orderIdsToMarkCompleted={orderIdsToMarkCompleted}
          orderProgress={currentOrderProgress}
          mediumSheetTotalQuantity={selectedMediumSheetQuantity}
          selectedMediumSheet={selectedFoamSheet ? formatMediumSheetName(selectedFoamSheet) : undefined}
          sku={selectedFoamSheet || undefined}
        />
      )}
    </div>
  );
}
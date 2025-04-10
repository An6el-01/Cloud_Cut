"use client";

import Navbar from "@/components/Navbar";
import ManuConfirm from "@/components/manuConfirm";
import { useEffect, useRef, useState } from "react";
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

// Define OrderWithPriority type
type OrderWithPriority = Order & { calculatedPriority: number };

export default function Manufacturing() {
  const dispatch = useDispatch<AppDispatch>();
  const orders = useSelector(selectManufacturingOrders); // Use manufacturing-specific selector
  const totalOrders = useSelector(selectCurrentViewTotal); // Use view-specific total
  const selectedOrderId = useSelector((state: RootState) => state.orders.selectedOrderId);
  const selectedOrderItems = useSelector(selectOrderItemsById(selectedOrderId || ""));
  const { currentPage, loading, error,} = useSelector((state: RootState) => state.orders);
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

  // Helper function to filter items by SKU
  const filterItemsBySku = (items: OrderItem[]) => {
    return items.filter(item => {
      const sku = item.sku_id.toUpperCase();
      return sku.startsWith('SFI') || sku.startsWith('SFC');
    });
  };

  // Use useSelector to get order items for each order in the table
  const orderItemsById = useSelector((state: RootState) =>
    orders.reduce((acc, order) => {
      acc[order.order_id] = selectOrderItemsById(order.order_id)(state);
      return acc;
    }, {} as Record<string, OrderItem[]>)
  );

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
  const autoMarkOrdersWithNoManufacturingItems = async () => {
    console.log("Checking for orders with no manufacturing items...");
    
    // Make sure orders and their items are fully loaded
    if (loading || isRefreshing) {
      console.log("Orders are still loading, skipping auto-mark process");
      return;
    }
    
    const ordersToProcess = orders.filter(order => {
      const items = orderItemsById[order.order_id] || [];
      // Only process orders that have items (so we know their items were loaded)
      // but none of those items need manufacturing (no SFI/SFC SKUs)
      const filteredItems = filterItemsBySku(items);
      return filteredItems.length === 0 && items.length > 0;
    });
    
    if (ordersToProcess.length > 0) {
      console.log(`Found ${ordersToProcess.length} orders with no manufacturing items to auto-process`);
      
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
  };

  useEffect(() => {
    // Set the current view first
    dispatch(setCurrentView('manufacturing'));
    
    // Then fetch orders with the manufacturing-specific filters
    dispatch(fetchOrdersFromSupabase({ 
      page: currentPage, 
      perPage: ordersPerPage,
      manufactured: false,
      packed: false,
      status: "Pending",
      view: 'manufacturing'
    }));

    const ordersSubscription = subscribeToOrders((payload) => {
      if (payload.eventType === "INSERT" && 
          payload.new.status === "Pending" && 
          !payload.new.manufactured && 
          !payload.new.packed) {
        dispatch({ type: "orders/addOrder", payload: payload.new });
      } else if (payload.eventType === "UPDATE") {
        if (payload.new.status === "Pending" && 
            !payload.new.manufactured && 
            !payload.new.packed) {
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

  const handleOrderClick = (orderId: string) => {
    dispatch(setSelectedOrderId(orderId));
    setTimeout(() => {
      selectedRowRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 100);
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

  const handleToggleCompleted = (orderId: string, itemId: string, completed: boolean) => {
    // If marking as incomplete, just do it directly
    if (!completed) {
      dispatch(updateItemCompleted({ orderId, itemId, completed }));
      return;
    }

    // Get the relevant items (those with SKUs starting with SFI or SFC)
    const relevantItems = filterItemsBySku(selectedOrderItems);
    
    // Count how many items are already completed
    const completedItems = relevantItems.filter(item => 
      item.completed || item.id === itemId // Count the current item if it's being marked as completed
    );
    
    // Check if this is the last item to complete
    if (completedItems.length === relevantItems.length && completed) {
      // Store the pending item completion details
      setPendingItemToComplete({
        orderId,
        itemId,
        completed
      });
      // Show confirmation dialog
      setShowConfirmDialog(true);
    } else {
      // Not the last item, just mark it as completed
      dispatch(updateItemCompleted({ orderId, itemId, completed }));
    }
  };

  const handleMarkManufactured = (orderId: string) => {
    // Close the confirmation dialog
    setShowConfirmDialog(false);
    
    // If there's a pending item to complete
    if (pendingItemToComplete) {
      // Mark the item as completed
      dispatch(updateItemCompleted(pendingItemToComplete));
      
      console.log(`Marking order ${orderId} as manufactured`);
      // Show loading state
      setIsRefreshing(true);
      
      // Update the manufactured status in Redux and Supabase
      try {
        dispatch(updateOrderManufacturedStatus({ orderId, manufactured: true }));
        
        // Refresh the orders list to remove the manufactured order after a delay
        // to ensure the Supabase update completes
        setTimeout(() => {
          console.log(`Refreshing orders after marking ${orderId} as manufactured`);
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
            // Clear the pending item
            setPendingItemToComplete(null);
          });
        }, 2000); // Increased delay to ensure Supabase update completes
      } catch (error) {
        console.error("Error marking order as manufactured:", error);
        setIsRefreshing(false);
        setPendingItemToComplete(null);
      }
    }
  };

  // Function to handle cancellation of the confirmation dialog
  const handleCancelConfirm = () => {
    // Close the dialog
    setShowConfirmDialog(false);
    // Clear the pending item
    setPendingItemToComplete(null);
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

  return (
    <div className="min-h-screen">
      <Navbar />
      <div className="container mx-auto pt-32 mb-8 p-6 flex justify-center gap-8">
        {/* Orders Queue Section */}
        <div className="flex-1 max-w-3xl">
          <div className="bg-[#1d1d1d]/90 rounded-t-lg backdrop-blur-sm p-4">
            <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
              <h1 className="text-2xl font-bold text-white">Orders Queue</h1>
              
              <div className="flex flex-wrap items-center gap-3">
                <button
                  onClick={handleRefresh}
                  className={`flex items-center gap-2 px-3.5 py-2 text-white font-medium rounded-lg transition-all duration-300 bg-gradient-to-br from-gray-700 to-gray-800 hover:from-gray-600 hover:to-gray-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-gray-500 shadow-md hover:shadow-lg disabled:opacity-70 disabled:cursor-not-allowed`}
                  disabled={isRefreshing}
                  aria-label={isRefreshing ? "Syncing orders in progress" : "Refresh orders list"}
                >
                  <span className={`${isRefreshing ? "animate-spin" : ""} text-red-400`}>
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-4.5 w-4.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.67-8.9" />
                    </svg>
                  </span>
                  <span>{isRefreshing ? "Syncing..." : "Refresh"}</span>
                </button>
                
                <button
                  onClick={handleExportCSV}
                  className={`flex items-center gap-2 px-3.5 py-2 text-white font-medium rounded-lg transition-all duration-300 bg-gradient-to-br from-emerald-600 to-emerald-700 hover:from-emerald-500 hover:to-emerald-600 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-emerald-500 shadow-md hover:shadow-lg disabled:opacity-70 disabled:cursor-not-allowed`}
                  disabled={isExporting}
                  aria-label={isExporting ? "CSV export in progress" : "Export orders to CSV"}
                >
                  <span className={`${isExporting ? "animate-spin" : ""} text-white`}>
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-4.5 w-4.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      {isExporting ? (
                        <path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.67-8.9" />
                      ) : (
                        <>
                          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                          <polyline points="7 10 12 15 17 10" />
                          <line x1="12" y1="15" x2="12" y2="3" />
                        </>
                      )}
                    </svg>
                  </span>
                  <span>{isExporting ? "Exporting..." : "Export CSV"}</span>
                </button>
              </div>
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
                              className={`transition-all duration-200 cursor-pointer text-center h-[calc((100vh-300px-48px)/15)] ${
                                order.order_id === selectedOrderId 
                                  ? "bg-blue-100/90 border-l-4 border-blue-500 shadow-md" 
                                  : "hover:bg-gray-50/90 hover:border-l-4 hover:border-gray-300"
                              }`}
                              onClick={() => handleOrderClick(order.order_id)}
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
        {/* Order Details Section */}
        <div className="flex-1 max-w-2xl">
          <div className="bg-black/70 rounded-t-lg">
            <h1 className="text-2xl font-bold text-white p-4 flex justify-center">
              Order Details
            </h1>
          </div>
          <div className="bg-black/70 border border-gray-200 p-6 h-[calc(100vh-300px)] overflow-y-auto">
            {selectedOrder ? (
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
                            {filterItemsBySku(selectedOrderItems).filter(item => item.completed).length} of {filterItemsBySku(selectedOrderItems).length} items
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
                        
                        {/* Complete Order Button */}
                        <button
                          onClick={() => {
                            // Check if all relevant items are completed
                            const relevantItems = filterItemsBySku(selectedOrderItems);
                            const allItemsCompleted = relevantItems.every(item => item.completed);
                            
                            if (allItemsCompleted && relevantItems.length > 0) {
                              setShowConfirmDialog(true);
                            } else {
                              // Show warning message with timeout instead of alert
                              setShowWarning(true);
                              setTimeout(() => {
                                setShowWarning(false);
                              }, 4000);
                            }
                          }}
                          className="group px-4 py-1.5 bg-gradient-to-br from-green-500 to-green-600 rounded-md text-white text-sm font-medium hover:from-green-600 hover:to-green-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-gray-800 focus:ring-green-500 transition-all duration-200 shadow-sm hover:shadow-md flex items-center gap-1.5"
                          aria-label="Mark order as manufactured"
                          disabled={filterItemsBySku(selectedOrderItems).length === 0}
                        >
                          <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 transition-transform group-hover:scale-110" viewBox="0 0 20 20" fill="currentColor">
                            <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                          </svg>
                          Complete Manufacturing
                        </button>
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
                                      onChange={(e) =>
                                        handleToggleCompleted(
                                          selectedOrder.order_id,
                                          item.id,
                                          e.target.checked
                                        )
                                      }
                                      className="sr-only peer"
                                      aria-label={`Mark ${item.item_name} as ${item.completed ? 'incomplete' : 'complete'}`}
                                    />
                                    <div className="w-5 h-5 border-2 border-gray-400 rounded peer-checked:bg-green-500 peer-checked:border-green-500 peer-focus:ring-2 peer-focus:ring-green-400/50 transition-all flex items-center justify-center">
                                      {item.completed && (
                                        <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5 text-white" viewBox="0 0 20 20" fill="currentColor">
                                          <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
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
      {/* Confirmation Dialog */}
      {showConfirmDialog && selectedOrder && (
        <ManuConfirm
          isOpen={showConfirmDialog}
          onClose={handleCancelConfirm}
          onConfirm={handleMarkManufactured}
          orderId={selectedOrder.order_id}
        />
      )}
    </div>
  );
}
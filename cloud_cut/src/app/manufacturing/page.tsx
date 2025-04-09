"use client";

import Navbar from "@/components/Navbar";
import ManuConfirm from "@/components/manuConfirm";
import { useEffect, useRef, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import { AppDispatch, RootState } from "@/redux/store";
import {
  fetchOrdersFromSupabase,
  syncOrders,
  setSelectedOrderId,
  updateItemCompleted,
  updateOrderManufacturedStatus,
  selectManufacturingOrders,
  selectOrderItemsById,
  exportPendingOrdersCSV,
  setCurrentView,
  selectCurrentViewTotal,
} from "@/redux/slices/ordersSlice";
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
  const { currentPage, loading, error,} = useSelector(
    (state: RootState) => state.orders
  );
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
          <div className="bg-[#1d1d1d]/90 rounded-t-lg flex justify-between items-center backdrop-blur-sm p-4">
            <h1 className="text-2xl font-bold text-white">Orders Queue</h1>
            <button
              onClick={handleRefresh}
              className={`px-4 py-2 text-white font-semibold rounded-lg transition-all duration-300 z-10 border-2 border-red-500 ${
                isRefreshing
                  ? "bg-blue-600 animate-pulse flex items-center gap-2 cursor-not-allowed"
                  : "bg-gray-700 hover:bg-gray-600"
              }`}
              disabled={isRefreshing}
              style={{ position: 'relative' }}
            >
              {isRefreshing ? (
                <>
                  <span className="animate-spin">↻</span>
                  <span>Syncing...</span>
                </>
              ) : (
                "Refresh Orders"
              )}
            </button>
            <button
              onClick={handleExportCSV}
              className={`px-4 py-2 text-white font-semibold rounded-lg transition-all duration-300 z-10 border-2 border-green-500 ${isExporting ? "bg-green-600 animate-pulse flex items-center gap-2 cursor-not-allowed"
                : "bg-gray-700 hover:bg-gray-600"}`}
                disabled= {isExporting}
            >
              {isExporting ? (
                <>
                  <span className= "animate-spin">↓</span>
                  <span>Exporting...</span>
                </>
              ) : (
                "Export CSV"
              )}
            </button>
          </div>
          <div className="overflow-x-auto bg-white h-[calc(100vh-300px)] flex flex-col">
            {loading ? (
              <div className="text-center text-white py-4">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-white mx-auto">↻</div>
                <p className="mt-2">Loading orders...</p>
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
                      {orders.map((order) => {
                        return (
                          <tr
                            key={order.order_id}
                            ref={order.order_id === selectedOrderId ? selectedRowRef : null}
                            className={`hover:bg-gray-50/90 cursor-pointer text-center h-[calc((100vh-300px-48px)/15)] ${
                              order.order_id === selectedOrderId ? "bg-blue-100/90" : ""
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
                      })}
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
                    <p className="text-sm text-gray-400 underline">Priority Level:</p>
                    <p className="font-medium">
                      {(() => {
                        const filteredItems = filterItemsBySku(selectedOrderItems);
                        if (filteredItems.length === 0) return 'N/A';
                        return Math.max(...filteredItems.map(item => item.priority || 0));
                      })()}
                    </p>
                  </div>
                  <div>
                    <p className="text-sm text-gray-400 underline">Customer Name:</p>
                    <p className="font-medium">{selectedOrder.customer_name}</p>
                  </div>
                </div>
                
                <div>
                  <h2 className="font-semibold mb-2">Items:</h2>
                  <div className="overflow-x-auto">
                    <table className="w-full text-white">
                      <thead>
                        <tr>
                          <th className="px-4 py-2 text-center text-sm underline">Name</th>
                          <th className="px-6 py-2 text-center text-sm underline whitespace-nowrap">
                            Foam Sheet
                          </th>
                          <th className="px-4 py-2 text-center text-sm underline">Quantity</th>
                          <th className="px-4 py-2 text-center text-sm underline">Priority</th>
                          <th className="px-4 py-2 text-center text-sm underline">Completed</th>
                        </tr>
                      </thead>
                      <tbody>
                        {filterItemsBySku(selectedOrderItems)
                          .map((item) => (
                            <tr key={item.id} className="border-b">
                              <td className="px-4 py-2 text-center">{item.item_name}</td>
                              <td className="px-4 py-2 text-center">{item.foamsheet}</td>
                              <td className="px-4 py-2 text-center">{item.quantity}</td>
                              <td className="px-4 py-2 text-center">{item.priority}</td>
                              <td className="px-4 py-2 text-center">
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
                                />
                              </td>
                            </tr>
                          ))}
                        {selectedOrderItems.length > 0 && 
                         filterItemsBySku(selectedOrderItems).length === 0 && (
                          <tr>
                            <td colSpan={5} className="px-4 py-4 text-center text-yellow-300">
                              No items with SKUs starting with SFI or SFC found in this order.
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
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
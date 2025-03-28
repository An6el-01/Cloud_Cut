"use client";

import Navbar from "@/components/Navbar";
import { useState, useEffect, useRef } from "react";
import { fetchOrders, fetchOrderDetails } from "@/utils/despatchCloud";
//import { translateOrderDetails } from "@/utils/translate"; // Import the new utility
import { DespatchCloudOrder, OrderDetails } from "@/types/despatchCloud";

export default function Manufacturing() {
  const [selectedOrder, setSelectedOrder] = useState<OrderDetails | null>(null);
  const [orders, setOrders] = useState<DespatchCloudOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalOrders, setTotalOrders] = useState(0);
  const selectedRowRef = useRef<HTMLTableRowElement>(null);
  const ordersPerPage = 10;

  useEffect(() => {
    const loadOrders = async () => {
      try {
        setLoading(true);
        setError(null); // Clear any previous errors

        const response = await fetchOrders(currentPage, ordersPerPage);
        console.log("Orders Response:", JSON.stringify(response, null, 2));

        if (!response.data || response.data.length === 0) {
          setError("No orders found for the current page");
          setOrders([]);
        } else {
          setOrders(response.data);
          setError(null);
        }
        
        setTotalPages(response.last_page);
        setTotalOrders(response.total);

        console.log("Updated state:", {
          orders: response.data,
          totalPages: response.last_page,
          totalOrders: response.total,
        });

        // //Load and store inventory 
        // if (currentPage === 1) {
        //   const inventoryResponse = await fetch('/api/fetch-inventory');
        //   if(!inventoryResponse.ok) {
        //     throw new Error('Failed to fetch inventory');
        //   }
        //   console.log('Inventory fetched and stored: ', await inventoryResponse.json());
        // }
      } catch (err) {
        console.error("Error loading data:", err);
        setError(err instanceof Error ? err.message : "Failed to load data");
        setOrders([]);
        setTotalPages(1);
        setTotalOrders(0);
      } finally {
        setLoading(false);
      }
    };
    loadOrders();
  }, [currentPage]);

  const handleOrderClick = async (orderId: string, internalId: number) => {
    try {
      setLoading(true);
      const details = await fetchOrderDetails(internalId.toString());
      //const translatedDetails = await translateOrderDetails(details); // Translate item names
      setSelectedOrder(details);
      // Scroll to the selected row after a short delay to ensure the DOM has updated
      setTimeout(() => {
        selectedRowRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }, 100);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load order details");
    } finally {
      setLoading(false);
    }
  };

  const handlePageChange = (newPage: number) => {
    if (newPage >= 1 && newPage <= totalPages) {
      setCurrentPage(newPage);
    }
  };

  return (
    <div className="min-h-screen">
      <Navbar />
      <div className="container mx-auto pt-32 mb-8 p-6 flex justify-center gap-8">
        {/* Orders Queue Section */}
        <div className="flex-1 max-w-3xl">
          <div className="bg-[#1d1d1d] rounded-t-lg">
            <h1 className="text-2xl font-bold text-white p-4">Orders Queue</h1>
          </div>
          <div className="overflow-x-auto">
            {loading ? (
              <div className="text-center text-white py-4">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-white mx-auto"></div>
                <p className="mt-2">Loading orders...</p>
              </div>
            ) : error ? (
              <div className="text-center py-4">
                <p className="text-red-500">{error}</p>
                <button 
                  onClick={() => setCurrentPage(1)} 
                  className="mt-2 px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600"
                >
                  Retry
                </button>
              </div>
            ) : orders.length === 0 ? (
              <div className="text-center py-4">
                <p className="text-white">No orders found</p>
                <p className="text-sm text-gray-400 mt-1">Try adjusting your filters or refreshing the page</p>
              </div>
            ) : (
              <>
                <div className="h-[calc(100vh-300px)] overflow-y-auto">
                  <table className="w-full bg-white border border-gray-200">
                    <thead className="bg-gray-100 sticky top-0">
                      <tr>
                        <th className="px-4 py-4 text-center text-black text-md">Order Id</th>
                        <th className="px-4 py-2 text-center text-black text-md whitespace-nowrap">Customer Name</th>
                        <th className="px-4 py-2 text-center text-black text-md">Priority</th>
                        <th className="px-4 py-2 text-center text-black text-md whitespace-nowrap">Order Date</th>
                        <th className="px-4 py-2 text-center text-black text-md">Progress</th>
                      </tr>
                    </thead>
                    <tbody>
                      {orders.map((order) => (
                        <tr
                          key={order.id}
                          ref={selectedOrder?.orderId === order.channel_order_id ? selectedRowRef : null}
                          className={`border-b hover:bg-gray-50 cursor-pointer text-center ${
                            selectedOrder?.orderId === order.channel_order_id ? "bg-blue-100" : ""
                          }`}
                          onClick={() => handleOrderClick(order.channel_order_id, order.id)}
                        >
                          <td className="px-4 py-2 text-black">{order.channel_order_id}</td>
                          <td className="px-4 py-2 text-black">{order.shipping_name}</td>
                          <td className="px-4 py-2 text-black">{order.highestPriority}</td>
                          <td className="px-4 py-2 text-black">
                            {new Date(order.date_received).toLocaleDateString("en-GB")}
                          </td>
                          <td className="px-4 py-2 text-black">N/A</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {/* Pagination Controls */}
                <div className="flex justify-between items-center bg-white p-4 border border-gray-200">
                  <div className="text-sm text-gray-600">
                    Showing {(currentPage - 1) * ordersPerPage + 1} to{" "}
                    {Math.min(currentPage * ordersPerPage, totalOrders)} of {totalOrders} orders
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
            <h1 className="text-2xl font-bold text-white p-4 flex justify-center">Order Details</h1>
          </div>
          <div className="bg-black/70 border border-gray-200 p-6 h-[calc(100vh-300px)] overflow-y-auto">
            {selectedOrder ? (
              <div className="space-y-6">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <p className="text-sm text-gray-400 underline">Order Date:</p>
                    <p className="font-medium">{selectedOrder.orderDate}</p>
                  </div>
                  <div>
                    <p className="text-sm text-gray-400 underline">Status:</p>
                    <p className="font-medium">{selectedOrder.status}</p>
                  </div>
                  <div>
                    <p className="text-sm text-gray-400 underline">Priority Level:</p>
                    <p className="font-medium">{selectedOrder.priorityLevel}</p>
                  </div>
                  <div>
                    <p className="text-sm text-gray-400 underline">Customer Name:</p>
                    <p className="font-medium">{selectedOrder.customerName}</p>
                  </div>
                </div>

                <div>
                  <h2 className="font-semibold mb-2">Items:</h2>
                  <div className="overflow-x-auto">
                    <table className="w-full">
                      <thead>
                        <tr>
                          <th className="px-4 py-2 text-center text-sm underline">Name</th>
                          <th className="px-6 py-2 text-center text-sm underline whitespace-nowrap">Foam Sheet</th>
                          <th className="px-4 py-2 text-center text-sm underline">Quantity</th>
                          <th className="px-4 py-2 text-center text-sm underline">Priority</th>
                          <th className="px-4 py-2 text-center text-sm underline">Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {selectedOrder.items.map((item) => (
                          <tr key={item.id} className="border-b">
                            <td className="px-4 py-2 text-center">{item.name}</td>
                            <td className="px-4 py-2 text-center">{item.foamSheet}</td>
                            <td className="px-4 py-2 text-center">{item.quantity}</td>
                            <td className="px-4 py-2 text-center">{item.priority}</td>
                            <td className="px-4 py-2 text-center">{item.status}</td>
                          </tr>
                        ))}
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
    </div>
  );
}
"use client";

import Navbar from "@/components/Navbar";
import { useState } from "react";

interface OrderDetails {
    orderDate: string;
    status: string;
    priorityLevel: number;
    customerName: string;
    items: Array<{
        id: number;
        name: string;
        foamSheet: string;
        quantity: number;
        status: string;
    }>;
}

export default function Manufacturing() {
    const [selectedOrder, setSelectedOrder] = useState<OrderDetails | null>(null);

    return (
        <div>
            <Navbar />
            <div className="container mx-auto mt-40 p-6 flex justify-center gap-8">
                {/* Orders Queue Section */}
                <div className="flex-1 max-w-3xl">
                    <div className="bg-[#1d1d1d] rounded-t-lg">
                        <h1 className="text-2xl font-bold text-white p-4">Orders Queue</h1>
                    </div>
                    <div className="overflow-x-auto">
                        <table className="w-full bg-white border border-gray-200">
                            <thead className="bg-gray-100">
                                <tr>
                                    <th className="px-4 py-4 text-left text-black text-md">Order Id</th>
                                    <th className="px-4 py-2 text-left text-black text-md whitespace-nowrap">Customer Name</th>
                                    <th className="px-4 py-2 text-left text-black text-md">Priority</th>
                                    <th className="px-4 py-2 text-left text-black text-md whitespace-nowrap">Order Date</th>
                                    <th className="px-4 py-2 text-left text-black text-md">Progress</th>
                                </tr>
                            </thead>
                            <tbody>
                                <tr 
                                    className="border-b hover:bg-gray-50 cursor-pointer text-center"
                                    onClick={() => setSelectedOrder({
                                        orderDate: "17/03/2025",
                                        status: "Ready for packing",
                                        priorityLevel: 9,
                                        customerName: "Thomas Brighton",
                                        items: [
                                            { id: 1, name: "Medium Sheet", foamSheet: "Grey 30mm", quantity: 1, status: "Done" },
                                            { id: 2, name: "Large Traveling Case", foamSheet: "Blue 30mm", quantity: 1, status: "Done" },
                                        ]
                                    })}
                                >
                                    <td className="px-4 py-2 text-black">ORD123</td>
                                    <td className="px-4 py-2 text-black">Thomas Brighton</td>
                                    <td className="px-4 py-2 text-black">9</td>
                                    <td className="px-4 py-2 text-black">17/03/2025</td>
                                    <td className="px-4 py-2 text-black">2/2</td>
                                </tr>
                            </tbody>
                        </table>
                    </div>
                </div>

                {/* Order Details Section */}
                <div className="flex-1 max-w-2xl">
                    <div className="bg-black/70 rounded-t-lg">
                        <h1 className="text-2xl font-bold text-white p-4 flex justify-center ">Order Details</h1>
                    </div>
                    <div className="bg-black/70 border border-gray-200 p-6">
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
                                    <table className="w-full">
                                        <thead>
                                            <tr>
                                                <th className="px-4 py-2 text-center text-sm underline"></th>
                                                <th className="px-4 py-2 text-center text-sm underline ">Name</th>
                                                <th className="px-4 py-2 text-center text-sm whitespace-nowrap underline">Foam Sheet</th>
                                                <th className="px-4 py-2 text-center text-sm underline">Quantity</th>
                                                <th className="px-4 py-2 text-center text-sm underline">Status</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {selectedOrder.items.map((item) => (
                                                <tr key={item.id} className="border-b">
                                                    <td className="px-4 py-2">{item.id}</td>
                                                    <td className="px-4 py-2 whitespace-nowrap text-center">{item.name}</td>
                                                    <td className="px-4 py-2 text-center whitespace-nowrap">{item.foamSheet}</td>
                                                    <td className="px-4 py-2 text-center">{item.quantity}</td>
                                                    <td className="px-4 py-2 text-center">{item.status}</td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            </div>
                        ) : (
                            <div className="flex items-center justify-center h-64">
                                <p className="text-white text-lg">No order selected. Please choose an order.</p>
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}
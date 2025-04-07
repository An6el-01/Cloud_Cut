"use client";

import React, { useState, useEffect } from 'react';
import { OrderItem } from '@/types/redux';
import { supabase } from '@/utils/supabase';

interface OrderItemsOverlayProps {
    orderId: string;
    onClose: () => void;
    items?: OrderItem[];
}

export default function OrderItemsOverlay({ orderId, onClose, items: initialItems }: OrderItemsOverlayProps) {
    const [items, setItems] = useState<OrderItem[]>(initialItems || []);
    const [loading, setLoading] = useState(!initialItems);

    useEffect(() => {
        if (!initialItems) {
            // If no items provided, fetch them from the database
            const fetchItems = async () => {
                setLoading(true);
                try {
                    // Try to fetch from active orders first
                    const { data: activeItems, error: activeError } = await supabase
                        .from('order_items')
                        .select('*')
                        .eq('order_id', orderId);

                    if (activeError) {
                        console.error('Error fetching active items:', activeError);
                    }

                    if (!activeItems || activeItems.length === 0) {
                        // If no active items, try archived items
                        const { data: archivedItems, error: archivedError } = await supabase
                            .from('archived_order_items')
                            .select('*')
                            .eq('order_id', orderId);

                        if (archivedError) {
                            console.error('Error fetching archived items:', archivedError);
                        }

                        if (archivedItems) {
                            setItems(archivedItems);
                        }
                    } else {
                        setItems(activeItems);
                    }
                } catch (error) {
                    console.error('Error fetching items:', error);
                } finally {
                    setLoading(false);
                }
            };

            fetchItems();
        }
    }, [orderId, initialItems]);

    return (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
            <div className="bg-white rounded-lg p-6 max-w-2xl w-full max-h-[80vh] overflow-y-auto">
                <div className="flex justify-between items-center mb-4">
                    <h2 className="text-xl font-bold text-gray-800">Order Items</h2>
                    <button
                        onClick={onClose}
                        className="text-gray-500 hover:text-gray-700"
                    >
                        ✕
                    </button>
                </div>
                {loading ? (
                    <div className="text-center py-4">
                        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-gray-900 mx-auto" />
                        <p className="mt-2 text-gray-600">Loading items...</p>
                    </div>
                ) : items.length === 0 ? (
                    <p className="text-gray-600 text-center py-4">No items found for this order</p>
                ) : (
                    <table className="w-full">
                        <thead>
                            <tr className="border-b">
                                <th className="text-center text-black px-4 py-2">Item Name</th>
                                <th className="text-center whitespace-nowrap text-black px-4 py-2">Foam Sheet</th>
                                <th className="text-center text-black px-4 py-2">Quantity</th>
                            </tr>
                        </thead>
                        <tbody>
                            {items.map((item) => (
                                <tr key={item.id} className="border-b">
                                    <td className=" text-center px-4 text-black py-2">{item.item_name}</td>
                                    <td className=" text-center whitespace-nowrap px-4 text-black py-2">{item.foamsheet}</td>
                                    <td className=" text-center whitespace-nowrap px-4 text-black py-2">{item.quantity}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                )}
            </div>
        </div>
    );
}
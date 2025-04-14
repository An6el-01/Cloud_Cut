"use client";

import React, { useState, useEffect, useRef } from 'react';
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
    
    // Refs for accessibility
    const closeButtonRef = useRef<HTMLButtonElement>(null);
    const dialogRef = useRef<HTMLDivElement>(null);

    // Handle escape key press to close overlay
    useEffect(() => {
        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') {
                onClose();
            }
        };

        if (true) { // Always active when component is mounted
            window.addEventListener('keydown', handleKeyDown);
            // Prevent scroll on body
            document.body.style.overflow = 'hidden';
            // Focus the close button when dialog opens
            closeButtonRef.current?.focus();
        }

        return () => {
            window.removeEventListener('keydown', handleKeyDown);
            document.body.style.overflow = '';
        };
    }, [onClose]);

    // Click outside to close
    const handleBackdropClick = (e: React.MouseEvent) => {
        if (dialogRef.current && e.target === dialogRef.current) {
            onClose();
        }
    };

    useEffect(() => {
        if (!initialItems) {
            // If no items provided, fetch them from the database
            const fetchItems = async () => {
                setLoading(true);
                try {
                    // Try to fetch from active orders first
                    const { data: activeItems, error: activeError } = await supabase
                        .from('order_items')
                        .select('id, order_id, sku_id, item_name, quantity, completed, foamsheet, extra_info, priority, created_at, updated_at')
                        .eq('order_id', orderId);

                    if (activeError) {
                        console.error('Error fetching active items:', activeError);
                    }

                    if (!activeItems || activeItems.length === 0) {
                        // If no active items, try archived items
                        const { data: archivedItems, error: archivedError } = await supabase
                            .from('archived_order_items')
                            .select('id, order_id, sku_id, item_name, quantity, completed, foamsheet, extra_info, priority, created_at, updated_at')
                            .eq('order_id', orderId);

                        if (archivedError) {
                            console.error('Error fetching archived items:', archivedError);
                        }

                        if (archivedItems) {
                            setItems(archivedItems as OrderItem[]);
                        }
                    } else {
                        setItems(activeItems as OrderItem[]);
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
        <div 
            className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 transition-opacity duration-300"
            onClick={handleBackdropClick}
            ref={dialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="overlay-title"
        >
            <div 
                className="bg-white dark:bg-gray-800 rounded-xl shadow-2xl max-w-2xl w-full max-h-[80vh] overflow-y-auto border border-gray-200 dark:border-gray-700 transform transition-all duration-300 scale-100 relative p-6"
                onClick={e => e.stopPropagation()}
            >
                {/* Close button (X) in the top right */}
                <button
                    type="button"
                    ref={closeButtonRef}
                    onClick={onClose}
                    className="absolute top-3 right-3 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors duration-200 p-1 rounded-full hover:bg-gray-100 dark:hover:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-gray-400"
                    aria-label="Close dialog"
                >
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                        <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
                    </svg>
                </button>

                <h2 
                    id="overlay-title" 
                    className="text-xl font-bold text-gray-900 dark:text-white mb-4"
                >
                    Order Items - {orderId}
                </h2>
                
                {loading ? (
                    <div className="text-center py-8">
                        <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-gray-900 dark:border-gray-300 mx-auto" />
                        <p className="mt-4 text-gray-600 dark:text-gray-300">Loading items...</p>
                    </div>
                ) : items.length === 0 ? (
                    <div className="flex items-center justify-center py-8 bg-gray-50 dark:bg-gray-700/30 rounded-lg">
                        <div className="text-center">
                            <svg xmlns="http://www.w3.org/2000/svg" className="h-12 w-12 text-gray-400 mx-auto mb-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                            </svg>
                            <p className="text-gray-600 dark:text-gray-300 text-lg">No items found for this order</p>
                        </div>
                    </div>
                ) : (
                    <div className="overflow-hidden rounded-lg border border-gray-200 dark:border-gray-700">
                        <table className="w-full">
                            <thead className="bg-gray-50 dark:bg-gray-700">
                                <tr>
                                    <th className="text-left text-gray-700 dark:text-gray-300 font-semibold px-4 py-3">Item Name</th>
                                    <th className="text-left whitespace-nowrap text-gray-700 dark:text-gray-300 font-semibold px-4 py-3">Foam Sheet</th>
                                    <th className="text-center text-gray-700 dark:text-gray-300 font-semibold px-4 py-3">Quantity</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                                {items.map((item) => (
                                    <tr key={item.id} className="hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors duration-150">
                                        <td className="px-4 py-3 text-gray-900 dark:text-gray-100">{item.item_name}</td>
                                        <td className="px-4 py-3 whitespace-nowrap text-gray-900 dark:text-gray-100">{item.foamsheet}</td>
                                        <td className="px-4 py-3 text-center text-gray-900 dark:text-gray-100">{item.quantity}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>
        </div>
    );
}
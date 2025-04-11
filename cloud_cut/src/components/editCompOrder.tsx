"use client";

import React, { useState, useEffect, useRef } from 'react';
import { Order, OrderItem } from '@/types/redux';
import { supabase } from '@/utils/supabase';

interface EditCompOrderProps {
    order: Order;
    onClose: () => void;
    onSave: (updatedOrder: Order) => void;
}

// Add a new interface for the edited item
interface EditedItem extends OrderItem {
    isEditing?: boolean;
}

export default function EditCompOrder({ order, onClose, onSave }: EditCompOrderProps) {
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [success, setSuccess] = useState<string | null>(null);
    const [editedOrder, setEditedOrder] = useState<Order>(order);
    const [orderItems, setOrderItems] = useState<EditedItem[]>([]);
    const [isLoadingItems, setIsLoadingItems] = useState(true);
    const [itemsError, setItemsError] = useState<string | null>(null);

    // Refs for accessibility
    const closeButtonRef = useRef<HTMLButtonElement>(null);
    const dialogRef = useRef<HTMLDivElement>(null);

    // Fetch order items when the component mounts
    useEffect(() => {
        const fetchOrderItems = async () => {
            setIsLoadingItems(true);
            setItemsError(null);
            
            try {
                // Determine which table to query based on order status
                const table = order.status === 'Completed' ? 'archived_order_items' : 'order_items';
                
                const { data, error } = await supabase
                    .from(table)
                    .select('*')
                    .eq('order_id', order.order_id);
                
                if (error) {
                    throw new Error(`Failed to fetch order items: ${error.message}`);
                }
                
                // Convert to EditedItem array with isEditing property
                setOrderItems((data || []).map(item => ({ ...item, isEditing: false })));
            } catch (err) {
                console.error('Error fetching order items:', err);
                setItemsError(err instanceof Error ? err.message : 'Failed to fetch order items');
            } finally {
                setIsLoadingItems(false);
            }
        };
        
        fetchOrderItems();
    }, [order.order_id, order.status]);

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

    // Handle input changes
    const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
        const { name, value } = e.target;
        setEditedOrder(prev => ({
            ...prev,
            [name]: value
        }));
    };

    // Handle item field change
    const handleItemChange = (index: number, field: string, value: string | number | boolean) => {
        setOrderItems(items => {
            const updatedItems = [...items];
            updatedItems[index] = {
                ...updatedItems[index],
                [field]: value
            };
            return updatedItems;
        });
    };
    
    // Toggle item edit mode
    const toggleItemEdit = (index: number) => {
        setOrderItems(items => {
            const updatedItems = [...items];
            updatedItems[index] = {
                ...updatedItems[index],
                isEditing: !updatedItems[index].isEditing
            };
            return updatedItems;
        });
    };

    // Save changes to Supabase
    const handleSave = async () => {
        setIsLoading(true);
        setError(null);
        setSuccess(null);
        
        try {
            // Format dates and ensure data types match
            const updatedOrder = {
                ...editedOrder,
                updated_at: new Date().toISOString()
            };
            
            // Status change handling - especially for Completed to Pending transition
            const wasCompleted = order.status === 'Completed';
            const isPending = updatedOrder.status === 'Pending';
            
            // Handle status transition from Completed to Pending
            if (wasCompleted && isPending) {
                console.log('Moving order from archived to active tables...');
                
                // 1. Fetch all order items from archived_order_items
                const { data: archivedItems, error: fetchItemsError } = await supabase
                    .from('archived_order_items')
                    .select('*')
                    .eq('order_id', updatedOrder.order_id);
                
                if (fetchItemsError) {
                    throw new Error(`Failed to fetch archived items: ${fetchItemsError.message}`);
                }
                
                // 2. Set manufactured and packed based on items
                // Check if any item has a SKU starting with SFI or SFC
                const hasFoamInserts = archivedItems?.some(item => 
                    item.sku_id?.startsWith('SFI') || item.sku_id?.startsWith('SFC')
                ) || false;
                
                // 3. Create a clean order object with only the fields that exist in the orders table
                const orderForInsertion = {
                    order_id: updatedOrder.order_id,
                    order_date: updatedOrder.order_date,
                    customer_name: updatedOrder.customer_name,
                    status: updatedOrder.status,
                    total_items: updatedOrder.total_items,
                    items_completed: 0, // Reset completed items count
                    access_url: updatedOrder.access_url,
                    email: updatedOrder.email,
                    country: updatedOrder.country,
                    raw_data: updatedOrder.raw_data,
                    created_at: new Date().toISOString(),
                    updated_at: new Date().toISOString(),
                    manufactured: !hasFoamInserts, // Set based on foam inserts
                    packed: false
                };

                // Start a transaction-like operation
                try {
                    // 4. Delete from archived_order_items first
                    const { error: deleteItemsError } = await supabase
                        .from('archived_order_items')
                        .delete()
                        .eq('order_id', updatedOrder.order_id);

                    if (deleteItemsError) {
                        throw new Error(`Failed to delete items from archived_order_items: ${deleteItemsError.message}`);
                    }

                    // 5. Delete from archived_orders
                    const { error: deleteOrderError } = await supabase
                        .from('archived_orders')
                        .delete()
                        .eq('order_id', updatedOrder.order_id);

                    if (deleteOrderError) {
                        throw new Error(`Failed to delete order from archived_orders: ${deleteOrderError.message}`);
                    }
                    
                    // 6. Insert the order into the orders table
                    const { error: insertOrderError } = await supabase
                        .from('orders')
                        .insert([orderForInsertion]);
                    
                    if (insertOrderError) {
                        throw new Error(`Failed to insert order into orders table: ${insertOrderError.message}`);
                    }

                    // 7. If there are items to move
                    if (archivedItems && archivedItems.length > 0) {
                        // Prepare items for insertion - create clean objects with only necessary fields
                        const itemsToInsert = archivedItems.map(item => {
                            const cleanItem = {
                                order_id: item.order_id,
                                sku_id: item.sku_id,
                                item_name: item.item_name,
                                quantity: item.quantity,
                                completed: false, // Reset completed status
                                foamsheet: item.foamsheet,
                                extra_info: item.extra_info,
                                priority: item.priority,
                                created_at: new Date().toISOString(),
                                updated_at: new Date().toISOString()
                            };
                            return cleanItem;
                        });
                        
                        // Insert items into order_items table
                        const { error: insertItemsError } = await supabase
                            .from('order_items')
                            .insert(itemsToInsert);
                        
                        if (insertItemsError) {
                            // If items insertion fails, we should clean up the order
                            await supabase
                                .from('orders')
                                .delete()
                                .eq('order_id', updatedOrder.order_id);
                            
                            throw new Error(`Failed to insert items into order_items table: ${insertItemsError.message}`);
                        }
                    }

                    setSuccess('Order moved from archived to active successfully!');
                    onSave(updatedOrder);
                    return;
                } catch (error) {
                    // If any step fails, try to clean up
                    try {
                        await supabase
                            .from('orders')
                            .delete()
                            .eq('order_id', updatedOrder.order_id);
                    } catch (cleanupError) {
                        console.error('Cleanup failed:', cleanupError);
                    }
                    throw error;
                }
            }

            // Handle normal update (no table changes)
            else {
                // Determine which table to update
                const table = updatedOrder.status === 'Completed' ? 'archived_orders' : 'orders';
                const itemsTable = updatedOrder.status === 'Completed' ? 'archived_order_items' : 'order_items';
                
                // If updating in the regular orders table, set manufactured and packed
                if (table === 'orders') {
                    // Fetch items to check for foam inserts
                    const { data: orderItems, error: fetchItemsError } = await supabase
                        .from('order_items')
                        .select('sku_id')
                        .eq('order_id', updatedOrder.order_id);
                    
                    if (fetchItemsError) {
                        console.warn(`Warning: Could not fetch items to check for foam inserts: ${fetchItemsError.message}`);
                    }
                    
                    // Check if any item has a SKU starting with SFI or SFC
                    const hasFoamInserts = orderItems?.some(item => 
                        item.sku_id?.startsWith('SFI') || item.sku_id?.startsWith('SFC')
                    ) || false;
                    
                    // Set manufactured and packed values
                    updatedOrder.manufactured = !hasFoamInserts;
                    updatedOrder.packed = false;
                }
                
                // Prepare the update object appropriate for the target table
                let updateObject;
                
                if (table === 'orders') {
                    updateObject = {
                        order_id: updatedOrder.order_id,
                        order_date: updatedOrder.order_date,
                        customer_name: updatedOrder.customer_name,
                        status: updatedOrder.status,
                        email: updatedOrder.email,
                        country: updatedOrder.country,
                        updated_at: new Date().toISOString(),
                        manufactured: updatedOrder.manufactured,
                        packed: updatedOrder.packed
                    };
                } else {
                    // For archived_orders table
                    updateObject = {
                        order_id: updatedOrder.order_id,
                        order_date: updatedOrder.order_date,
                        customer_name: updatedOrder.customer_name,
                        status: updatedOrder.status,
                        email: updatedOrder.email,
                        country: updatedOrder.country,
                        updated_at: new Date().toISOString()
                    };
                }
                
                // Update the order in the appropriate table
                const { error: updateError } = await supabase
                    .from(table)
                    .update(updateObject)
                    .eq('order_id', updatedOrder.order_id);
                
                if (updateError) {
                    throw new Error(`Failed to update order in ${table}: ${updateError.message}`);
                }

                // Additionally, update all modified items
                const itemsToUpdate = orderItems.filter(item => item.isEditing);
                
                if (itemsToUpdate.length > 0) {
                    console.log(`Updating ${itemsToUpdate.length} items in ${itemsTable} table`);
                    
                    // Process items one by one to avoid bulk update issues
                    for (const item of itemsToUpdate) {
                        // Create a clean item object without the isEditing property
                        const { isEditing, ...cleanItem } = item;
                        
                        // Update the item
                        const { error: itemUpdateError } = await supabase
                            .from(itemsTable)
                            .update({
                                ...cleanItem,
                                updated_at: new Date().toISOString()
                            })
                            .eq('id', item.id);
                        
                        if (itemUpdateError) {
                            throw new Error(`Failed to update item ${item.id}: ${itemUpdateError.message}`);
                        }
                        
                        console.log(`Updated item ${item.id} (isEditing: ${isEditing})`);
                    }
                    
                    console.log(`Successfully updated ${itemsToUpdate.length} items in ${itemsTable}`);
                }
            }
            
            // Call the onSave callback with the updated order
            onSave(updatedOrder);
            
            setSuccess('Order and items updated successfully!');
            
            // Close the modal after a brief delay to show success message
            setTimeout(() => {
                onClose();
            }, 1500);
            
        } catch (err) {
            console.error('Error updating order:', err);
            setError(err instanceof Error ? err.message : 'Failed to update order');
        } finally {
            setIsLoading(false);
        }
    };

    return(
        <div 
            className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 transition-opacity duration-300"
            onClick={handleBackdropClick}
            ref={dialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="overlay-title"
        > 
            <div
                className="bg-white dark:bg-gray-800 rounded-xl shadow-2xl max-w-4xl w-full max-h-[80vh] overflow-y-auto border border-gray-200 dark:border-gray-700 transform transition-all duration-300 scale-100 relative p-6"    
                onClick={e => e.stopPropagation()}
            >
                {/**Close button (X) in the top right */}
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
                    Edit Order - {editedOrder.order_id}
                </h2>

                {isLoading ? (
                    <div className="text-center py-8">
                        <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-gray-900 dark:border-gray-300 mx-auto"/>
                        <p className="mt-4 text-gray-600 dark:text-gray-300">Processing...</p>
                    </div>
                ) : (
                    <div className="space-y-6">
                        {error && (
                            <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg" role="alert">
                                <p>{error}</p>
                            </div>
                        )}
                        
                        {success && (
                            <div className="bg-green-50 border border-green-200 text-green-700 px-4 py-3 rounded-lg" role="alert">
                                <p>{success}</p>
                            </div>
                        )}
                        
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                            {/* Order ID Field - Read only */}
                            <div>
                                <label htmlFor="order_id" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                                    Order ID
                                </label>
                                <input
                                    type="text"
                                    id="order_id"
                                    name="order_id"
                                    value={editedOrder.order_id}
                                    readOnly
                                    className="w-full px-3 py-2 bg-gray-100 dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-md shadow-sm text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 cursor-not-allowed"
                                />
                                <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">Order ID cannot be changed</p>
                            </div>
                            
                            {/* Customer Name Field */}
                            <div>
                                <label htmlFor="customer_name" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                                    Customer Name
                                </label>
                                <input
                                    type="text"
                                    id="customer_name"
                                    name="customer_name"
                                    value={editedOrder.customer_name}
                                    readOnly
                                    className="w-full px-3 py-2 bg-gray-100 dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-md shadow-sm text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 cursor-not-allowed"
                                />
                                <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">Customer Name cannot be changed</p>
                            </div>
                            
                            {/* Order Date Field */}
                            <div>
                                <label htmlFor="order_date" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                                    Order Date
                                </label>
                                <input
                                    type="date"
                                    id="order_date"
                                    name="order_date"
                                    value={editedOrder.order_date.split('T')[0]} // Format date to YYYY-MM-DD
                                    readOnly
                                    className="w-full px-3 py-2 bg-gray-100 dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-md shadow-sm text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 cursor-not-allowed"
                                />
                                <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">Order Date cannot be changed</p>
                            </div>
                            
                            {/* Status Field */}
                            <div>
                                <label htmlFor="status" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                                    Status
                                </label>
                                <select
                                    id="status"
                                    name="status"
                                    value={editedOrder.status || 'Completed'}
                                    onChange={handleInputChange}
                                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md shadow-sm text-gray-900 dark:text-gray-100 bg-white dark:bg-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                                >
                                    <option value="Completed">Completed</option>
                                    <option value="Pending">Pending</option>
                                    <option value="Cancelled">Cancelled</option>
                                </select>
                            </div>
                            
                            {/* Email Field */}
                    <div>
                                <label htmlFor="email" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                                    Email
                                </label>
                                <input
                                    type="email"
                                    id="email"
                                    name="email"
                                    value={editedOrder.email || ''}
                                    readOnly
                                    className="w-full px-3 py-2 bg-gray-100 dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-md shadow-sm text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 cursor-not-allowed"
                                />
                                <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">Email cannot be changed</p>
                            </div>
                            
                            {/* Country Field */}
                        <div>
                                <label htmlFor="country" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                                    Country
                                </label>
                                <input
                                    type="text"
                                    id="country"
                                    name="country"
                                    value={editedOrder.country || ''}
                                    readOnly
                                    className="w-full px-3 py-2 bg-gray-100 dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-md shadow-sm text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 cursor-not-allowed"
                                />
                                <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">Country cannot be changed</p>
                            </div>
                        </div>
                        
                        {/* Order Items Section */}
                        <div className="mt-8">
                            <h3 className="text-lg font-medium text-gray-900 dark:text-white mb-4">Order Items</h3>
                            
                            {isLoadingItems ? (
                                <div className="text-center py-6">
                                    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-gray-600 dark:border-gray-400 mx-auto"/>
                                    <p className="mt-3 text-gray-500 dark:text-gray-400">Loading items...</p>
                                </div>
                            ) : itemsError ? (
                                <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-700 text-red-700 dark:text-red-400 px-4 py-3 rounded-lg" role="alert">
                                    <p>{itemsError}</p>
                                </div>
                            ) : orderItems.length === 0 ? (
                                <div className="text-center py-6 bg-gray-50 dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700">
                                    <p className="text-gray-500 dark:text-gray-400">No items found for this order</p>
                                </div>
                            ) : (
                                <div className="overflow-x-auto rounded-lg border border-gray-200 dark:border-gray-700">
                                    <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
                                        <thead className="bg-gray-50 dark:bg-gray-800">
                                            <tr>
                                                <th scope="col" className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Item Name</th>
                                                <th scope="col" className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">SKU</th>
                                                <th scope="col" className="px-4 py-3 text-center text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Quantity</th>
                                                <th scope="col" className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Foam Sheet</th>
                                                <th scope="col" className="px-4 py-3 text-center text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Completed</th>
                                                <th scope="col" className="px-4 py-3 text-center text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Actions</th>
                                            </tr>
                                        </thead>
                                        <tbody className="bg-white dark:bg-gray-900 divide-y divide-gray-200 dark:divide-gray-800">
                                            {orderItems.map((item, index) => (
                                                <tr key={item.id} className={item.isEditing ? "bg-blue-50 dark:bg-blue-900/20" : ""}>
                                                    <td className="px-4 py-3 whitespace-nowrap">
                                                        {item.isEditing ? (
                                                            <input
                                                                type="text"
                                                                value={item.item_name}
                                                                onChange={(e) => handleItemChange(index, 'item_name', e.target.value)}
                                                                className="w-full px-2 py-1 text-sm border border-gray-300 dark:border-gray-600 rounded shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent dark:bg-gray-800 dark:text-gray-200"
                                                            />
                                                        ) : (
                                                            <div className="text-sm text-gray-900 dark:text-gray-200">{item.item_name}</div>
                                                        )}
                                                    </td>
                                                    <td className="px-4 py-3 whitespace-nowrap">
                                                        {item.isEditing ? (
                                                            <input
                                                                type="text"
                                                                value={item.sku_id}
                                                                onChange={(e) => handleItemChange(index, 'sku_id', e.target.value)}
                                                                className="w-full px-2 py-1 text-sm border border-gray-300 dark:border-gray-600 rounded shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent dark:bg-gray-800 dark:text-gray-200"
                                                            />
                                                        ) : (
                                                            <div className="text-sm text-gray-900 dark:text-gray-200">{item.sku_id}</div>
                                                        )}
                                                    </td>
                                                    <td className="px-4 py-3 whitespace-nowrap text-center">
                                                        {item.isEditing ? (
                                                            <input
                                                                type="number"
                                                                min="1"
                                                                value={item.quantity}
                                                                onChange={(e) => handleItemChange(index, 'quantity', parseInt(e.target.value) || 1)}
                                                                className="w-16 px-2 py-1 text-sm text-center border border-gray-300 dark:border-gray-600 rounded shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent dark:bg-gray-800 dark:text-gray-200"
                                                            />
                                                        ) : (
                                                            <div className="text-sm text-gray-900 dark:text-gray-200">{item.quantity}</div>
                                                        )}
                                                    </td>
                                                    <td className="px-4 py-3 whitespace-nowrap">
                                                        {item.isEditing ? (
                                                            <input
                                                                type="text"
                                                                value={item.foamsheet || ''}
                                                                onChange={(e) => handleItemChange(index, 'foamsheet', e.target.value)}
                                                                className="w-full px-2 py-1 text-sm border border-gray-300 dark:border-gray-600 rounded shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent dark:bg-gray-800 dark:text-gray-200"
                                                            />
                                                        ) : (
                                                            <div className="text-sm text-gray-900 dark:text-gray-200">{item.foamsheet || 'N/A'}</div>
                                                        )}
                                                    </td>
                                                    <td className="px-4 py-3 whitespace-nowrap text-center">
                                                        {item.isEditing ? (
                                                            <input
                                                                type="checkbox"
                                                                checked={item.completed}
                                                                onChange={(e) => handleItemChange(index, 'completed', e.target.checked)}
                                                                className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
                                                            />
                                                        ) : (
                                                            <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                                                                item.completed 
                                                                ? 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300' 
                                                                : 'bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-300'
                                                            }`}>
                                                                {item.completed ? 'Yes' : 'No'}
                                                            </span>
                                                        )}
                                                    </td>
                                                    <td className="px-4 py-3 whitespace-nowrap text-center">
                                                        <button
                                                            type="button"
                                                            onClick={() => toggleItemEdit(index)}
                                                            className={`inline-flex items-center px-2.5 py-1.5 border border-transparent text-xs font-medium rounded 
                                                                ${item.isEditing
                                                                ? 'text-indigo-700 bg-indigo-100 hover:bg-indigo-200 dark:bg-indigo-900 dark:text-indigo-300 dark:hover:bg-indigo-800'
                                                                : 'text-gray-700 bg-gray-100 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700'
                                                                } focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500`}
                                                        >
                                                            {item.isEditing ? 'Done' : 'Edit'}
                                                        </button>
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            )}
                        </div>
                        
                        <div className="flex justify-center space-x-4 pt-4 border-t border-gray-200 dark:border-gray-700">
                            
                            <button
                                type="button"
                                onClick={handleSave}
                                disabled={isLoading}
                                className="px-4 py-2 bg-blue-600 text-white hover:bg-blue-700 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 transition-colors disabled:opacity-50 disabled:pointer-events-none"
                            >
                                {isLoading ? 'Saving...' : 'Save Changes'}
                            </button>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );   
}

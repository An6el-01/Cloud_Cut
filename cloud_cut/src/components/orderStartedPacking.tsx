"use client";

import React, {useRef, useEffect, useState} from "react";
import { Order, OrderItem } from "@/types/redux";
import { useDispatch, useSelector } from "react-redux";
import { AppDispatch, RootState } from "@/redux/store";
import { updateItemCompleted, setCurrentView, updateOrderPickingStatus } from "@/redux/slices/ordersSlice";
import { supabase } from "@/utils/supabase";

export default function StartPacking({
    isOpen,
    onClose,
    onConfirm,
    selectedOrder,
    selectedOrderItems,
    id,
} : {
    isOpen: boolean;
    onClose: () => void;
    onConfirm: (orderId: string) => void;
    selectedOrder: Order;
    selectedOrderItems: OrderItem[];
    id: string;
}) {
    const [showDespatch, setShowDespatch] = useState(false);
    const [isProcessing, setIsProcessing] = useState(false);
    const despatchUrl = `https://shadowfoam.despatchcloud.net/orders/edit?id=${id}`;
    const dispatch = useDispatch<AppDispatch>();

    // Trap focus inside modal when open for accessibility
    const confirmButtonRef = useRef<HTMLButtonElement>(null);
    const closeButtonRef = useRef<HTMLButtonElement>(null);
    const dialogRef = useRef<HTMLDivElement>(null);
    const {loading} = useSelector((state: RootState) => state.orders)

    // Function to reset picking status - single source of truth
    const resetPickingStatus = () => {
        if (selectedOrder && isOpen) {
            dispatch(updateOrderPickingStatus({
                orderId: selectedOrder.order_id,
                picking: false,
                user_picking: 'N/A'
            }));
        }
    };

    // Handle escape key press to close modal
    useEffect(() => {
        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key === "Escape" && isOpen) {
                resetPickingStatus();
                onClose();
            }
        };
        if (isOpen) {
            window.addEventListener('keydown', handleKeyDown);
            //Focus the confirm button when dialog opens
            confirmButtonRef.current?.focus();
            //Prevent scroll on body
            document.body.style.overflow = 'hidden';
        }

        return () => {
            window.removeEventListener('keydown', handleKeyDown);
            document.body.style.overflow = '';
        };
    }, [isOpen, onClose, dispatch, selectedOrder]);

    //Click outside to close
    const handleBackdropCLick = (e: React.MouseEvent) => {
        if (dialogRef.current && e.target === dialogRef.current) {
            resetPickingStatus();
            onClose();
        }
    };

    const handleConfirmClick = () => {
        setShowDespatch(true);
    };

    const handleDoneClick = async () => {
        try {
            setIsProcessing(true);
            // 1. Set all items as completed
            const orderItems = selectedOrderItems || [];
            for (const item of orderItems) {
                if (!item.completed) {
                    dispatch(updateItemCompleted({
                        orderId: selectedOrder.order_id,
                        itemId: item.id,
                        completed: true
                    }));
                }
            }

            console.log(`Processing order: ${selectedOrder.order_id}`);

            // 2. Update order status to Completed
            const { error: updateError } = await supabase
                .from('orders')
                .update({
                    status: 'Completed',
                    packed: true,
                    picking: true,
                    updated_at: new Date().toISOString()
                })
                .eq('order_id', selectedOrder.order_id);

            if (updateError) throw new Error(`Failed to update order: ${updateError.message}`);
            console.log(`Updated order status to Completed`);

            // 3. Fetch the complete order data to copy to archived_orders
            let orderData;
            try {
                const { data: orderDataArray, error: fetchError } = await supabase
                    .from('orders')
                    .select('id, order_id, order_date, customer_name, status, total_items, items_completed, access_url, email, country, raw_data, created_at, updated_at, manufactured, packed')
                    .eq('order_id', selectedOrder.order_id);

                if (fetchError) throw fetchError;
                if (!orderDataArray || orderDataArray.length === 0) throw new Error(`Order not found in database`);
                
                console.log(`Fetched ${orderDataArray.length} records for order`);
                orderData = orderDataArray[0];
            } catch (fetchErr: any) {
                console.warn(`Could not fetch order from database: ${fetchErr.message}`);
                console.log('Using selected order data as fallback');
                
                // Use selectedOrder as fallback - it may not have all fields, but it has the essential ones
                orderData = {
                    ...selectedOrder,
                    status: 'Completed',
                    packed: true,
                    updated_at: new Date().toISOString()
                };
            }

            // 4. Insert into archived_orders
            try {
                const timestamp = new Date().toISOString();
                
                // Extract only the fields that exist in the archived_orders table
                const { 
                    id,
                    order_id, 
                    order_date, 
                    customer_name, 
                    status, 
                    total_items, 
                    items_completed, 
                    access_url, 
                    email, 
                    country, 
                    raw_data, 
                    created_at, 
                    updated_at
                } = orderData;
                
                // Only include fields that exist in the archived_orders table
                const archivedOrderData = {
                    order_id,
                    order_date,
                    customer_name,
                    status,
                    total_items,
                    items_completed,
                    access_url,
                    email,
                    country,
                    raw_data,
                    created_at,
                    updated_at,
                    archived_at: timestamp
                };
                
                const { error: archiveError } = await supabase
                    .from('archived_orders')
                    .insert(archivedOrderData);
    
                if (archiveError) throw archiveError;
                console.log(`Inserted order into archived_orders`);
            } catch (archiveErr: any) {
                // If the error is about a duplicate, we can continue
                if (archiveErr.message && archiveErr.message.includes('duplicate')) {
                    console.warn(`Order already exists in archived_orders: ${archiveErr.message}`);
                } else {
                    throw new Error(`Failed to archive order: ${archiveErr.message}`);
                }
            }

            // 5. Get all order items
            const { data: itemsData, error: itemsError } = await supabase
                .from('order_items')
                .select('id, order_id, sku_id, item_name, quantity, completed, foamsheet, extra_info, priority, created_at, updated_at')
                .eq('order_id', selectedOrder.order_id);

            if (itemsError) throw new Error(`Failed to fetch order items: ${itemsError.message}`);
            console.log(`Fetched ${itemsData?.length || 0} order items`);

            // If we have items to archive, proceed with archiving
            if (itemsData && itemsData.length > 0) {
                // 6. Update all items' completed status to true
                const { error: updateItemsError } = await supabase
                    .from('order_items')
                    .update({ completed: true })
                    .eq('order_id', selectedOrder.order_id);

                if (updateItemsError) throw new Error(`Failed to update order items: ${updateItemsError.message}`);
                console.log(`Updated all items to completed`);

                // 7. Move all items to archived_order_items
                // Prepare items for insertion (remove ids)
                const timestamp = new Date().toISOString();
                const archivedItems = itemsData.map(item => {
                    // Create a new object without the id field
                    const { id, ...itemWithoutId } = item;
                    return {
                        ...itemWithoutId,
                        completed: true, // Ensure all items are marked as completed
                        archived_at: timestamp
                    };
                });

                try {
                    const { error: archiveItemsError } = await supabase
                        .from('archived_order_items')
                        .insert(archivedItems);
    
                    if (archiveItemsError) throw archiveItemsError;
                    console.log(`Inserted ${archivedItems.length} items into archived_order_items`);
                } catch (archiveItemsErr: any) {
                    // If the error is about duplicates, we can continue
                    if (archiveItemsErr.message && archiveItemsErr.message.includes('duplicate')) {
                        console.warn(`Some items already exist in archived_order_items: ${archiveItemsErr.message}`);
                    } else {
                        throw new Error(`Failed to archive order items: ${archiveItemsErr.message}`);
                    }
                }

                // 8. Delete the original order items
                const { error: deleteItemsError } = await supabase
                    .from('order_items')
                    .delete()
                    .eq('order_id', selectedOrder.order_id);

                if (deleteItemsError) throw new Error(`Failed to delete order items: ${deleteItemsError.message}`);
                console.log(`Deleted original order items`);
            } else {
                console.log(`No items found for order ${selectedOrder.order_id}`);
            }

            // 9. Delete the original order
            const { error: deleteOrderError } = await supabase
                .from('orders')
                .delete()
                .eq('order_id', selectedOrder.order_id);

            if (deleteOrderError) throw new Error(`Failed to delete order: ${deleteOrderError.message}`);
            console.log(`Deleted original order`);

            // Finally, call the onConfirm handler to update the UI and trigger refresh
            onConfirm(selectedOrder.order_id);
            
            // Force a check for orphaned orders in the manufacturing view
            dispatch(setCurrentView('manufacturing'));
            
            setIsProcessing(false);
            onClose(); // Close the modal after successful completion
        } catch (error) {
            console.error('Error completing order:', error);
            alert(`Failed to complete order: ${error instanceof Error ? error.message : 'Unknown error'}`);
            setIsProcessing(false);
        }
    };

    const handleGoBack = () => {
        setShowDespatch(false);
    };

    const handleToggleCompleted = (orderId: string, itemId: string, completed: boolean) => {
        // If marking as incomplete, just do it directly
        if (!completed) {
            dispatch(updateItemCompleted({ orderId, itemId, completed }));
            return;
        }

        // Count how many items are already completed
        const completedItems = selectedOrderItems.filter(item =>
            item.completed || item.id === itemId // Count the current item if it's being marked as completed
        );

        
            // Not the last item, just mark it as completed
            dispatch(updateItemCompleted({ orderId, itemId, completed }));
    };

    const handleCloseClick = () => {
        resetPickingStatus();
        onClose();
    };

    if (!isOpen) return null;

    return(
        <div
            className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 transition-opacity duration-300"
            onClick={handleBackdropCLick}
            ref={dialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="dialog-title"
        >
            <div
                className="bg-white p-6 rounded-xl shadow-2xl max-w-lg w-full border border-gray-200 transform transition-all duration-300 scale-100 relative overflow-hidden"
                onClick={e => e.stopPropagation()}
            >
                {/* Close button (X) in the top right */}
                {showDespatch ? (
                    <button
                        type="button"
                        onClick={handleGoBack}
                        className="absolute top-4 right-4 text-gray-500 hover:text-gray-700 transition-colors duration-200 p-2 rounded-full hover:bg-gray-100
                                    focus:outline-none focus:ring-2 focus:ring-blue-500"
                        aria-label="Go back"
                    >
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                            <path fillRule="evenodd" d="M9.707 16.707a1 1 0 01-1.414 0l-6-6a1 1 0 010-1.414l6-6a1 1 0 011.414 1.414L5.414 9H17a1 1 0 110 2H5.414l4.293 4.293a1 1 0 010 1.414z" clipRule="evenodd" />
                        </svg>
                    </button>
                ) : (
                    <button
                        type="button"
                        ref={closeButtonRef}
                        onClick={handleCloseClick}
                        className="absolute top-4 right-4 text-gray-500 hover:text-gray-700 transition-colors duration-200 p-2 rounded-full hover:bg-gray-100
                                    focus:outline-none focus:ring-2 focus:ring-blue-500"
                        aria-label="Close dialog"
                    >
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                            <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
                        </svg>
                    </button>
                )}

                <div className="border-b border-gray-200 pb-4 mb-5">
                    <h2
                        id="dialog-title"
                        className="text-2xl font-bold text-gray-800 mb-1"
                    >
                        {showDespatch ? "Despatch Order" : `Order: #${selectedOrder.id}`}
                    </h2>
                    <p className="text-gray-500">{showDespatch ? "" : "Picking in progress"}</p>
                </div>

                {showDespatch ? (
                    <div className="mb-6 text-gray-700 space-y-3">
                        <p>
                            Please despatch the order using the link below:
                        </p>
                        <a
                            href={despatchUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="block w-full px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors duration-200 text-center"
                        >
                            Despatch Order
                        </a>
                        <p className="mt-4">
                            Once you have completed the despatch process, click the button below to mark the order as complete.
                        </p>
                    </div>
                ) : (
                    <>
                        <div className="grid grid-cols-3 gap-5 mb-6">
                            <div className="bg-gray-50 p-3 rounded-lg">
                                <p className="text-sm text-gray-500 mb-1">Order Date</p>
                                <p className="font-medium text-gray-800">{new Date(selectedOrder.order_date).toLocaleDateString()}</p>
                            </div>
                            <div className="bg-gray-50 p-3 rounded-lg">
                                <p className="text-sm text-gray-500 mb-1">Customer</p>
                                <p className="font-medium text-gray-800" title={selectedOrder.customer_name}>{selectedOrder.customer_name}</p>
                            </div>
                            <div className="bg-gray-50 p-3 rounded-lg">
                                <p className="text-sm text-gray-500 mb-1">External Link</p>
                                <a
                                    href={`https://shadowfoam.despatchcloud.net/orders/edit?id=${selectedOrder.id}`}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="text-blue-600 hover:text-blue-800 hover:underline font-medium flex items-center gap-1"
                                >
                                    Despatch Cloud
                                    <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                                    </svg>
                                </a>
                            </div>
                        </div>

                        <div className="mb-6">
                            <div className="flex justify-between items-center mb-3">
                                <h3 className="font-semibold text-lg text-gray-800">Items:</h3>

                                {/**Progress Indicator */}
                                {selectedOrderItems.length > 0 && (
                                    <div className="flex items-center gap-2">
                                        <span className="text-sm font-medium text-gray-600">
                                            {selectedOrderItems.filter(item => item.completed).length}/{selectedOrderItems.length}
                                        </span>
                                        <div className="w-32 bg-gray-200 rounded-full h-2.5 overflow-hidden">
                                            <div
                                                className="bg-green-600 h-2.5 rounded-full transition-all duration-500 ease-out"
                                                style={{ 
                                                    width: `${selectedOrderItems.length > 0 
                                                        ? (selectedOrderItems.filter(item => item.completed).length / selectedOrderItems.length) * 100 
                                                        : 0}%` 
                                                }}
                                                aria-hidden="true"
                                            ></div>
                                        </div>
                                    </div>
                                )}
                            </div>

                            {/**Loading Indicator For Items */}
                            {selectedOrder.id && selectedOrderItems.length === 0 && !loading ? (
                                <div className="flex flex-col items-center justify-center p-8 bg-gray-50 rounded-lg border border-gray-200 animate-pulse">
                                    <div className="w-10 h-10 border-4 border-gray-200 border-t-blue-600 rounded-full animate-spin mb-4"></div>
                                    <p className="text-gray-600 font-medium">Loading order items...</p>
                                </div>
                            ) : (
                                <div className="overflow-hidden rounded-lg border border-gray-200">
                                    <table className="w-full">
                                        <thead className="bg-gray-50 border-b border-gray-200">
                                            <tr>
                                                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Name</th>
                                                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider whitespace-nowrap">FoamSheet</th>
                                                <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">Qty</th>
                                                <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">Picked</th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-gray-200 bg-white">
                                            {selectedOrderItems.map((item, index) => (
                                                <tr key={item.id} className="hover:bg-gray-50 transition-colors">
                                                    <td className="px-4 py-3 text-sm font-medium text-gray-800">{item.item_name}</td>
                                                    <td className="px-4 py-3 text-sm text-gray-600">{item.foamsheet}</td>
                                                    <td className="px-4 py-3 text-sm text-center text-gray-600">{item.quantity}</td>
                                                    <td className="px-4 py-3 text-center">
                                                        <div className="flex justify-center">
                                                            <label className="relative inline-flex items-center cursor-pointer">
                                                                <input
                                                                    type="checkbox"
                                                                    checked={item.completed}
                                                                    onChange={(e) => handleToggleCompleted(selectedOrder.order_id, item.id, e.target.checked)}
                                                                    className="sr-only peer"
                                                                    aria-label={`Mark ${item.item_name} as ${item.completed ? "packed" : "unpacked"}`}
                                                                />
                                                                <div className="w-6 h-6 border-2 border-gray-300 rounded peer-checked:bg-green-500 peer-checked:border-green-500 peer-focus:ring-2 peer-focus:ring-green-400/50 transition-all flex items-center justify-center">
                                                                {item.completed && (
                                                                    <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-white" viewBox="0 0 20 20" fill="currentColor">
                                                                        <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                                                                    </svg>
                                                                )}
                                                                </div>
                                                            </label>
                                                        </div>
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            )}
                        </div>
                    </>
                )}

                <div className="flex justify-center gap-3 mt-6">
                    
                    {showDespatch ? (
                        <button
                            type="button"
                            onClick={handleDoneClick}
                            className="px-6 py-2.5 bg-green-600 rounded-lg text-white font-medium hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-green-500 transition-colors duration-200 shadow-sm flex items-center gap-2"
                            aria-label="Mark order as complete"
                            disabled={isProcessing}
                        >
                            {isProcessing ? (
                                <>
                                    <svg className="animate-spin -ml-1 mr-2 h-4 w-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                                    </svg>
                                    <span>Processing...</span>
                                </>
                            ) : (
                                <>
                                    <span>Complete Order</span>
                                    <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                                        <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                                    </svg>
                                </>
                            )}
                        </button>
                    ) : (
                        <button
                            type="button"
                            ref={confirmButtonRef}
                            onClick={handleConfirmClick}
                            className="px-6 py-2.5 bg-green-600 rounded-lg text-white font-medium hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-green-500 transition-colors duration-200 shadow-sm"
                            aria-label="Confirm and proceed to despatch"
                        >
                            Confirm & Continue
                        </button>
                    )}
                </div>
            </div>
        </div>
    );
}


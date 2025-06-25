"use client";

import React, {useRef, useEffect, useState, useCallback} from "react";
import { Order, OrderItem } from "@/types/redux";
import { useDispatch, useSelector } from "react-redux";
import { AppDispatch, RootState } from "@/redux/store";
import { updateItemCompleted, setCurrentView, updateOrderPickingStatus } from "@/redux/slices/ordersSlice";
import { supabase } from "@/utils/supabase";
import { fetchFinishedStockFromSupabase } from "@/redux/thunks/stockThunk";

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
    const {items: stockItems} = useSelector((state: RootState) => state.stock)
    const [allItemsPacked, setAllItemsPacked] = useState(false);
    const [checkedItems, setCheckedItems] = useState<Set<string>>(new Set());
    const [pendingUpdates, setPendingUpdates] = useState<Record<string, boolean>>({});
    const updateTimeoutRef = useRef<NodeJS.Timeout | null>(null);

    // Add state for packing boxes
    const [packingBoxes, setPackingBoxes] = useState<Array<{id: string, boxType: string, quantity: number}>>([
        { id: '1', boxType: '', quantity: 1 }
    ]);

    // Add state for dropdown visibility
    const [openDropdownId, setOpenDropdownId] = useState<string | null>(null);

    // Track stock changes for potential rollback - no longer needed since we don't update immediately
    // const [stockChanges, setStockChanges] = useState<Record<string, {originalStock: number, newStock: number, quantity: number}>>({});

    // Mapping between box types and SKUs
    const boxTypeToSku: Record<string, string> = {
        'Box 00': 'SHA00',
        'Box 1': 'SHA01',
        'Box 2A': 'SHA02A',
        'Box 2B': 'SHA02B',
        'Box 4A': 'SHA04A',
        'Box 4B': 'SHA04B',
        'Box 6A': 'SHA06A',
        'Box 6B': 'SHA06B',
        'Box 8A': 'SHA08A',
        'Box 8B': 'SHA08B',
        'Box 9A/B': 'SHA09AB',
        'Box 10': 'SHA10',
        'Box 11B': 'SHA11B',
        'Box 12A': 'SHA12A',
        'Box 70': 'SHA70',
        'Box 2X1': 'SHA2X1'
    };

    // Sample packing box types - you can replace with actual data from your system
    const packingBoxTypes = [
        'Box 00',
        'Box 1',
        'Box 2A',
        'Box 2B',
        'Box 4A',
        'Box 4B',
        'Box 6A',
        'Box 6B',
        'Box 8A',
        'Box 8B',
        'Box 9A/B',
        'Box 10',
        'Box 11B',
        'Box 12A',
        'Box 70',
        'Box 2X1'
    ];

    // Function to get current stock for a box type
    const getCurrentStock = (boxType: string): number => {
        const sku = boxTypeToSku[boxType];
        if (!sku) return 0;
        
        const stockItem = stockItems.find(item => item.sku === sku);
        return stockItem?.stock || 0;
    };

    // Function to update stock for a packing box
    const updatePackingBoxStock = async (boxType: string, quantity: number) => {
        const sku = boxTypeToSku[boxType];
        if (!sku) {
            return false;
        }

        const stockItem = stockItems.find(item => item.sku === sku);
        if (!stockItem) {
            return false;
        }

        if (stockItem.stock < quantity) {
            return false;
        }

        try {
            // Track the change for potential rollback
            // setStockChanges(prev => ({
            //     ...prev,
            //     [boxType]: {
            //         originalStock: stockItem.stock,
            //         newStock: stockItem.stock - quantity,
            //         quantity: quantity
            //     }
            // }));

            // Update stock in Supabase
            const { error } = await supabase
                .from('finished_stock')
                .update({
                    stock: stockItem.stock - quantity,
                    updated_at: new Date().toISOString()
                })
                .eq('sku', sku);

            if (error) {
                console.error('Error updating stock:', error);
                return false;
            }

            // Refresh stock data
            await dispatch(fetchFinishedStockFromSupabase({ page: 1, perPage: 15 }));

            // Clear any previous error messages for this box type
            return true;
        } catch (error) {
            console.error('Error updating packing box stock:', error);
            return false;
        }
    };

    // Function to rollback stock changes - no longer needed
    // const rollbackStockChanges = async () => {
    //     // Rollback functionality removed since we don't update stock immediately
    // };

    // Function to add a new packing box row
    const addPackingBoxRow = () => {
        const newId = (packingBoxes.length + 1).toString();
        setPackingBoxes(prev => [...prev, { id: newId, boxType: '', quantity: 1 }]);
    };

    // Function to remove a packing box row
    const removePackingBoxRow = (id: string) => {
        if (packingBoxes.length > 1) {
            setPackingBoxes(prev => prev.filter(box => box.id !== id));
        }
    };

    // Function to update packing box data
    const updatePackingBox = (id: string, field: 'boxType' | 'quantity', value: string | number) => {
        setPackingBoxes(prev => prev.map(box => 
            box.id === id ? { ...box, [field]: value } : box
        ));
    };

    // Function to toggle dropdown
    const toggleDropdown = (id: string) => {
        setOpenDropdownId(openDropdownId === id ? null : id);
    };

    // Function to select an option
    const selectOption = async (boxId: string, option: string) => {
        updatePackingBox(boxId, 'boxType', option);
        setOpenDropdownId(null);
        
        // Don't update stock immediately - wait for order completion
    };

    // Function to handle quantity change
    const handleQuantityChange = async (boxId: string, quantity: number) => {
        updatePackingBox(boxId, 'quantity', quantity);
        
        // Don't update stock immediately - wait for order completion
    };

    // Close dropdown when clicking outside
    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (openDropdownId) {
                const target = event.target as Element;
                if (!target.closest('.custom-dropdown')) {
                    setOpenDropdownId(null);
                }
            }
        };

        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, [openDropdownId]);

    // Fetch stock data when component opens
    useEffect(() => {
        if (isOpen) {
            dispatch(fetchFinishedStockFromSupabase({ page: 1, perPage: 15 }));
        }
    }, [isOpen, dispatch]);

    // Add an effect to update the checkedItems set whenever selectedOrderItems changes
    useEffect(() => {
        if (selectedOrderItems) {
            // Group items by SKU
            const groupedItems = selectedOrderItems.reduce((acc, item) => {
                const key = item.sku_id;
                if (!acc[key]) {
                    acc[key] = { ...item, completed: false };
                }
                // If any item with this SKU is completed, mark the group as completed
                if (item.completed) {
                    acc[key].completed = true;
                }
                return acc;
            }, {} as Record<string, OrderItem>);
            
            // Create a new Set with the SKUs of completed items
            const completedSkus = new Set<string>();
            Object.values(groupedItems).forEach(item => {
                if (item.completed) {
                    completedSkus.add(item.sku_id);
                }
            });
            
            setCheckedItems(completedSkus);
            
            // Check if all items are completed to update allItemsPacked
            const allCompleted = Object.values(groupedItems).every(item => item.completed);
            setAllItemsPacked(allCompleted);
        }
    }, [selectedOrderItems]);

    // Create a debounced function to process pending updates
    const processPendingUpdates = useCallback(() => {
        if (updateTimeoutRef.current) {
            clearTimeout(updateTimeoutRef.current);
            updateTimeoutRef.current = null;
        }

        updateTimeoutRef.current = setTimeout(() => {
            const updates = {...pendingUpdates};
            
            // Clear pending updates first before processing to prevent loops
            setPendingUpdates({});
            
            // Process each pending update
            Object.entries(updates).forEach(([itemId, completed]) => {
                // Direct dispatch to Redux
                dispatch(updateItemCompleted({ 
                    orderId: selectedOrder.order_id, 
                    itemId, 
                    completed 
                }));
            });
        }, 2000); // 2 second delay
    }, [pendingUpdates, dispatch, selectedOrder?.order_id]);

    // Process updates when pendingUpdates changes
    useEffect(() => {
        if (Object.keys(pendingUpdates).length > 0) {
            processPendingUpdates();
        }
        
        // Cleanup on unmount
        return () => {
            if (updateTimeoutRef.current) {
                clearTimeout(updateTimeoutRef.current);
            }
        };
    }, [pendingUpdates, processPendingUpdates]);

    // Function to check if all validation conditions are met
    const isConfirmButtonEnabled = () => {
        // Check if all items are packed
        const allItemsPacked = selectedOrderItems.length > 0 && 
            selectedOrderItems.every(item => checkedItems.has(item.sku_id));
        
        // Check if at least one packing box is selected
        const atLeastOneBoxSelected = packingBoxes.some(box => box.boxType && box.quantity > 0);
        
        return allItemsPacked && atLeastOneBoxSelected;
    };

    // Function to reset picking status - single source of truth
    const resetPickingStatus = () => {
        if (selectedOrder && isOpen) {
            dispatch(updateOrderPickingStatus({
                orderId: selectedOrder.order_id,
                picking: false,
                user_picking: 'N/A'
            }));
            setAllItemsPacked(false);
        }
    };

    // Handle escape key press to close modal
    useEffect(() => {
        const handleKeyDown = async (event: KeyboardEvent) => {
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
    const handleBackdropCLick = async (e: React.MouseEvent) => {
        if (dialogRef.current && e.target === dialogRef.current) {
            resetPickingStatus();
            onClose();
        }
    };

    const handleConfirmClick = () => {
        setShowDespatch(true);
    };

    const handleCloseClick = async () => {
        resetPickingStatus();
        onClose();
    };

    const handleDoneClick = async () => {
        try {
            setIsProcessing(true);
            
            // 1. Process packing box stock updates
            const packingBoxUpdates = packingBoxes
                .filter(box => box.boxType && box.quantity > 0)
                .map(box => ({ boxType: box.boxType, quantity: box.quantity }));
            
            if (packingBoxUpdates.length > 0) {
                console.log('Processing packing box stock updates:', packingBoxUpdates);
                
                for (const update of packingBoxUpdates) {
                    const success = await updatePackingBoxStock(update.boxType, update.quantity);
                    if (!success) {
                        throw new Error(`Failed to update stock for ${update.boxType}`);
                    }
                }
                console.log('All packing box stock updates completed');
            }

            // 2. Set all items as completed
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

            // 3. Update order status to Completed
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

            // 4. Fetch the complete order data to copy to archived_orders
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

            // 5. Insert into archived_orders
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

            // 6. Get all order items
            const { data: itemsData, error: itemsError } = await supabase
                .from('order_items')
                .select('id, order_id, sku_id, item_name, quantity, completed, foamsheet, extra_info, priority, created_at, updated_at')
                .eq('order_id', selectedOrder.order_id);

            if (itemsError) throw new Error(`Failed to fetch order items: ${itemsError.message}`);
            console.log(`Fetched ${itemsData?.length || 0} order items`);

            // If we have items to archive, proceed with archiving
            if (itemsData && itemsData.length > 0) {
                // 7. Update all items' completed status to true
                const { error: updateItemsError } = await supabase
                    .from('order_items')
                    .update({ completed: true })
                    .eq('order_id', selectedOrder.order_id);

                if (updateItemsError) throw new Error(`Failed to update order items: ${updateItemsError.message}`);
                console.log(`Updated all items to completed`);

                // 8. Move all items to archived_order_items
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

                // 9. Delete the original order items
                const { error: deleteItemsError } = await supabase
                    .from('order_items')
                    .delete()
                    .eq('order_id', selectedOrder.order_id);

                if (deleteItemsError) throw new Error(`Failed to delete order items: ${deleteItemsError.message}`);
                console.log(`Deleted original order items`);
            } else {
                console.log(`No items found for order ${selectedOrder.order_id}`);
            }

            // 10. Delete the original order
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
        // Queue the update instead of dispatching immediately
        setPendingUpdates(prev => ({...prev, [itemId]: completed}));
    };

    // Cleanup function when modal closes - no longer needed since we don't update stock immediately
    // useEffect(() => {
    //     return () => {
    //         // No cleanup needed since we don't update stock immediately
    //     };
    // }, []);

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
                className="bg-white p-8 rounded-xl shadow-2xl max-w-4xl w-full min-h-[700px] border border-gray-200 transform transition-all duration-300 scale-100 relative"
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
                                <p className="text-sm text-gray-500 mb-1 underline">Order Date:</p>
                                <p className="font-medium text-gray-800">{new Date(selectedOrder.order_date).toLocaleDateString()}</p>
                            </div>
                            <div className="bg-gray-50 p-3 rounded-lg">
                                <p className="text-sm text-gray-500 mb-1 underline">Customer:</p>
                                <p className="font-medium text-gray-800" title={selectedOrder.customer_name}>{selectedOrder.customer_name}</p>
                            </div>
                            <div className="bg-gray-50 p-3 rounded-lg">
                                <p className="text-sm text-gray-500 mb-1 underline">External Link:</p>
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
                        {/* Side-by-side tables for Items and Packing Boxes */}
                        <div className="flex flex-col md:flex-row gap-6 mb-6">
                            {/* Items Table */}
                            <div className="md:w-1/2 w-full">
                                <div className="flex justify-between items-center mb-3">
                                    <h3 className="font-semibold text-lg text-gray-800">Items:</h3>
                                    {/* Progress Indicator */}
                                    {selectedOrderItems.length > 0 && (
                                        <div className="flex items-center gap-2">
                                            <span className="text-sm font-medium text-gray-600">
                                                {checkedItems.size}/{selectedOrderItems.length}
                                            </span>
                                            <div className="w-32 bg-gray-200 rounded-full h-2.5 overflow-hidden">
                                                <div
                                                    className="bg-green-600 h-2.5 rounded-full transition-all duration-500 ease-out"
                                                    style={{ 
                                                        width: `${selectedOrderItems.length > 0 
                                                            ? (checkedItems.size / selectedOrderItems.length) * 100 
                                                            : 0}%` 
                                                    }}
                                                    aria-hidden="true"
                                                ></div>
                                            </div>
                                        </div>
                                    )}
                                </div>
                                {selectedOrder.id && selectedOrderItems.length === 0 && !loading ? (
                                    <div className="flex flex-col items-center justify-center p-8 bg-gray-50 rounded-lg border border-gray-200 animate-pulse">
                                        <div className="w-10 h-10 border-4 border-gray-200 border-t-blue-600 rounded-full animate-spin mb-4"></div>
                                        <p className="text-gray-600 font-medium">Loading order items...</p>
                                    </div>
                                ) : (
                                    <div className="overflow-hidden rounded-lg border border-gray-200">
                                        <div className="max-h-[300px] overflow-y-auto">
                                            <table className="w-full">
                                                <thead className="bg-gray-50 border-b border-gray-200">
                                                    <tr>
                                                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Name</th>
                                                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider whitespace-nowrap">FoamSheet</th>
                                                        <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">Qty</th>
                                                        <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">
                                                        Select
                                                        </th>
                                                    </tr>
                                                </thead>
                                                <tbody className="divide-y divide-gray-200 bg-white">
                                                    {(() => {
                                                        // Group items by SKU
                                                        const groupedItems = selectedOrderItems.reduce((acc, item) => {
                                                            const key = item.sku_id;
                                                            if (!acc[key]) {
                                                                acc[key] = {
                                                                    ...item,
                                                                    quantity: 0,
                                                                    completed: false
                                                                };
                                                            }
                                                            acc[key].quantity += item.quantity;
                                                            // If any item with this SKU is completed, mark the group as completed
                                                            if (item.completed) {
                                                                acc[key].completed = true;
                                                            }
                                                            return acc;
                                                        }, {} as Record<string, OrderItem>);

                                                        // Convert grouped items to array and sort them
                                                        return Object.values(groupedItems)
                                                            .sort((a, b) => a.item_name.localeCompare(b.item_name))
                                                            .map((item) => (
                                                                <tr key={item.sku_id} className="hover:bg-gray-50 transition-colors">
                                                                    <td className="px-4 py-3 text-sm font-medium text-gray-800">{item.item_name}</td>
                                                                    <td className="px-4 py-3 text-sm text-gray-600">{item.foamsheet}</td>
                                                                    <td className="px-4 py-3 text-sm text-center text-gray-600">{item.quantity}</td>
                                                                    <td className="px-4 py-3 text-center">
                                                                        <div className="flex justify-center">
                                                                            <label className="relative inline-flex items-center cursor-pointer">
                                                                                <input
                                                                                    type="checkbox"
                                                                                    checked={checkedItems.has(item.sku_id)}
                                                                                    onChange={(e) => {
                                                                                        const newCheckedState = e.target.checked;
                                                                                        setCheckedItems(prev => {
                                                                                            const newSet = new Set(prev);
                                                                                            if (newCheckedState) {
                                                                                                newSet.add(item.sku_id);
                                                                                            } else {
                                                                                                newSet.delete(item.sku_id);
                                                                                            }
                                                                                            return newSet;
                                                                                        });
                                                                                        const itemsToUpdate = selectedOrderItems
                                                                                            .filter(i => i.sku_id === item.sku_id);
                                                                                        const newUpdates: Record<string, boolean> = {};
                                                                                        itemsToUpdate.forEach(i => {
                                                                                            newUpdates[i.id] = newCheckedState;
                                                                                        });
                                                                                        setPendingUpdates(prev => ({...prev, ...newUpdates}));
                                                                                        const currentGroupedItems = {...groupedItems};
                                                                                        currentGroupedItems[item.sku_id].completed = newCheckedState;
                                                                                        const allChecked = Object.values(currentGroupedItems)
                                                                                            .every(i => i.completed);
                                                                                        setAllItemsPacked(allChecked);
                                                                                    }}
                                                                                    className="sr-only peer"
                                                                                    aria-label={`Mark ${item.item_name} as ${item.completed ? "packed" : "unpacked"}`}
                                                                                />
                                                                                <div className="w-6 h-6 border-2 border-gray-300 rounded peer-checked:bg-green-500 peer-checked:border-green-500 peer-focus:ring-2 peer-focus:ring-green-400/50 transition-all flex items-center justify-center">
                                                                                    {checkedItems.has(item.sku_id) && (
                                                                                        <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-white" viewBox="0 0 20 20" fill="currentColor">
                                                                                            <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                                                                                        </svg>
                                                                                    )}
                                                                                </div>
                                                                            </label>
                                                                        </div>
                                                                    </td>
                                                                </tr>
                                                            ));
                                                    })()}
                                                </tbody>
                                            </table>
                                        </div>
                                    </div>
                                )}
                            </div>
                            {/* Packing Boxes Table */}
                            <div className="md:w-1/2 w-full">
                                <div className="flex justify-between items-center mb-3">
                                    <h3 className="font-semibold text-lg text-gray-800">Packing Boxes:</h3>
                                </div>
                                
                                
                                <div className="rounded-lg border border-gray-200">
                                        <table className="w-full">
                                            <thead className="bg-gray-50 border-b border-gray-200">
                                                <tr>
                                                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Packing Box</th>
                                                    {/* <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">Stock</th> */}
                                                    <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">Qty</th>
                                                    <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">Delete</th>
                                                </tr>
                                            </thead>
                                            <tbody className="divide-y divide-gray-200 bg-white">
                                                {packingBoxes.map((box) => {
                                                    const currentStock = getCurrentStock(box.boxType);
                                                    
                                                    return (
                                                        <tr key={box.id} className="hover:bg-gray-50 transition-colors">
                                                        <td className="px-4 py-3">
                                                            <div className="relative custom-dropdown">
                                                                <button
                                                                    type="button"
                                                                    onClick={() => toggleDropdown(box.id)}
                                                                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-sm bg-white text-left flex justify-between items-center"
                                                                    style={{ minWidth: '120px' }}
                                                                >
                                                                    <span className={box.boxType ? 'text-gray-900' : 'text-gray-500'}>
                                                                        {box.boxType || 'Select Box'}
                                                                    </span>
                                                                    <svg 
                                                                        className={`h-4 w-4 text-gray-400 transition-transform ${openDropdownId === box.id ? 'rotate-180' : ''}`} 
                                                                        fill="none" 
                                                                        stroke="currentColor" 
                                                                        viewBox="0 0 24 24"
                                                                    >
                                                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                                                                    </svg>
                                                                </button>
                                                                
                                                                {openDropdownId === box.id && (
                                                                    <div className="absolute z-50 w-full mt-1 bg-white border border-gray-300 rounded-md shadow-lg max-h-40 overflow-y-auto">
                                                                        <div className="py-1">
                                                                            <button
                                                                                type="button"
                                                                                onClick={() => selectOption(box.id, '')}
                                                                                className="w-full px-3 py-2 text-left text-sm text-gray-500 hover:bg-gray-100 focus:bg-gray-100 focus:outline-none"
                                                                            >
                                                                                Select Box
                                                                            </button>
                                                                    {packingBoxTypes.map((type) => {
                                                                        return (
                                                                            <button
                                                                                key={type}
                                                                                type="button"
                                                                                onClick={() => selectOption(box.id, type)}
                                                                                className="w-full px-3 py-2 text-left text-sm text-gray-900 hover:bg-gray-100 focus:bg-gray-100 focus:outline-none flex justify-between items-center"
                                                                            >
                                                                        <span>{type}</span>
                                                                            </button>
                                                                        );
                                                                    })}
                                                                        </div>
                                                                    </div>
                                                                )}
                                                            </div>
                                                        </td>
                                                        <td className="px-4 py-3">
                                                            <input
                                                                type="number"
                                                                min="1"
                                                                max={currentStock}
                                                                value={box.quantity}
                                                                onChange={(e) => handleQuantityChange(box.id, parseInt(e.target.value) || 1)}
                                                                className={`w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-sm text-center`}
                                                            />
                                                        </td>
                                                        <td className="px-4 py-3 text-center">
                                                            <button
                                                                onClick={() => removePackingBoxRow(box.id)}
                                                                disabled={packingBoxes.length === 1}
                                                                className="text-red-500 hover:text-red-700 disabled:text-gray-300 disabled:cursor-not-allowed transition-colors duration-200 p-1 rounded-full hover:bg-red-50"
                                                                aria-label="Delete packing box row"
                                                            >
                                                                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                                                                    <path fillRule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z" clipRule="evenodd" />
                                                                </svg>
                                                            </button>
                                                        </td>
                                                    </tr>
                                                    );
                                                })}
                                            </tbody>
                                        </table>
                                    {/* Add Row Button */}
                                    <div className="mt-3 p-3">
                                        <button
                                            onClick={addPackingBoxRow}
                                            className="w-full px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 focus:outline-none focus:ring-2 focus:ring-gray-500 transition-colors duration-200 text-sm font-medium"
                                        >
                                            + Add a Row
                                        </button>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </>
                )}

                {/**Confirm Button */}
                <div className="flex justify-center gap-3 mt-6">
                    
                    {showDespatch ? (
                        <button
                            type="button"
                            onClick={handleDoneClick}
                            className="px-6 py-2.5 bg-green-600 rounded-lg text-white font-medium hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-green-500 transition-colors duration-200 shadow-sm flex items-center gap-2"
                            aria-label="Mark order as complete"
                            disabled={isProcessing || Object.keys(pendingUpdates).length > 0}
                        >
                            {isProcessing || Object.keys(pendingUpdates).length > 0 ? (
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
                            disabled={!isConfirmButtonEnabled()}
                            className={`px-6 py-2.5 rounded-lg font-medium focus:outline-none focus:ring-2 focus:ring-offset-2 transition-colors duration-200 shadow-sm mt-10 ${
                                isConfirmButtonEnabled() 
                                    ? 'bg-green-600 text-white hover:bg-green-700 focus:ring-green-500' 
                                    : 'bg-gray-300 text-gray-500 cursor-not-allowed'
                            }`}
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


"use client";

import React, { useEffect, useRef, useState } from 'react';
import { getSupabaseClient } from "@/utils/supabase";

export default function MediumSheetConfirm({
    isOpen,
    onClose,
    onConfirm,
    orderId,
    orderIdsToPacking,
    orderIdsToMarkCompleted,
    orderProgress,
    mediumSheetTotalQuantity,
    selectedMediumSheet,
    sku,
} : {
    isOpen: boolean;
    onClose: () => void;
    onConfirm: (orderIdsToPacking: string[], orderIdsToMarkCompleted: string[]) => void;
    orderId?: string | null;
    orderIdsToPacking?: string[];
    orderIdsToMarkCompleted?: string[];
    orderProgress?: string;
    mediumSheetTotalQuantity?: number;
    selectedMediumSheet?: string;
    sku?: string;
}) {
    console.log("MediumSheetConfirm: Component received props", { 
        isOpen, orderId, orderIdsToPacking, orderIdsToMarkCompleted, orderProgress 
    });

    // Trap focus inside modal when open for accessibility
    const confirmButtonRef = useRef<HTMLButtonElement>(null);
    const closeButtonRef = useRef<HTMLButtonElement>(null);
    const dialogRef = useRef<HTMLDivElement>(null);

    // Use state to track processed order arrays to ensure they update properly
    const [packingOrders, setPackingOrders] = useState<string[]>([]);
    const [markCompletedOrders, setMarkCompletedOrders] = useState<string[]>([]);
    const [totalOrders, setTotalOrders] = useState(0);
    const [isMultipleOrders, setIsMultipleOrders] = useState(false);
    const [isAvailableStock, setIsAvailableStock] = useState(false);
    const [adjustedMediumSheetQuantity, setAdjustedMediumSheetQuantity] = useState(mediumSheetTotalQuantity || 0);
    const [mediumSheetsAddedToStock, setMediumSheetsAddedToStock] = useState(0);
    const [userMediumSheetsAddedToStock, setUserMediumSheetsAddedToStock] = useState(mediumSheetsAddedToStock);
    const [currentMediumSheetStock, setCurrentMediumSheetStock] = useState(0);
    // Parse order progress to determine if it's ready for packing
    const [isReadyForPacking, setIsReadyForPacking] = useState(true);
    
    // Function to reset all state
    const resetState = () => {
        console.log("MediumSheetConfirm: resetState called - Resetting all state values");
        setPackingOrders([]);
        setMarkCompletedOrders([]);
        setTotalOrders(0);
        setIsMultipleOrders(false);
        setIsReadyForPacking(true);
        
        // Log after state is scheduled to be updated
        setTimeout(() => {
            console.log("MediumSheetConfirm: State after reset (next tick):", {
                packingOrders: [],
                markCompletedOrders: [],
                totalOrders: 0,
                isMultipleOrders: false,
                isReadyForPacking: true
            });
        }, 0);
    };
    
    // Custom handlers that call the props and then reset state
    const handleClose = () => {
        console.log("MediumSheetConfirm: handleClose called - Current state:", {
            packingOrders, markCompletedOrders, totalOrders, isMultipleOrders, isReadyForPacking
        });
        onClose();
        resetState();
    };
    
    const handleConfirm = async () => {
        console.log("MediumSheetConfirm: handleConfirm called - Current state:", {
            packingOrders, markCompletedOrders, totalOrders, isMultipleOrders, isReadyForPacking,
            userMediumSheetsAddedToStock, sku
        });

        try {
            const supabase = getSupabaseClient();
            // If there is available stock, deduct from stock
            if (isAvailableStock && sku && typeof mediumSheetTotalQuantity === 'number') {
                const newStockValue = currentMediumSheetStock - mediumSheetTotalQuantity;
                const { error: updateError } = await supabase
                    .from('finished_stock')
                    .update({ stock: newStockValue })
                    .eq('sku', sku);
                if (updateError) {
                    console.error("Error updating stock (deducting):", updateError);
                    return;
                }
                console.log("Stock deducted for SKU:", sku, "New value:", newStockValue);
            } else if (sku && userMediumSheetsAddedToStock > 0) {
                // Only add to stock if not using available stock
                // First get current stock value
                const { data: currentStock, error: fetchError } = await supabase
                    .from('finished_stock')
                    .select('stock')
                    .eq('sku', sku)
                    .single();

                if (fetchError) {
                    console.error("Error fetching current stock:", fetchError);
                    return;
                }

                // Calculate new stock value
                const newStockValue = (currentStock?.stock as number || 0) + userMediumSheetsAddedToStock;

                // Update stock value
                const { error: updateError } = await supabase
                    .from('finished_stock')
                    .update({ stock: newStockValue })
                    .eq('sku', sku);

                if (updateError) {
                    console.error("Error updating stock:", updateError);
                    return;
                }

                console.log("Successfully updated stock for SKU:", sku, "New value:", newStockValue);
            }

            // Call the original onConfirm with the order arrays
            onConfirm(packingOrders, markCompletedOrders);
            resetState();
            // Close the dialog after processing is complete
            onClose();
        } catch (error) {
            console.error("Error in handleConfirm:", error);
        }
    };
    
    // Effect to update state when props change
    useEffect(() => {
        console.log("MediumSheetConfirm: useEffect running with deps:", { 
            orderId, orderIdsToPacking, orderIdsToMarkCompleted, orderProgress, isOpen, isMultipleOrders 
        });
        
        // Only update state if modal is open
        if (!isOpen) {
            console.log("MediumSheetConfirm: Modal is closed, skipping state update");
            return;
        }
        
        // Process orders data from props
        const newPackingOrders = orderIdsToPacking || (orderId ? [orderId] : []);
        const newMarkCompletedOrders = orderIdsToMarkCompleted || [];
        
        // Update state
        setPackingOrders(newPackingOrders);
        setMarkCompletedOrders(newMarkCompletedOrders);
        
        // Calculate derived values
        const newTotalOrders = newPackingOrders.length + newMarkCompletedOrders.length;
        setTotalOrders(newTotalOrders);
        setIsMultipleOrders(newTotalOrders > 1);
        console.log("MediumSheetConfirm: New isMultipleOrders value being set:", newTotalOrders > 1);
        
        // Determine if the order is ready for packing based on progress
        if (orderProgress && !isMultipleOrders) {
            console.log("MediumSheetConfirm: Calculating isReadyForPacking from progress:", orderProgress);
            const [completed, total] = orderProgress.split('/').map(Number);
            console.log("MediumSheetConfirm: Parsed progress values:", { completed, total, isNaN_completed: isNaN(completed), isNaN_total: isNaN(total) });
            
            // Check if it's fully complete OR if it's just one item away from completion
            // This will handle the scenario where checking this item would complete the order
            const shouldBeReadyForPacking = completed === total || completed + 1 >= total;
            console.log("MediumSheetConfirm: Calculated shouldBeReadyForPacking:", shouldBeReadyForPacking);
            setIsReadyForPacking(shouldBeReadyForPacking);
            
            // For logging, add context about why it's considered ready for packing
            const reason = completed === total ? 'fully complete' : 
                          (completed + 1 >= total ? 'one item from completion' : 'not complete');
            
            console.log(`MediumSheetConfirm: Order progress: ${completed}/${total} - Ready for packing: ${shouldBeReadyForPacking} (${reason})`);
        } else {
            // Default for multiple orders: use packingOrders presence
            console.log("MediumSheetConfirm: Using default isReadyForPacking based on packingOrders:", newPackingOrders.length > 0);
            setIsReadyForPacking(newPackingOrders.length > 0);
        }
        
        // Log for debugging
        console.log('MediumSheetConfirm: State updated to:', { 
            packingCount: newPackingOrders.length,
            markCompletedCount: newMarkCompletedOrders.length,
            isMultiple: newTotalOrders > 1,
            progress: orderProgress,
            isReadyForPacking: isReadyForPacking
        });
        
        // Log actual state in next tick after updates have been applied
        setTimeout(() => {
            console.log('MediumSheetConfirm: State after useEffect (next tick):', {
                packingOrders,
                markCompletedOrders,
                totalOrders,
                isMultipleOrders,
                isReadyForPacking
            });
        }, 0);
    }, [orderId, orderIdsToPacking, orderIdsToMarkCompleted, orderProgress, isOpen, isMultipleOrders]);

    // Reset state when modal closes
    useEffect(() => {
        console.log("MediumSheetConfirm: isOpen changed to:", isOpen);
        if (!isOpen) {
            console.log("MediumSheetConfirm: Modal closed, resetting state");
            resetState();
        }
    }, [isOpen]);

    // Handle escape key press to close modal
    useEffect(() => {
        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape' && isOpen) {
                console.log("MediumSheetConfirm: Escape key pressed, closing modal");
                handleClose();
            }
        };

        if (isOpen) {
            window.addEventListener('keydown', handleKeyDown);
            // Focus the confirm button when dialog opens
            confirmButtonRef.current?.focus();
            // Prevent scroll on body
            document.body.style.overflow = 'hidden';
        }

        return () => {
            window.removeEventListener('keydown', handleKeyDown);
            document.body.style.overflow = '';
        };
    }, [isOpen]);

    // Click outside to close
    const handleBackdropClick = (e: React.MouseEvent) => {
        if (dialogRef.current && e.target === dialogRef.current) {
            console.log("MediumSheetConfirm: Backdrop clicked, closing modal");
            handleClose();
        }
    };

    if (!isOpen) {
        console.log("MediumSheetConfirm: Not rendering because isOpen is false");
        return null;
    }

    console.log("MediumSheetConfirm: Rendering with state:", {
        packingOrders,
        markCompletedOrders,
        totalOrders,
        isMultipleOrders,
        isReadyForPacking,
        isAvailableStock
    });

    const handleMediumSheetsManufactured = () => {
        if (!mediumSheetTotalQuantity) return;
        
        // Calculate the next multiple of 4
        const nextMultipleOf4 = Math.ceil(mediumSheetTotalQuantity / 4) * 4;
        setAdjustedMediumSheetQuantity(nextMultipleOf4);

        const mediumSheetsAddedToStock = adjustedMediumSheetQuantity - mediumSheetTotalQuantity;

        setMediumSheetsAddedToStock(mediumSheetsAddedToStock);
    }

    // Effect to update adjusted quantity when mediumSheetTotalQuantity changes
    useEffect(() => {
        if (mediumSheetTotalQuantity) {
            const nextMultipleOf4 = Math.ceil(mediumSheetTotalQuantity / 4) * 4;
            setAdjustedMediumSheetQuantity(nextMultipleOf4);
            
            // Calculate sheets added to stock after we have the adjusted quantity
            const sheetsAdded = nextMultipleOf4 - mediumSheetTotalQuantity;
            console.log('Calculating sheets added:', {
                mediumSheetTotalQuantity,
                nextMultipleOf4,
                sheetsAdded
            });
            setMediumSheetsAddedToStock(sheetsAdded);
        }
    }, [mediumSheetTotalQuantity]);

    // Add debug log for render
    console.log('Render state:', {
        mediumSheetsAddedToStock,
        adjustedMediumSheetQuantity,
        mediumSheetTotalQuantity
    });

    useEffect(() => {
        if (
            typeof mediumSheetTotalQuantity === 'number' &&
            typeof currentMediumSheetStock === 'number'
        ) {
            // How many do we need to manufacture?
            const needed = Math.max(0, mediumSheetTotalQuantity - currentMediumSheetStock);
            // Always manufacture in multiples of 4
            const manufacturedQty = needed > 0 ? Math.ceil(needed / 4) * 4 : 0;
            // Sheets left over after fulfilling the order
            const leftover = manufacturedQty - needed;
            setUserMediumSheetsAddedToStock(leftover > 0 ? leftover : 0);
        }
    }, [mediumSheetTotalQuantity, currentMediumSheetStock]);

    const getMediumSheetCurrentStock = async () => {
        if (!sku) {
            console.log("No SKU provided to fetch current stock");
            return;
        }

        try {
            const supabase = getSupabaseClient();
            const { data: currentStock, error: fetchError } = await supabase
                .from('finished_stock')
                .select('stock')
                .eq('sku', sku)
                .single();

            if (fetchError) {
                console.error("Error fetching current stock:", fetchError);
                return;
            }

            if (currentStock) {
                setCurrentMediumSheetStock(currentStock.stock as number);
                console.log("Current stock value for SKU", sku, ":", currentStock.stock);
                if (mediumSheetTotalQuantity && mediumSheetTotalQuantity <= (currentStock.stock as number)) {
                    setIsAvailableStock(true);
                    console.log("There is enough stock for the order");
                    console.log("Medium sheet total quantity:", mediumSheetTotalQuantity);
                    console.log("Medium sheet current stock:", currentStock.stock);
                } else {
                    setIsAvailableStock(false);
                    console.log("There is not enough stock for the order");
                    console.log("Medium sheet total quantity:", mediumSheetTotalQuantity);
                    console.log("Medium sheet current stock:", currentStock.stock);
                }
            }
        } catch (error) {
            console.error("Error in getMediumSheetCurrentStock:", error);
        }
    };

    // Add useEffect to fetch current stock when modal opens and SKU is available
    useEffect(() => {
        if (isOpen && sku) {
            getMediumSheetCurrentStock();
        }
    }, [isOpen, sku]);

    return (
        <div 
            className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 transition-opacity duration-300"
            onClick={handleBackdropClick}
            ref={dialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="dialog-title"
        >
            <div 
                className={`bg-white dark:bg-gray-800 p-6 rounded-xl shadow-2xl ${isMultipleOrders ? 'max-w-lg' : 'max-w-md'} w-full border border-gray-200 dark:border-gray-700 transform transition-all duration-300 scale-100 relative`}
                onClick={e => e.stopPropagation()}
            >
                {/* Close button (X) in the top right */}
                <button
                    type="button"
                    ref={closeButtonRef}
                    onClick={handleClose}
                    className="absolute top-3 right-3 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors duration-200 p-1 rounded-full hover:bg-gray-100 dark:hover:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-gray-400"
                    aria-label="Close dialog"
                >
                     <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                        <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
                    </svg>
                </button>
                {/**Confirm Completion Title */}
                <h2 
                    id="dialog-title" 
                    className="text-xl font-bold text-gray-900 dark:text-white mb-4"
                >
                    Confirm Completion
                </h2>
                               
                
                <div className="mb-6 text-gray-700 dark:text-gray-300 space-y-3">
                    {/**SubTitle for Multiple Orders */}
                    {isMultipleOrders ? (
                        <>
                        {isAvailableStock ? (
                            <>
                                <div className="bg-green-50 dark:bg-green-900/30 p-4 rounded-lg mb-4 border border-green-200 dark:border-green-800">
                                    <div className="flex items-center gap-3 mb-2">
                                        <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-label="Stock available icon">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                                        </svg>
                                        <div>
                                            <h3 className="font-semibold text-green-800 dark:text-green-200">Stock Available!</h3>
                                            <p className="text-green-700 dark:text-green-300 mb-1">
                                                We have <span className="font-bold">{currentMediumSheetStock}</span> sheets in stock.
                                            </p>
                                        </div>
                                    </div>
                                </div>
                                <hr className="my-4 border-gray-200 dark:border-gray-700" />
                                <p className="text-gray-700 dark:text-gray-300 mb-2">
                                    By confirming, <strong>{mediumSheetTotalQuantity}</strong> sheets will be deducted from <strong>{selectedMediumSheet}.</strong>
                                </p>

                                <p> <strong>New Stock Level:</strong> {currentMediumSheetStock - (mediumSheetTotalQuantity || 0)} sheets</p>
                               
                            </>
                        ) : (
                            <>
                                 <div className="bg-green-50 dark:bg-green-900/30 p-4 rounded-lg mb-4 border border-green-200 dark:border-green-800">
                                    <div className="flex items-center gap-3 mb-2">
                                        <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-label="Stock available icon">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                                        </svg>
                                        <div>
                                            <h3 className="font-semibold text-green-800 dark:text-green-200">Stock Available!</h3>
                                            <p className="text-green-700 dark:text-green-300 mb-1">
                                                We have <span className="font-bold">{currentMediumSheetStock}</span> sheets in stock.
                                            </p>
                                        </div>
                                    </div>
                                </div>
                                Are you confirming that you have manufactured <strong className="font-semibold">{adjustedMediumSheetQuantity}</strong> of <strong>{selectedMediumSheet}?</strong>
                                {/*How many sheets are being added to stock*/}
                                <div className="bg-gray-50 dark:bg-gray-900/30 p-3 rounded-lg mb-1">
                                    <div className="flex items-center mb-2">
                                        <span className="text-red-600 dark:text-red-400 mr-2">
                                            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                                                <path fillRule="evenodd" d="M10 2a4 4 0 00-4 4v1H5a1 1 0 00-.994.89l-1 9A1 1 0 004 18h12a1 1 0 00.994-1.11l-1-9A1 1 0 0015 7h-1V6a4 4 0 00-4-4zm2 5V6a2 2 0 10-4 0v1h4zm-6 3a1 1 0 112 0 1 1 0 01-2 0zm7-1a1 1 0 100 2 1 1 0 000-2z" clipRule="evenodd" />
                                            </svg>
                                        </span>
                                        <span className="flex items-center gap-2">
                                            <input
                                                type="number"
                                                min={0}
                                                className="w-16 px-2 py-1 border border-gray-300 rounded text-black font-semibold text-center focus:outline-none focus:ring-2 focus:ring-blue-400"
                                                value={userMediumSheetsAddedToStock}
                                                onChange={e => setUserMediumSheetsAddedToStock(Math.max(0, Number(e.target.value)))}
                                                aria-label="Medium sheets to add to stock"
                                            />
                                            sheets will be added to stock
                                        </span>
                                    </div>
                                </div>
                            </>
                        )}
                           

                           
                            
                            {/* Orders Being moved to Packing */}
                            {packingOrders.length > 0 && (
                                <div className="bg-green-50 dark:bg-green-900/30 p-3 rounded-lg mb-3">
                                    <div className="flex items-center mb-2">
                                        <span className="text-green-600 dark:text-green-400 mr-2">
                                            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                                                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                                            </svg>
                                        </span>
                                        <span>
                                            <strong className="font-semibold">{packingOrders.length} orders</strong> will be moved to Packing:
                                        </span>
                                    </div>
                                    {packingOrders.length <= 5 ? (
                                        <ul className="ml-7 mt-2 space-y-1 list-disc">
                                            {packingOrders.map(id => (
                                                <li key={id}><strong className="font-semibold">{id}</strong></li>
                                            ))}
                                        </ul>
                                    ) : (
                                        <details className="ml-7 mt-2">
                                            <summary className="cursor-pointer text-green-600 dark:text-green-400 hover:underline">
                                                View all {packingOrders.length} orders for packing
                                            </summary>
                                            <ul className="mt-2 space-y-1 max-h-40 overflow-y-auto list-disc pl-4">
                                                {packingOrders.map(id => (
                                                    <li key={id}><strong className="font-semibold">{id}</strong></li>
                                                ))}
                                            </ul>
                                        </details>
                                    )}
                                </div>
                            )}
                            
                            {/*Orders being marked as completed */}
                            {markCompletedOrders.length > 0 && (
                                <div className="bg-blue-50 dark:bg-blue-900/30 p-3 rounded-lg">
                                    <div className="flex items-center mb-2">
                                        <span className="text-blue-600 dark:text-blue-400 mr-2">
                                            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                                                <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
                                            </svg>
                                        </span>
                                        <span>
                                            Only the medium sheet items in the following orders will be marked as completed:
                                        </span>
                                    </div>
                                    {markCompletedOrders.length <= 5 ? (
                                        <ul className="ml-7 mt-2 space-y-1 list-disc">
                                            {markCompletedOrders.map(id => (
                                                <li key={id}><strong className="font-semibold">{id}</strong></li>
                                            ))}
                                        </ul>
                                    ) : (
                                        <details className="ml-7 mt-2">
                                            <summary className="cursor-pointer text-blue-600 dark:text-blue-400 hover:underline">
                                                View all {markCompletedOrders.length} orders for item completion
                                            </summary>
                                            <ul className="mt-2 space-y-1 max-h-40 overflow-y-auto list-disc pl-4">
                                                {markCompletedOrders.map(id => (
                                                    <li key={id}><strong className="font-semibold">{id}</strong></li>
                                                ))}
                                            </ul>
                                        </details>
                                    )}
                                </div>
                            )}
                        </>
                    ) : (
                        <>
                        {/**Subtitle for Single Order being moved to Packing */}
                            
                             {/**How many sheets are being added to stock */}
                             {isAvailableStock ? (
                                <>
                                    <div className="bg-green-50 dark:bg-green-900/30 p-4 rounded-lg mb-4 border border-green-200 dark:border-green-800">
                                        <div className="flex items-center gap-3 mb-2">
                                            <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-label="Stock available icon">
                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                                            </svg>
                                            <div>
                                                <h3 className="font-semibold text-green-800 dark:text-green-200">Stock Available!</h3>
                                                <p className="text-green-700 dark:text-green-300 mb-1">
                                                    We have <span className="font-bold">{currentMediumSheetStock}</span> sheets in stock.
                                                </p>
                                            </div>
                                        </div>
                                    </div>
                                    <p className="text-gray-700 dark:text-gray-300 mb-2">
                                        By confirming, <strong>{mediumSheetTotalQuantity}</strong> sheets will be deducted from <strong>{selectedMediumSheet}.</strong>
                                    </p>
                                    <p> <strong>New Stock Level:</strong> {currentMediumSheetStock - (mediumSheetTotalQuantity || 0)} sheets</p>
                                </>
                            ) : (
                                <>
                                    <>
                                    <div className="bg-green-50 dark:bg-green-900/30 p-4 rounded-lg mb-4 border border-green-200 dark:border-green-800">
                                    <div className="flex items-center gap-3 mb-2">
                                        <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-label="Stock available icon">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                                        </svg>
                                        <div>
                                            <h3 className="font-semibold text-green-800 dark:text-green-200">Stock Available!</h3>
                                            <p className="text-green-700 dark:text-green-300 mb-1">
                                                We have <span className="font-bold">{currentMediumSheetStock}</span> sheets in stock.
                                            </p>
                                        </div>
                                    </div>
                                </div>
                                    </>
                                    Are you confirming that you have manufactured <strong className="font-semibold">{adjustedMediumSheetQuantity}</strong> of <strong>{selectedMediumSheet}?</strong>
                                    {/*How many sheets are being added to stock*/}
                                    <div className="bg-gray-50 dark:bg-gray-900/30 p-3 rounded-lg mb-1">
                                        <div className="flex items-center">
                                            <span className="text-red-600 dark:text-red-400 mr-2">
                                                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                                                    <path fillRule="evenodd" d="M10 2a4 4 0 00-4 4v1H5a1 1 0 00-.994.89l-1 9A1 1 0 004 18h12a1 1 0 00.994-1.11l-1-9A1 1 0 0015 7h-1V6a4 4 0 00-4-4zm2 5V6a2 2 0 10-4 0v1h4zm-6 3a1 1 0 112 0 1 1 0 01-2 0zm7-1a1 1 0 100 2 1 1 0 000-2z" clipRule="evenodd" />
                                                </svg>
                                            </span>
                                            <span className="flex items-center gap-2">
                                                <input
                                                    type="number"
                                                    min={0}
                                                    className="w-16 px-2 py-1 border border-gray-300 rounded text-black font-semibold text-center focus:outline-none focus:ring-2 focus:ring-blue-400"
                                                    value={userMediumSheetsAddedToStock}
                                                    onChange={e => setUserMediumSheetsAddedToStock(Math.max(0, Number(e.target.value)))}
                                                    aria-label="Medium sheets to add to stock"
                                                />
                                                sheets will be added to stock
                                            </span>
                                        </div>
                                    </div>
                                </>
                            )}
                            <p className={`flex items-center ${isReadyForPacking ? 'bg-green-50 dark:bg-green-900/30' : 'bg-blue-50 dark:bg-blue-900/30'} p-3 rounded-lg`}>
                                <span className={`${isReadyForPacking ? 'text-green-600 dark:text-green-400' : 'text-blue-600 dark:text-blue-400'} mr-2`}>
                                    <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                                        {isReadyForPacking ? (
                                            <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                                        ) : (
                                            <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
                                        )}
                                    </svg>
                                </span>
                                <span>
                                    {isReadyForPacking
                                        ? <>Order: <strong className="font-semibold">{orderId}</strong> will be moved to the Packing stage.</>
                                        : <>This item will be marked as completed.</>
                                    }
                                </span>
                            </p>
                        </>
                    )}
                </div>
                {/**Confirm Buttons */}
                <div className="flex justify-center">
                    <button
                        type="button"
                        ref={confirmButtonRef}
                        onClick={handleConfirm}
                        className={`px-6 py-2.5 rounded-lg text-white font-medium focus:outline-none focus:ring-2 focus:ring-offset-2 transition-colors duration-200 shadow-md hover:shadow-lg ${
                            isReadyForPacking
                                ? 'bg-blue-600 hover:bg--700 focus:ring-blue-500' 
                                : 'bg-blue-600 hover:bg-blue-700 focus:ring-blue-500'
                        }`}
                        aria-label="Confirm processing orders"
                    >
                        {isMultipleOrders 
                            ? `Confirm Batch Processing (${totalOrders})` 
                            : 'Confirm Processing'}
                    </button>
                </div>
            </div>      
        </div>
    );
}
"use client";

import React, { useEffect, useRef, useState } from 'react';

export default function ManuConfirm({
    isOpen,
    onClose,
    onConfirm,
    orderId,
    orderIdsToPacking,
    orderIdsToMarkCompleted,
    orderProgress,
    mediumSheetTotalQuantity,
    selectedMediumSheet
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
}) {
    console.log("ManuConfirm: Component received props", { 
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
    
    // Parse order progress to determine if it's ready for packing
    const [isReadyForPacking, setIsReadyForPacking] = useState(true);
    
    // Function to reset all state
    const resetState = () => {
        console.log("ManuConfirm: resetState called - Resetting all state values");
        setPackingOrders([]);
        setMarkCompletedOrders([]);
        setTotalOrders(0);
        setIsMultipleOrders(false);
        setIsReadyForPacking(true);
        
        // Log after state is scheduled to be updated
        setTimeout(() => {
            console.log("ManuConfirm: State after reset (next tick):", {
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
        console.log("ManuConfirm: handleClose called - Current state:", {
            packingOrders, markCompletedOrders, totalOrders, isMultipleOrders, isReadyForPacking
        });
        onClose();
        resetState();
    };
    
    const handleConfirm = () => {
        console.log("ManuConfirm: handleConfirm called - Current state:", {
            packingOrders, markCompletedOrders, totalOrders, isMultipleOrders, isReadyForPacking
        });
        onConfirm(packingOrders, markCompletedOrders);
        resetState();
    };
    
    // Effect to update state when props change
    useEffect(() => {
        console.log("ManuConfirm: useEffect running with deps:", { 
            orderId, orderIdsToPacking, orderIdsToMarkCompleted, orderProgress, isOpen, isMultipleOrders 
        });
        
        // Only update state if modal is open
        if (!isOpen) {
            console.log("ManuConfirm: Modal is closed, skipping state update");
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
        console.log("ManuConfirm: New isMultipleOrders value being set:", newTotalOrders > 1);
        
        // Determine if the order is ready for packing based on progress
        if (orderProgress && !isMultipleOrders) {
            console.log("ManuConfirm: Calculating isReadyForPacking from progress:", orderProgress);
            const [completed, total] = orderProgress.split('/').map(Number);
            console.log("ManuConfirm: Parsed progress values:", { completed, total, isNaN_completed: isNaN(completed), isNaN_total: isNaN(total) });
            
            // Check if it's fully complete OR if it's just one item away from completion
            // This will handle the scenario where checking this item would complete the order
            const shouldBeReadyForPacking = completed === total || completed + 1 >= total;
            console.log("ManuConfirm: Calculated shouldBeReadyForPacking:", shouldBeReadyForPacking);
            setIsReadyForPacking(shouldBeReadyForPacking);
            
            // For logging, add context about why it's considered ready for packing
            const reason = completed === total ? 'fully complete' : 
                          (completed + 1 >= total ? 'one item from completion' : 'not complete');
            
            console.log(`ManuConfirm: Order progress: ${completed}/${total} - Ready for packing: ${shouldBeReadyForPacking} (${reason})`);
        } else {
            // Default for multiple orders: use packingOrders presence
            console.log("ManuConfirm: Using default isReadyForPacking based on packingOrders:", newPackingOrders.length > 0);
            setIsReadyForPacking(newPackingOrders.length > 0);
        }
        
        // Log for debugging
        console.log('ManuConfirm: State updated to:', { 
            packingCount: newPackingOrders.length,
            markCompletedCount: newMarkCompletedOrders.length,
            isMultiple: newTotalOrders > 1,
            progress: orderProgress,
            isReadyForPacking: isReadyForPacking
        });
        
        // Log actual state in next tick after updates have been applied
        setTimeout(() => {
            console.log('ManuConfirm: State after useEffect (next tick):', {
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
        console.log("ManuConfirm: isOpen changed to:", isOpen);
        if (!isOpen) {
            console.log("ManuConfirm: Modal closed, resetting state");
            resetState();
        }
    }, [isOpen]);

    // Handle escape key press to close modal
    useEffect(() => {
        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape' && isOpen) {
                console.log("ManuConfirm: Escape key pressed, closing modal");
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
            console.log("ManuConfirm: Backdrop clicked, closing modal");
            handleClose();
        }
    };

    if (!isOpen) {
        console.log("ManuConfirm: Not rendering because isOpen is false");
        return null;
    }

    console.log("ManuConfirm: Rendering with state:", {
        packingOrders,
        markCompletedOrders,
        totalOrders,
        isMultipleOrders,
        isReadyForPacking
    });

    const handleMediumSheetTotalQuantity = () => {

    }

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

                <h2 
                    id="dialog-title" 
                    className="text-xl font-bold text-gray-900 dark:text-white mb-4"
                >
                    Confirm Completion
                </h2>
                
                <div className="mb-6 text-gray-700 dark:text-gray-300 space-y-3">
                    {isMultipleOrders ? (
                        <>
                            <p>
                                Are you confirming that you have manufactured {mediumSheetTotalQuantity} {selectedMediumSheet}?
                            </p>
                            
                            {/* Packing Orders Section */}
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
                            
                            {/* Mark Completed Orders Section */}
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
                            <p>
                                {isReadyForPacking
                                    ? <>
                                    Are you confirming that you have manufactured <strong className="font-semibold">{mediumSheetTotalQuantity}</strong> of <strong className="font-semibold">{selectedMediumSheet}</strong>
                                    </>
                                    : `Are you confirming that you have manufactured this ${selectedMediumSheet}?`
                                }
                            </p>
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
                            {orderProgress && (
                                <div className="text-sm text-gray-500 mt-1 pl-2">
                                    Progress: {orderProgress}
                                </div>
                            )}
                        </>
                    )}
                </div>
                
                <div className="flex justify-center">
                    <button
                        type="button"
                        ref={confirmButtonRef}
                        onClick={handleConfirm}
                        className={`px-6 py-2.5 rounded-lg text-white font-medium focus:outline-none focus:ring-2 focus:ring-offset-2 transition-colors duration-200 shadow-md hover:shadow-lg ${
                            isReadyForPacking
                                ? 'bg-green-600 hover:bg-green-700 focus:ring-green-500' 
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
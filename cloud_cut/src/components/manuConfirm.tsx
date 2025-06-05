"use client";

import React, { useEffect, useRef, useState } from 'react';
import { getSupabaseClient } from "@/utils/supabase";

export default function ManuConfirm({
    isOpen,
    onClose, 
    onConfirm,
    orderId,
} : {
    isOpen: boolean;
    onClose: () => void;
    onConfirm: (orderId: string) => void;
    orderId?: string | null;
}) {
    console.log("ManuConfirm: Component Received Props", {isOpen, onClose, onConfirm, orderId});

    //Trap focus inside modal when open for accessibility
    const confirmButtonRef = useRef<HTMLButtonElement>(null);
    const closeButtonRef = useRef<HTMLButtonElement>(null);
    const dialogRef = useRef<HTMLDivElement>(null);

    //Use state to track processed order arrays to ensure they update properly
    const [packingOrders, setPackingOrders] = useState<string[]>([]);

    //Function to reset all state
    const resetState = () => {
        console.log("ManuConfirm: resetState called - Resetting all state values");
        setPackingOrders([]);
    }

    const handleClose = () => {
        console.log("ManuConfirm: handleClose called")
        console.log("ManuConfirm: Calling onClose prop");
        onClose();
        console.log("ManuConfirm: Resetting state");
        resetState();
    }

    const handleConfirm = async () => {
        console.log("ManuConfirm: handleConfirm called")
        if (!orderId) {
            console.error("No orderId provided");
            return;
        }

        try {
            console.log("ManuConfirm: Starting database updates");
            const supabase = getSupabaseClient();

            // Update the order's manufactured status
            const { error: orderError } = await supabase
                .from('orders')
                .update({ manufactured: true })
                .eq('order_id', orderId);

            if (orderError) {
                console.error('Error updating order:', orderError);
                throw orderError;
            }
            console.log("ManuConfirm: Successfully updated order status");

            // Update all order items to completed
            const { error: itemsError } = await supabase
                .from('orderItems')
                .update({ completed: true })
                .eq('order_id', orderId);

            if (itemsError) {
                console.error('Error updating order items:', itemsError);
                throw itemsError;
            }
            console.log("ManuConfirm: Successfully updated order items");

            // Call onConfirm with the orderId
            console.log("ManuConfirm: Calling onConfirm with orderId:", orderId);
            onConfirm(orderId);

        } catch (error) {
            console.error("Error in handleConfirm:", error);
            // Still call onConfirm even if there's an error
            console.log("ManuConfirm: Calling onConfirm despite error");
            onConfirm(orderId);
        } finally {
            // Always close the dialog
            console.log("ManuConfirm: Closing dialog");
            onClose();
        }
    };

    // Reset state when modal closes
    useEffect(() => {
        console.log("ManuConfirm: isOpen changed to:", isOpen);
        if (!isOpen){
            resetState();
        }
    }, [isOpen]);

    // Handle escape key press to close modal
    useEffect(() => {
        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape' && isOpen){
                console.log("ManuConfirm: Escape key pressed, closing modal");
                handleClose();
            }
        };

        if (isOpen) {
            window.addEventListener('keydown', handleKeyDown);
            // Focus the confirm button when dialog opens
            confirmButtonRef.current?.focus();
            //Prevent scroll on body
            document.body.style.overflow = 'hidden';
        }

        return () => {
            window.removeEventListener('keydown', handleKeyDown);
            document.body.style.overflow = '';
        };
    }, [isOpen]);

    //Click outside to close
    const handleBackdropClick = (e: React.MouseEvent) => {
        if (dialogRef.current && e.target === dialogRef.current) {
            console.log("ManuConfirm: Backdrop clicked, closing modal");
            handleClose();
        }
    };
    
    return (
        <div
            className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 transition-opacity duration-300"
            onClick={handleBackdropClick}
            ref={dialogRef}
            aria-modal="true"
            aria-labelledby="dialog-title"
        >
            <div
                className={`bg-white dark:bg-gray-800 p-6 rounded-xl shadow-2xl border border-gray-200 dark:border-gray-700 transform transition-all duration-300 scale-100 relative w-full max-w-md`}
                onClick={e => e.stopPropagation()}
            >
                {/** Close button (X) in the top right */}
                <button
                    type="button"
                    ref={closeButtonRef}
                    onClick={handleClose}
                    className='absolute top-3 right-3 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors duration-200 p-1 rounded-full hover:bg-gray-100 dark:hover:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-gray-400'
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
                    Confirm Completion: {orderId}
                </h2>

                <div className="mb-6 text-gray-700 dark:text-gray-300 space-y-3">
                    <div className="bg-blue-50 dark:bg-blue-900/30 p-4 rounded-lg border border-blue-200 dark:border-blue-800">
                        <div className="flex items-start gap-3">
                            <div className="flex-shrink-0 mt-1">
                                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-blue-500" viewBox="0 0 20 20" fill="currentColor">
                                    <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
                                </svg>
                            </div>
                            <div>
                                <h3 className="text-sm font-medium text-blue-800 dark:text-blue-200">Important Information</h3>
                                <div className="mt-2 text-sm text-blue-700 dark:text-blue-300">
                                    <p>By confirming this action, you are verifying that:</p>
                                    <ul className="list-disc list-inside mt-2 space-y-1">
                                        <li>All items in this order have been manufactured</li>
                                        <li>The order is ready to be moved to the Packing stage</li>
                                    </ul>
                                </div>
                            </div>
                        </div>
                    </div>

                </div>

                {/** Confirm Buttons */}
                <div className="flex justify-center items-center gap-4">
                    <button
                        type="button"
                        ref={confirmButtonRef}
                        onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            handleConfirm();
                        }}
                        className="px-4 py-2 text-sm font-medium text-white bg-green-600 border border-transparent rounded-md hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-green-500"
                    >
                        Confirm Processing
                    </button>
                </div>
            </div>
        </div>
    )

}
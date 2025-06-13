import React, { useEffect, useRef, useState } from 'react';
import { getSupabaseClient } from '@/utils/supabase';

export default function RetailPackConfirm({
    isOpen,
    onClose,
    onConfirm,
    orderId,
    orderIdsForMarkCompleted,
    retailPackOrders,
} : {
    isOpen: boolean;
    onClose: () => void;
    onConfirm: (orderIdsForMarkCompleted: string[]) => void;
    orderId?: string | null;
    orderIdsForMarkCompleted?: string[];
    retailPackOrders?: { retailPackName: string; orderIds: string[] }[];
}){

    const confirmButtonRef = useRef<HTMLButtonElement>(null);
    const closeButtonRef = useRef<HTMLButtonElement>(null);
    const dialogRef = useRef<HTMLDivElement>(null);

    const [markCompletedOrders, setMarkCompletedOrders] = useState<string[]>([]);
    const [isMultipleOrders, setIsMultipleOrders] = useState(false);
    const [isReadyForPicking, setIsReadyForPicking] = useState(true);
    const [isLoading, setIsLoading] = useState(false);

    
    const resetState = () => {
        setMarkCompletedOrders([]);

        setTimeout(() => {
            console.log("RetailPackConfirm: State after reset (next tick):", {
                markCompletedOrders: []
            });
        }, 0);
    }

    const handleClose = () => {
        onClose();
        resetState();
    };

    const handleBackdropClick = (e: React.MouseEvent) => {
        if(dialogRef.current && e.target == dialogRef.current){
            handleClose();
        }
    };

    const handleConfirm = () => {
        console.log("RetailPackConfirm: Confirm button clicked");
    } 


    return(
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
                {/** Close button (X) in the top right */}
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
                {/**Confirm Picking Title*/}
                <h2
                    id="dialog-title"
                    className="text-xl font-bold text-gray-900 dark:text-white mb-4"
                >
                    Confirm Picking
                </h2>

                <div className="mb-6 text-gray-700 dark:text-gray-300 space-y-3">
                    {/* Confirmation body for single or multiple retail packs */}
                    {retailPackOrders && retailPackOrders.length === 1 ? (
                        <>
                            <div>
                                <span>Are you confirming that <b>{retailPackOrders[0].retailPackName}</b> has been picked for the following order(s)?</span>
                                <ul className="mt-2 ml-4 list-disc text-sm">
                                    {retailPackOrders[0].orderIds.map(orderId => (
                                        <li key={orderId}>{orderId}</li>
                                    ))}
                                </ul>
                            </div>
                        </>
                    ) : retailPackOrders && retailPackOrders.length > 1 ? (
                        <>
                            <div>
                                <span>Are you confirming that the following retail packs have been picked?</span>
                                <ul className="mt-2 ml-4 list-disc text-sm">
                                    {retailPackOrders.map((pack, idx) => (
                                        <li key={pack.retailPackName + idx}>
                                            <b>{pack.retailPackName}</b> for order(s):
                                            <ul className="ml-4 list-[circle]">
                                                {pack.orderIds.map(orderId => (
                                                    <li key={orderId}>{orderId}</li>
                                                ))}
                                            </ul>
                                        </li>
                                    ))}
                                </ul>
                            </div>
                        </>
                    ) : (
                        <span>No retail packs selected for confirmation.</span>
                    )}
                </div>
                {/**Confirm Buttons*/}
                <div className="flex justify-center">
                    <button
                        type="button"
                        ref={confirmButtonRef}
                        onClick={handleConfirm}
                        className={`px-6 py-2.5 rounded-lg text-white font-medium focus:outline-none focus:ring-2 focus:ring-offset-2 transition-colors duration-200 shadow-md hover:shadow-lg ${
                            isReadyForPicking 
                            ? 'bg-blue-600 hover:bg-blue-700 focus:ring-blue-500'
                            : 'bg-blue-600 hover:bg-blue-700 focus:ring-blue-500'
                        } ${isLoading ? 'opacity-60 cursor-not-allowed' : ''}`}
                    >
                        {isLoading ? (
                            <span className="flex items-center justify-center gap-2">
                                <svg className="animate-spin -ml-1 mr-2 h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                                </svg>
                                Processing...
                            </span>
                        ) : (
                            <>Confirm Picking</>
                        )}

                    </button>
                </div>
            </div>
        </div>
    )
}
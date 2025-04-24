"use client";

import React, { useRef, useEffect } from 'react';

interface DeleteCompletedOrderProps {
    isOpen: boolean;
    orderId: string;
    onClose: () => void;
    onConfirm: (orderId: string) => void;
}

export default function DeleteCompletedOrder({ 
    isOpen, 
    orderId, 
    onClose, 
    onConfirm 
}: DeleteCompletedOrderProps) {
    const closeButtonRef = useRef<HTMLButtonElement>(null);
    const dialogRef = useRef<HTMLDivElement>(null);

    // Handle escape key press to close dialog
    useEffect(() => {
        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') {
                onClose();
            }
        };

        if (isOpen) {
            window.addEventListener('keydown', handleKeyDown);
            document.body.style.overflow = 'hidden';
            closeButtonRef.current?.focus();
        }
        
        return () => {
            window.removeEventListener('keydown', handleKeyDown);
            document.body.style.overflow = '';
        };
    }, [isOpen, onClose]);

    // Click outside to close
    const handleBackdropClick = (e: React.MouseEvent) => {
        if (dialogRef.current && e.target === dialogRef.current) {
            onClose();
        }
    };

    if (!isOpen) return null;

    return (
        <div
            className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 transition-opacity duration-300"
            onClick={handleBackdropClick}
            ref={dialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="delete-dialog-title"
        >
            <div 
                className="bg-white dark:bg-gray-800 rounded-lg shadow-2xl max-w-md w-full transform transition-all duration-300 scale-100 p-6 border border-gray-200 dark:border-gray-700"
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
                
                {/* Warning icon and title */}
                <div className="flex flex-col items-center justify-center mb-6">
                    <div className="w-16 h-16 bg-red-100 dark:bg-red-900/30 rounded-full flex items-center justify-center mb-4">
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-10 w-10 text-red-600 dark:text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                        </svg>
                    </div>
                    <h2 
                        id="delete-dialog-title" 
                        className="text-xl font-bold text-gray-900 dark:text-white"
                    >
                        Delete Order
                    </h2>
                </div>
                
                {/* Dialog content */}
                <div className="mb-6">
                    <p className="text-gray-600 dark:text-gray-300 text-center">
                        Are you sure you want to delete order <span className="font-semibold text-gray-800 dark:text-gray-200">{orderId}</span>?
                    </p>
                    <p className="mt-3 text-gray-600 dark:text-gray-300 text-center">
                        This action cannot be undone. All order items will be permanently removed.
                    </p>
                </div>
                
                {/* Action buttons */}
                <div className="flex justify-center space-x-4">
                    
                    <button
                        type="button"
                        onClick={() => onConfirm(orderId)}
                        className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-red-500 transition-colors"
                    >
                        Delete
                    </button>
                </div>
            </div>
        </div>
    );
} 
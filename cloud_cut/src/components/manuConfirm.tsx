"use client";

import React, { useEffect, useRef } from 'react';

export default function ManuConfirm({
    isOpen,
    onClose,
    onConfirm,
    orderId,
} : {
    isOpen: boolean;
    onClose: () => void;
    onConfirm: (orderId: string) => void;
    orderId: string;
}) {
    // Trap focus inside modal when open for accessibility
    const confirmButtonRef = useRef<HTMLButtonElement>(null);
    const closeButtonRef = useRef<HTMLButtonElement>(null);
    const dialogRef = useRef<HTMLDivElement>(null);

    // Handle escape key press to close modal
    useEffect(() => {
        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape' && isOpen) {
                onClose();
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
            aria-labelledby="dialog-title"
        >
            <div 
                className="bg-white dark:bg-gray-800 p-6 rounded-xl shadow-2xl max-w-md w-full border border-gray-200 dark:border-gray-700 transform transition-all duration-300 scale-100 relative"
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
                    id="dialog-title" 
                    className="text-xl font-bold text-gray-900 dark:text-white mb-4"
                >
                    Confirm Completion
                </h2>
                
                <div className="mb-6 text-gray-700 dark:text-gray-300 space-y-3">
                    <p>
                        Are you confirming that <span className="font-medium">all items</span> for this order have been manufactured?
                    </p>
                    <p className="flex items-center bg-blue-50 dark:bg-blue-900/30 p-3 rounded-lg">
                        <span className="text-blue-600 dark:text-blue-400 mr-2">
                            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                                <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
                            </svg>
                        </span>
                        <span>
                            Order: <strong className="font-semibold">{orderId}</strong> will be moved to the Packing stage.
                        </span>
                    </p>
                </div>
                
                <div className="flex justify-center">
                    <button
                        type="button"
                        ref={confirmButtonRef}
                        onClick={() => onConfirm(orderId)}
                        className="px-6 py-2.5 bg-green-600 rounded-lg text-white font-medium hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-green-500 transition-colors duration-200 shadow-md hover:shadow-lg"
                        aria-label="Confirm and mark as manufactured"
                    >
                        Confirm Completion
                    </button>
                </div>
            </div>      
        </div>
    );
}

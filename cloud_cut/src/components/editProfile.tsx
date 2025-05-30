"use client";

import React, { useState, useEffect, useRef } from 'react';
import { User } from '@/types/user';
import { supabase } from '@/utils/supabase';

interface EditProfileProps {
    user: User;
    onClose: () => void;
    onSave: (updatedUser: User) => void;
}

export default function EditProfile({ user, onClose, onSave } : EditProfileProps) {
    const [ isLoading, setIsLoading ] = useState(false);
    const [ error, setError ] = useState<string | null>(null);
    const [ success, setSuccess ] = useState<string | null>(null);
    const [ editedUser, setEditedUser ] = useState<User>(user);

    // Update editedUser when user prop changes
    useEffect(() => {
        setEditedUser(user);
    }, [user]);

    //Refs for accessibility
    const closeButtonRef = useRef<HTMLButtonElement>(null);
    const dialogRef = useRef<HTMLDivElement>(null);

    //Handle escape key press to close overlay
    useEffect(() => {
        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') {
                onClose();
            }
        };

        if (true) {
            window.addEventListener('keydown', handleKeyDown);
            //Prevent scroll on body
            document.body.style.overflow = 'hidden';
            //Focus the close button when dialog opens
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

    //Handle input changes
    const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
        const { name, value } = e.target;
        setEditedUser(prev => ({
            ...prev,
            [name]: value
        }));            
    };

    // Save changes to Supabase
    const handleSave = async () => {
        setIsLoading(true);
        setError(null);
        setSuccess(null);
        
        try {
            // Update user in Supabase
            const { error } = await supabase
                .from('users')
                .update({
                    name: editedUser.name,
                    email: editedUser.email,
                    phone: editedUser.phone,
                    role: editedUser.role,
                    updated_at: new Date().toISOString()
                })
                .eq('id', editedUser.id);

            if (error) {
                throw new Error(`Failed to update profile: ${error.message}`);
            }

            // Call the onSave callback with the updated user
            onSave(editedUser);
            
            setSuccess('Profile updated successfully!');
            
            // Close the modal after a brief delay to show success message
            setTimeout(() => {
                onClose();
            }, 1500);
            
        } catch (err) {
            console.error('Error updating profile:', err);
            setError(err instanceof Error ? err.message : 'Failed to update profile');
        } finally {
            setIsLoading(false);
        }
    };

    return(
        <div
            className= "fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 transition-opacity duration-300"
            onClick={handleBackdropClick}
            ref={dialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="overlay-title"
        >
            <div
                className="bg-white dark:bg-gray-800 rounded-xl shadow-2xl max-w-4xl w-full max-h-[80vh] overflow-y-auto border border-gray-200
                dark:border-gray-700 transform transition-all duration-300 scale-100 relative p-6"
                onClick={e => e.stopPropagation()}
            >
                {/**Close button (X) in the top right*/}
                <button
                    type="button"
                    ref={closeButtonRef}
                    onClick={onClose}
                    className='absolute top-3 right-3 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors duration-200 p-1
                    rounded-full hover:bg-gray-100 dark:hover:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-gray-400'
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
                    Edit Profile - {editedUser.name}
                </h2>

                { isLoading ? (
                    <div className= "text-center py-8">
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
                            {/**Name Field*/}
                            <div>
                                <label htmlFor="name" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                                    Name
                                </label>
                                <input
                                    type="text"
                                    id="name"
                                    name="name"
                                    value={editedUser.name}
                                    onChange={handleInputChange}
                                    className="w-full px-3 py-2 bg-gray-100 dark:bg-gray-700 border border-gray-300 dark:border-gray-600
                                    rounded -md shadow-sm text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 cursor-not-allowed"
                                />
                            </div>
                            {/**Email Field*/}
                            <div>
                                <label htmlFor="email" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                                    Email
                                </label>
                                <input
                                    type="email"
                                    id="email"
                                    name="email"
                                    value={editedUser.email}
                                    onChange={handleInputChange}
                                    className="w-full px-3 py-2 bg-gray-100 dark:bg-gray-700 border border-gray-300 dark:border-gray-600
                                    rounded -md shadow-sm text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 cursor-not-allowed"
                                />
                            </div>
                            {/**Phone Field*/}
                            <div>
                                <label htmlFor="phone" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                                    Phone
                                </label>
                                <input
                                    type="tel"
                                    id="phone"
                                    name="phone"
                                    value={editedUser.phone}
                                    onChange={handleInputChange}
                                    className="w-full px-3 py-2 bg-gray-100 dark:bg-gray-700 border border-gray-300 dark:border-gray-600
                                    rounded -md shadow-sm text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 cursor-not-allowed"
                                />
                            </div>
                            {/**Role Field*/}
                            <div>
                                <label htmlFor="role" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                                    Role
                                </label>
                                <select
                                    id="role"
                                    name="role"
                                    value={editedUser.role}
                                    onChange={handleInputChange}
                                    className="w-full px-3 py-2 bg-gray-100 dark:bg-gray-700 border border-gray-300 dark:border-gray-600
                                    rounded-md shadow-sm text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                                >
                                    <option value="GlobalAdmin">Global Admin</option>
                                    <option value="SiteAdmin">Site Admin</option>
                                    <option value="Manager">Manager</option>
                                    <option value="Operator">Operator</option>
                                    <option value="Packer">Packer</option>
                                </select>
                            </div>
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

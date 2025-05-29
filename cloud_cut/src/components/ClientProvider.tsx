"use client";

import { Provider } from 'react-redux';
import { store } from '@/redux/store';
import { ReactNode, useEffect } from "react";
import { syncOrders, initialFetch } from '@/redux/thunks/ordersThunks';
import { setUser, setUserProfile } from '@/redux/slices/authSlice';
import AutoLogout from './AutoLogout';

interface ClientProviderProps {
    children: ReactNode;
}

export default function ClientProvider({ children }: ClientProviderProps) {
    useEffect(() => {
        // Load auth state from localStorage if available
        try {
            const savedAuthState = localStorage.getItem('authState');
            if (savedAuthState) {
                const authState = JSON.parse(savedAuthState);
                if (authState.user) {
                    store.dispatch(setUser(authState.user));
                }
                if (authState.userProfile) {
                    store.dispatch(setUserProfile(authState.userProfile));
                    console.log('Loaded user profile from localStorage:', authState.userProfile);
                }
            }
        } catch (error) {
            console.error('Error loading auth state from localStorage:', error);
        }

        // Initial fetch of current state
        store.dispatch(initialFetch());

        // Set up interval for periodic syncs
        const intervalId = setInterval(() => {
            store.dispatch(syncOrders());
        }, 10 * 60 * 1000); // 10 minutes in milliseconds

        // Cleanup interval on unmount
        return () => clearInterval(intervalId);
    }, []);

    return (
        <Provider store={store}>
            <AutoLogout />
            {children}
        </Provider>
    );
}
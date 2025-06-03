"use client";

import { Provider } from 'react-redux';
import { store } from '@/redux/store';
import { ReactNode, useEffect } from "react";
import { syncOrders, initialFetch } from '@/redux/thunks/ordersThunks';
import { setUser, setUserProfile } from '@/redux/slices/authSlice';
import AutoLogout from './AutoLogout';
import { getSupabaseClient } from '@/utils/supabase';

interface Profile {
    role: string;
    email: string;
}

interface ClientProviderProps {
    children: ReactNode;
}

export default function ClientProvider({ children }: ClientProviderProps) {
    useEffect(() => {
        const initializeAuth = async () => {
            try {
                const supabase = getSupabaseClient();
                // First check if there's a valid session with Supabase
                const { data: { session } } = await supabase.auth.getSession();
                
                if (session && session.user.email) {
                    // If there's a valid session, get the user's profile from the database
                    const { data: profile } = await supabase
                        .from('profiles')
                        .select('*')
                        .eq('email', session.user.email)
                        .single();

                    if (profile && typeof profile.role === 'string' && typeof profile.email === 'string') {
                        // Update Redux with the current user's data
                        store.dispatch(setUser(session.user));
                        store.dispatch(setUserProfile({
                            role: profile.role,
                            email: profile.email
                        }));
                        console.log('Loaded user profile from database:', profile);
                    }
                } else {
                    // If no valid session, clear any stored auth state
                    store.dispatch(setUser(null));
                    store.dispatch(setUserProfile(null));
                    localStorage.removeItem('authState');
                }
            } catch (error) {
                console.error('Error initializing auth state:', error);
                // Clear auth state on error
                store.dispatch(setUser(null));
                store.dispatch(setUserProfile(null));
                localStorage.removeItem('authState');
            }
        };

        initializeAuth();

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
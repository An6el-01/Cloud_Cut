"use client";

import { Provider } from 'react-redux';
import { store } from '@/redux/store';
import { ReactNode, useEffect } from "react";
import { syncOrders } from '@/redux/thunks/ordersThunks';

interface ClientProviderProps {
    children: ReactNode;
}

export default function ClientProvider({ children }: ClientProviderProps) {
    useEffect(() => {
        // Initial sync
        store.dispatch(syncOrders());

        // Set up interval for periodic syncs
        const intervalId = setInterval(() => {
            store.dispatch(syncOrders());
        }, 10 * 60 * 1000); // 10 minutes in milliseconds

        // Cleanup interval on unmount
        return () => clearInterval(intervalId);
    }, []);

    return <Provider store={store}>{children}</Provider>;
}
"use client";

import { useEffect } from 'react';
import { useDispatch } from 'react-redux';
import { useRouter } from 'next/navigation';
import { clearAuth } from '@/redux/slices/authSlice';
import { signOut } from '@/utils/supabase';

// Time in milliseconds (30 minutes)
const INACTIVITY_TIMEOUT = 9 * 60 * 60 * 1000;

export default function AutoLogout() {
    const dispatch = useDispatch();
    const router = useRouter();

    useEffect(() => {
        let timeoutId: NodeJS.Timeout;

        const resetTimer = () => {
            if (timeoutId) {
                clearTimeout(timeoutId);
            }
            timeoutId = setTimeout(handleLogout, INACTIVITY_TIMEOUT);
        };

        const handleLogout = async () => {
            try {
                await signOut();
                dispatch(clearAuth());
                router.push('/');
            } catch (error) {
                console.error('Error during auto logout:', error);
            }
        };

        // Events to track user activity
        const events = [
            'mousedown',
            'mousemove',
            'keypress',
            'scroll',
            'touchstart',
            'click'
        ];

        // Add event listeners
        events.forEach(event => {
            window.addEventListener(event, resetTimer);
        });

        // Initial timer setup
        resetTimer();

        // Cleanup
        return () => {
            if (timeoutId) {
                clearTimeout(timeoutId);
            }
            events.forEach(event => {
                window.removeEventListener(event, resetTimer);
            });
        };
    }, [dispatch, router]);

    return null; // This component doesn't render anything
} 
import { createSlice, PayloadAction } from '@reduxjs/toolkit';
import { User } from '@supabase/supabase-js';

interface AuthState {
    user: User | null;
    userProfile: {
        role: string;
        email: string;
    } | null;
    selectedStation: string | null;
    loading: boolean;
    error: string | null;
}

// Get initial state from localStorage if available
const getInitialState = (): AuthState => {
    if (typeof window !== 'undefined') {
        const savedState = localStorage.getItem('authState');
        if (savedState) {
            try {
                return JSON.parse(savedState);
            } catch (e) {
                console.error('Error parsing saved auth state:', e);
            }
        }
    }
    return {
        user: null,
        userProfile: null,
        selectedStation: null,
        loading: false,
        error: null
    };
};

const initialState: AuthState = getInitialState();

export const authSlice = createSlice({
    name: 'auth',
    initialState,
    reducers: {
        setUser: (state, action: PayloadAction<User | null>) => {
            state.user = action.payload;
            // Save to localStorage
            if (typeof window !== 'undefined') {
                localStorage.setItem('authState', JSON.stringify(state));
            }
        },
        setUserProfile: (state, action: PayloadAction<{ role: string; email: string; } | null>) => {
            state.userProfile = action.payload;
            // Save to localStorage
            if (typeof window !== 'undefined') {
                localStorage.setItem('authState', JSON.stringify(state));
            }
        },
        setSelectedStation: (state, action: PayloadAction<string | null>) => {
            state.selectedStation = action.payload;
            // Save to localStorage
            if (typeof window !== 'undefined') {
                localStorage.setItem('authState', JSON.stringify(state));
            }
        },
        setLoading: (state, action: PayloadAction<boolean>) => {
            state.loading = action.payload;
        },
        setError: (state, action: PayloadAction<string | null>) => {
            state.error = action.payload;
        },
        clearAuth: (state) => {
            state.user = null;
            state.userProfile = null;
            state.selectedStation = null;
            state.loading = false;
            state.error = null;
            // Clear from localStorage
            if (typeof window !== 'undefined') {
                localStorage.removeItem('authState');
            }
        }
    }
});

export const { setUser, setUserProfile, setSelectedStation, setLoading, setError, clearAuth } = authSlice.actions;

export default authSlice.reducer; 
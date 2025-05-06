import { configureStore } from "@reduxjs/toolkit";
import enhancedOrdersReducer from './slices/ordersSlice';
import stockReducer from './slices/stockSlice';
import authReducer from './slices/authSlice';

export const store = configureStore({
    reducer: {
        orders: enhancedOrdersReducer,
        stock: stockReducer,
        auth: authReducer,
    },
});

export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;
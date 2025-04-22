import { configureStore } from "@reduxjs/toolkit";
import enhancedOrdersReducer from './slices/ordersSlice';

export const store = configureStore({
    reducer: {
        orders: enhancedOrdersReducer,
    },
});

export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;
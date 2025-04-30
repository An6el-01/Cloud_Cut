import { configureStore } from "@reduxjs/toolkit";
import enhancedOrdersReducer from './slices/ordersSlice';
import stockReducer from './slices/stockSlice';

export const store = configureStore({
    reducer: {
        orders: enhancedOrdersReducer,
        stock: stockReducer,
    },
});

export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;
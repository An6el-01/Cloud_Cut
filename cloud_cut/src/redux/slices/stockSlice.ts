import { createSlice, PayloadAction } from '@reduxjs/toolkit';
import { StockState } from '@/types/redux';
import { fetchFinishedStockFromSupabase, syncFinishedStock } from '../thunks/stockThunk';

interface StockItem {
  id: number;
  sku: string;
  stock: number;
  item_name: string;
  created_at: string;
  updated_at: string;
}

const initialState: StockState = {
  allFinishedStock: [],
  syncStatus: 'idle',
  loading: false,
  error: null,
  items: []
};

export const stockSlice = createSlice({
  name: 'stock',
  initialState,
  reducers: {
    setSyncStatus: (state, action: PayloadAction<'idle' | 'syncing' | 'error'>) => {
      state.syncStatus = action.payload;
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(fetchFinishedStockFromSupabase.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(fetchFinishedStockFromSupabase.fulfilled, (state, action: PayloadAction<StockItem[]>) => {
        state.loading = false;
        state.items = action.payload;
        state.error = null;
      })
      .addCase(fetchFinishedStockFromSupabase.rejected, (state, action) => {
        state.loading = false;
        state.error = action.error.message || 'Failed to fetch stock data';
      })
      .addCase(syncFinishedStock.pending, (state) => {
        state.syncStatus = 'syncing';
        state.error = null;
      })
      .addCase(syncFinishedStock.fulfilled, (state) => {
        state.syncStatus = 'idle';
        state.error = null;
      })
      .addCase(syncFinishedStock.rejected, (state, action) => {
        state.syncStatus = 'error';
        state.error = action.error.message || 'Failed to sync stock data';
      });
  }
});

export const { setSyncStatus } = stockSlice.actions;

const stockReducer = stockSlice.reducer;

export default stockReducer;





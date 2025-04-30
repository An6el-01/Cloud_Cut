import { createSlice, PayloadAction } from '@reduxjs/toolkit';

export interface StockState {
  loading: boolean;
  error: string | null;
  items: StockItem[];
}

export interface StockItem {
  id: string;
  color: string;
  thirty_mm_stock: number;
  fifty_mm_stock: number;
  seventy_mm_stock: number;
  lastUpdated: string;
}

const dummyStockData: StockItem[] = [
  {
    id: '1',
    color: 'White',
    thirty_mm_stock: 150,
    fifty_mm_stock: 200,
    seventy_mm_stock: 100,
    lastUpdated: new Date().toISOString(),
  },
  {
    id: '2',
    color: 'Black',
    thirty_mm_stock: 180,
    fifty_mm_stock: 150,
    seventy_mm_stock: 120,
    lastUpdated: new Date().toISOString(),
  },
  {
    id: '3',
    color: 'Red',
    thirty_mm_stock: 90,
    fifty_mm_stock: 110,
    seventy_mm_stock: 80,
    lastUpdated: new Date().toISOString(),
  },
  {
    id: '4',
    color: 'Blue',
    thirty_mm_stock: 120,
    fifty_mm_stock: 160,
    seventy_mm_stock: 90,
    lastUpdated: new Date().toISOString(),
  },
  {
    id: '5',
    color: 'Green',
    thirty_mm_stock: 100,
    fifty_mm_stock: 130,
    seventy_mm_stock: 70,
    lastUpdated: new Date().toISOString(),
  },
];

const initialState: StockState = {
  loading: false,
  error: null,
  items: dummyStockData,
};

const stockSlice = createSlice({
  name: 'stock',
  initialState,
  reducers: {
    setLoading: (state, action: PayloadAction<boolean>) => {
      state.loading = action.payload;
    },
    setError: (state, action: PayloadAction<string | null>) => {
      state.error = action.payload;
    },
    setItems: (state, action: PayloadAction<StockItem[]>) => {
      state.items = action.payload;
    },
    addItem: (state, action: PayloadAction<StockItem>) => {
      state.items.push(action.payload);
    },
    updateItem: (state, action: PayloadAction<StockItem>) => {
      const index = state.items.findIndex(item => item.id === action.payload.id);
      if (index !== -1) {
        state.items[index] = action.payload;
      }
    },
    removeItem: (state, action: PayloadAction<string>) => {
      state.items = state.items.filter(item => item.id !== action.payload);
    },
  },
});

export const {
  setLoading,
  setError,
  setItems,
  addItem,
  updateItem,
  removeItem,
} = stockSlice.actions;

export default stockSlice.reducer; 
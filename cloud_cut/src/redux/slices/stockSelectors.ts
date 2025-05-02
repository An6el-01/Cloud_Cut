import { createSelector } from '@reduxjs/toolkit';
import { RootState } from '../store';
import { InventoryItem } from '@/types/redux';
import { supabase } from '@/utils/supabase';

// Basic Selectors 
const selectStockState = (state:RootState) => state.stock;

export const selectAllFinishedStock = createSelector([selectStockState], stock => stock.allFinishedStock);


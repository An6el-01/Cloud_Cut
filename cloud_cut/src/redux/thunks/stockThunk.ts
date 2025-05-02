import { createAsyncThunk } from '@reduxjs/toolkit';
import { fetchInventory } from '@/utils/despatchCloud';
import { supabase } from '@/utils/supabase';
import { InventoryItem, InventoryResponse } from '@/types/despatchCloud';
import { setSyncStatus } from '../slices/stockSlice';

interface StockItem {
  id: number;
  sku: string;
  stock: number;
  item_name: string;
  created_at: string;
  updated_at: string;
}

// Thunks
export const syncFinishedStock = createAsyncThunk(
    'stock/syncFinishedStock',
    async (_, { dispatch }) => {
        console.log('Starting syncFinishedStock thunk');
        dispatch(setSyncStatus('syncing'));
        try{
            console.log('Fetching all finished stock from DespatchCloud...');
            let allFinishedStock: InventoryItem[] = [];
            let page = 1;
            let total = 0;
            let lastPage = 1;
            const perPage = 20;

            do{
                const { data, total: pageTotal, last_page } = await fetchInventory(page, perPage);
                console.log(`Fetched page ${page}: ${data.length} inventory items`);
                allFinishedStock = allFinishedStock.concat(data as unknown as InventoryItem[]);
                total = pageTotal;
                lastPage = last_page;
                page++;
            } while (page <= lastPage);

            console.log(`Total finished stock fetched: ${allFinishedStock.length}, reported total: ${total}`);

            const inventoryItems: InventoryItem[] = allFinishedStock.map(item => {
                return {
                    id: item.id,
                    name: item.name,
                    sku: item.sku,
                    stock_level: item.stock_level
                };
            });

            // Use SKU as unique identifier and combine stock levels for items with the same SKU
            const uniqueItems = new Map();
            inventoryItems.forEach(item => {
                if (uniqueItems.has(item.sku)) {
                    // If item exists, add stock levels
                    const existingItem = uniqueItems.get(item.sku);
                    existingItem.stock += parseInt(item.stock_level) || 0;
                } else {
                    // If item doesn't exist, add it
                    uniqueItems.set(item.sku, {
                        id: item.id,
                        item_name: item.name,
                        sku: item.sku,
                        stock: parseInt(item.stock_level) || 0,
                        updated_at: new Date().toISOString()
                    });
                }
            });

            // Convert Map to array for insertion
            const itemsToInsert = Array.from(uniqueItems.values());

            // Insert items into Supabase
            const { error: insertError } = await supabase
                .from('finished_stock')
                .upsert(
                    itemsToInsert,
                    { onConflict: 'sku' }  // Use SKU as the unique identifier
                );

            if (insertError) {
                console.error('Error inserting items:', insertError);
                throw new Error(`Failed to insert items: ${insertError.message}`);
            }

            console.log(`Successfully inserted ${itemsToInsert.length} items into finished_stock`);
            dispatch(setSyncStatus('idle'));
            return itemsToInsert;
        } catch (error) {
            console.error('Sync error:', error);
            dispatch(setSyncStatus('error'));
            throw new Error(`Sync failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }
);

export const fetchFinishedStockFromSupabase = createAsyncThunk<StockItem[], { page: number; perPage: number }>(
    'stock/fetchFinishedStockFromSupabase',
    async ({
        page,
        perPage, 
     }) => {
        console.log(`Fetching finished stock from Supabase, page: ${page}, perPage: ${perPage}`);
        
        //Build the query
        let query = supabase
            .from('finished_stock')
            .select('*');

        //Get all items (no pagination)
        const { data: allItems, error: fetchError } = await query
            .order('created_at', { ascending: false });

        if (fetchError) {
            console.error('Error fetching finished stock:', fetchError);
            throw new Error(`Fetch error: ${fetchError.message}`);
        }

        if (!allItems) {
            return [];
        }

        const typedItems = allItems as unknown as StockItem[];
        console.log('Raw data from Supabase:', typedItems);
        console.log(`Fetched ${typedItems.length} items from Supabase`);
        
        // Filter medium sheet items with case-insensitive SKU check
        const mediumSheetItems = typedItems.filter(item => 
            item.sku?.toUpperCase().startsWith('SFS-')
        );
        console.log('Medium sheet items:', mediumSheetItems);
        console.log(`Found ${mediumSheetItems.length} medium sheet items`);

        return mediumSheetItems;
     }
);
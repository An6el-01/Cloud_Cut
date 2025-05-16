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
                console.log('Sample items from page:', data.slice(0, 3));
                allFinishedStock = allFinishedStock.concat(data as unknown as InventoryItem[]);
                total = pageTotal;
                lastPage = last_page;
                page++;
            } while (page <= lastPage);

            console.log(`Total finished stock fetched: ${allFinishedStock.length}, reported total: ${total}`);
            console.log('Sample of all items:', allFinishedStock.slice(0, 5));

            const inventoryItems: InventoryItem[] = allFinishedStock.map(item => {
                return {
                    id: item.id,
                    name: item.name,
                    sku: item.sku,
                    stock_level: item.stock_level
                };
            });

            // Filter for only medium sheets (SKUs starting with SFS-)
            const mediumSheetItems = inventoryItems.filter(item => 
                item.sku?.toUpperCase().startsWith('SFS-')
            );

            console.log('Filtered medium sheet items:', mediumSheetItems);
            console.log(`Found ${mediumSheetItems.length} medium sheet items`);

            // Use SKU as unique identifier and combine stock levels for items with the same SKU
            const uniqueItems = new Map();
            mediumSheetItems.forEach(item => {
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
            console.log('Items to insert into Supabase:', itemsToInsert.slice(0, 5));
            console.log('Total items to insert:', itemsToInsert.length);

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
            .order('created_at', { ascending: false })
            .limit(10000); // Set a high limit to ensure we get all items

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
        const mediumSheetItems = typedItems.filter(item => {
            const sku = item.sku?.toUpperCase() || '';
            // Check for specific medium sheet patterns
            const validPatterns = ['SFS-100/50/30', 'SFS-100/50/50', 'SFS-100/50/70'];
            const isMediumSheet = validPatterns.some(pattern => sku.includes(pattern));
            
            return isMediumSheet;
        });

        // Define color order for sorting
        const colorOrder: { [key: string]: number } = {
            'BLACK': 1,
            'BLUE': 2,
            'GREEN': 3,
            'GREY': 4,
            'GRAY': 4,
            'ORANGE': 5,
            'PINK': 6,
            'PURPLE': 7,
            'RED': 8,
            'TEAL': 9,
            'YELLOW': 10
        };

        // Sort medium sheet items by color
        const sortedMediumSheetItems = mediumSheetItems.sort((a, b) => {
            const colorA = Object.keys(colorOrder).find(color => 
                a.item_name.toUpperCase().includes(color)
            ) || 'OTHER';
            const colorB = Object.keys(colorOrder).find(color => 
                b.item_name.toUpperCase().includes(color)
            ) || 'OTHER';

            const orderA = colorOrder[colorA] || 999;
            const orderB = colorOrder[colorB] || 999;

            if (orderA === orderB) {
                // If same color, sort by SKU
                return a.sku.localeCompare(b.sku);
            }
            return orderA - orderB;
        });
        
        console.log('Medium sheet items after filtering and sorting:', sortedMediumSheetItems);
        console.log(`Found ${sortedMediumSheetItems.length} medium sheet items`);
        
        return sortedMediumSheetItems;
     }
);
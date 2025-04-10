import { OrderItem } from '@/types/redux';
import { SupabaseClient } from '@supabase/supabase-js';

// Define the interface for OrderItemData to match what's being used
interface OrderItemData {
  sku_id: string;
  item_name: string;
  quantity: number;
  foamsheet?: string;
  extra_info?: string;
  priority?: number;
}

// Helper function to split arrays into batches
export const splitArrayIntoBatches = <T>(array: T[], batchSize: number): T[][] => {
  const batches: T[][] = [];
  for (let i = 0; i < array.length; i += batchSize) {
    batches.push(array.slice(i, i + batchSize));
  }
  return batches;
};

// Helper function to process items for a batch of orders
export const processItemsForOrders = async (
  supabase: SupabaseClient,
  orderIds: string[], 
  orderItemsByOrderId: Record<string, OrderItemData[]>,
  isArchived: boolean
) => {
  const itemsToInsert: Omit<OrderItem, 'id'>[] = [];
  let skippedCount = 0;
  
  // Fetch existing item IDs to avoid duplicates
  const tableName = isArchived ? 'archived_order_items' : 'order_items';
  const { data: existingItems, error: existingItemsError } = await supabase
    .from(tableName)
    .select('order_id, sku_id, item_name')
    .in('order_id', orderIds);
    
  if (existingItemsError) {
    console.error(`Error fetching existing ${tableName}:`, existingItemsError);
    return;
  }
  
  const existingItemKeys = new Set(
    existingItems?.map(item => `${item.order_id}_${item.sku_id}_${item.item_name}`) || []
  );
  console.log(`Found ${existingItemKeys.size} existing items in ${tableName}`);
  
  // Create items to insert
  for (const orderId of orderIds) {
    const items = orderItemsByOrderId[orderId];
    if (!items) continue;
    
    items.forEach(item => {
      const uniqueStr = `${orderId}_${item.sku_id}_${item.item_name}`;
      
      // Skip if item already exists
      if (existingItemKeys.has(uniqueStr)) {
        skippedCount++;
        return;
      }
      
      const newItem = {
        order_id: orderId,
        sku_id: item.sku_id,
        item_name: item.item_name,
        quantity: item.quantity,
        completed: false,
        foamsheet: item.foamsheet || '',
        extra_info: item.extra_info || '',
        priority: item.priority || 0,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      };
      
      itemsToInsert.push(newItem);
    });
  }
  
  console.log(`Processing ${itemsToInsert.length} items for ${orderIds.length} ${isArchived ? 'archived' : 'active'} orders (skipped ${skippedCount})`);
  
  // Insert items in batches
  if (itemsToInsert.length > 0) {
    const insertBatchSize = 50;
    const batches = splitArrayIntoBatches(itemsToInsert, insertBatchSize);
    
    for (const batch of batches) {
      try {
        const { error } = await supabase
          .from(tableName)
          .insert(batch);
          
        if (error) {
          console.error(`Error inserting items into ${tableName}:`, error.message);
          console.log('Failed batch:', batch);
        }
      } catch (err) {
        console.error(`Exception inserting items into ${tableName}:`, err);
      }
    }
    
    console.log(`Successfully inserted ${itemsToInsert.length} items into ${tableName}`);
  }
  
  return itemsToInsert.length;
};

// Export additional types to be used by other modules
export type { OrderItemData };
export interface OrderItemInfo {
  orderId: string;
  items: OrderItemData[];
} 
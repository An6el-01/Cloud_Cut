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
  const archivedItemsToInsert: Omit<OrderItem, 'id'>[] = [];
  let skippedCount = 0;
  
  console.log(`Processing items for ${orderIds.length} orders (isArchived=${isArchived})...`);
  
  // First check if the orders exist in either the active or archived tables
  console.log(`Verifying orders exist in both active and archived tables...`);
  
  // Check active orders table
  const { data: activeOrders, error: activeOrdersError } = await supabase
    .from('orders')
    .select('order_id')
    .in('order_id', orderIds);
    
  if (activeOrdersError) {
    console.error(`Error verifying orders in active table:`, activeOrdersError);
  }
  
  // Check archived orders table
  const { data: archivedOrders, error: archivedOrdersError } = await supabase
    .from('archived_orders')
    .select('order_id')
    .in('order_id', orderIds);
    
  if (archivedOrdersError) {
    console.error(`Error verifying orders in archived table:`, archivedOrdersError);
  }
  
  // Create sets of valid order IDs from each table
  const activeOrderIds = new Set((activeOrders || []).map(o => o.order_id));
  const archivedOrderIds = new Set((archivedOrders || []).map(o => o.order_id));
  
  console.log(`Found ${activeOrderIds.size} orders in active table and ${archivedOrderIds.size} orders in archived table`);
  
  if (activeOrderIds.size === 0 && archivedOrderIds.size === 0) {
    console.error(`No valid orders found in either table. Cannot insert items.`);
    return 0;
  }

  // Fetch ALL existing items for these orders in both tables at once
  const { data: existingActiveItems, error: activeItemsError } = await supabase
    .from('order_items')
    .select('*')
    .in('order_id', orderIds);

  const { data: existingArchivedItems, error: archivedItemsError } = await supabase
    .from('archived_order_items')
    .select('*')
    .in('order_id', orderIds);

  if (activeItemsError) {
    console.error(`Error fetching existing active items:`, activeItemsError);
  }
  if (archivedItemsError) {
    console.error(`Error fetching existing archived items:`, archivedItemsError);
  }

  // Create a map of existing items for quick lookup
  const existingItemsMap = new Map();
  
  // Add active items to the map
  existingActiveItems?.forEach(item => {
    const key = `${item.order_id}_${item.sku_id}_${item.item_name}_${item.quantity}`;
    existingItemsMap.set(key, { ...item, isArchived: false });
  });

  // Add archived items to the map
  existingArchivedItems?.forEach(item => {
    const key = `${item.order_id}_${item.sku_id}_${item.item_name}_${item.quantity}`;
    existingItemsMap.set(key, { ...item, isArchived: true });
  });

  console.log(`Found ${existingItemsMap.size} total existing items across both tables`);

  // Process items for active orders
  for (const orderId of activeOrderIds) {
    // Skip this order if it already has any items in the database (active or archived)
    const hasActiveItems = existingActiveItems?.some(item => item.order_id === orderId);
    const hasArchivedItems = existingArchivedItems?.some(item => item.order_id === orderId);
    if (hasActiveItems || hasArchivedItems) {
      console.log(`Skipping order ${orderId}: items already exist in the database.`);
      continue;
    }
    const items = orderItemsByOrderId[orderId];
    if (!items) continue;
    
    items.forEach(item => {
      const key = `${orderId}_${item.sku_id}_${item.item_name}_${item.quantity}`;
      
      // Skip if item already exists in either table
      if (existingItemsMap.has(key)) {
        skippedCount++;
        return;
      }
      // Double-check: Prevent adding the same item twice in this run
      if (itemsToInsert.some(existing => existing.order_id === orderId && existing.sku_id === item.sku_id && existing.item_name === item.item_name && existing.quantity === item.quantity)) {
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
  
  // Process items for archived orders
  for (const orderId of archivedOrderIds) {
    // Skip this order if it already has any items in the database (active or archived)
    const hasActiveItems = existingActiveItems?.some(item => item.order_id === orderId);
    const hasArchivedItems = existingArchivedItems?.some(item => item.order_id === orderId);
    if (hasActiveItems || hasArchivedItems) {
      console.log(`Skipping archived order ${orderId}: items already exist in the database.`);
      continue;
    }
    const items = orderItemsByOrderId[orderId];
    if (!items) continue;
    
    items.forEach(item => {
      const key = `${orderId}_${item.sku_id}_${item.item_name}_${item.quantity}`;
      
      // Skip if item already exists in either table
      if (existingItemsMap.has(key)) {
        skippedCount++;
        return;
      }
      // Double-check: Prevent adding the same item twice in this run
      if (archivedItemsToInsert.some(existing => existing.order_id === orderId && existing.sku_id === item.sku_id && existing.item_name === item.item_name && existing.quantity === item.quantity)) {
        skippedCount++;
        return;
      }
      
      const newItem = {
        order_id: orderId,
        sku_id: item.sku_id,
        item_name: item.item_name,
        quantity: item.quantity,
        completed: true, // Set to true for archived items
        foamsheet: item.foamsheet || '',
        extra_info: item.extra_info || '',
        priority: item.priority || 0,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      };
      
      archivedItemsToInsert.push(newItem);
    });
  }
  
  // Process missing orders - collect items for orders that don't exist in either table
  const missingOrderIds = orderIds.filter(id => !activeOrderIds.has(id) && !archivedOrderIds.has(id));
  let missingItemsCount = 0;
  
  for (const orderId of missingOrderIds) {
    const items = orderItemsByOrderId[orderId];
    if (items) {
      missingItemsCount += items.length;
    }
  }
  
  console.log(`Summary: ${itemsToInsert.length} items for active orders, ${archivedItemsToInsert.length} items for archived orders`);
  console.log(`Skipped ${skippedCount} duplicate items and ${missingItemsCount} items for orders not found in database`);
  
  let successCount = 0;
  let failedCount = 0;
  
  // Insert items for active orders
  if (itemsToInsert.length > 0) {
    const insertBatchSize = 50;
    const batches = splitArrayIntoBatches(itemsToInsert, insertBatchSize);
    
    console.log(`Inserting ${itemsToInsert.length} items into order_items in ${batches.length} batches...`);
    
    for (let i = 0; i < batches.length; i++) {
      const batch = batches[i];
      console.log(`Processing active batch ${i+1}/${batches.length} (${batch.length} items)`);
      
      try {
        const { error } = await supabase
          .from('order_items')
          .insert(batch);
          
        if (error) {
          console.error(`Error inserting items into order_items:`, error.message);
          failedCount += batch.length;
          // Log the first problematic item for debugging
          if (batch.length > 0) {
            console.log('Example problematic item:', batch[0]);
          }
        } else {
          successCount += batch.length;
        }
        
        // Add a small delay between batches to avoid rate limiting
        if (i < batches.length - 1) {
          await new Promise(resolve => setTimeout(resolve, 300));
        }
      } catch (err) {
        console.error(`Exception inserting items into order_items:`, err);
        failedCount += batch.length;
      }
    }
  }
  
  // Insert items for archived orders
  if (archivedItemsToInsert.length > 0) {
    const insertBatchSize = 50;
    const archivedBatches = splitArrayIntoBatches(archivedItemsToInsert, insertBatchSize);
    
    console.log(`Inserting ${archivedItemsToInsert.length} items into archived_order_items in ${archivedBatches.length} batches...`);
    
    for (let i = 0; i < archivedBatches.length; i++) {
      const batch = archivedBatches[i];
      console.log(`Processing archived batch ${i+1}/${archivedBatches.length} (${batch.length} items)`);
      
      try {
        const { error } = await supabase
          .from('archived_order_items')
          .insert(batch);
          
        if (error) {
          console.error(`Error inserting items into archived_order_items:`, error.message);
          failedCount += batch.length;
          // Log the first problematic item for debugging
          if (batch.length > 0) {
            console.log('Example problematic archived item:', batch[0]);
          }
        } else {
          successCount += batch.length;
        }
        
        // Add a small delay between batches to avoid rate limiting
        if (i < archivedBatches.length - 1) {
          await new Promise(resolve => setTimeout(resolve, 300));
        }
      } catch (err) {
        console.error(`Exception inserting items into archived_order_items:`, err);
        failedCount += batch.length;
      }
    }
  }
  
  console.log(`Insertion results: ${successCount} successful, ${failedCount} failed`);
  
  return successCount;
};

// Export additional types to be used by other modules
export type { OrderItemData };
export interface OrderItemInfo {
  orderId: string;
  items: OrderItemData[];
} 
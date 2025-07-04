import { createAsyncThunk } from '@reduxjs/toolkit';
import { Order, OrderItem } from '@/types/redux';
import { fetchOrders } from '@/utils/despatchCloud';
import { supabase } from '@/utils/supabase';
import { getFoamSheetFromSKU } from '@/utils/skuParser';
import { DespatchCloudOrder } from '@/types/despatchCloud';
import { getPriorityLevel, isAmazonOrder, calculateDayNumber } from '@/utils/priority'; 
import { optimizeItemName } from '@/utils/optimizeItemName';
import { downloadCSV, generateCSV } from '@/utils/exportCSV';
import { processItemsForOrders, OrderItemData } from '../utils/orderUtils';
import { setSyncStatus } from '../slices/ordersSlice';
import { shouldOrderBeManufactured } from '@/utils/manufacturingUtils';

// Define helper type for Supabase response items
type SupabaseOrderItem = {
  order_id: string;
  [key: string]: unknown;
};

// Add type extension for Order with calculatedPriority
type OrderWithPriority = Order & { calculatedPriority: number };

// Define interface for order update operations
interface OrderUpdate {
  id: number | undefined; 
  order_id: string;
  status: string | null;
  manufactured?: boolean;
  updated_at: string;
}

// Thunks
export const syncOrders = createAsyncThunk(
  'orders/syncOrders',
  async (_, { dispatch }) => {
    console.log('Starting syncOrders thunk');
    dispatch(setSyncStatus('syncing'));
    try {
      console.log('Fetching all orders from DespatchCloud...');
      let allOrders: DespatchCloudOrder[] = [];
      let page = 1;
      let total = 0;
      let lastPage = 1;
      const perPage = 15;

      do {
        const { data, total: pageTotal, last_page } = await fetchOrders(page, perPage);
        console.log(`Fetched page ${page}: ${data.length} orders`);
        allOrders = allOrders.concat(data);
        total = pageTotal;
        lastPage = last_page;
        page++;
      } while (page <= lastPage);

      console.log(`Total orders fetched: ${allOrders.length}, reported total: ${total}`);

      const orders: Order[] = allOrders.map(order => {
        const inventory = order.inventory || [];
        let status = order.status_description || null;
        if(status !== "Cancelled" && status !== "Despatched" && status !== null && status!== "On Hold"){
          status = "Pending";
        }

        // Trim whitespace from order_id to prevent database issues
        const trimmedOrderId = order.channel_order_id.trim();

        return {
          id: order.id,
          order_id: trimmedOrderId,
          order_date: order.date_received,
          customer_name: order.shipping_name,
          status: status,
          total_items: inventory.length,
          items_completed: order.status_description === 'Despatched' ? inventory.length : 0,
          access_url: order.access_url || null,
          email: order.email || null,
          country: order.shipping_address_country || 'N/A',
          raw_data: order,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          manufactured: status === 'Completed',
          packed: status === 'Completed',
          picking: status === 'Completed',
          user_picking: 'N/A'
        };
      });

      // Filter out invalid orders to avoid issues
      const validOrders = orders.filter(order => order.status !== null);
      const invalidOrders = orders.filter(order => order.status === null);
      console.log(`Filtered out ${invalidOrders.length} invalid orders out of ${orders.length} total orders`);

      //********* STEP 1: Fetch existing orders from Supabase *********
      console.log('STEP 1: Fetching all existing orders from Supabase...');
      
      // Get ALL order IDs from both active and archived tables - important to do this first
      const { data: existingActiveOrders, error: activeOrdersError } = await supabase
          .from('orders')
          .select('id, order_id, status, manufactured');

      if (activeOrdersError) {
        console.error('Error fetching active orders:', activeOrdersError);
        throw new Error(`Failed to fetch active orders: ${activeOrdersError.message}`);
      }

      const { data: existingArchivedOrders, error: archivedOrdersError } = await supabase
        .from('archived_orders')
        .select('id, order_id');

      if (archivedOrdersError) {
        console.error('Error fetching archived orders:', archivedOrdersError);
        throw new Error(`Failed to fetch archived orders: ${archivedOrdersError.message}`);
      }

      // Create maps and sets for faster lookups
      const existingActiveOrderIds = new Set(existingActiveOrders?.map(o => o.order_id) || []);
      const existingArchivedOrderIds = new Set(existingArchivedOrders?.map(o => o.order_id) || []);
      const activeOrderMap = new Map(existingActiveOrders?.map(o => [o.order_id, o.id]) || []);
      // Create a map to store existing manufactured values
      const existingManufacturedMap = new Map(existingActiveOrders?.map(o => [o.order_id, o.manufactured]) || []);
      
      const totalExistingOrders = existingActiveOrderIds.size + existingArchivedOrderIds.size;
      console.log(`Found ${existingActiveOrderIds.size} active orders and ${existingArchivedOrderIds.size} archived orders (${totalExistingOrders} total)`);
      
      //********* STEP 2: Identify orders to update, insert, or skip *********
      console.log('STEP 2: Categorizing orders...');
      
      // Orders to update in the active table (existing active orders from API)
      const ordersToUpdate: OrderUpdate[] = [];
      
      // New orders to insert (not in active or archived tables)
      const ordersToInsert: Order[] = [];
      
      // Keep track of newly added order IDs for item processing
      const newlyAddedOrderIds: string[] = [];
      
      // Classify each order from the API
      validOrders.forEach(order => {
        const { order_id, status } = order;
        
        // CASE 1: Order exists in active table
        if (existingActiveOrderIds.has(order_id)) {
          // Only update if the order has a cancelled status or is complete
          if (status === 'Cancelled' || status === 'Despatched' || status === 'Completed') {
            // If status is "Despatched", change it to "Completed" for orders in our database
            const updatedStatus = status === 'Despatched' ? 'Completed' : status;
            
            // Get the existing manufactured value to preserve it
            const existingManufactured = existingManufacturedMap.get(order_id);
            
            ordersToUpdate.push({
              id: activeOrderMap.get(order_id) as number | undefined,
              order_id: order_id,
              status: updatedStatus,
              manufactured: existingManufactured as boolean | undefined,
              updated_at: new Date().toISOString()
            });
          }
        }
        // CASE 2: Order is in archived table - skip it entirely
        else if (existingArchivedOrderIds.has(order_id)) {
          // Skip - we don't modify archived orders
        }
        // CASE 3: Order doesn't exist anywhere - insert it
        else {
          ordersToInsert.push(order);
          newlyAddedOrderIds.push(order_id);
        }
      });
      
      console.log(`Categorized orders: ${ordersToUpdate.length} to update, ${ordersToInsert.length} to insert, ${newlyAddedOrderIds.length} new order IDs for items`);
      
      //********* STEP 3: Process updates and insertions *********
      console.log('STEP 3: Processing updates and insertions...');
      
      // Batch size for database operations
      const batchSize = 20;
      
      // Update existing orders
      if (ordersToUpdate.length > 0) {
        console.log(`Updating ${ordersToUpdate.length} existing orders...`);
        
        for (let i = 0; i < ordersToUpdate.length; i += batchSize) {
          const batch = ordersToUpdate.slice(i, i + batchSize);
          
          const { error: updateError } = await supabase
            .from('orders')
            .upsert(batch as unknown as Record<string, unknown>[], {
              onConflict: 'id'
            });
          
          if (updateError) {
            console.error('Order update error:', updateError);
            throw new Error(`Order update failed: ${updateError.message}`);
          }
          
          console.log(`Successfully updated batch ${Math.floor(i/batchSize) + 1} of ${Math.ceil(ordersToUpdate.length/batchSize)}`);
          
          // Small delay to prevent rate limiting
          if (i + batchSize < ordersToUpdate.length) {
            await new Promise(resolve => setTimeout(resolve, 300));
          }
        }
      }
      
      // Insert new orders
      if (ordersToInsert.length > 0) {
        console.log(`Inserting ${ordersToInsert.length} new orders...`);
        
        let successfulInsertions = 0;
        
        for (let i = 0; i < ordersToInsert.length; i += batchSize) {
          const batch = ordersToInsert.slice(i, i + batchSize);
          
          try {
            const { error } = await supabase
              .from('orders')
              .upsert(batch as unknown as Record<string, unknown>[], { 
                onConflict: 'order_id',
                ignoreDuplicates: false
              });
            
            if (error) {
              console.error(`Error inserting batch ${Math.floor(i/batchSize) + 1}:`, error);
            } else {
              successfulInsertions += batch.length;
              console.log(`Successfully inserted batch ${Math.floor(i/batchSize) + 1} of ${Math.ceil(ordersToInsert.length/batchSize)}`);
            }
          } catch (err) {
            console.error(`Exception inserting batch ${Math.floor(i/batchSize) + 1}:`, err);
          }
          
          // Small delay to prevent rate limiting
          if (i + batchSize < ordersToInsert.length) {
            await new Promise(resolve => setTimeout(resolve, 300));
          }
        }
        
        console.log(`Order insertion complete: ${successfulInsertions}/${ordersToInsert.length} orders inserted successfully`);
        
        // Add a significant delay to ensure database consistency before moving to items
        console.log('Waiting for database to stabilize before processing items...');
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
      
      //********* STEP 4: Process order items for newly added orders *********
      console.log('STEP 4: Processing order items for newly added orders...');
      
      // Only process items for newly added orders
      if (newlyAddedOrderIds.length > 0) {
        // Create a map of order items to process
        const orderItemsToProcess: Record<string, OrderItemData[]> = {};
        
        // Only process items for newly added orders
        newlyAddedOrderIds.forEach(orderId => {
          const order = allOrders.find(o => o.channel_order_id.trim() === orderId);
          if (order && order.inventory) {
            const dayNumber = calculateDayNumber(order.date_received);
            const isAmazon = isAmazonOrder(order);
            const isOnHold = order.status.toLowerCase().includes('hold');
            
            orderItemsToProcess[orderId] = order.inventory.map(item => {
              const foamSheet = getFoamSheetFromSKU(item.sku) || 'N/A';
              const optimizedName = optimizeItemName(
                { sku: item.sku, name: item.name, options: item.options },
                order.status
              );
              
              const priority = getPriorityLevel(
                optimizedName.toLowerCase(),
                foamSheet,
                dayNumber,
                isAmazon,
                isOnHold
              );
              
              return {
                sku_id: item.sku || 'N/A',
                item_name: optimizedName,
                quantity: item.quantity || 0,
                foamsheet: foamSheet,
                extra_info: item.options || 'N/A',
                priority
              };
            });
          }
        });
        
        // Process items using the optimized orderUtils function
        try {
          const itemsInserted = await processItemsForOrders(
            supabase,
            newlyAddedOrderIds,
            orderItemsToProcess,
            false
          );
          
          console.log(`Finished processing items for ${newlyAddedOrderIds.length} orders: inserted approximately ${itemsInserted} items`);
        } catch (error) {
          console.error('Error processing order items:', error);
          console.log('Continuing with sync despite item processing error');
        }
      }
      
      //********* STEP 4.5: Update manufacturing status for all orders *********
      console.log('STEP 4.5: Updating manufacturing status for all orders...');
      
      // Get all active orders that need manufacturing status update
      const { data: activeOrdersToUpdate, error: manufacturingOrdersError } = await supabase
        .from('orders')
        .select('order_id, manufactured')
        .in('order_id', [...existingActiveOrderIds, ...newlyAddedOrderIds]);
      
      if (manufacturingOrdersError) {
        console.error('Error fetching active orders for manufacturing update:', manufacturingOrdersError);
      } else if (activeOrdersToUpdate) {
        // Process each order in batches
        const batchSize = 20;
        for (let i = 0; i < activeOrdersToUpdate.length; i += batchSize) {
          const batch = activeOrdersToUpdate.slice(i, i + batchSize);
          const orderIds = batch.map(o => o.order_id);
          
          // Get items for these orders
          const { data: items, error: manufacturingItemsError } = await supabase
            .from('order_items')
            .select('*')
            .in('order_id', orderIds);
          
          if (manufacturingItemsError) {
            console.error('Error fetching items for manufacturing update:', manufacturingItemsError);
            continue;
          }
          
          // Group items by order_id
          const itemsByOrder = items.reduce<Record<string, OrderItem[]>>((acc, item) => {
            const typedItem = item as unknown as OrderItem;
            if (!acc[typedItem.order_id]) acc[typedItem.order_id] = [];
            acc[typedItem.order_id].push(typedItem);
            return acc;
          }, {});
          
          // Only update orders that don't already have a manufactured value set
          const updates = Object.entries(itemsByOrder)
            .filter(([orderId, items]) => {
              // Find the existing order to check its current manufactured status
              const existingOrder = batch.find(o => o.order_id === orderId);
              // Only update if manufactured is null/undefined or false
              return !existingOrder?.manufactured;
            })
            .map(([orderId, items]) => ({
              order_id: orderId,
              manufactured: shouldOrderBeManufactured(items),
              updated_at: new Date().toISOString()
            }));
          
          // Update orders in batches
          if (updates.length > 0) {
            const { error: manufacturingUpdateError } = await supabase
              .from('orders')
              .upsert(updates, { onConflict: 'order_id' });
            
            if (manufacturingUpdateError) {
              console.error('Error updating manufacturing status:', manufacturingUpdateError);
            } else {
              console.log(`Updated manufacturing status for ${updates.length} orders`);
            }
          }
          
          // Small delay to prevent rate limiting
          if (i + batchSize < activeOrdersToUpdate.length) {
            await new Promise(resolve => setTimeout(resolve, 300));
          }
        }
      }
      
      //********* STEP 5: Fetch final data for the Redux store *********
      console.log('STEP 6: Fetching final data for Redux store...');
      
      // Fetch pending orders for the Redux store 
      const { data: pendingOrders, error: pendingOrdersError } = await supabase
          .from('orders')
          .select('*')
          .eq('status', 'Pending');

      if (pendingOrdersError) {
        console.error('Error fetching pending orders:', pendingOrdersError);
        throw new Error(`Failed to fetch pending orders: ${pendingOrdersError.message}`);
      }
      
      console.log(`Fetched ${pendingOrders?.length || 0} pending orders for the Redux store`);
      
      // Get the items for these orders
      const pendingOrderIds = pendingOrders?.map(o => o.order_id) || [];
      
      const { data: activeItems, error: activeItemsError } = await supabase
        .from('order_items')
        .select('*')
        .in('order_id', pendingOrderIds);
        
      if (activeItemsError) {
        console.error('Error fetching order items:', activeItemsError);
        throw new Error(`Failed to fetch order items: ${activeItemsError.message}`);
      }
      
      console.log(`Fetched ${activeItems?.length || 0} order items for pending orders`);
      
      // Create the final order items map
      const updatedOrderItems = (activeItems || []).reduce<Record<string, OrderItem[]>>((acc, item) => {
        const typedItem = item as SupabaseOrderItem;
        const orderID = typedItem.order_id;
        if (!acc[orderID]) acc[orderID] = [];
        acc[orderID].push(typedItem as unknown as OrderItem);
        return acc;
      }, {});


      // AutoMark orders as Manufactured if all items with the SKU Prefix "SFI", "SFC", or "SFS" are completed
      const autoMarkManufactured = async () => {
        try {
          console.log('AutoMarking orders as manufactured if all items with the SKU Prefix "SFI", "SFC", or "SFS" are completed');
          
          // Get all orders that need to be checked
          const { data: ordersToCheck, error: ordersError } = await supabase
            .from('orders')
            .select('order_id')
            .in('order_id', pendingOrderIds)
            .eq('manufactured', false);

          if (ordersError) {
            console.error('Error fetching orders for manufacturing check:', ordersError);
            return;
          }

          if (ordersToCheck && ordersToCheck.length > 0) {
            console.log(`Checking ${ordersToCheck.length} orders for manufacturing status`);

            // Process orders in batches
            const batchSize = 20;
            for (let i = 0; i < ordersToCheck.length; i += batchSize) {
              const batch = ordersToCheck.slice(i, i + batchSize);
              const orderIds = batch.map(order => order.order_id);

              // Get all items for these orders
              const { data: items, error: itemsError } = await supabase
                .from('order_items')
                .select('*')
                .in('order_id', orderIds)
                .or('sku_id.ilike.SFI%,sku_id.ilike.SFC%,sku_id.ilike.SFS%,sku_id.eq.SFP30E,sku_id.eq.SFP50E,sku_id.eq.SFP30P,sku_id.eq.SFP50P,sku_id.eq.SFP30T,sku_id.eq.SFP50T');

              if (itemsError) {
                console.error('Error fetching items for manufacturing check:', itemsError);
                continue;
              }

              // Group items by order_id
              const itemsByOrder = items.reduce<Record<string, OrderItem[]>>((acc, item) => {
                const typedItem = item as unknown as OrderItem;
                if (!acc[typedItem.order_id]) acc[typedItem.order_id] = [];
                acc[typedItem.order_id].push(typedItem);
                return acc;
              }, {});

              // Check each order's items and update if all are completed
              const ordersToUpdate = Object.entries(itemsByOrder)
                .filter(([orderId, items]) => {
                  // Only include orders that have at least one true manufacturing item (SFI, SFC, SFS)
                  const hasManufacturingItems = items.some(item => {
                    const sku = item.sku_id.toUpperCase();
                    return sku.startsWith('SFI') || sku.startsWith('SFC') || sku.startsWith('SFS');
                  });
                  
                  // Check if all manufacturing items are completed
                  const allManufacturingCompleted = items
                    .filter(item => {
                      const sku = item.sku_id.toUpperCase();
                      return sku.startsWith('SFI') || sku.startsWith('SFC') || sku.startsWith('SFS');
                    })
                    .every(item => item.completed);
                  
                  // Check if order has any retail pack items that should prevent manufacturing
                  const hasRetailPackItems = items.some(item => {
                    const sku = item.sku_id.toUpperCase();
                    const validRetailPackSkus = ['SFP30E', 'SFP50E', 'SFP30P', 'SFP50P', 'SFP30T', 'SFP50T'];
                    return validRetailPackSkus.includes(sku);
                  });
                  
                  // Only mark as manufactured if:
                  // 1. Has at least one manufacturing item
                  // 2. All manufacturing items are completed
                  // 3. Does NOT have any retail pack items (which should prevent manufacturing)
                  return hasManufacturingItems && allManufacturingCompleted && !hasRetailPackItems;
                })
                .map(([orderId]) => ({
                  order_id: orderId,
                  manufactured: true,
                  updated_at: new Date().toISOString()
                }));

              if (ordersToUpdate.length > 0) {
                // Update orders in Supabase using update instead of upsert
                for (const update of ordersToUpdate) {
                  const { error: updateError } = await supabase
                    .from('orders')
                    .update({ 
                      manufactured: true,
                      updated_at: new Date().toISOString()
                    })
                    .eq('order_id', update.order_id);

                  if (updateError) {
                    console.error(`Error updating manufacturing status for order ${update.order_id}:`, updateError);
                  } else {
                    console.log(`Successfully marked order ${update.order_id} as manufactured`);
                  }
                }

                // Update Redux state
                ordersToUpdate.forEach(update => {
                  const order = pendingOrders?.find(o => o.order_id === update.order_id);
                  if (order) {
                    order.manufactured = true;
                  }
                });
              }

              // Small delay to prevent rate limiting
              if (i + batchSize < ordersToCheck.length) {
                await new Promise(resolve => setTimeout(resolve, 300));
              }
            }
          }
        } catch (error) {
          console.error('Error in auto-mark manufacturing process:', error);
        }
      };

      console.log('AutoMarking orders as manufactured if all items with the SKU Prefix "SFI", "SFC", or "SFS" are completed FINISHED');

      // Execute the auto-mark manufacturing function
      await autoMarkManufactured();

      // AutoMark all items of the orders marked as manufactured to completed = false.
      const autoMarkItemsAsNotCompleted = async () => {
        try {
          console.log('AutoMarking all items of the orders marked as manufactured to completed = false');

          // Get all orders that were just marked as manufactured
          const { data: manufacturedOrders, error: ordersError } = await supabase
            .from('orders')
            .select('order_id')
            .in('order_id', pendingOrderIds)
            .eq('manufactured', true);

          if (ordersError) {
            console.error('Error fetching manufactured orders:', ordersError);
            return;
          }

          if (manufacturedOrders && manufacturedOrders.length > 0) {
            console.log(`Found ${manufacturedOrders.length} manufactured orders to process`);

            // Process orders in batches
            const batchSize = 20;
            for (let i = 0; i < manufacturedOrders.length; i += batchSize) {
              const batch = manufacturedOrders.slice(i, i + batchSize);
              const orderIds = batch.map(order => order.order_id);

              // Get all items for these orders
              const { data: items, error: itemsError } = await supabase
                .from('order_items')
                .select('*')
                .in('order_id', orderIds)
                .eq('completed', true);

              if (itemsError) {
                console.error('Error fetching items for completion check:', itemsError);
                continue;
              }

              if (items && items.length > 0) {
                console.log(`Found ${items.length} completed items to mark as not completed`);

                // Update items in batches
                for (let j = 0; j < items.length; j += batchSize) {
                  const itemBatch = items.slice(j, j + batchSize);
                  const itemIds = itemBatch.map(item => item.id);

                  const { error: updateError } = await supabase
                    .from('order_items')
                    .update({ 
                      completed: false,
                      updated_at: new Date().toISOString()
                    })
                    .in('id', itemIds);

                  if (updateError) {
                    console.error('Error updating items completion status:', updateError);
                  } else {
                    console.log(`Successfully marked ${itemBatch.length} items as not completed`);
                  }

                  // Update Redux state
                  itemBatch.forEach((item) => {
                    const typedItem = item as unknown as OrderItem;
                    const orderId = typedItem.order_id;
                    const orderItems = updatedOrderItems[orderId] || [];
                    const itemIndex = orderItems.findIndex(i => i.id === typedItem.id);
                    if (itemIndex !== -1) {
                      orderItems[itemIndex].completed = false;
                    }
                  });

                  // Small delay to prevent rate limiting
                  if (j + batchSize < items.length) {
                    await new Promise(resolve => setTimeout(resolve, 300));
                  }
                }
              }

              // Small delay to prevent rate limiting
              if (i + batchSize < manufacturedOrders.length) {
                await new Promise(resolve => setTimeout(resolve, 300));
              }
            }
          }
        } catch (error) {
          console.error('Error in auto-mark items as not completed process:', error);
        }
      };

      // Execute the auto-mark items as not completed function
      await autoMarkItemsAsNotCompleted();

      console.log('Sync completed successfully');
      
      return {
        orders: pendingOrders || [],
        orderItems: updatedOrderItems,
        total: pendingOrders?.length || 0,
        last_page: 1
      };
    } catch (error) {
      console.error('Sync error:', error);
      dispatch(setSyncStatus('error'));
      throw new Error(`Sync failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }
);



export const fetchOrdersFromSupabase = createAsyncThunk(
  'orders/fetchOrdersFromSupabase',
  async ({ 
    page, 
    perPage,
    manufactured = undefined,
    packed = undefined,
    status = undefined,
    view = 'manufacturing'
  }: { 
    page: number; 
    perPage: number;
    manufactured?: boolean;
    packed?: boolean;
    status?: string;
    view?: 'manufacturing' | 'packing' | 'archived' | 'all';
  }) => {
    console.log(`Fetching ${view} orders from Supabase, page: ${page}, perPage: ${perPage}, status: ${status}, manufactured: ${manufactured}, packed: ${packed}`);
    
    // Build the query - FETCH ALL ORDERS AT ONCE to sort properly
    let query = supabase
      .from('orders')
      .select('*');
    
    // Add status filter if specified
    if (status !== undefined) {
      query = query.eq('status', status);
    }

    // Add manufactured filter if specified
    if (manufactured !== undefined) {
      query = query.eq('manufactured', manufactured);
    }

    // Add packed filter if specified
    if (packed !== undefined) {
      query = query.eq('packed', packed);
    }

    // Get ALL orders matching the criteria (no pagination)
    const { data: allOrders, error: ordersError } = await query
      .order('order_date', { ascending: false });

    if (ordersError) throw new Error(`Fetch orders failed: ${ordersError.message}`);
    console.log(`Fetched ${allOrders.length} ${view} orders from Supabase`);

    // Fetch order items for all orders - check both order_items and archived_order_items tables
    const allOrderIds = allOrders.map(o => o.order_id);

    // Get active items
    const { data: activeItems, error: activeItemsError } = await supabase
      .from('order_items')
      .select('*')
      .in('order_id', allOrderIds);

    if (activeItemsError) throw new Error(`Fetch active items failed: ${activeItemsError.message}`);
    console.log(`Fetched ${activeItems?.length || 0} active items for ${allOrderIds.length} orders`);

    // Get archived items if any
    const { data: archivedItems, error: archivedItemsError } = await supabase
      .from('archived_order_items')
      .select('*')
      .in('order_id', allOrderIds);

    if (archivedItemsError) throw new Error(`Fetch archived items failed: ${archivedItemsError.message}`);
    console.log(`Fetched ${archivedItems?.length || 0} archived items for ${allOrderIds.length} orders`);

    // Combine active and archived items
    const allOrderItems = [...(activeItems || []), ...(archivedItems || [])];

    // Create a map of all order items
    const allOrderItemsMap = allOrderItems.reduce<Record<string, OrderItem[]>>((acc, item) => {
      const typedItem = item as SupabaseOrderItem;
      const orderID = typedItem.order_id;
      if (!acc[orderID]) acc[orderID] = [];
      acc[orderID].push({
        ...typedItem,
        completed: Boolean(typedItem.completed)
      } as unknown as OrderItem);
      return acc;
    }, {});

    // Filter out orders with no manufacturing items if we're in manufacturing view
    let filteredOrders = allOrders;
    if (view === 'manufacturing') {
      console.log('Filtering orders for manufacturing view. Total orders before filtering:', allOrders.length);
      filteredOrders = allOrders.filter(order => {
        const items = allOrderItemsMap[order.order_id as string] || [];
        // Check for any manufacturing items (SFI, SFC) or uncompleted medium sheets or retail pack items
        const hasManufacturingItems = items.some((item: OrderItem) => {
          const isManufacturingItem = item.sku_id.startsWith('SFI') || item.sku_id.startsWith('SFC');
          const isMediumSheet = ['SFS-100/50/30', 'SFS-100/50/50', 'SFS-100/50/70'].some(pattern => 
            item.sku_id.includes(pattern)
          );
          // Check for specific retail pack SKUs
          const validRetailPackSkus = ['SFP30E', 'SFP50E', 'SFP30P', 'SFP50P', 'SFP30T', 'SFP50T'];
          const isRetailPack = validRetailPackSkus.includes(item.sku_id.toUpperCase());
          // Include the item if it's a manufacturing item, an uncompleted medium sheet, or a retail pack item
          return isManufacturingItem || (isMediumSheet && !item.completed) || isRetailPack;
        });

        if (!hasManufacturingItems) {
          console.log(`Order ${order.order_id} filtered out. Items:`, items.map(item => ({
            sku_id: item.sku_id,
            completed: item.completed
          })));
        }
        return hasManufacturingItems;
      });
      console.log(`Filtered out ${allOrders.length - filteredOrders.length} orders with no manufacturing items`);
    } else if (view === 'all') {
      // For 'all' view, don't filter orders - show all pending orders
      console.log('Showing all pending orders without filtering');
    }

    // Calculate priority for each order based on its items and sort ALL orders
    const ordersWithPriority = filteredOrders.map(order => {
      const typedOrder = order as SupabaseOrderItem;
      const items = allOrderItemsMap[typedOrder.order_id] || [];
      const priority = items.length > 0 
        ? Math.min(...items.map(item => item.priority ?? 10)) 
        : 10;
      return { ...typedOrder, calculatedPriority: priority } as unknown as OrderWithPriority;
    });

    // Sort ALL orders by priority in descending order
    const sortedOrders = ordersWithPriority.sort((a, b) => 
      a.calculatedPriority - b.calculatedPriority
    );

    // Calculate pagination info for the UI
    const startIndex = (page - 1) * perPage;
    const endIndex = startIndex + perPage;
    const paginatedOrders = sortedOrders.slice(startIndex, endIndex);

    console.log(`Calculated pagination info: showing orders ${startIndex+1} to ${Math.min(endIndex, sortedOrders.length)} of ${sortedOrders.length} for UI display`);
    console.log(`Returning all ${Object.keys(allOrderItemsMap).length} order items with ${Object.values(allOrderItemsMap).flat().length} total items`);

    return { 
      orders: sortedOrders, // Return ALL orders instead of just paginated ones 
      paginatedOrders, // Also include paginated orders for the UI
      orderItems: allOrderItemsMap,
      total: sortedOrders.length, 
      page, 
      view 
    };
  }
);

export const exportPendingOrdersCSV = createAsyncThunk(
  "orders/exportPendingOrdersCSV",
  async () => {
    console.log("Fetching all pending orders for CSV export...");

    //Fetch all "Pending" orders (no pagination for export)
    const { data: orders, error: ordersError } = await supabase
      .from("orders")
      .select("*")
      .eq("status", "Pending")
      .order("order_date", { ascending: false });

    if (ordersError) throw new Error(`Fetch orders failed: ${ordersError.message}`);
    console.log(`Fetched ${orders.length} pending orders`);

    const orderIds = orders.map((o) => o.order_id);
    const { data: orderItems, error: itemsError } = await supabase
      .from("order_items")
      .select("*")
      .in("order_id", orderIds);

    if (itemsError) throw new Error(`Fetch items failed: ${itemsError.message}`);
    console.log(`Fetched ${orderItems.length} order items`);

    const orderItemsMap = orderItems.reduce<Record<string, OrderItem[]>>((acc, item) => {
      const typedItem = item as SupabaseOrderItem;
      const orderID = typedItem.order_id;
      if (!acc[orderID]) acc[orderID] = [];
      acc[orderID].push(typedItem as unknown as OrderItem);
      return acc;
    }, {});

    const csvContent = generateCSV(
      orders as unknown as Order[],
      orderItemsMap
    );
    downloadCSV(csvContent, `pending_orders_${new Date().toISOString().split("T")[0]}.csv`);

    return { orders, orderItems: orderItemsMap }; //Return data to update state if needed
  }
);

export const initialFetch = createAsyncThunk(
  'orders/initialFetch',
  async () => {
    console.log('Initial fetch started');
    
    // First, check if we have connection to Supabase
    try {
      const { error } = await supabase.from('orders').select('count');
      if (error) throw error;
      console.log('Supabase connection verified');
    } catch (error) {
      console.error('Supabase connection error:', error);
      throw new Error('Failed to connect to Supabase');
    }
    
    // Get all pending orders
    const { data: pendingOrders, error: ordersError } = await supabase
      .from('orders')
      .select('*')
      .eq('status', 'Pending');
    
    if (ordersError) throw new Error(`Fetch orders failed: ${ordersError.message}`);
    console.log(`Fetched ${pendingOrders?.length || 0} pending orders`);
    
    // Get all order items - both active and archived
    const pendingOrderIds = pendingOrders?.map(o => o.order_id) || [];
    
    // Get active items
    const { data: activeItems, error: activeItemsError } = await supabase
      .from('order_items')
      .select('*')
      .in('order_id', pendingOrderIds);
    
    if (activeItemsError) throw new Error(`Fetch active items failed: ${activeItemsError.message}`);
    console.log(`Fetched ${activeItems?.length || 0} active order items`);
    
    // Get archived items if any
    const { data: archivedItems, error: archivedItemsError } = await supabase
      .from('archived_order_items')
      .select('*')
      .in('order_id', pendingOrderIds);
    
    if (archivedItemsError) throw new Error(`Fetch archived items failed: ${archivedItemsError.message}`);
    console.log(`Fetched ${archivedItems?.length || 0} archived order items`);
    
    // Combine active and archived items
    const allOrderItems = [...(activeItems || []), ...(archivedItems || [])];
    
    // Create a map for better access
    const orderItemsMap = allOrderItems.reduce<Record<string, OrderItem[]>>((acc, item) => {
      const typedItem = item as SupabaseOrderItem;
      const orderID = typedItem.order_id;
      acc[orderID] = acc[orderID] || [];
      acc[orderID].push({
        ...typedItem,
        completed: Boolean(typedItem.completed)
      } as unknown as OrderItem);
      return acc;
    }, {});
    
    // Get sync status
    const { data: syncData, error: syncError } = await supabase
      .from('sync_status')
      .select('*')
      .single();
    
    if (syncError && syncError.code !== 'PGRST116') {
      throw new Error(`Fetch sync status failed: ${syncError.message}`);
    }
    
    const syncStatus = syncData || { last_sync: null, status: 'idle' };
    console.log('Initial fetch completed successfully');
    
    return { 
      orders: pendingOrders || [], 
      orderItems: orderItemsMap,
      syncStatus
    };
  }
);

export const fetchArchivedOrders = createAsyncThunk(
  'orders/fetchArchivedOrders',
  async () => {
    console.log('Fetching archived orders...');
    
    const { data: archivedOrders, error } = await supabase
      .from('archived_orders')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) {
      console.error('Error fetching archived orders:', error);
      throw new Error(`Failed to fetch archived orders: ${error.message}`);
    }

    // Fetch items for each archived order
    const orderItems: Record<string, OrderItem[]> = {};
    
    if (archivedOrders && archivedOrders.length > 0) {
      const orderIds = archivedOrders.map(order => order.order_id);
      
      // Use a single query to get all items at once
      const { data: items, error: itemsError } = await supabase
        .from('archived_order_items')
        .select('id, order_id, sku_id, item_name, quantity, completed, foamsheet, extra_info, priority, created_at, updated_at')
        .in('order_id', orderIds);

      if (itemsError) {
        console.error(`Error fetching archived items:`, itemsError);
      } else if (items) {
        // Group items by order_id
        (items as unknown as OrderItem[]).forEach(item => {
          if (!orderItems[item.order_id]) {
            orderItems[item.order_id] = [];
          }
          orderItems[item.order_id].push(item);
        });
      }
    }

    console.log(`Fetched ${archivedOrders?.length || 0} archived orders with ${Object.keys(orderItems).length} order items`);
    
    return {
      orders: archivedOrders as unknown as Order[],
      orderItems
    };
  }
);

// New thunks for admin page functionality
export const fetchPendingOrdersForAdmin = createAsyncThunk(
  'orders/fetchPendingOrdersForAdmin',
  async ({ 
    page, 
    perPage
  }: { 
    page: number; 
    perPage: number;
  }) => {
    console.log(`Fetching pending orders for admin, page: ${page}, perPage: ${perPage}`);
    
    // Fetch all orders with status != 'Completed' from orders table
    const { data: pendingOrders, error: ordersError } = await supabase
      .from('orders')
      .select('*')
      .neq('status', 'Completed')
      .order('order_date', { ascending: false });

    if (ordersError) throw new Error(`Fetch pending orders failed: ${ordersError.message}`);
    console.log(`Fetched ${pendingOrders?.length || 0} pending orders from orders table`);

    // Fetch order items for all pending orders from both tables
    const pendingOrderIds = pendingOrders?.map(o => o.order_id) || [];

    // Get active items
    const { data: activeItems, error: activeItemsError } = await supabase
      .from('order_items')
      .select('*')
      .in('order_id', pendingOrderIds);

    if (activeItemsError) throw new Error(`Fetch active items failed: ${activeItemsError.message}`);
    console.log(`Fetched ${activeItems?.length || 0} active items for pending orders`);

    // Get archived items if any
    const { data: archivedItems, error: archivedItemsError } = await supabase
      .from('archived_order_items')
      .select('*')
      .in('order_id', pendingOrderIds);

    if (archivedItemsError) throw new Error(`Fetch archived items failed: ${archivedItemsError.message}`);
    console.log(`Fetched ${archivedItems?.length || 0} archived items for pending orders`);

    // Combine active and archived items
    const allOrderItems = [...(activeItems || []), ...(archivedItems || [])];

    // Create a map of all order items
    const allOrderItemsMap = allOrderItems.reduce<Record<string, OrderItem[]>>((acc, item) => {
      const typedItem = item as SupabaseOrderItem;
      const orderID = typedItem.order_id;
      if (!acc[orderID]) acc[orderID] = [];
      acc[orderID].push({
        ...typedItem,
        completed: Boolean(typedItem.completed)
      } as unknown as OrderItem);
      return acc;
    }, {});

    // Calculate priority for each order based on its items and sort ALL orders
    const ordersWithPriority = (pendingOrders || []).map(order => {
      const typedOrder = order as SupabaseOrderItem;
      const items = allOrderItemsMap[typedOrder.order_id] || [];
      const priority = items.length > 0 
        ? Math.min(...items.map(item => item.priority ?? 10)) 
        : 10;
      return { ...typedOrder, calculatedPriority: priority } as unknown as OrderWithPriority;
    });

    // Sort ALL orders by priority in ascending order (highest priority first)
    const sortedOrders = ordersWithPriority.sort((a, b) => 
      a.calculatedPriority - b.calculatedPriority
    );

    // Calculate pagination info for the UI
    const startIndex = (page - 1) * perPage;
    const endIndex = startIndex + perPage;
    const paginatedOrders = sortedOrders.slice(startIndex, endIndex);

    console.log(`Calculated pagination info: showing orders ${startIndex+1} to ${Math.min(endIndex, sortedOrders.length)} of ${sortedOrders.length} for UI display`);

    return { 
      orders: sortedOrders, // Return ALL orders
      paginatedOrders, // Also include paginated orders for the UI
      orderItems: allOrderItemsMap,
      total: sortedOrders.length, 
      page
    };
  }
);

export const fetchCompletedOrdersForAdmin = createAsyncThunk(
  'orders/fetchCompletedOrdersForAdmin',
  async ({ 
    page, 
    perPage
  }: { 
    page: number; 
    perPage: number;
  }) => {
    console.log(`Fetching completed orders for admin, page: ${page}, perPage: ${perPage}`);
    
    // Fetch completed orders from both orders and archived_orders tables
    const { data: activeCompletedOrders, error: activeOrdersError } = await supabase
      .from('orders')
      .select('*')
      .eq('status', 'Completed')
      .order('order_date', { ascending: false });

    if (activeOrdersError) throw new Error(`Fetch active completed orders failed: ${activeOrdersError.message}`);
    console.log(`Fetched ${activeCompletedOrders?.length || 0} completed orders from orders table`);

    const { data: archivedCompletedOrders, error: archivedOrdersError } = await supabase
      .from('archived_orders')
      .select('*')
      .order('created_at', { ascending: false });

    if (archivedOrdersError) throw new Error(`Fetch archived completed orders failed: ${archivedOrdersError.message}`);
    console.log(`Fetched ${archivedCompletedOrders?.length || 0} completed orders from archived_orders table`);

    // Combine all completed orders
    const allCompletedOrders = [...(activeCompletedOrders || []), ...(archivedCompletedOrders || [])];
    console.log(`Total completed orders: ${allCompletedOrders.length}`);

    // Fetch order items for all completed orders from both tables
    const completedOrderIds = allCompletedOrders.map(o => o.order_id);

    // Get active items
    const { data: activeItems, error: activeItemsError } = await supabase
      .from('order_items')
      .select('*')
      .in('order_id', completedOrderIds);

    if (activeItemsError) throw new Error(`Fetch active items failed: ${activeItemsError.message}`);
    console.log(`Fetched ${activeItems?.length || 0} active items for completed orders`);

    // Get archived items
    const { data: archivedItems, error: archivedItemsError } = await supabase
      .from('archived_order_items')
      .select('*')
      .in('order_id', completedOrderIds);

    if (archivedItemsError) throw new Error(`Fetch archived items failed: ${archivedItemsError.message}`);
    console.log(`Fetched ${archivedItems?.length || 0} archived items for completed orders`);

    // Combine active and archived items
    const allOrderItems = [...(activeItems || []), ...(archivedItems || [])];

    // Create a map of all order items
    const allOrderItemsMap = allOrderItems.reduce<Record<string, OrderItem[]>>((acc, item) => {
      const typedItem = item as SupabaseOrderItem;
      const orderID = typedItem.order_id;
      if (!acc[orderID]) acc[orderID] = [];
      acc[orderID].push({
        ...typedItem,
        completed: Boolean(typedItem.completed)
      } as unknown as OrderItem);
      return acc;
    }, {});

    // Sort completed orders by date (newest first)
    const sortedOrders = allCompletedOrders.sort((a, b) => {
      const dateA = new Date((a.order_date as string) || (a.created_at as string) || new Date(0));
      const dateB = new Date((b.order_date as string) || (b.created_at as string) || new Date(0));
      return dateB.getTime() - dateA.getTime();
    });

    // Calculate pagination info for the UI
    const startIndex = (page - 1) * perPage;
    const endIndex = startIndex + perPage;
    const paginatedOrders = sortedOrders.slice(startIndex, endIndex);

    console.log(`Calculated pagination info: showing orders ${startIndex+1} to ${Math.min(endIndex, sortedOrders.length)} of ${sortedOrders.length} for UI display`);

    return { 
      orders: sortedOrders, // Return ALL orders
      paginatedOrders, // Also include paginated orders for the UI
      orderItems: allOrderItemsMap,
      total: sortedOrders.length, 
      page
    };
  }
);
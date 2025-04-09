// src/redux/slices/ordersSlice.ts
import { createSlice, createAsyncThunk, PayloadAction, createSelector } from '@reduxjs/toolkit';
import { RootState } from '../store';
import { OrdersState, Order, OrderItem } from '@/types/redux';
import { fetchOrders } from '@/utils/despatchCloud';
import { supabase } from '@/utils/supabase';
import { getFoamSheetFromSKU } from '@/utils/skuParser';
import { DespatchCloudOrder } from '@/types/despatchCloud';
import { getPriorityLevel, isAmazonOrder, calculateDayNumber } from '@/utils/priority'; // Import priority utils
import { optimizeItemName } from '@/utils/optimizeItemName';
import { downloadCSV, generateCSV } from '@/utils/exportCSV';

// Initial State
const initialState: OrdersState = {
  allOrders: [],
  manufacturingOrders: [],
  packingOrders: [],
  orderItems: {},
  currentPage: 1,
  ordersPerPage: 15,
  totalOrders: 0,
  totalManufacturingOrders: 0,
  totalPackingOrders: 0, 
  selectedOrderId: null,
  loading: false,
  error: null,
  syncStatus: 'idle',
  currentView: 'manufacturing',
};

// Add type extension for Order with calculatedPriority
type OrderWithPriority = Order & { calculatedPriority: number };

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
          packed: status === 'Completed'
        };
      });

      console.log('Processing order items...');
      const orderItems: Record<string, OrderItem[]> = allOrders.reduce((acc, order) => {
        const inventory = order.inventory || [];

        // Calculate parameters needed for getPriorityLevel
        const dayNumber = calculateDayNumber(order.date_received);
        const isAmazon = isAmazonOrder(order);
        const isOnHold = order.status.toLowerCase().includes('hold');
        const orderStatus = order.status;
        
        // Use trimmed order ID
        const trimmedOrderId = order.channel_order_id.trim();

        acc[trimmedOrderId] = inventory.map((item, index) => {
          const foamSheet = getFoamSheetFromSKU(item.sku) || 'N/A';

          //Optimize the item name
          const optimizedName = optimizeItemName(
            {sku: item.sku, name: item.name, options: item.options },
            orderStatus
          )

          // Calculate individual priority for this item
          const priority = getPriorityLevel(
            optimizedName.toLowerCase(),
            foamSheet,
            dayNumber,
            isAmazon,
            isOnHold
          );

          return {
            id: `${order.id}-${index + 1}`,
            order_id: trimmedOrderId,
            sku_id: item.sku || 'N/A',
            item_name: optimizedName || 'Unknown',
            quantity: item.quantity || 0,
            completed: order.status_description === 'Despatched',
            foamsheet: foamSheet,
            extra_info: item.options || 'N/A',
            priority,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          };
        });
        return acc;
      }, {} as Record<string, OrderItem[]>);

      const totalOrderItems = Object.values(orderItems).reduce((sum, items) => sum + items.length, 0);
      
      console.log(`Total order items to process: ${totalOrderItems}`);

      //STEP 1: Check for existing orders in both tables before upserting
      console.log('Checking for existing orders in both tables...');
      
      // Get existing order IDs from both tables
      const { data: existingActiveOrders, error: activeCheckError } = await supabase
        .from('orders')
        .select('order_id');
      
      const { data: existingArchivedOrders, error: archivedCheckError } = await supabase
        .from('archived_orders')
        .select('order_id');
      
      if (activeCheckError || archivedCheckError) {
        console.error('Error checking existing orders:', activeCheckError || archivedCheckError);
        throw new Error(`Failed to check existing orders: ${(activeCheckError || archivedCheckError)?.message}`);
      }
      
      const existingActiveOrderIds = new Set(existingActiveOrders?.map(o => o.order_id) || []);
      const existingArchivedOrderIds = new Set(existingArchivedOrders?.map(o => o.order_id) || []);
      
      console.log(`Found ${existingActiveOrderIds.size} active orders and ${existingArchivedOrderIds.size} archived orders`);
      
      // Filter orders to insert/update for each table
      const ordersToUpsertActive = orders.filter(order => 
        (order.status === 'Pending' || !order.status) && 
        !existingArchivedOrderIds.has(order.order_id)
      );
      
      const ordersToUpsertArchived = orders.filter(order => 
        order.status === 'Despatched' && 
        !existingActiveOrderIds.has(order.order_id) &&
        !existingArchivedOrderIds.has(order.order_id)
      );
      
      // Orders that need status updates (i.e., changed from Pending to Despatched)
      const ordersToMove = orders.filter(order => 
        order.status === 'Despatched' && 
        existingActiveOrderIds.has(order.order_id) &&
        !existingArchivedOrderIds.has(order.order_id)
      );
      
      console.log(`Orders to upsert in active table: ${ordersToUpsertActive.length}`);
      console.log(`Orders to upsert in archived table: ${ordersToUpsertArchived.length}`);
      console.log(`Orders to move from active to archived: ${ordersToMove.length}`);

      //STEP 2: Upsert orders into appropriate tables
      console.log('Upserting orders to respective tables...');
      
      // Split orders into batches to avoid payload size issues
      const batchSize = 50;
      
      // Upsert active orders
      if (ordersToUpsertActive.length > 0) {
        console.log('Processing active orders...');
        
        // First, get all existing orders to check IDs
        const { data: existingOrders, error: fetchError } = await supabase
          .from('orders')
          .select('id, order_id')
          .in('order_id', ordersToUpsertActive.map(o => o.order_id));
          
        if (fetchError) {
          console.error('Error fetching existing orders:', fetchError);
          throw new Error(`Failed to fetch existing orders: ${fetchError.message}`);
        }
        
        // Create a map of order_id to database id for quick lookup
        const existingOrderMap = new Map(existingOrders?.map(o => [o.order_id, o.id]) || []);
        
        // Separate orders that need insert vs just status update
        const newOrders = [];
        const ordersToUpdateStatus = [];
        
        for (const order of ordersToUpsertActive) {
          if (existingOrderMap.has(order.order_id)) {
            // For existing orders, only update the status and other key fields
            ordersToUpdateStatus.push({
              id: existingOrderMap.get(order.order_id),
              order_id: order.order_id,
              status: order.status,
              items_completed: order.items_completed,
              updated_at: new Date().toISOString()
            });
          } else {
            // New orders to insert
            newOrders.push(order);
          }
        }
        
        // Process new orders in batches
        if (newOrders.length > 0) {
          console.log(`Inserting ${newOrders.length} new orders...`);
          for (let i = 0; i < newOrders.length; i += batchSize) {
            const batch = newOrders.slice(i, i + batchSize);
            
            // Remove the 'id' field from each order to let Supabase auto-generate the primary key
            const batchWithoutIds = batch.map(order => {
              // eslint-disable-next-line @typescript-eslint/no-unused-vars
              const { id, ...orderWithoutId } = order;
              return orderWithoutId;
            });
            
            const { error: insertError } = await supabase
              .from('orders')
              .insert(batchWithoutIds);
            
            if (insertError) {
              console.error('New orders insert error:', insertError);
              throw new Error(`New orders insert failed: ${insertError.message}`);
            }
            console.log(`Successfully inserted batch ${Math.floor(i/batchSize) + 1} of new orders`);
          }
        }
        
        // Process status updates in batches
        if (ordersToUpdateStatus.length > 0) {
          console.log(`Updating status for ${ordersToUpdateStatus.length} existing orders...`);
          for (let i = 0; i < ordersToUpdateStatus.length; i += batchSize) {
            const batch = ordersToUpdateStatus.slice(i, i + batchSize);
            const { error: updateError } = await supabase
              .from('orders')
              .upsert(batch, {
                onConflict: 'id'
              });
            
            if (updateError) {
              console.error('Order status update error:', updateError);
              throw new Error(`Order status update failed: ${updateError.message}`);
            }
            console.log(`Successfully updated status for batch ${Math.floor(i/batchSize) + 1} of existing orders`);
          }
        }
      }
      
      // Upsert archived orders
      if (ordersToUpsertArchived.length > 0) {
        console.log('Upserting directly to archived orders table...');
        for (let i = 0; i < ordersToUpsertArchived.length; i += batchSize) {
          const batch = ordersToUpsertArchived.slice(i, i + batchSize);
          
          // Prepare the batch by removing manufactured, packed, and id fields
          const cleanedBatch = batch.map(order => {
            // Create a new object without the manufactured, packed, and id fields
            // eslint-disable-next-line @typescript-eslint/no-unused-vars
            const { manufactured, packed, id, ...cleanedOrder } = order;
            return cleanedOrder;
          });
          
          // Insert into archived_orders
          const { error: insertError } = await supabase
            .from('archived_orders')
            .upsert(cleanedBatch, {
              onConflict: 'order_id'
            });
          
          if (insertError) {
            console.error('Error upserting to archived orders:', insertError);
          } else {
            console.log(`Successfully upserted batch ${i/batchSize + 1} of archived orders`);
          }
        }
      }

      // Move orders from active to archived
      if (ordersToMove.length > 0) {
        console.log('Moving orders from active to archived...');
        for (let i = 0; i < ordersToMove.length; i += batchSize) {
          const batch = ordersToMove.slice(i, i + batchSize);
          
          // Prepare the batch by removing manufactured, packed, and id fields
          const cleanedBatch = batch.map(order => {
            // Create a new object without the manufactured, packed, and id fields
            // eslint-disable-next-line @typescript-eslint/no-unused-vars
            const { manufactured, packed, id, ...cleanedOrder } = order;
            return cleanedOrder;
          });
          
          // First insert into archived_orders
          const { error: insertError } = await supabase
            .from('archived_orders')
            .upsert(cleanedBatch, {
              onConflict: 'order_id'
            });
          
          if (insertError) {
            console.error('Error moving orders to archived:', insertError);
            continue;
          }
          
          // Then delete from orders table
          const batchOrderIds = batch.map(o => o.order_id);
          const { error: deleteError } = await supabase
            .from('orders')
            .delete()
            .in('order_id', batchOrderIds);
          
          if (deleteError) {
            console.error('Error deleting moved orders from active table:', deleteError);
          } else {
            console.log(`Successfully moved batch ${i/batchSize + 1} of orders to archived`);
          }
        }
      }

      // Add a longer delay to ensure orders are committed
      console.log('Waiting for orders to be committed...');
      await new Promise(resolve => setTimeout(resolve, 2000));

      // Update our tracking of which orders are where
      existingArchivedOrderIds.forEach(id => existingActiveOrderIds.delete(id));
      ordersToUpsertArchived.forEach(order => existingArchivedOrderIds.add(order.order_id));
      ordersToMove.forEach(order => {
        existingActiveOrderIds.delete(order.order_id);
        existingArchivedOrderIds.add(order.order_id);
      });
      ordersToUpsertActive.forEach(order => {
        if (!existingActiveOrderIds.has(order.order_id)) {
          existingActiveOrderIds.add(order.order_id);
        }
      });

      // Verify orders exist with retries, checking both tables
      let verifiedOrders = null;
      let retryCount = 0;
      const maxRetries = 3;

      while (retryCount < maxRetries) {
        // Check both orders and archived_orders tables
        const { data: activeOrders, error: activeError } = await supabase
          .from('orders')
          .select('order_id')
          .in('order_id', orders.map(o => o.order_id));

        const { data: archivedOrders, error: archivedError } = await supabase
          .from('archived_orders')
          .select('order_id')
          .in('order_id', orders.map(o => o.order_id));

        if (activeError || archivedError) {
          console.error(`Error verifying orders (attempt ${retryCount + 1}):`, activeError || archivedError);
          retryCount++;
          if (retryCount < maxRetries) {
            console.log('Retrying verification after delay...');
            await new Promise(resolve => setTimeout(resolve, 5000));
            continue;
          }
          throw new Error(`Failed to verify orders after ${maxRetries} attempts: ${(activeError || archivedError)?.message}`);
        }

        // Combine results from both tables
        verifiedOrders = [...(activeOrders || []), ...(archivedOrders || [])];
        console.log(`Verified ${verifiedOrders.length} orders on attempt ${retryCount + 1}`);
        break;
      }

      if (!verifiedOrders) {
        throw new Error('Failed to verify orders after all retries');
      }

      // Log the verification results
      console.log('Verified order IDs:', Array.from(verifiedOrders.map(o => o.order_id)));
      console.log('Total orders to process:', orders.length);
      console.log('Orders found in database:', verifiedOrders.length);

      // Only consider orders as missing if they are not in either table
      const missingOrders = orders.filter(o => !verifiedOrders.some(vo => vo.order_id === o.order_id));
      
      if (missingOrders.length > 0) {
        console.error('Some orders failed to be inserted:', missingOrders);
        
        // Log more detailed information about each missing order to help with debugging
        missingOrders.forEach(order => {
          console.error(`Failed order details - ID: "${order.order_id}", Length: ${order.order_id.length}, Status: "${order.status}"`);
        });
        
        throw new Error(`Failed to insert ${missingOrders.length} orders`);
      }

      //STEP 2: Handle order items with separate insert and update
      console.log('Processing order items for Supabase...');
      
      // First, get all existing order items from both tables
      const { data: existingOrderItems, error: fetchExistingItemsError } = await supabase
        .from('order_items')
        .select('id');
      
      const { data: existingArchivedItems, error: fetchExistingArchivedItemsError } = await supabase
        .from('archived_order_items')
        .select('id');

      if (fetchExistingItemsError || fetchExistingArchivedItemsError) {
        console.error('Error fetching existing items:', fetchExistingItemsError || fetchExistingArchivedItemsError);
        throw new Error(`Failed to fetch existing items: ${(fetchExistingItemsError || fetchExistingArchivedItemsError)?.message}`);
      }

      const existingItemIds = new Set(existingOrderItems?.map(item => item.id) || []);
      const existingArchivedItemIds = new Set(existingArchivedItems?.map(item => item.id) || []);
      
      console.log(`Found ${existingItemIds.size} active items and ${existingArchivedItemIds.size} archived items`);
      
      // Prepare arrays for insert and update operations
      const itemsToInsertActive: OrderItem[] = [];
      const itemsToUpdateActive: OrderItem[] = [];
      const itemsToInsertArchived: OrderItem[] = [];
      const itemsToUpdateArchived: OrderItem[] = [];
      const itemsToMoveToArchived: OrderItem[] = [];

      for (const orderId in orderItems) {
        const items = orderItems[orderId];
        
        // Skip if order doesn't exist in either table
        if (!existingActiveOrderIds.has(orderId) && !existingArchivedOrderIds.has(orderId)) {
          console.warn(`Skipping items for non-existent order: ${orderId}`);
          continue;
        }

        const orderIsArchived = existingArchivedOrderIds.has(orderId);
        
        items.forEach(item => {
          const itemId = item.id;
          const itemExistsInActive = existingItemIds.has(itemId);
          const itemExistsInArchived = existingArchivedItemIds.has(itemId);

          if (orderIsArchived) {
            // Order is in archived_orders table
            if (itemExistsInArchived) {
              itemsToUpdateArchived.push(item);
            } else {
              // Create a unique hash ID for this archived item
              const uniqueString = `${item.order_id}-${item.sku_id}`;
              let hash = 0;
              for (let i = 0; i < uniqueString.length; i++) {
                const char = uniqueString.charCodeAt(i);
                hash = ((hash << 5) - hash) + char;
                hash = hash & hash; // Convert to 32bit integer
              }
              const positiveHash = Math.abs(hash) % 2147483647;
              
              itemsToInsertArchived.push({
                ...item,
                id: positiveHash.toString()
              });
            }
            
            // If the item exists in active but the order is now archived, we need to delete it from active
            if (itemExistsInActive) {
              // Will handle this in a separate deletion step
              itemsToMoveToArchived.push(item);
            }
          } else {
            // Order is in active orders table
            if (itemExistsInActive) {
              itemsToUpdateActive.push(item);
            } else {
              itemsToInsertActive.push(item);
            }
          }
        });
      }

      console.log(`Items to insert in active table: ${itemsToInsertActive.length}`);
      console.log(`Items to update in active table: ${itemsToUpdateActive.length}`);
      console.log(`Items to insert in archived table: ${itemsToInsertArchived.length}`);
      console.log(`Items to update in archived table: ${itemsToUpdateArchived.length}`);
      console.log(`Items to move from active to archived: ${itemsToMoveToArchived.length}`);

      // Insert new active items in batches
      if (itemsToInsertActive.length > 0) {
        console.log(`Inserting ${itemsToInsertActive.length} new active items in batches`);
        for (let i = 0; i < itemsToInsertActive.length; i += batchSize) {
          const batch = itemsToInsertActive.slice(i, i + batchSize);
          const { error: insertError } = await supabase
            .from('order_items')
            .insert(batch);
          
          if (insertError) {
            console.error('Error inserting new active items:', insertError);
            console.error('Failed batch:', batch);
            throw new Error(`Failed to insert new active items: ${insertError.message}`);
          }
          console.log(`Successfully inserted batch ${i/batchSize + 1} of active items`);
        }
      }

      // Insert items for archived orders
      if (itemsToInsertArchived.length > 0) {
        console.log(`Inserting ${itemsToInsertArchived.length} items for archived orders`);
        
        // First, get the existing archived item IDs to check for duplicates
        const allItemIds = new Set<string>();
        const { data: existingIDs, error: existingIDsError } = await supabase
          .from('archived_order_items')
          .select('id');
        
        if (!existingIDsError && existingIDs) {
          existingIDs.forEach(item => allItemIds.add(item.id.toString()));
          console.log(`Found ${allItemIds.size} existing archived item IDs`);
        }
        
        // Process items in batches
        for (let i = 0; i < itemsToInsertArchived.length; i += batchSize) {
          const batch = itemsToInsertArchived.slice(i, i + batchSize);
          
          // Create unique IDs that won't conflict, using a more robust method
          const processedBatch = batch.map(item => {
            // Create a unique string that includes more varied information
            const uniqueString = `${item.order_id}-${item.sku_id}-${item.item_name.substring(0, 10)}`;
            
            // More robust hash function
            let hash = 0;
            const prime = 31;
            for (let i = 0; i < uniqueString.length; i++) {
              hash = Math.imul(hash, prime) + uniqueString.charCodeAt(i);
            }
            
            // Ensure positive number and within safe integer range with more entropy
            const positiveHash = Math.abs(hash) % 1000000000;
            
            // Make sure the ID doesn't already exist
            let finalId = positiveHash;
            let attempt = 0;
            while (allItemIds.has(finalId.toString()) && attempt < 10) {
              // If there's a collision, modify the hash slightly
              finalId = (positiveHash + attempt * 1000 + Math.floor(Math.random() * 1000)) % 2147483647;
              attempt++;
            }
            
            // Add this ID to our set to avoid future collisions
            allItemIds.add(finalId.toString());
            
            return {
              ...item,
              id: finalId
            };
          });
          
          // Use upsert with onConflict instead of insert
          const { error: archiveError } = await supabase
            .from('archived_order_items')
            .upsert(processedBatch, {
              onConflict: 'id',
              ignoreDuplicates: true
            });
          
          if (archiveError) {
            console.error('Error upserting archived items:', archiveError);
            console.error('Failed batch:', processedBatch);
            console.warn('Continue with sync despite archived items insertion error');
            // Don't throw here to allow the process to continue
          } else {
            console.log(`Successfully upserted batch ${Math.floor(i/batchSize) + 1} of archived items`);
          }
        }
      }

      // Update existing active items in batches
      if (itemsToUpdateActive.length > 0) {
        console.log(`Updating ${itemsToUpdateActive.length} existing active items`);
        for (let i = 0; i < itemsToUpdateActive.length; i += batchSize) {
          const batch = itemsToUpdateActive.slice(i, i + batchSize);
          for (const item of batch) {
            const { error: updateError } = await supabase
              .from('order_items')
              .update({
                quantity: item.quantity,
                completed: item.completed,
                priority: item.priority,
                updated_at: item.updated_at
              })
              .eq('id', item.id);
            
            if (updateError) {
              console.error(`Error updating active item ${item.id}:`, updateError);
              // Continue with other updates even if one fails
            }
          }
          console.log(`Successfully updated batch ${i/batchSize + 1} of active items`);
        }
      }

      // Update existing archived items in batches
      if (itemsToUpdateArchived.length > 0) {
        console.log(`Updating ${itemsToUpdateArchived.length} existing archived items`);
        for (let i = 0; i < itemsToUpdateArchived.length; i += batchSize) {
          const batch = itemsToUpdateArchived.slice(i, i + batchSize);
          for (const item of batch) {
            const { error: updateError } = await supabase
              .from('archived_order_items')
              .update({
                quantity: item.quantity,
                completed: item.completed,
                priority: item.priority,
                updated_at: item.updated_at
              })
              .eq('id', item.id);
            
            if (updateError) {
              console.error(`Error updating archived item ${item.id}:`, updateError);
              // Continue with other updates even if one fails
            }
          }
          console.log(`Successfully updated batch ${i/batchSize + 1} of archived items`);
        }
      }

      // Handle items that need to be moved from active to archived
      if (itemsToMoveToArchived.length > 0) {
        console.log(`Moving ${itemsToMoveToArchived.length} items from active to archived`);
        
        // First, prepare these items with proper IDs for the archived table
        const processedItemsToMove = itemsToMoveToArchived.map(item => {
          const uniqueString = `${item.order_id}-${item.sku_id}`;
          let hash = 0;
          for (let i = 0; i < uniqueString.length; i++) {
            const char = uniqueString.charCodeAt(i);
            hash = ((hash << 5) - hash) + char;
            hash = hash & hash;
          }
          const positiveHash = Math.abs(hash) % 2147483647;
          
          return {
            ...item,
            id: positiveHash.toString()
          };
        });
        
        // Insert into archived_order_items in batches
        for (let i = 0; i < processedItemsToMove.length; i += batchSize) {
          const batch = processedItemsToMove.slice(i, i + batchSize);
          const { error: insertError } = await supabase
            .from('archived_order_items')
            .insert(batch);
          
          if (insertError) {
            console.error('Error moving items to archived:', insertError);
            console.warn('Continuing despite error moving items');
          } else {
            // Delete from order_items
            const itemIds = itemsToMoveToArchived.slice(i, i + batchSize).map(item => item.id);
            const { error: deleteError } = await supabase
              .from('order_items')
              .delete()
              .in('id', itemIds);
            
            if (deleteError) {
              console.error('Error deleting moved items from active table:', deleteError);
            } else {
              console.log(`Successfully moved batch ${i/batchSize + 1} of items to archived`);
            }
          }
        }
      }

      // Step 3: No need for a separate "Archive Completed Orders" step since we already handled it above
        
        //Fetch updated data
        console.log('Fetching updated data from Supabase...');
        
      const { data: updatedOrders, error: fetchUpdatedOrdersError } = await supabase
          .from('orders')
          .select('*')
          .eq('status', 'Pending'); // Only fetch pending orders

      if(fetchUpdatedOrdersError) {
        console.error('Fetch orders error:', fetchUpdatedOrdersError);
        throw new Error(`Fetch orders failed: ${fetchUpdatedOrdersError.message}`);
      }

      const { data: updatedItems, error: fetchUpdatedItemsError } = await supabase
          .from('order_items')
          .select('*');
      if(fetchUpdatedItemsError) {
        console.error('Fetch items error: ', fetchUpdatedItemsError);
        throw new Error(`Fetch items failed: ${fetchUpdatedItemsError.message}`);
      }

      console.log(`Fetched ${updatedItems?.length || 0} order items from Supabase`);

      const updatedOrderItems = (updatedItems || []).reduce((acc, item) => {
          acc[item.order_id] = acc[item.order_id] || [];
          acc[item.order_id].push(item);
          return acc;
        }, {} as Record<string, OrderItem[]>);

    console.log('Sync completed successfully');
    return {
      orders: updatedOrders || orders,
      orderItems: updatedOrderItems || orderItems,
      total,
      last_page: lastPage,
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
    view?: 'manufacturing' | 'packing' | 'archived';
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

    // Fetch order items for all orders
    const allOrderIds = allOrders.map(o => o.order_id);

    const { data: allOrderItems, error: itemsError } = await supabase
      .from('order_items')
      .select('*')
      .in('order_id', allOrderIds);

    if (itemsError) throw new Error(`Fetch items failed: ${itemsError.message}`);
    console.log(`Fetched ${allOrderItems?.length || 0} order items for ${allOrderIds.length} orders`);

    // Create a map of all order items
    const allOrderItemsMap = (allOrderItems || []).reduce((acc, item) => {
      acc[item.order_id] = acc[item.order_id] || [];
      acc[item.order_id].push({
        ...item,
        completed: item.completed || false  // Ensure completed is always a boolean
      });
      return acc;
    }, {} as Record<string, OrderItem[]>);

    // Calculate priority for each order based on its items and sort ALL orders
    const ordersWithPriority = allOrders.map(order => {
      const items = allOrderItemsMap[order.order_id] || [];
      const priority = items.length > 0 
        ? Math.max(...items.map((item: OrderItem) => item.priority || 0)) 
        : 0;
      return { ...order, calculatedPriority: priority } as OrderWithPriority;
    });

    // Sort ALL orders by priority in descending order
    const sortedOrders = ordersWithPriority.sort((a, b) => 
      b.calculatedPriority - a.calculatedPriority
    );

    // Now apply pagination to the sorted orders
    const startIndex = (page - 1) * perPage;
    const endIndex = startIndex + perPage;
    const paginatedOrders = sortedOrders.slice(startIndex, endIndex);

    console.log(`Applied pagination: showing orders ${startIndex+1} to ${Math.min(endIndex, sortedOrders.length)} of ${sortedOrders.length}`);

    // Create a map of order items for just the paginated orders
    const paginatedOrderIds = paginatedOrders.map(o => o.order_id);
    const paginatedOrderItemsMap = paginatedOrderIds.reduce((acc, orderId) => {
      if (allOrderItemsMap[orderId]) {
        acc[orderId] = allOrderItemsMap[orderId];
      }
      return acc;
    }, {} as Record<string, OrderItem[]>);

    return { 
      orders: paginatedOrders, 
      orderItems: paginatedOrderItemsMap, 
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

    const orderItemsMap = orderItems.reduce((acc, item) => {
      acc[item.order_id] = acc[item.order_id] || [];
      acc[item.order_id].push(item);
      return acc;
    }, {} as Record<string, OrderItem[]>);

    const csvContent = generateCSV(orders, orderItemsMap);
    downloadCSV(csvContent, `pending_orders_${new Date().toISOString().split("T")[0]}.csv`);

    return { orders, orderItems: orderItemsMap }; //Return data to update state if needed
  }
);

// Slice
const ordersSlice = createSlice({
  name: 'orders',
  initialState,
  reducers: {
    setSelectedOrderId: (state, action: PayloadAction<string | null>) => {
      state.selectedOrderId = action.payload;
    },
    updateOrderStatus: (
      state,
      action: PayloadAction<{ orderId: string; status: 'Pending' | 'Completed' }>
    ) => {
      const order = state.allOrders.find(o => o.order_id === action.payload.orderId);
      if (order) order.status = action.payload.status;
    },
    updateItemCompleted: (
      state,
      action: PayloadAction<{ orderId: string; itemId: string; completed: boolean }>
    ) => {
      const orderId = action.payload.orderId;
      const itemId = action.payload.itemId;
      const completed = action.payload.completed;
      const items = state.orderItems[orderId];
      
      if (items) {
        const item = items.find(i => i.id === itemId);
        if (item) {
          // Only update if the value is actually different
          if (item.completed !== completed) {
            item.completed = completed;
            
            // Calculate the new items_completed count
            const newCompletedCount = items.filter(i => i.completed).length;
            
            // Update items_completed in allOrders
            const orderInAllOrders = state.allOrders.find(o => o.order_id === orderId);
            if (orderInAllOrders) {
              orderInAllOrders.items_completed = newCompletedCount;
            }
            
            // Update items_completed in manufacturingOrders
            const orderInManufacturing = state.manufacturingOrders.find(o => o.order_id === orderId);
            if (orderInManufacturing) {
              orderInManufacturing.items_completed = newCompletedCount;
            }
            
            // Update items_completed in packingOrders
            const orderInPacking = state.packingOrders.find(o => o.order_id === orderId);
            if (orderInPacking) {
              orderInPacking.items_completed = newCompletedCount;
            }
            
            // Update the item in Supabase
            supabase
              .from('order_items')
              .update({ 
                completed: completed, 
                updated_at: new Date().toISOString() 
              })
              .eq('id', itemId)
              .then(({ error }) => {
                if (error) {
                  console.error('Error updating item in Supabase:', error);
                  // Revert the change if the update failed
                  item.completed = !completed;
                  
                  // Recalculate the items_completed count
                  const originalCompletedCount = items.filter(i => i.completed).length;
                  
                  // Update all arrays with original count
                  if (orderInAllOrders) {
                    orderInAllOrders.items_completed = originalCompletedCount;
                  }
                  if (orderInManufacturing) {
                    orderInManufacturing.items_completed = originalCompletedCount;
                  }
                  if (orderInPacking) {
                    orderInPacking.items_completed = originalCompletedCount;
                  }
                }
              });
          }
        }
      }
    },
    setSyncStatus: (state, action: PayloadAction<'idle' | 'syncing' | 'error'>) => {
      state.syncStatus = action.payload;
    },
    addOrder: (state, action: PayloadAction<Order>) => {
      state.allOrders.push(action.payload);
      state.totalOrders += 1;   
    },
    updateOrder: (state, action: PayloadAction<Order>) => {
      const index = state.allOrders.findIndex((o) => o.order_id === action.payload.order_id);
      if (index !== -1) state.allOrders[index] = action.payload;
    },
    removeOrder: (state, action: PayloadAction<{ order_id: string }>) => {
      state.allOrders = state.allOrders.filter((o) => o.order_id !== action.payload.order_id);
      state.totalOrders -= 1;
      if (state.selectedOrderId === action.payload.order_id) state.selectedOrderId = null;
    },
    addOrderItem: (state, action: PayloadAction<OrderItem>) => {
      const orderId = action.payload.order_id;
      if (!state.orderItems[orderId]) state.orderItems[orderId] = [];
      state.orderItems[orderId].push(action.payload);
      const order = state.allOrders.find((o) => o.order_id === orderId);
      if(order) order.total_items += 1;
    },
    removeOrderItem: (state, action: PayloadAction<{ order_id: string; id: string }>) => {
      const orderId = action.payload.order_id;
      if (state.orderItems[orderId]) {
        state.orderItems[orderId] = state.orderItems[orderId].filter(
          (item) => item.id !== action.payload.id
        );
        const order = state.allOrders.find((o) => o.order_id === orderId);
        if (order) {
          order.total_items -= 1;
          order.items_completed = state.orderItems[orderId].filter((i) => i.completed).length;
        }
      }
    },
    setCurrentView: (state, action: PayloadAction<'manufacturing' | 'packing' | 'archived'>) => {
      state.currentView = action.payload;
    },
  },
  extraReducers: builder => {
    builder
      .addCase(syncOrders.pending, state => {
        state.loading = true;
        state.error = null;
      })
      .addCase(syncOrders.fulfilled, (state, action) => {
        state.allOrders = action.payload.orders;
        state.orderItems = action.payload.orderItems;
        state.totalOrders = action.payload.total;
        state.loading = false;
        state.syncStatus = 'idle';
      })
      .addCase(syncOrders.rejected, (state, action) => {
        state.loading = false;
        state.error = action.error.message || 'Failed to sync orders';
        state.syncStatus = 'error';
      })
      .addCase(fetchOrdersFromSupabase.pending, state => {
        state.loading = true;
        state.error = null;
      })
      .addCase(fetchOrdersFromSupabase.fulfilled, (state, action) => {
        const { orders, orderItems, total, page, view } = action.payload;
        
        // Update state based on view
        if (view === 'manufacturing') {
          state.manufacturingOrders = orders;
          state.totalManufacturingOrders = total;
        } else if (view === 'packing') {
          state.packingOrders = orders;
          state.totalPackingOrders = total;
        } else {
          // Default or 'all' view
          state.allOrders = orders;
          state.totalOrders = total;
        }
        
        // Update orderItems
        state.orderItems = { ...state.orderItems, ...orderItems };
        state.currentPage = page;
        state.loading = false;
      })
      .addCase(fetchOrdersFromSupabase.rejected, (state, action) => {
        state.loading = false;
        state.error = action.error.message || 'Failed to fetch orders';
      })    
      //CASES FOR CSV DOWNLOAD     
      .addCase(exportPendingOrdersCSV.pending, state => {
        state.loading = true;
        state.error = null;
      })
      .addCase(exportPendingOrdersCSV.fulfilled, (state, action) => {
        state.loading = false;
        //Optionally update state with fetched data
        state.allOrders = action.payload.orders;
        state.orderItems = action.payload.orderItems;
      })
      .addCase(exportPendingOrdersCSV.rejected, (state, action) => {
        state.loading = false;
        state.error = action.error.message || 'Failed to export CSV';
      });
  },
});

export const { 
  setSelectedOrderId, 
  updateOrderStatus, 
  updateItemCompleted, 
  setSyncStatus,
  addOrder,
  updateOrder,
  removeOrder,
  addOrderItem,
  removeOrderItem, 
  setCurrentView, 
} = ordersSlice.actions;
export default ordersSlice.reducer;



// Selectors
const selectOrdersState = (state: RootState) => state.orders;

export const selectAllOrders = createSelector([selectOrdersState], orders => orders.allOrders);

export const selectManufacturingOrders = createSelector(
  [selectOrdersState], 
  state => state.manufacturingOrders
);

export const selectPackingOrders = createSelector(
  [selectOrdersState], 
  state => state.packingOrders
);

export const selectCurrentViewOrders = createSelector(
  [selectOrdersState],
  state => {
    switch (state.currentView) {
      case 'manufacturing':
        return state.manufacturingOrders;
      case 'packing':
        return state.packingOrders;
      default:
        return state.allOrders;
    }
  }
);

export const selectCurrentViewTotal = createSelector(
  [selectOrdersState],
  state => {
    switch (state.currentView) {
      case 'manufacturing':
        return state.totalManufacturingOrders;
      case 'packing':
        return state.totalPackingOrders;
      default:
        return state.totalOrders;
    }
  }
);

export const selectSortedOrders = createSelector(
  [selectAllOrders, selectOrdersState],
  (orders, state) => {
    const sorted = orders
      .map(order => {
        const items = state.orderItems[order.order_id] || [];
        const priority = items.length > 0 ? Math.max(...items.map((item: OrderItem) => item.priority || 0)) : 0;
        return { ...order, priority };
      })
      .sort((a, b) => b.priority - a.priority);
    return sorted;
  }
);

export const selectPaginatedOrders = createSelector(
  [selectSortedOrders, selectOrdersState],
  (sortedOrders, state) => {
    const start = (state.currentPage - 1) * state.ordersPerPage;
    const end = start + state.ordersPerPage;
    const paginated = sortedOrders.slice(start, end);
    return paginated;
  }
);

export const selectOrderItemsById = (orderId: string) =>
  createSelector([selectOrdersState], orders => orders.orderItems[orderId] || []);

export const selectOrderProgress = (orderId: string) =>
  createSelector([selectOrdersState], orders => {
    // First check in manufacturing orders
    let order = orders.manufacturingOrders.find((o) => o.order_id === orderId);
    
    // If not found, check in packing orders
    if (!order) {
      order = orders.packingOrders.find((o) => o.order_id === orderId);
    }
    
    // If still not found, check in allOrders
    if (!order) {
      order = orders.allOrders.find((o) => o.order_id === orderId);
    }
    
    // Handle the order properties regardless of whether calculatedPriority exists
    if (order) {
      return `${order.items_completed}/${order.total_items}`;
    }
    
    return 'N/A';
  });

export const selectArchivedOrders = createSelector(
  [selectOrdersState],
  async () => {
    const { data: archivedOrders, error } = await supabase
      .from('archived_orders')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) {
      console.error('Error fetching archived orders:', error);
      return { orders: [], orderItems: {} };
    }

    // Fetch items for each archived order
    const orderItems: Record<string, OrderItem[]> = {};
    
    if (archivedOrders && archivedOrders.length > 0) {
      const orderIds = archivedOrders.map(order => order.order_id);
      
      // Use a single query to get all items at once
      const { data: items, error: itemsError } = await supabase
        .from('archived_order_items')
        .select('*')
        .in('order_id', orderIds);

      if (itemsError) {
        console.error(`Error fetching archived items:`, itemsError);
      } else if (items) {
        // Group items by order_id
        items.forEach(item => {
          if (!orderItems[item.order_id]) {
            orderItems[item.order_id] = [];
          }
          orderItems[item.order_id].push(item);
        });
      }
    }

    return {
      orders: archivedOrders || [],
      orderItems
    };
  }
);
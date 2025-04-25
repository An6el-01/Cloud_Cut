import { createAsyncThunk } from '@reduxjs/toolkit';
import { Order, OrderItem } from '@/types/redux';
import { fetchOrders } from '@/utils/despatchCloud';
import { supabase } from '@/utils/supabase';
import { getFoamSheetFromSKU } from '@/utils/skuParser';
import { DespatchCloudOrder } from '@/types/despatchCloud';
import { getPriorityLevel, isAmazonOrder, calculateDayNumber } from '@/utils/priority'; 
import { optimizeItemName } from '@/utils/optimizeItemName';
import { downloadCSV, generateCSV } from '@/utils/exportCSV';
import { processItemsForOrders } from '../utils/orderUtils';
import { setSyncStatus } from '../slices/ordersSlice';

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

      console.log('Processing order items...');
      const orderItems: Record<string, OrderItem[]> = allOrders.reduce((acc, order) => {
        const inventory = order.inventory || [];

        // Skip orders with null status or no order_id
        if (!order.status || !order.channel_order_id) {
          return acc;
        }

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

      //********* STEP 1: Fetch existing orders from Supabase *********
      console.log('STEP 1: Fetching all existing orders from Supabase...');
      
      // Get ALL order IDs from both active and archived tables - important to do this first
      const { data: existingActiveOrders, error: activeOrdersError } = await supabase
          .from('orders')
          .select('id, order_id, status');

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
            
            ordersToUpdate.push({
              id: activeOrderMap.get(order_id) as number | undefined,
              order_id: order_id, // Important: include order_id field
              status: updatedStatus,
              updated_at: new Date().toISOString()
            });
          }
          // Don't track active orders as newly added since they already exist
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
          
          // Log a sample of what we're updating
          if (i === 0) {
            console.log('Update sample:', batch[0]);
          }
          
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
        
        // We'll use upsert instead of insert to handle any potential race conditions
        // where orders might have been added in between our checks
        console.log('Using upsert strategy to prevent duplicates and conflicts');
        
        // Track successful insertions
        let successfulInsertions = 0;
        
        for (let i = 0; i < ordersToInsert.length; i += batchSize) {
          const batch = ordersToInsert.slice(i, i + batchSize);
          
          // Log a sample of what we're inserting
          if (i === 0) {
            console.log('Insert sample:', batch[0]);
          }
          
          try {
            // eslint-disable-next-line @typescript-eslint/no-unused-vars
            const { data, error } = await supabase
              .from('orders')
              .upsert(batch as unknown as Record<string, unknown>[], { 
                onConflict: 'order_id',
                ignoreDuplicates: false
              });
            
            if (error) {
              console.error(`Error inserting batch ${Math.floor(i/batchSize) + 1}:`, error);
              // Continue with next batch instead of failing completely
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
      console.log(`Found ${newlyAddedOrderIds.length} new order IDs for item processing`);
      
      // Only process items for newly added orders
      if (newlyAddedOrderIds.length > 0) {
        // We'll fetch all existing orders regardless of isArchived flag 
        // to properly distribute items to the correct tables
        console.log(`Fetching all order information for proper item distribution...`);
        
        // Process items using the optimized orderUtils function
        try {
          // We intentionally set isArchived to false here as the processItemsForOrders function
          // will automatically check both tables and insert items appropriately
          const itemsInserted = await processItemsForOrders(
            supabase, 
            newlyAddedOrderIds, 
            orderItems, 
            false // isArchived flag is not needed anymore as the function checks both tables
          );
          
          console.log(`Finished processing items for ${newlyAddedOrderIds.length} orders: inserted approximately ${itemsInserted} items`);
        } catch (error) {
          console.error('Error processing order items:', error);
          console.log('Continuing with sync despite item processing error');
        }
      }
      
      //********* STEP 5: Verify the orders were properly inserted *********
      console.log('STEP 5: Verifying orders in the database...');
      
      // Add a delay to ensure everything is committed
      console.log('Waiting for orders to be committed...');
      await new Promise(resolve => setTimeout(resolve, 5000));
      
      // Get updated counts from Supabase for both active and archived orders
      const { data: updatedActiveOrders, error: updatedActiveError } = await supabase
        .from('orders')
        .select('order_id');
        
      if (updatedActiveError) {
        console.error('Error fetching updated active orders:', updatedActiveError);
        throw new Error(`Failed to verify active orders: ${updatedActiveError.message}`);
      }
      
      const { data: updatedArchivedOrders, error: updatedArchivedError } = await supabase
        .from('archived_orders')
        .select('order_id');
        
      if (updatedArchivedError) {
        console.error('Error fetching updated archived orders:', updatedArchivedError);
        throw new Error(`Failed to verify archived orders: ${updatedArchivedError.message}`);
      }
      
      const updatedActiveOrderIds = new Set(updatedActiveOrders?.map(o => o.order_id) || []);
      const updatedArchivedOrderIds = new Set(updatedArchivedOrders?.map(o => o.order_id) || []);
      
      console.log(`Verification: Found ${updatedActiveOrderIds.size} active orders and ${updatedArchivedOrderIds.size} archived orders in the database`);
      
      // Check if the newly added orders are actually in either the active or archived database
      const missingOrderIds = newlyAddedOrderIds.filter(id => 
        !updatedActiveOrderIds.has(id) && !updatedArchivedOrderIds.has(id)
      );
      
      if (missingOrderIds.length > 0) {
        console.error(`Warning: ${missingOrderIds.length} of ${newlyAddedOrderIds.length} new orders were not found in either database after insertion`);
        if (missingOrderIds.length <= 20) {
          console.error('Missing order IDs:', missingOrderIds);
        } else {
          console.error('First 20 missing order IDs:', missingOrderIds.slice(0, 20));
        }
      } else if (newlyAddedOrderIds.length > 0) {
        console.log(`Success: All ${newlyAddedOrderIds.length} newly added orders were found in the database`);
      }
      
      // Count how many orders are in active vs archived
      const foundInActive = newlyAddedOrderIds.filter(id => updatedActiveOrderIds.has(id)).length;
      const foundInArchived = newlyAddedOrderIds.filter(id => updatedArchivedOrderIds.has(id)).length;
      console.log(`New orders found: ${foundInActive} in active table, ${foundInArchived} in archived table`);
      
      //********* STEP 6: Fetch final data for the Redux store *********
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

    // Calculate priority for each order based on its items and sort ALL orders
    const ordersWithPriority = allOrders.map(order => {
      const typedOrder = order as SupabaseOrderItem;
      const items = allOrderItemsMap[typedOrder.order_id] || [];
      const priority = items.length > 0 
        ? Math.max(...items.map(item => item.priority || 0)) 
        : 0;
      return { ...typedOrder, calculatedPriority: priority } as unknown as OrderWithPriority;
    });

    // Sort ALL orders by priority in descending order
    const sortedOrders = ordersWithPriority.sort((a, b) => 
      b.calculatedPriority - a.calculatedPriority
    );

    // We still calculate pagination info for the UI, but store ALL orders in state
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
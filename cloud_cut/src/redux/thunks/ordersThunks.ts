import { createAsyncThunk } from '@reduxjs/toolkit';
import { Order, OrderItem } from '@/types/redux';
import { fetchOrders } from '@/utils/despatchCloud';
import { supabase } from '@/utils/supabase';
import { getFoamSheetFromSKU } from '@/utils/skuParser';
import { DespatchCloudOrder } from '@/types/despatchCloud';
import { getPriorityLevel, isAmazonOrder, calculateDayNumber } from '@/utils/priority'; 
import { optimizeItemName } from '@/utils/optimizeItemName';
import { downloadCSV, generateCSV } from '@/utils/exportCSV';
import { processItemsForOrders, OrderItemData, OrderItemInfo } from '../utils/orderUtils';
import { setSyncStatus } from '../slices/ordersSlice';

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

      // Filter out cancelled orders to avoid issues
      const validOrders = orders.filter(order => order.status !== "Cancelled");
      const cancelledOrders = orders.filter(order => order.status === "Cancelled");
      console.log(`Filtered out ${cancelledOrders.length} cancelled orders out of ${orders.length} total orders`);

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
      console.log('Items to process:', Object.entries(orderItems).map(([orderId, items]) => ({
        orderId,
        itemCount: items.length,
        items: items.map(item => ({
          name: item.item_name,
          sku: item.sku_id,
          priority: item.priority
        }))
      })));

      //STEP 1: Check for existing orders in both tables before upserting
      console.log('Checking for existing orders in both tables...');
      
      // Get existing order IDs from both tables with retries
      let existingActiveOrderIds = new Set<string>();
      let existingArchivedOrderIds = new Set<string>();
      let fetchRetryCount = 0;
      const maxFetchRetries = 3;
      
      while (fetchRetryCount < maxFetchRetries) {
        try {
          const { data: existingActiveOrders, error: activeCheckError } = await supabase
            .from('orders')
            .select('order_id');
          
          const { data: existingArchivedOrders, error: archivedCheckError } = await supabase
            .from('archived_orders')
            .select('order_id');
          
          if (activeCheckError || archivedCheckError) {
            console.error(`Error checking existing orders (attempt ${fetchRetryCount + 1}):`, activeCheckError || archivedCheckError);
            fetchRetryCount++;
            
            if (fetchRetryCount < maxFetchRetries) {
              console.log('Retrying fetch of existing orders...');
              await new Promise(resolve => setTimeout(resolve, 2000 * fetchRetryCount));
              continue;
            }
            
            throw new Error(`Failed to check existing orders: ${(activeCheckError || archivedCheckError)?.message}`);
          }
          
          existingActiveOrderIds = new Set(existingActiveOrders?.map(o => o.order_id) || []);
          existingArchivedOrderIds = new Set(existingArchivedOrders?.map(o => o.order_id) || []);
          
          console.log(`Found ${existingActiveOrderIds.size} active orders and ${existingArchivedOrderIds.size} archived orders`);
          break;
        } catch (error) {
          console.error(`Unexpected error during order verification (attempt ${fetchRetryCount + 1}):`, error);
          fetchRetryCount++;
          
          if (fetchRetryCount < maxFetchRetries) {
            console.log('Retrying after error...');
            await new Promise(resolve => setTimeout(resolve, 2000 * fetchRetryCount));
          } else {
            throw new Error(`Failed to check existing orders after ${maxFetchRetries} attempts`);
          }
        }
      }

      // Filter orders to insert/update
      const ordersToUpsert = validOrders.filter(order => 
        !existingArchivedOrderIds.has(order.order_id)
      );

      console.log(`Orders to upsert to orders table: ${ordersToUpsert.length}`);

      //STEP 2: Upsert orders into orders table
      console.log('Upserting orders to orders table...');

      // Split orders into batches to avoid payload size issues
      const batchSize = 20; // Reduced from 50 to 20 for more reliable handling

      // Prepare orderItems by order ID for quick lookup
      const orderItemsByOrderId: Record<string, OrderItemData[]> = {};
      const orderItemsArray: OrderItemInfo[] = Object.entries(orderItems).map(([orderId, items]) => ({
        orderId,
        items: items.map(item => ({
          sku_id: item.sku_id,
          item_name: item.item_name,
          quantity: item.quantity,
          foamsheet: item.foamsheet,
          extra_info: item.extra_info,
          priority: item.priority
        }))
      }));

      orderItemsArray.forEach(info => {
        orderItemsByOrderId[info.orderId] = info.items;
      });

      // Upsert all orders to orders table
      if (ordersToUpsert.length > 0) {
        console.log('Processing orders for upsert...');
        
        // First, fetch all orders from both tables
        const { data: existingActiveOrders, error: activeError } = await supabase
          .from('orders')
          .select('id, order_id, status');
          
        if (activeError) {
          console.error('Error fetching active orders:', activeError);
          throw new Error(`Failed to fetch active orders: ${activeError.message}`);
        }

        const { data: existingArchivedOrders, error: archivedError } = await supabase
          .from('archived_orders') 
          .select('id, order_id');

        if (archivedError) {
          console.error('Error fetching archived orders:', archivedError);
          throw new Error(`Failed to fetch archived orders: ${archivedError.message}`);
        }

        // Create sets of order_ids for faster lookup
        const existingActiveOrderIds = new Set(existingActiveOrders?.map(o => o.order_id) || []);
        const existingArchivedOrderIds = new Set(existingArchivedOrders?.map(o => o.order_id) || []);

        console.log(`Found ${existingActiveOrderIds.size} active orders and ${existingArchivedOrderIds.size} archived orders`);

        // Create map for looking up active order IDs
        const activeOrderMap = new Map(existingActiveOrders?.map(o => [o.order_id, o.id]) || []);

        // Filter orders that need status updates (only active orders)
        const ordersToUpdate = ordersToUpsert
          .filter(order => {
            if (existingArchivedOrderIds.has(order.order_id)) {
              console.log(`Skipping archived order: ${order.order_id}`);
              return false;
            }
            return existingActiveOrderIds.has(order.order_id);
          })
          .map(order => ({
            id: activeOrderMap.get(order.order_id),
            status: order.status // Only update the status
          }));

        console.log(`Found ${ordersToUpdate.length} active orders to update status`);

        // Process status updates in batches
        if (ordersToUpdate.length > 0) {
          console.log(`Updating status for ${ordersToUpdate.length} existing orders...`);
          for (let i = 0; i < ordersToUpdate.length; i += batchSize) {
            const batch = ordersToUpdate.slice(i, i + batchSize);
            const { error: updateError } = await supabase
              .from('orders')
              .upsert(batch, {
                onConflict: 'id'
              });
            
            if (updateError) {
              console.error('Order status update error:', updateError);
              throw new Error(`Order status update failed: ${updateError.message}`);
            }
            console.log(`Successfully updated status for batch ${Math.floor(i/batchSize) + 1} of orders`);
          }
        }

        // THIS IS THE NEW CODE - Filter out orders that need to be inserted (don't exist in active or archived tables)
        const newOrders = ordersToUpsert.filter(order => 
          !existingActiveOrderIds.has(order.order_id) && 
          !existingArchivedOrderIds.has(order.order_id)
        );
        
        console.log(`Found ${newOrders.length} new orders to insert`);
        
        // Process new order insertions in batches
        if (newOrders.length > 0) {
          console.log(`Inserting ${newOrders.length} new orders...`);
          for (let i = 0; i < newOrders.length; i += batchSize) {
            const batch = newOrders.slice(i, i + batchSize);
            const { error: insertError } = await supabase
              .from('orders')
              .insert(batch);
            
            if (insertError) {
              console.error('Order insertion error:', insertError);
              throw new Error(`Order insertion failed: ${insertError.message}`);
            }
            console.log(`Successfully inserted batch ${Math.floor(i/batchSize) + 1} of ${Math.ceil(newOrders.length/batchSize)} for new orders`);
            
            // Add a small delay between batches to prevent rate limiting
            if (i + batchSize < newOrders.length) {
              await new Promise(resolve => setTimeout(resolve, 500));
            }
          }
        }
      }

      // STEP 3: Process order items into the correct tables based on parent order location
      console.log('Processing order items...');

      // Get all order IDs from both orders and archived_orders tables
      const { data: activeOrders, error: activeOrdersError } = await supabase
        .from('orders')
        .select('order_id');

      if (activeOrdersError) {
        console.error('Error fetching active orders:', activeOrdersError);
        throw new Error(`Failed to fetch active orders: ${activeOrdersError.message}`);
      }

      const { data: archivedOrders, error: archivedOrdersError } = await supabase
        .from('archived_orders')
        .select('order_id');

      if (archivedOrdersError) {
        console.error('Error fetching archived orders:', archivedOrdersError);
        throw new Error(`Failed to fetch archived orders: ${archivedOrdersError.message}`);
      }

      // Create sets for faster lookup
      const activeOrderIds = new Set(activeOrders?.map(o => o.order_id) || []);
      const archivedOrderIds = new Set(archivedOrders?.map(o => o.order_id) || []);

      // Group items by whether they belong to active or archived orders
      const activeItems: Record<string, OrderItemData[]> = {};
      const archivedItems: Record<string, OrderItemData[]> = {};

      Object.entries(orderItemsByOrderId).forEach(([orderId, items]) => {
        if (activeOrderIds.has(orderId)) {
          activeItems[orderId] = items;
        } else if (archivedOrderIds.has(orderId)) {
          archivedItems[orderId] = items;
        } else {
          console.warn(`Order ID ${orderId} not found in either active or archived orders tables`);
        }
      });

      // Process items for active orders
      console.log(`Processing ${Object.keys(activeItems).length} order IDs for active items`);
      for (const orderId of Object.keys(activeItems)) {
        await processItemsForOrders(supabase, [orderId], activeItems, false);
      }

      // Process items for archived orders
      console.log(`Processing ${Object.keys(archivedItems).length} order IDs for archived items`);
      for (const orderId of Object.keys(archivedItems)) {
        await processItemsForOrders(supabase, [orderId], archivedItems, true);
      }

      // Add a longer delay to ensure orders are committed
      console.log('Waiting for orders to be committed...');
      await new Promise(resolve => setTimeout(resolve, 10000));
      
      let retryCount = 0;
      let verifiedOrderIds: string[] = [];
      
      while (retryCount < 5) {
        try {
          // Get all order IDs from both orders and archived_orders tables
          const [ordersResult, archivedResult] = await Promise.all([
            supabase.from('orders').select('order_id'),
            supabase.from('archived_orders').select('order_id')
          ]);
          
          if (ordersResult.error || archivedResult.error) {
            console.error(`Error verifying orders (attempt ${retryCount + 1}):`, 
              ordersResult.error || archivedResult.error);
            retryCount++;
            await new Promise(resolve => setTimeout(resolve, 2000 * Math.pow(2, retryCount)));
            continue;
          }

          // Combine order IDs from both tables
          verifiedOrderIds = [
            ...(ordersResult.data?.map(o => o.order_id) || []),
            ...(archivedResult.data?.map(o => o.order_id) || [])
          ];
          
          console.log(`Verified ${verifiedOrderIds.length} orders on attempt ${retryCount + 1}`);
          console.log(`- Active orders: ${ordersResult.data?.length || 0}`);
          console.log(`- Archived orders: ${archivedResult.data?.length || 0}`);
          
          // Check if we verified at least 90% of the expected orders
          if (verifiedOrderIds.length >= ordersToUpsert.length * 0.9) {
            break;
          } else {
            console.log(`Only verified ${verifiedOrderIds.length} out of ${ordersToUpsert.length} orders. Waiting and retrying...`);
            retryCount++;
            await new Promise(resolve => setTimeout(resolve, 3000 * Math.pow(2, retryCount)));
          }
        } catch (error) {
          console.error(`Error during verification (attempt ${retryCount + 1}):`, error);
          retryCount++;
          await new Promise(resolve => setTimeout(resolve, 3000 * Math.pow(2, retryCount)));
        }
      }
      
      console.log('Verified order IDs:', verifiedOrderIds);
      console.log('Total orders to process:', ordersToUpsert.length);
      console.log('Orders found in database:', verifiedOrderIds.length);
      
      // Check for missing orders
      const missingOrders = ordersToUpsert.filter(o => !verifiedOrderIds.includes(o.order_id));
      if (missingOrders.length > 0) {
        console.error('Some orders failed to be inserted:', missingOrders);
        for (const order of missingOrders) {
          console.error(`Failed order details - ID: "${order.order_id}", Length: ${order.order_id.length}, Status: "${order.status}"`);
        }
        throw new Error(`Failed to insert ${missingOrders.length} orders`);
      }
      
      // STEP 4: Fetch updated data after insertion
      console.log('All orders and items have been processed');
      
      // Fetch all orders from orders table with status 'Pending'
      const { data: updatedOrders, error: fetchUpdatedOrdersError } = await supabase
          .from('orders')
          .select('*')
          .eq('status', 'Pending');

      if(fetchUpdatedOrdersError) {
        console.error('Fetch orders error:', fetchUpdatedOrdersError);
        throw new Error(`Fetch orders failed: ${fetchUpdatedOrdersError.message}`);
      }

      // Fetch items in order_items table
      const { data: updatedActiveItems, error: fetchActiveItemsError } = await supabase
          .from('order_items')
          .select('*');
        
      if(fetchActiveItemsError) {
        console.error('Fetch active items error: ', fetchActiveItemsError);
        throw new Error(`Fetch active items failed: ${fetchActiveItemsError.message}`);
      }

      // Fetch items in archived_order_items table
      const { data: updatedArchivedItems, error: fetchArchivedItemsError } = await supabase
        .from('archived_order_items')
        .select('*');
        
      if(fetchArchivedItemsError) {
        console.error('Fetch archived items error: ', fetchArchivedItemsError);
        throw new Error(`Fetch archived items failed: ${fetchArchivedItemsError.message}`);
      }

      // Combine active and archived items
      const updatedItems = [...(updatedActiveItems || []), ...(updatedArchivedItems || [])];
      console.log(`Fetched ${updatedActiveItems?.length || 0} active items and ${updatedArchivedItems?.length || 0} archived items from Supabase`);

      const updatedOrderItems = updatedItems.reduce((acc, item) => {
        acc[item.order_id] = acc[item.order_id] || [];
        acc[item.order_id].push(item);
        return acc;
      }, {} as Record<string, OrderItem[]>);

      console.log('Sync completed successfully');
      return {
        orders: updatedOrders || [],
        orderItems: updatedOrderItems || {},
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
    const allOrderItemsMap = allOrderItems.reduce((acc, item) => {
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
    const orderItemsMap = allOrderItems.reduce((acc, item) => {
      acc[item.order_id] = acc[item.order_id] || [];
      acc[item.order_id].push({
        ...item,
        completed: item.completed || false
      });
      return acc;
    }, {} as Record<string, OrderItem[]>);
    
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
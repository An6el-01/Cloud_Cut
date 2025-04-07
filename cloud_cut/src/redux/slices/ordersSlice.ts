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

// Initial State
const initialState: OrdersState = {
  allOrders: [],
  orderItems: {},
  currentPage: 1,
  ordersPerPage: 15,
  totalOrders: 0,
  selectedOrderId: null,
  loading: false,
  error: null,
  syncStatus: 'idle',
};

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

        return {
          id: order.id,
          order_id: order.channel_order_id,
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

        acc[order.channel_order_id] = inventory.map((item, index) => {
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
            id: `${order.channel_order_id}-${index + 1}`,
            order_id: order.channel_order_id,
            sku_id: item.sku || 'N/A',
            item_name: optimizedName || 'Unknown',
            quantity: item.quantity || 0,
            completed: order.status_description === 'Despatched',
            foamsheet: foamSheet,
            extra_info: item.options || 'N/A',
            priority, // Use the individual priority
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          };
        });
        return acc;
      }, {} as Record<string, OrderItem[]>);

      const totalOrderItems = Object.values(orderItems).reduce((sum, items) => sum + items.length, 0);
      
      console.log(`Total order items to process: ${totalOrderItems}`);

      //STEP 1: Upsert orders into 'orders' table
      console.log('Upserting orders to supabase "orders" table...');
      console.log('Orders about to be upserted:', orders.map(o => ({ order_id: o.order_id, status: o.status})));
      
      const { error: ordersError } = await supabase
        .from('orders')
        .upsert(orders, {
          onConflict: 'order_id'
        });
      
      if (ordersError) {
        console.error('Orders upsert error:', ordersError);
        throw new Error(`Orders upsert failed: ${ordersError.message}`);
      }

      //STEP 2: Handle order items with separate insert and update
      console.log('Processing order items for Supabase...');
      for (const orderId in orderItems) {
        const items = orderItems[orderId];
        console.log(`Processing ${items.length} items for order ${orderId}`);

        // First verify the order exists
        const { data: orderExists, error: checkError } = await supabase
          .from('orders')
          .select('order_id')
          .eq('order_id', orderId)
          .single();

        if (checkError || !orderExists) {
          console.error(`Order ${orderId} not found in database, skipping items`);
          continue;
        }

        //Fetch existing items for this order
        const { data: existingItems, error: fetchItemsError } = await supabase
          .from('order_items')
          .select('id')
          .eq('order_id', orderId);
        
        if (fetchItemsError) {
          console.error(`Fetch existing items error for order ${orderId}:`, fetchItemsError);
          continue;
        }

        const existingItemIds = new Set(existingItems.map(item => item.id));
        const itemsToInsert = items.filter(item => !existingItemIds.has(item.id));
        const itemsToUpdate = items.filter(item => existingItemIds.has(item.id));

        //Insert new items
        if (itemsToInsert.length > 0) {
          console.log(`Inserting ${itemsToInsert.length} new items for order ${orderId}`);
          const { error: insertError } = await supabase
            .from('order_items')
            .insert(itemsToInsert);
          
          if (insertError) {
            console.error(`Insert error for order ${orderId}:`, insertError);
            continue;
          }
        }

        //Update Existing Items
        if (itemsToUpdate.length > 0) {
          console.log(`Updating ${itemsToUpdate.length} existing items for order ${orderId}`);
          for(const item of itemsToUpdate){
            const { error: updateError } = await supabase
              .from('order_items')
              .update({
                quantity: item.quantity,
                completed: item.completed,
                priority: item.priority,
                updated_at: item.updated_at,
              })
              .eq('id', item.id);
            
            if (updateError) {
              console.error(`Update error for item ${item.id} in order ${orderId}:`, updateError);
              continue;
            }
          }
        }
      }

      // Step 3: Archive Completed Orders
      const completedOrders = orders.filter(order => order.status === 'Despatched');
      if(completedOrders.length > 0) {
        console.log(`Processing ${completedOrders.length} completed orders for archiving...`);
        
        const orderIds = completedOrders.map(order => order.order_id);
        
        // First check which orders are already archived
        const { data: existingArchivedOrders, error: checkError } = await supabase
          .from('archived_orders')
          .select('order_id')
          .in('order_id', orderIds);
        
        if (checkError) {
          console.error('Error checking archived orders:', checkError);
          console.warn('Archiving failed but continuing with sync');
        } else {
          // Filter out orders that are already archived
          const existingArchivedOrderIds = new Set(existingArchivedOrders?.map(o => o.order_id) || []);
          const ordersToArchive = completedOrders.filter(order => !existingArchivedOrderIds.has(order.order_id));
          
          if (ordersToArchive.length > 0) {
            console.log(`Found ${ordersToArchive.length} orders to archive`);
            
            // Update the status of orders to trigger the archive process
            const { error: updateError } = await supabase
              .from('orders')
              .update({ status: 'Archived' })
              .in('order_id', ordersToArchive.map(o => o.order_id));
            
            if (updateError) {
              console.error('Error updating order status for archiving:', updateError);
              console.warn('Archiving failed but continuing with sync');
            } else {
              console.log('Successfully triggered archiving for completed orders');
              
              // Delete the orders from the main orders table after they've been archived
              console.log('Removing archived orders from main orders table...');
              const { error: deleteOrdersError } = await supabase
                .from('orders')
                .delete()
                .in('order_id', ordersToArchive.map(o => o.order_id));
              
              if (deleteOrdersError) {
                console.error('Error deleting orders:', deleteOrdersError);
              }
            }
          } else {
            console.log('No new orders to archive');
          }
        }
      }
        
        //Fetch updated data
        console.log('Fetching updated data from Supabase...');
        
        const { data: updatedOrders, error: fetchOrdersError } = await supabase
          .from('orders')
          .select('*')
          .eq('status', 'Pending'); // Only fetch pending orders

        if(fetchOrdersError) {
          console.error('Fetch orders error:', fetchOrdersError);
          throw new Error(`Fetch orders failed: ${fetchOrdersError.message}`);
        }

        const { data: updatedItems, error: fetchItemsError } = await supabase
          .from('order_items')
          .select('*');
        if(fetchItemsError) {
          console.error('Fetch items error: ', fetchItemsError);
          throw new Error(`Fetch items failed: ${fetchItemsError.message}`);
        }

        console.log(`Fetched ${updatedItems.length} order items from Supabase`);

        const updatedOrderItems = updatedItems.reduce((acc, item) => {
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

// redux/slices/ordersSlice.ts
export const fetchOrdersFromSupabase = createAsyncThunk(
  'orders/fetchOrdersFromSupabase',
  async ({ page, perPage }: { page: number; perPage: number }) => {
    console.log(`Fetching orders from Supabase, page: ${page}, perPage: ${perPage}`);
    // Fetch only orders with status = 'Completed'
    const { data: orders, error: ordersError } = await supabase
      .from('orders')
      .select('*')
      .eq('status', 'Pending') // Filter by status
      .range((page - 1) * perPage, page * perPage - 1)
      .order('order_date', { ascending: false });

    if (ordersError) throw new Error(`Fetch orders failed: ${ordersError.message}`);
    console.log(`Fetched ${orders.length} completed orders from Supabase`);

    const orderIds = orders.map(o => o.order_id);
    const { data: orderItems, error: itemsError } = await supabase
      .from('order_items')
      .select('*')
      .in('order_id', orderIds);

    if (itemsError) throw new Error(`Fetch items failed: ${itemsError.message}`);
    console.log(`Fetched ${orderItems.length} order items for ${orderIds.length} orders`);

    const orderItemsMap = orderItems.reduce((acc, item) => {
      acc[item.order_id] = acc[item.order_id] || [];
      acc[item.order_id].push(item);
      return acc;
    }, {} as Record<string, OrderItem[]>);

    // Fetch the total count of "Completed" orders
    const { count } = await supabase
      .from('orders')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'Pending'); // Filter by status
    console.log(`Total pending orders in Supabase: ${count}`);

    return { orders, orderItems: orderItemsMap, total: count || 0, page };
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
      const items = state.orderItems[action.payload.orderId];
      if (items) {
        const item = items.find(i => i.id === action.payload.itemId);
        if (item) {
          item.completed = action.payload.completed;
          const order = state.allOrders.find(o => o.order_id === action.payload.orderId);
          if (order) order.items_completed = items.filter(i => i.completed).length;
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
        const { orders, orderItems, total, page } = action.payload;
        // Update allOrders without overwriting
        const existingOrderIds = new Set(state.allOrders.map(o => o.order_id));
        const newOrders = orders.filter(o => !existingOrderIds.has(o.order_id));
        state.allOrders = [...state.allOrders, ...newOrders];
        // Update orderItems
        state.orderItems = { ...state.orderItems, ...orderItems };
        state.totalOrders = total;
        state.currentPage = page;
        state.loading = false;
      })
      .addCase(fetchOrdersFromSupabase.rejected, (state, action) => {
        state.loading = false;
        state.error = action.error.message || 'Failed to fetch orders';
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
} = ordersSlice.actions;
export default ordersSlice.reducer;

// Selectors
const selectOrdersState = (state: RootState) => state.orders;

export const selectAllOrders = createSelector([selectOrdersState], orders => orders.allOrders);

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
    const order = orders.allOrders.find((o) => o.order_id === orderId);
    return order ? `${order.items_completed}/${order.total_items}` : 'N/A';
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
    for (const order of archivedOrders || []) {
      const { data: items, error: itemsError } = await supabase
        .from('archived_order_items')
        .select('*')
        .eq('order_id', order.order_id);

      if (itemsError) {
        console.error(`Error fetching items for order ${order.order_id}:`, itemsError);
        continue;
      }

      orderItems[order.order_id] = items || [];
    }

    return {
      orders: archivedOrders || [],
      orderItems
    };
  }
);
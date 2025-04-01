// src/redux/slices/ordersSlice.ts
import { createSlice, createAsyncThunk, PayloadAction, createSelector } from '@reduxjs/toolkit';
import { RootState } from '../store';
import { OrdersState, Order, OrderItem } from '@/types/redux';
import { fetchOrders } from '@/utils/despatchCloud';
import { supabase } from '@/utils/supabase';
import { getFoamSheetFromSKU } from '@/utils/skuParser';
import { DespatchCloudOrder } from '@/types/despatchCloud';
import { getPriorityLevel, isAmazonOrder, calculateDayNumber } from '@/utils/priority'; // Import priority utils

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

        return {
          id: order.id,
          order_id: order.channel_order_id,
          order_date: order.date_received,
          customer_name: order.shipping_name,
          status: order.status_description === 'Despatched' ? 'Completed' : 'Pending',
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

        acc[order.channel_order_id] = inventory.map((item, index) => {
          const foamSheet = getFoamSheetFromSKU(item.sku) || 'N/A';
          // Calculate individual priority for this item
          const priority = getPriorityLevel(
            item.name.toLowerCase(),
            foamSheet,
            dayNumber,
            isAmazon,
            isOnHold
          );

          return {
            id: `${order.channel_order_id}-${index + index}`,
            order_id: order.channel_order_id,
            sku_id: item.sku || 'N/A',
            item_name: item.name || 'Unknown',
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
      console.log(`Total order items to upsert: ${totalOrderItems}`);

      console.log('Upserting orders to Supabase...');
      const { error: ordersError } = await supabase
        .from('orders')
        .upsert(orders, { onConflict: 'order_id' });
      if (ordersError) {
        console.error('Orders upsert error:', ordersError);
        throw new Error(`Orders upsert failed: ${ordersError.message}`);
      }

      console.log('Upserting order items to Supabase...');
      for (const orderId in orderItems) {
        const items = orderItems[orderId];
        console.log(`Upserting ${items.length} items for order ${orderId} with order_id: ${items[0]?.order_id}`);
        const { error: itemsError } = await supabase
          .from('order_items')
          .upsert(items, { onConflict: 'id' });
        if (itemsError) {
          console.error(`Items upsert error for order ${orderId}:`, itemsError);
          throw new Error(`Items upsert failed: ${itemsError.message}`);
        }
      }

      console.log('Fetching updated data from Supabase...');
      const { data: updatedOrders, error: fetchOrdersError } = await supabase
        .from('orders')
        .select('*');
      if (fetchOrdersError) {
        console.error('Fetch orders error:', fetchOrdersError);
        throw new Error(`Fetch orders failed: ${fetchOrdersError.message}`);
      }

      const { data: updatedItems, error: fetchItemsError } = await supabase
        .from('order_items')
        .select('*');
      if (fetchItemsError) {
        console.error('Fetch items error:', fetchItemsError);
        throw new Error(`Fetch items failed: ${fetchItemsError.message}`);
      }

      console.log(`Fetched ${updatedItems.length} order items from Supabase`);

      console.log('Processing updated data...');
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

export const fetchOrdersFromSupabase = createAsyncThunk(
  'orders/fetchOrdersFromSupabase',
  async ({ page, perPage }: { page: number; perPage: number }) => {
    console.log(`Fetching orders from Supabase, page: ${page}, perPage: ${perPage}`);
    const { data: orders, error: ordersError } = await supabase
      .from('orders')
      .select('*')
      .range((page - 1) * perPage, page * perPage - 1)
      .order('order_date', { ascending: false });

    if (ordersError) throw new Error(`Fetch orders failed: ${ordersError.message}`);
    console.log(`Fetched ${orders.length} orders from Supabase`);

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

    const { count } = await supabase.from('orders').select('*', { count: 'exact', head: true });
    console.log(`Total orders in Supabase: ${count}`);

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
    const order = orders.allOrders.find(o => o.order_id === orderId);
    return order ? `${order.items_completed}/${order.total_items}` : 'N/A';
  });
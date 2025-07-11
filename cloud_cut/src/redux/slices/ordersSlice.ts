// src/redux/slices/ordersSlice.ts
import { createSlice, PayloadAction, AnyAction } from '@reduxjs/toolkit';
import { OrdersState, Order, OrderItem } from '@/types/redux';
import { supabase } from '@/utils/supabase';
// Import thunks without the circular dependency
// We'll import these in the extraReducers section directly
import { fetchArchivedOrders } from '../thunks/ordersThunks';

// Initial State
const initialState: OrdersState = {
  allOrders: [],
  manufacturingOrders: [],
  packingOrders: [],
  pickingOrders: [],
  archivedOrders: [],
  orderItems: {},
  archivedOrderItems: {},
  currentPage: 1,
  ordersPerPage: 15,
  totalOrders: 0,
  totalManufacturingOrders: 0,
  totalPackingOrders: 0, 
  totalArchivedOrders: 0,
  selectedOrderId: null,
  loading: false,
  error: null,
  archivedOrdersLoading: false,
  archivedOrdersError: null,
  syncStatus: 'idle',
  currentView: 'manufacturing',
};

// Slice
export const ordersSlice = createSlice({
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
    updateOrderManufacturedStatus: (
      state,
      action: PayloadAction<{ orderId: string; manufactured: boolean }>
    ) => {
      // Look for the order in both allOrders
      let order = state.allOrders.find(o => o.order_id === action.payload.orderId);
      
      // If not found in allOrders, check manufacturingOrders
      if (!order) {
        order = state.manufacturingOrders.find(o => o.order_id === action.payload.orderId);
      }
      
      if (order) {
        // Update the order in state
        order.manufactured = action.payload.manufactured;
        
        // Also update the order in Supabase
        console.log(`Updating manufactured status for order ${action.payload.orderId} to ${action.payload.manufactured}`);
        
        // Use a more robust approach to ensure Supabase update succeeds
        (async () => {
          try {
            const { data, error } = await supabase
              .from('orders')
              .update({ 
                manufactured: action.payload.manufactured,
                updated_at: new Date().toISOString() 
              })
              .eq('order_id', action.payload.orderId);
            
            if (error) {
              console.error('Error updating manufactured status in Supabase:', error);
              throw error;
            } else {
              console.log(`Successfully updated manufactured status for order ${action.payload.orderId}`, data);
            }
          } catch (err) {
            console.error('Failed to update manufactured status:', err);
          }
        })();
      } else {
        console.error(`Order with ID ${action.payload.orderId} not found in state`);
      }
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
    updateItemPickedStatus: (
      state,
      action: PayloadAction<{ orderId: string; itemId: string; picked: boolean }>
    ) => {
      const orderId = action.payload.orderId;
      const itemId = action.payload.itemId;
      const picked = action.payload.picked;
      const items = state.orderItems[orderId];
      
      if (items) {
        const item = items.find(i => i.id === itemId);
        if (item) {
          // Only update if the value is actually different
          if (item.picked !== picked) {
            item.picked = picked;
            
            // Update the item in Supabase
            supabase
              .from('order_items')
              .update({ 
                picked: picked, 
                updated_at: new Date().toISOString() 
              })
              .eq('id', itemId)
              .then(({ error }) => {
                if (error) {
                  console.error('Error updating item picked status in Supabase:', error);
                  // Revert the change if the update failed
                  item.picked = !picked;
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
    updateOrderPickingStatus: (state, action: PayloadAction<{ orderId: string; picking: boolean; user_picking: string }>) => {
      
      // Update in packingOrders 
      const packingOrder = state.packingOrders.find(o => o.order_id === action.payload.orderId);
      if (packingOrder) {
        packingOrder.picking = action.payload.picking;
        packingOrder.user_picking = action.payload.user_picking;
      }
      
      // Update in Supabase database
      (async () => {
        try {
          const { data, error } = await supabase
            .from('orders')
            .update({ 
              picking: action.payload.picking,
              user_picking: action.payload.user_picking,
              updated_at: new Date().toISOString() 
            })
            .eq('order_id', action.payload.orderId);
          
          if (error) {
            console.error('Error updating picking status in Supabase:', error);
            throw error;
          } else {
            console.log(`Successfully updated picking status for order ${action.payload.orderId} to ${action.payload.picking} with user ${action.payload.user_picking}`, data);
          }
        } catch (err) {
          console.error('Failed to update picking status:', err);
        }
      })();
    },
  },
  extraReducers: (builder) => {
    // Handle the fetchArchivedOrders thunk
    builder
      .addCase(fetchArchivedOrders.pending, (state) => {
        state.archivedOrdersLoading = true;
        state.archivedOrdersError = null;
      })
      .addCase(fetchArchivedOrders.fulfilled, (state, action) => {
        state.archivedOrders = action.payload.orders;
        state.archivedOrderItems = action.payload.orderItems;
        state.totalArchivedOrders = action.payload.orders.length;
        state.archivedOrdersLoading = false;
        console.log(`Loaded ${state.archivedOrders.length} archived orders with ${Object.values(state.archivedOrderItems).flat().length} order items into state`);
      })
      .addCase(fetchArchivedOrders.rejected, (state, action) => {
        state.archivedOrdersLoading = false;
        state.archivedOrdersError = action.error.message || 'Failed to fetch archived orders';
        console.error('Failed to fetch archived orders:', action.error);
      });
  },
});

// Export all the action creators directly from the slice
export const {
  setSelectedOrderId, 
  updateOrderStatus, 
  updateOrderManufacturedStatus,
  updateItemCompleted, 
  updateItemPickedStatus,
  setSyncStatus,
  addOrder,
  updateOrder,
  removeOrder,
  addOrderItem,
  removeOrderItem, 
  setCurrentView,
  updateOrderPickingStatus,
} = ordersSlice.actions;

// Import thunks after we've created the slice to avoid circular dependencies
import { syncOrders, fetchOrdersFromSupabase, exportPendingOrdersCSV, fetchPendingOrdersForAdmin, fetchCompletedOrdersForAdmin } from '@/redux/thunks/ordersThunks';

// Get the base reducer
const ordersReducer = ordersSlice.reducer;

// Create a new reducer that wraps the original one and adds the extraReducers
const enhancedOrdersReducer = (state: OrdersState | undefined = initialState, action: AnyAction): OrdersState => {
  // First, let the original reducer handle the action
  let newState = ordersReducer(state, action);
  
  // Handle the async thunk actions
  if (syncOrders.pending.match(action)) {
    newState = {
      ...newState,
      loading: true,
      error: null,
    };
  } else if (syncOrders.fulfilled.match(action)) {
    const orders = action.payload.orders as unknown as Order[];
    const items = action.payload.orderItems as unknown as Record<string, OrderItem[]>;
    newState = {
      ...newState,
      allOrders: orders,
      orderItems: items,
      totalOrders: action.payload.total,
      loading: false,
      syncStatus: 'idle',
    };
  } else if (syncOrders.rejected.match(action)) {
    newState = {
      ...newState,
      loading: false,
      error: action.error.message || 'Failed to sync orders',
      syncStatus: 'error',
    };
  } else if (fetchOrdersFromSupabase.pending.match(action)) {
    newState = {
      ...newState,
      loading: true,
      error: null,
    };
  } else if (fetchOrdersFromSupabase.fulfilled.match(action)) {
    const { orders: rawOrders, paginatedOrders: rawPaginatedOrders, orderItems: rawItems, total, page, view } = action.payload;
    const typedOrders = rawOrders as unknown as Order[];
    const typedPaginatedOrders = rawPaginatedOrders as unknown as Order[];
    const typedItems = rawItems as unknown as Record<string, OrderItem[]>;
    
    // Update state based on view
    if (view === 'manufacturing') {
      newState = {
        ...newState,
        allOrders: typedOrders, // Store ALL orders
        manufacturingOrders: typedPaginatedOrders, // Store paginated orders for UI display
        totalManufacturingOrders: total,
      };
    } else if (view === 'packing') {
      newState = {
        ...newState,
        allOrders: typedOrders, // Store ALL orders
        packingOrders: typedPaginatedOrders, // Store paginated orders for UI display
        totalPackingOrders: total,
      };
    } else {
      // Default or 'all' view - populate both manufacturing and packing orders
      newState = {
        ...newState,
        allOrders: typedOrders,
        manufacturingOrders: typedOrders, // For 'all' view, populate both arrays
        packingOrders: typedOrders,       // so selectActiveOrders can find them
        totalOrders: total,
        totalManufacturingOrders: total,
        totalPackingOrders: total,
      };
    }
    
    newState = {
      ...newState,
      // REPLACE orderItems with complete set of items for all orders
      orderItems: typedItems,
      currentPage: page,
      loading: false,
    };
  } else if (fetchOrdersFromSupabase.rejected.match(action)) {
    newState = {
      ...newState,
      loading: false,
      error: action.error.message || 'Failed to fetch orders',
    };
  } else if (fetchPendingOrdersForAdmin.pending.match(action)) {
    newState = {
      ...newState,
      loading: true,
      error: null,
    };
  } else if (fetchPendingOrdersForAdmin.fulfilled.match(action)) {
    const { orders: rawOrders, paginatedOrders: rawPaginatedOrders, orderItems: rawItems, total, page } = action.payload;
    const typedOrders = rawOrders as unknown as Order[];
    const typedPaginatedOrders = rawPaginatedOrders as unknown as Order[];
    const typedItems = rawItems as unknown as Record<string, OrderItem[]>;
    
    newState = {
      ...newState,
      allOrders: typedOrders,
      manufacturingOrders: typedOrders, // For admin pending orders, populate both arrays
      packingOrders: typedOrders,       // so selectActiveOrders can find them
      orderItems: typedItems,
      totalOrders: total,
      totalManufacturingOrders: total,
      totalPackingOrders: total,
      currentPage: page,
      loading: false,
    };
  } else if (fetchPendingOrdersForAdmin.rejected.match(action)) {
    newState = {
      ...newState,
      loading: false,
      error: action.error.message || 'Failed to fetch pending orders',
    };
  } else if (fetchCompletedOrdersForAdmin.pending.match(action)) {
    newState = {
      ...newState,
      archivedOrdersLoading: true,
      archivedOrdersError: null,
    };
  } else if (fetchCompletedOrdersForAdmin.fulfilled.match(action)) {
    const { orders: rawOrders, paginatedOrders: rawPaginatedOrders, orderItems: rawItems, total, page } = action.payload;
    const typedOrders = rawOrders as unknown as Order[];
    const typedPaginatedOrders = rawPaginatedOrders as unknown as Order[];
    const typedItems = rawItems as unknown as Record<string, OrderItem[]>;
    
    newState = {
      ...newState,
      archivedOrders: typedOrders,
      archivedOrderItems: typedItems,
      totalArchivedOrders: total,
      archivedOrdersLoading: false,
    };
  } else if (fetchCompletedOrdersForAdmin.rejected.match(action)) {
    newState = {
      ...newState,
      archivedOrdersLoading: false,
      archivedOrdersError: action.error.message || 'Failed to fetch completed orders',
    };
  } else if (exportPendingOrdersCSV.pending.match(action)) {
    newState = {
      ...newState,
      loading: true,
      error: null,
    };
  } else if (exportPendingOrdersCSV.fulfilled.match(action)) {
    const orders = action.payload.orders as unknown as Order[];
    const items = action.payload.orderItems as unknown as Record<string, OrderItem[]>;
    newState = {
      ...newState,
      loading: false,
      //Optionally update state with fetched data
      allOrders: orders,
      orderItems: items,
    };
  } else if (exportPendingOrdersCSV.rejected.match(action)) {
    newState = {
      ...newState,
      loading: false,
      error: action.error.message || 'Failed to export CSV',
    };
  }
  
  return newState;
};

// Export the enhanced reducer as default
export default enhancedOrdersReducer;
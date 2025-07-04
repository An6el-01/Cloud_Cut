//**
// This file contains various selector which we use to separate the orders and their respective items by case.
// Allows the UI to quickly fetch orders for the current view.
// Doesn't filter the items themselves just the orders.
//  */


import { createSelector } from '@reduxjs/toolkit';
import { RootState } from '../store';
import { OrderItem, Order } from '@/types/redux';
import { supabase } from '@/utils/supabase';

// Basic selectors
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

export const selectPickingOrders = createSelector(
  [selectOrdersState],
  state => state.pickingOrders
);

export const selectCurrentViewOrders = createSelector(
  [selectOrdersState],
  state => {
    switch (state.currentView) {
      case 'manufacturing':
        return state.manufacturingOrders;
      case 'packing':
        return state.packingOrders;
      case 'picking':
        return state.pickingOrders;
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
//Check if this needs to be updated
export const selectSortedOrders = createSelector(
  [selectAllOrders, selectOrdersState],
  (orders, state) => {
    const sorted = orders
      .map(order => {
        const items = state.orderItems[order.order_id] || [];
        const priority = items.length > 0 ? Math.min(...items.map((item: OrderItem) => item.priority ?? 10)) : 10;
        return { ...order, priority };
      })
      .sort((a, b) => a.priority - b.priority);
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
    // First check in all orders
    const allItems = orders.orderItems[orderId] || [];
    
    if (allItems.length > 0) {
      const completedCount = allItems.filter(item => item.completed).length;
      return `${completedCount}/${allItems.length}`;
    }
    
    // If no items found, return 'N/A'
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
        .select('id, order_id, sku_id, item_name, quantity, completed, picked, foamsheet, extra_info, priority, created_at, updated_at, archived_at')
        .in('order_id', orderIds);

      if (itemsError) {
        console.error(`Error fetching archived items:`, itemsError);
      } else if (items) {
        // Group items by order_id
        (items as OrderItem[]).forEach(item => {
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

// New selector specifically for admin pending orders - avoids duplicates
export const selectAdminPendingOrders = createSelector(
  [selectOrdersState],
  state => {
    // For admin page, we only need one array since both manufacturingOrders and packingOrders 
    // contain the same pending orders. Use manufacturingOrders as the source.
    return state.manufacturingOrders;
  }
);

export const selectActiveOrders = createSelector(
  [selectManufacturingOrders, selectPackingOrders],
  (manufacturingOrders, packingOrders) => {
    // Only create a new array if the inputs have actually changed
    if (manufacturingOrders.length === 0 && packingOrders.length === 0) {
      return [];
    }
    
    // For admin page, both arrays contain the same orders, so just return one to avoid duplicates
    if (manufacturingOrders.length > 0 && packingOrders.length > 0) {
      // Check if they're the same orders (for admin page)
      const manufacturingIds = new Set(manufacturingOrders.map(o => o.order_id));
      const packingIds = new Set(packingOrders.map(o => o.order_id));
      
      // If they have the same order IDs, they're duplicates, so return just one array
      if (manufacturingIds.size === packingIds.size && 
          [...manufacturingIds].every(id => packingIds.has(id))) {
        return manufacturingOrders;
      }
    }
    
    // For other pages where they might be different, combine them
    return [...manufacturingOrders, ...packingOrders];
  }
);

export const selectOrderItemsByOrderIds = createSelector(
  [selectOrdersState, selectActiveOrders],
  (ordersState, activeOrders) => {
    const result: Record<string, OrderItem[]> = {};
    activeOrders.forEach((order) => {
      result[order.order_id] = ordersState.orderItems[order.order_id] || [];
    });
    return result;
  }
); 
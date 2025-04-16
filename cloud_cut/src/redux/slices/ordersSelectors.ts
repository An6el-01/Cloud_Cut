import { createSelector } from '@reduxjs/toolkit';
import { RootState } from '../store';
import { OrderItem } from '@/types/redux';
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

    // If still not found, check in picking orders
    if (!order) {
      order = orders.pickingOrders.find((o) => o.order_id === orderId);
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
        .select('id, order_id, sku_id, item_name, quantity, completed, foamsheet, extra_info, priority, created_at, updated_at, archived_at')
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
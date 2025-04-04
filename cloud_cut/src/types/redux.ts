import { DespatchCloudOrder } from './despatchCloud';

export interface Order {
    id: number;
    order_id: string;
    order_date: string;
    customer_name: string;
    status: 'Pending' | 'Completed';
    total_items: number;
    items_completed: number;
    access_url: string | null;
    email: string | null;
    country: string | null;
    raw_data: DespatchCloudOrder;
    created_at: string;
    updated_at: string;
}   

export interface OrderItem {
    id: string;
    order_id: string;
    sku_id: string;
    item_name: string;
    quantity: number;
    completed: boolean,
    foamsheet: string,
    extra_info: string,
    priority: number,
    created_at: string;
    updated_at: string;
}

export interface OrdersState {
    allOrders: Order[],
    orderItems: Record<string, OrderItem[]>;
    currentPage: number;
    ordersPerPage: number;
    totalOrders: number;
    selectedOrderId: string | null;
    loading: boolean,
    error: string | null;
    syncStatus: 'idle' | 'syncing' | 'error';
}
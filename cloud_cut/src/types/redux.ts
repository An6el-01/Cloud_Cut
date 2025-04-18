import { DespatchCloudOrder } from './despatchCloud';

export interface Order {
    id: number;
    order_id: string;
    order_date: string;
    customer_name: string;
    status: string | null;
    total_items: number;
    items_completed: number;
    access_url: string | null;
    email: string | null;
    country: string | null;
    raw_data: DespatchCloudOrder;
    created_at: string;
    updated_at: string;
    manufactured: boolean;
    packed: boolean;
    picking: boolean;
    user_picking: string | null;
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
    manufacturingOrders: Order[],
    packingOrders: Order[],
    pickingOrders: Order[],
    archivedOrders: Order[],
    orderItems: Record<string, OrderItem[]>;
    archivedOrderItems: Record<string, OrderItem[]>;
    currentPage: number;
    ordersPerPage: number;
    totalOrders: number;
    totalManufacturingOrders: number;
    totalPackingOrders: number;
    totalArchivedOrders: number;
    selectedOrderId: string | null;
    loading: boolean,
    error: string | null;
    archivedOrdersLoading: boolean;
    archivedOrdersError: string | null;
    syncStatus: 'idle' | 'syncing' | 'error';
    currentView: 'manufacturing' | 'packing' | 'picking' | 'archived';
}
import { DespatchCloudOrder, InventoryItem as DespatchCloudInventoryItem } from './despatchCloud';

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
    picked: boolean,
    foamsheet: string,
    extra_info: string,
    priority: number,
    created_at: string;
    updated_at: string;
}

export interface InventoryItem extends DespatchCloudInventoryItem {
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

export interface StockState {
    allFinishedStock: InventoryItem[],
    syncStatus: 'idle' | 'syncing' | 'error';
    loading: boolean;
    error: string | null;
    items: Array<{
        id: number;
        sku: string;
        stock: number;
        item_name: string;
        created_at: string;
        updated_at: string;
    }>;
}


export interface NestingItem {
    sku: string;
    itemName: string;
    quantity: number;
    orderId: string;
    customerName: string;
    priority: number;
    svgUrl?: string[];
}

export interface PolygonPoint {
    x: number;
    y: number;
}

export interface NestingPart {
    x: number;
    y: number;
    rotation: number;
    id: string;
    source: NestingItem;
    filename: string;
    polygons? : { x: number, y: number }[][];
    children?: NestingPart[];
    itemName?: string;
    orderId?: string;
    customerName?: string;
    priority?: number;
}

export interface NestingPlacement {
    sheet: number;
    sheetid: string;
    parts: NestingPart[];
    binPolygon?: { x: number, y: number }[];
}

export interface NestingResult {
    fitness: number;
    placements: NestingPlacement[];
}

export interface ProcessedNestingData {
    items: NestingItem[];
    nestingResult: NestingResult | null;
}

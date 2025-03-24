
export interface DespatchCloudOrder {
    id: number;
    channel_order_id: string;
    print_process_ref: string;
    status: string;
    data_received: string;
    shipping_name: string;
    total_paid: string;
    shipping_method: string;
    sales_channel: string;
    shipping_address_country: string;
    items: Array<{
        sku: string;
        name: string;
        quantity: number,
        unit_price: string;
        total_discount: string;
        subtotal: string;
        options?: string;
    }>;
}

export interface OrderDetails {
    orderId: string;
    orderDate: string;
    status: string;
    priorityLevel: number;
    customerName: string;
    items: Array<{
        id: number;
        name: string;
        foamSheet: string;
        quantity: number;
        status: string;
    }>;
}

export interface InventoryItem {
    sku: string;
    type: string;
    name: string;
    stock_available: number;
    stock_open: number;
    weight_kg: number;
}
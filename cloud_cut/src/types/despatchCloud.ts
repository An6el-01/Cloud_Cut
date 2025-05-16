export interface DespatchCloudOrder {
    id: number;
    channel_order_id: string;
    print_process_ref: string;
    status: string;
    date_received: string;
    shipping_name: string;
    total_paid: string;
    shipping_method: string;
    sales_channel: string;
    shipping_address_country: string;
    status_description?: string; 
    access_url?: string;
    email?: string;
    channel_alt_id?: string,
    highestPriority: number;
    inventory: Array<{
        id: number;
        inventory_id: number;
        order_summary_id: number;
        sales_channel_item_id: string;
        sku: string;
        name: string;
        quantity: number;
        unit_price: string;
        unit_tax: string;
        line_total_discount: string;
        price: string;
        options: string;
        notes: string;
        created_at: string;
        updated_at: string;
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
        quantity: number;
        foamSheet: string;
        status: string;
        options: string;
        priority?: number;
    }>;
}

export interface InventoryItem {
    id: number;
    name: string;
    sku: string;
    stock_level: string;
}


export interface InventoryResponse {
    total: number;
    per_page: string;
    current_page: number;
    last_page: number;
    next_page_url: string;
    prev_page_url: string | null;
    from: number;
    to: number;
    data: InventoryItem[];
}


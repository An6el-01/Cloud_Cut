import { DespatchCloudOrder, OrderDetails, InventoryItem } from '@/types/despatchCloud';

const DESPATCH_CLOUD_EMAIL = process.env.NEXT_PUBLIC_DESPATCH_CLOUD_EMAIL || "";
const DESPATCH_CLOUD_PASSWORD = process.env.NEXT_PUBLIC_DESPATCH_CLOUD_PASSWORD || "";

interface ApiResponse<T> {
    data: T;
    message?: string;
    status?: string;
}

async function fetchWithAuth<T>(url: string, options: RequestInit = {}): Promise<T> {
    const token = await getAuthToken();
    const response = await fetch(url, {
        ...options,
        headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
            ...options.headers,
        },
    });
    if (!response.ok) throw new Error(`API request failed: ${response.statusText}`);
    return response.json();
}

export async function getAuthToken(): Promise<string> {
    console.log('Attempting to authenticate with:', `/api/public-api/auth/login`);
    const response = await fetch(`/api/public-api/auth/login`, {
        method: 'POST',
        headers: { 
            'Content-Type': 'application/json',
            'Accept': 'application/json'
        },
        body: JSON.stringify({
            email: DESPATCH_CLOUD_EMAIL,
            password: DESPATCH_CLOUD_PASSWORD,
        }),
    });
    if(!response.ok) {
        console.error('Authentication failed:', response.status, response.statusText);
        throw new Error(`Authentication failed: ${response.status} ${response.statusText}`);
    }
    const data = await response.json();
    if (!data.token) {
        throw new Error('No token received in response');
    }
    return data.token;
}

export interface OrdersResponse {
    data: DespatchCloudOrder[];
    total: number;
    current_page: number;
    last_page: number;
    per_page: number;
}

export async function fetchOrders(page: number = 1): Promise<OrdersResponse> {
    const twoWeeksAgo = new Date();
    twoWeeksAgo.setDate(twoWeeksAgo.getDate() - 14);
    const now = new Date();
    const dateRange =  `${Math.floor(twoWeeksAgo.getTime() / 1000)},${Math.floor(now.getTime() / 1000)}`;

    console.log('Fetching orders with date range:', dateRange);
    const response = await fetchWithAuth<OrdersResponse>(
        `/api/public-api/orders?page=${page}&filters[date_range]=${dateRange}`
    );
    console.log('Raw API Response:', JSON.stringify(response, null, 2));

    // The API already returns the correct structure, so we can return it directly
    return response;
}

export async function fetchOrderDetails(orderId: string): Promise<OrderDetails> {
    const order = await fetchWithAuth<ApiResponse<DespatchCloudOrder>>(
        `/api/public-api/order/${orderId}`
    );

    const items = order.data.items.map((item, index) => {
        //Extract foam sheet from name
        const foamSheetMatch = item.name.match(/\[(.*?)\]/);
        const foamSheet = foamSheetMatch ? foamSheetMatch[1] : 'N/A';

        return {
            id: index + 1, // Using array index + 1 as a fallback ID
            name: item.name,
            foamSheet,
            quantity: item.quantity,
            status: "Pending",
        };
    });

    // Fix date handling
    const orderDate = new Date(parseInt(order.data.data_received) * 1000);

    return {
        orderId: order.data.channel_order_id,
        orderDate: orderDate.toLocaleDateString("en-GB"),
        status: order.data.status,
        priorityLevel: 0,
        customerName: order.data.shipping_name,
        items,
    };
}

interface InventoryApiItem {
    sku: string;
    type: string;
    name: string;
    stock_available: string;
    stock_open: string;
    weight_kg: string;
}

export async function fetchInventory(): Promise<InventoryItem[]> {
    const data = await fetchWithAuth<ApiResponse<InventoryApiItem[]>>(
        `/api/public-api/inventory?page=1&sort=name_az`
    );
    return data.data.map((item) => ({
        sku: item.sku,
        type: item.type,
        name: item.name,
        stock_available: parseInt(item.stock_available, 10),
        stock_open: parseInt(item.stock_open, 10),
        weight_kg: parseFloat(item.weight_kg),
    })) || [];
}
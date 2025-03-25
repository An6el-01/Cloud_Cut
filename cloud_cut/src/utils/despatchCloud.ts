import { DespatchCloudOrder, OrderDetails, InventoryItem } from '@/types/despatchCloud';

const DESPATCH_CLOUD_EMAIL = process.env.NEXT_PUBLIC_DESPATCH_CLOUD_EMAIL || "";
const DESPATCH_CLOUD_PASSWORD = process.env.NEXT_PUBLIC_DESPATCH_CLOUD_PASSWORD || "";

interface ApiResponse<T> {
  data: T;
  message?: string;
  status?: string;
}

export interface OrdersResponse {
  data: DespatchCloudOrder[];
  current_page: number;
  last_page: number;
  total: number;
  per_page: number;
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
  const url = `/api/despatchCloud/proxy?path=auth/login`;
  console.log('Attempting to authenticate with:', url);
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    },
    body: JSON.stringify({
      email: DESPATCH_CLOUD_EMAIL,
      password: DESPATCH_CLOUD_PASSWORD,
    }),
  });
  if (!response.ok) {
    console.error('Authentication failed:', response.status, response.statusText);
    throw new Error(`Authentication failed: ${response.status} ${response.statusText}`);
  }
  const data = await response.json();
  if (!data.token) {
    throw new Error('No token received in response');
  }
  return data.token;
}

export async function fetchOrders(page: number = 1, perPage: number = 10): Promise<OrdersResponse> {
  const fiveDaysAgo = new Date();
  fiveDaysAgo.setDate(fiveDaysAgo.getDate() - 5);
  const now = new Date();
  const dateRange = `${Math.floor(fiveDaysAgo.getTime() / 1000)},${Math.floor(now.getTime() / 1000)}`;

  // Ensure perPage is within reasonable limits
  const normalizedPerPage = Math.min(Math.max(perPage, 5), 20); // Min 5, Max 20 orders per page

  const url = `/api/despatchCloud/proxy?path=orders&page=${page}&per_page=${normalizedPerPage}&filters[date_range]=${dateRange}`;
  console.log("Fetching orders from:", url);
  const response = await fetchWithAuth<OrdersResponse>(url);

  return {
    data: response.data || [],
    current_page: response.current_page || page,
    last_page: response.last_page || 1,
    total: response.total || 0,
    per_page: response.per_page || normalizedPerPage,
  };
}

export async function fetchOrderDetails(orderId: string): Promise<OrderDetails> {
  const url = `/api/despatchCloud/proxy?path=order/${orderId}`;
  console.log('Fetching order details from:', url);
  
  try {
    const order = await fetchWithAuth<DespatchCloudOrder>(url);
    console.log('Order details response:', order);

    if (!order || !order.channel_order_id) {
      throw new Error('Invalid order details response');
    }

    // Extract items from the inventory array
    const items = (order.inventory || []).map((item, index) => ({
      id: index + 1,
      name: item.name.replace(/\s*\(Pack of \d+\)$/, ''), // Remove "Pack of X" from display name
      foamSheet: 'N/A',
      quantity: item.quantity,
      status: "Pending",
    }));

    const orderDate = new Date(order.date_received);

    return {
      orderId: order.channel_order_id,
      orderDate: orderDate.toLocaleDateString("en-GB"),
      status: order.status || "Unknown",
      priorityLevel: 0,
      customerName: order.shipping_name,
      items,
    };
  } catch (error) {
    console.error('Error fetching order details:', error);
    throw error;
  }
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
  const url = `/api/despatchCloud/proxy?path=inventory&page=1&sort=name_az`;
  const data = await fetchWithAuth<ApiResponse<InventoryApiItem[]>>(url);

  return data.data.map((item) => ({
    sku: item.sku,
    type: item.type,
    name: item.name,
    stock_available: parseInt(item.stock_available, 10),
    stock_open: parseInt(item.stock_open, 10),
    weight_kg: parseFloat(item.weight_kg),
  })) || [];
}
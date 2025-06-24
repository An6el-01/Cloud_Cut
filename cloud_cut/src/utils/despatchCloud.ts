import { DespatchCloudOrder, OrderDetails, InventoryItem, InventoryResponse as TypedInventoryResponse } from '@/types/despatchCloud';
import { getFoamSheetFromSKU } from './skuParser';
import { getPriorityLevel, isAmazonOrder, calculateDayNumber } from './priority';
import { optimizeItemName } from './optimizeItemName';

// Use environment variable or default to localhost for development
const BASE_URL = process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000';

export interface OrdersResponse {
  data: DespatchCloudOrder[];
  current_page: number;
  last_page: number;
  total: number;
  per_page: number;
}

export interface InventoryResponse {
  data: InventoryItem[];
  current_page: number;
  last_page: number;
  total: number;
  per_page: number;
}

let authToken: string | null = null;

async function fetchWithAuth<T>(url: string, options: RequestInit = {}): Promise<T> {
  if (!authToken) {
    authToken = await getAuthToken();
    console.log('New token:', authToken);
  }

  try {
    console.log('Making request to:', url);
    console.log('Request options:', {
      method: options.method,
      headers: options.headers,
      body: options.body ? JSON.parse(options.body as string) : undefined
    });

    const response = await fetch(url, {
      ...options,
      headers: {
        Authorization: `Bearer ${authToken}`,
        "Content-Type": "application/json",
        ...options.headers,
      },
    });

    console.log('Response status:', response.status);
    console.log('Response headers:', Object.fromEntries(response.headers.entries()));

    // If unauthorized, try to refresh token once
    if (response.status === 401) {
      console.log('Token expired, refreshing...');
      authToken = await getAuthToken();
      console.log('New token:', authToken);
      const retryResponse = await fetch(url, {
        ...options,
        headers: {
          Authorization: `Bearer ${authToken}`,
          "Content-Type": "application/json",
          ...options.headers,
        },
      });
      
      if (!retryResponse.ok) {
        const errorText = await retryResponse.text();
        console.error('Retry request failed:', {
          status: retryResponse.status,
          statusText: retryResponse.statusText,
          errorText
        });
        throw new Error(`API request failed: ${retryResponse.statusText}`);
      }
      return retryResponse.json();
    }

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Request failed:', {
        status: response.status,
        statusText: response.statusText,
        errorText
      });
      throw new Error(`API request failed: ${response.statusText}`);
    }
    return response.json();
  } catch (error) {
    console.error('Error in fetchWithAuth:', error);
    throw error;
  }
}

export async function getAuthToken(): Promise<string> {
  const url = `${BASE_URL}/api/despatchCloud/proxy?path=auth/login`;
  console.log('Attempting to authenticate with:', url);
  
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      }
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Authentication failed:', response.status, response.statusText, errorText);
      throw new Error(`Authentication failed: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    if (!data.token) {
      throw new Error('No token received in response');
    }

    return data.token;
  } catch (error) {
    console.error('Error in getAuthToken:', error);
    throw error;
  }
}

export async function fetchOrders(page: number = 1, perPage: number = 15): Promise<OrdersResponse> {
  const now = new Date();
  const localOffset = now.getTimezoneOffset() * 60000; // Time zone offset in milliseconds
  const localNow = new Date(now.getTime() - localOffset); // Adjusted current time in local time zone

  const twoDaysAgo = new Date(localNow.getTime() - (4 * 24 * 60 * 60 * 1000)); // 4 days ago in local time
  const dateRange = `${Math.floor(twoDaysAgo.getTime() / 1000)},${Math.floor(localNow.getTime() / 1000)}`;

  const normalizedPerPage = Math.min(Math.max(perPage, 5), 20);
  const url = `${BASE_URL}/api/despatchCloud/proxy?path=orders&page=${page}&per_page=${normalizedPerPage}&filters[date_range]=${dateRange}`;
  console.log(`Page: ${page}, Per Page: ${normalizedPerPage}, Date Range: ${dateRange}`);
  console.log("Fetching orders from:", url);
  console.log("Auth Token:", authToken);
  const response = await fetchWithAuth<OrdersResponse>(url);

  const processedOrders = response.data.map(order => {
    const dayNumber = calculateDayNumber(order.date_received);
    const isAmazon = isAmazonOrder(order);
    const isOnHold = order.status.toLowerCase().includes('hold');

    const inventory = order.inventory || [];

    console.log(`\nProcessing order ${order.channel_order_id}:`);
    // console.log(`Order ${order.channel_order_id} - Inventory: ${inventory.length}`);
    // console.log(`Day number: ${dayNumber}`);
    // console.log(`Is Amazon: ${isAmazon}`);
    // console.log(`Is on hold: ${isOnHold}`);
    // console.log(`Number of items (inventory array): ${inventory.length}`);

    const itemPriorities = inventory.map(item => {
      const foamSheet = getFoamSheetFromSKU(item.sku);
      const priority = getPriorityLevel(
        item.name.toLowerCase(),
        foamSheet,
        dayNumber,
        isAmazon,
        isOnHold
      );

      // console.log(`Item: ${item.name}`);
      // console.log(`Foam Sheet: ${foamSheet}`);
      // console.log(`Priority: ${priority}`);

      return priority;
    });

    const highestPriority = itemPriorities.length > 0 ? Math.max(...itemPriorities) : 0;
    console.log(`Highest priority for order: ${highestPriority}`);

    return {
      ...order,
      highestPriority
    };
  });

  return {
    data: processedOrders,
    current_page: response.current_page || page,
    last_page: response.last_page || 1,
    total: response.total || 0,
    per_page: response.per_page || normalizedPerPage,
  };
}


export async function fetchOrderDetails(orderId: string): Promise<OrderDetails> {
  const url = `${BASE_URL}/api/despatchCloud/proxy?path=order/${orderId}`;
  console.log('Fetching order details from:', url);

  try {
    const order = await fetchWithAuth<DespatchCloudOrder>(url);
    console.log('Order details response:', order);

    if (!order || !order.channel_order_id) {
      throw new Error('Invalid order details response');
    }

    // Calculate day number and check if it's an Amazon order
    const dayNumber = calculateDayNumber(order.date_received);
    const isAmazon = isAmazonOrder(order);

    const items = (order.inventory || []).map((item, index) => {
      const optimizedName = optimizeItemName(
        { sku: item.sku, name: item.name, options: item.options },
        order.status
      );
      const foamSheet = getFoamSheetFromSKU(item.sku);
      
      // Calculate priority level for this item
      const priority = getPriorityLevel(
        optimizedName,
        foamSheet,
        dayNumber,
        isAmazon,
        order.status.toLowerCase().includes('hold')
      );

      return {
        id: index + 1,
        name: optimizedName, // Use the optimized name
        foamSheet,
        quantity: item.quantity,
        status: "Pending",
        options: item.options,
        priority,
      };
    });

    //Check if this needs to be updated (Needs to be changed to lowest number of priority among items)
    // Calculate overall order priority (highest priority among items)
    const orderPriority = Math.min(...items.map(item => item.priority ?? 10));

    const orderDate = new Date(order.date_received);

    return {
      orderId: order.channel_order_id,
      orderDate: orderDate.toLocaleDateString("en-GB"),
      status: order.status || "Unknown",
      priorityLevel: orderPriority,
      customerName: order.shipping_name,
      items,
    };
  } catch (error) {
    console.error('Error fetching order details:', error);
    throw error;
  }
}

export async function fetchInventory(
  page: number = 1,
  perPage: number = 100,
  filters: {
    sku?: string;
    search?: string;
    product_type?: number;
    product_types?: number[];
    location?: number;
    locations?: number[];
  } = {},
  sort: string = 'name_az',
  fetchAll: boolean = false
): Promise<InventoryResponse> {
  const queryParams = new URLSearchParams({
    page: page.toString(),
    per_page: perPage.toString(),
    sort,
  });
  if (filters.sku) queryParams.append('filters[sku]', filters.sku);
  if (filters.search) queryParams.append('filters[search]', filters.search);
  if (filters.product_type) queryParams.append('filters[product_type]', filters.product_type.toString());
  if (filters.product_types) filters.product_types.forEach(pt => queryParams.append('filters[product_types][]', pt.toString()));
  if (filters.location) queryParams.append('filters[location]', filters.location.toString());
  if (filters.locations) filters.locations.forEach(loc => queryParams.append('filters[location][]', loc.toString()));

  const url = `${BASE_URL}/api/despatchCloud/proxy?path=inventory&${queryParams.toString()}`;
  console.log('Fetching inventory from:', url);

  try {
    if (fetchAll) {
      let allItems: InventoryItem[] = [];
      let currentPage = 1;
      let lastPage = 1;

      do {
        const queryParamsAll = new URLSearchParams({
          page: currentPage.toString(),
          per_page: perPage.toString(),
          sort,
        });
        Object.entries(filters).forEach(([key, value]) => {
          if (Array.isArray(value)) {
            value.forEach(v => queryParamsAll.append(`filters[${key}][]`, v.toString()));
          } else if (value !== undefined) {
            queryParamsAll.append(`filters[${key}]`, value.toString());
          }
        });

        const fetchUrl = `${BASE_URL}/api/despatchCloud/proxy?path=inventory&${queryParamsAll.toString()}`;
        console.log(`Fetching page ${currentPage} from:`, fetchUrl);
        const response = await fetchWithAuth<TypedInventoryResponse>(fetchUrl);
        
        console.log(`Raw inventory data from DespatchCloud (page ${currentPage}):`, response);
        console.log(`Items count on page ${currentPage}:`, response.data?.length || 0);

        allItems = allItems.concat(response.data || []);
        currentPage++;
        lastPage = response.last_page || 1;
      } while (currentPage <= lastPage);

      return {
        data: allItems,
        current_page: 1,
        last_page: lastPage,
        total: allItems.length,
        per_page: perPage,
      } as InventoryResponse;
    } else {
      const response = await fetchWithAuth<TypedInventoryResponse>(url);
      
      console.log(`Raw inventory data from DespatchCloud:`, response);
      console.log(`Items count:`, response.data?.length || 0);
      
      return {
        data: response.data || [],
        current_page: response.current_page || page,
        last_page: response.last_page || 1,
        total: response.total || 0,
        per_page: Number(response.per_page) || perPage,
      } as InventoryResponse;
    }
  } catch (error) {
    console.error('Error fetching inventory:', error);
    throw error;
  }
}

export async function bookOutStock(
  inventoryId: number,
  quantity: number,
): Promise<any> {
  // Fetch the inventory item to verify existence (optional, can be skipped if you trust the ID)
  const fetchUrl = `${BASE_URL}/api/despatchCloud/proxy?path=inventory/${inventoryId}`;
  console.log('Fetching inventory item:', fetchUrl);

  try {
    const inventoryItem = await fetchWithAuth<any>(fetchUrl);
    console.log('Fetched inventory item:', inventoryItem);

    if (!inventoryItem || !inventoryItem.id) {
      throw new Error('Could not fetch inventory item details');
    }
      const url = `${BASE_URL}/api/despatchCloud/proxy?path=inventory/${inventoryItem.id}/adjust_location_stock`;
      console.log('Updating inventory item stock:', url);

      const response = await fetchWithAuth<any>(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${authToken}`,
        },
        body: JSON.stringify({
          operator: 'decrease',
          location_id: 1,
          quantity: quantity,
          note: 'API TEST',
          auto_allocate: 1
        }),
      });
      console.log('Stock update response:', response);

      return response;
  } catch (error) {
    console.error('Error updating inventory item stock:', error);
    throw error;
  }
};

export async function updateStockItem(
  inventoryId: number,
  updateData: {
    stock_level?: string;
    [key: string]: any;
  },
  locationId?: number,

): Promise<any> {
  // Fetch the inventory item to verify existence (optional, can be skipped if you trust the ID)
  const fetchUrl = `${BASE_URL}/api/despatchCloud/proxy?path=inventory/${inventoryId}`;
  console.log('Fetching inventory item:', fetchUrl);

  try {
    const inventoryItem = await fetchWithAuth<any>(fetchUrl);
    console.log('Fetched inventory item:', inventoryItem);

    if (!inventoryItem || !inventoryItem.id) {
      throw new Error('Could not fetch inventory item details');
    }

    // Check if the item is a medium sheet by looking at the SKU
    if (inventoryItem.sku && inventoryItem.sku.toLowerCase().startsWith('sfs-100/50')) {
      console.log('Skipping stock update for medium sheet item:', inventoryItem.sku);
      return inventoryItem;
    }

    const url = `${BASE_URL}/api/despatchCloud/proxy?path=inventory/${inventoryItem.id}/adjust_location_stock`;
    console.log('Updating inventory item stock:', url);

    // Only send one stock field, default to stock_level_global_available
    let payload: any = {};
    if (updateData.stock_level !== undefined) {
      payload.stock_level = parseInt(updateData.stock_level);
    } else {
      throw new Error('No valid stock field provided');
    }
    
    //Optionally fetch the updated item to get the quantity
    const itemUrl = `${BASE_URL}/api/despatchCloud/proxy?path=inventory/${inventoryItem.id}`;
    const itemUrlResponse = await fetchWithAuth<any>(itemUrl);

    //Compare the stock levels as numbers and get the difference
    const newStockLevel = Number(Object.values(payload)[0]);
    const oldStockLevel = typeof itemUrlResponse.stock_level === 'string'
      ? parseInt(itemUrlResponse.stock_level)
      : itemUrlResponse.stock_level; 

    
    const difference = oldStockLevel - newStockLevel;

    let operator;
    let quantity;

    // Find out if we need to increase or decrease the stock level
    if (difference > 0) {
      operator = 'decrease';
      quantity = difference;
    } else {
      operator = 'increase';
      quantity = newStockLevel - oldStockLevel;
    }

    console.log('request url:', url);
    console.log('newStockLevel:', payload.stock_level);

    const response = await fetchWithAuth<any>(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${authToken}`,
        'Accept': 'application/json',
      },
      body: JSON.stringify({
        operator: 'set',
        location_id: locationId,
        quantity: payload.stock_level,
        note: 'API TEST',
        auto_allocate: 0
      }),
    });

    console.log('Stock update response:', response);

    return itemUrlResponse;
  } catch (error) {
    console.error('Error updating inventory item stock:', error);
    throw error;
  }
}
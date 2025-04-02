import inventoryData from '@/data/inventory.json';

//Create a Map for efficient SKU-to-name lookups
export const inventoryMap = new Map<string, string>(
    inventoryData.map((item: { sku: string; name: string }) => [item.sku, item.name])
);
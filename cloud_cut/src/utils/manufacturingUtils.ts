import { OrderItem } from '@/types/redux';

// SKU prefixes that indicate an item should be considered for manufacturing
const MANUFACTURING_SKU_PREFIXES = ['SFI', 'SFC', 'SFS'];
// Retail pack SKUs that should prevent marking as manufactured
const RETAIL_PACK_SKUS = ['SFP30E', 'SFP50E', 'SFP30P', 'SFP50P', 'SFP30T', 'SFP50T'];

/**
 * Checks if an order should be marked as manufactured based on its items' SKUs
 * @param items The order items to check
 * @returns true if the order should be marked as manufactured, false otherwise
 */
export const shouldOrderBeManufactured = (items: OrderItem[]): boolean => {
  if (!items || items.length === 0) return false;

  // If the order contains any retail pack SKUs, do not mark as manufactured
  const hasRetailPackItem = items.some(item =>
    RETAIL_PACK_SKUS.includes(item.sku_id?.toUpperCase())
  );
  if (hasRetailPackItem) return false;

  // Find all manufacturing items
  const manufacturingItems = items.filter(item =>
    MANUFACTURING_SKU_PREFIXES.some(prefix =>
      item.sku_id?.toUpperCase().startsWith(prefix)
    )
  );

  // If there are no manufacturing items, do not mark as manufactured
  if (manufacturingItems.length === 0) return false;

  // Only mark as manufactured if all manufacturing items are completed
  return manufacturingItems.every(item => item.completed);
}; 
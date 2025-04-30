import { OrderItem } from '@/types/redux';

// SKU prefixes that indicate an item should NOT be marked as manufactured
const NON_MANUFACTURED_SKU_PREFIXES = ['SFI', 'SFC', 'SFS'];

/**
 * Checks if an order should be marked as manufactured based on its items' SKUs
 * @param items The order items to check
 * @returns true if the order should be marked as manufactured, false otherwise
 */
export const shouldOrderBeManufactured = (items: OrderItem[]): boolean => {
  if (!items || items.length === 0) return false;

  // Check if any item has a SKU that starts with any of the non-manufactured prefixes
  const hasNonManufacturedItem = items.some(item => 
    NON_MANUFACTURED_SKU_PREFIXES.some(prefix => 
      item.sku_id?.toUpperCase().startsWith(prefix)
    )
  );

  // If any item has a non-manufactured SKU prefix, the order should not be marked as manufactured
  return !hasNonManufacturedItem;
}; 
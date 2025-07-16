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

export const clearActiveNests = async () => {
  const { supabase } = await import('./supabase');
  // Fetch all active_nests where locked is false
  const { data, error } = await supabase
    .from('active_nests')
    .select('id, locked')
    .eq('locked', false);

  if (error) {
    console.error('Error fetching unlocked active nests:', error);
    return;
  }

  if (data && data.length > 0) {
    // Delete all unlocked nests by id
    const idsToDelete = data.map((row) => Number(row.id));
    const { error: deleteError } = await supabase
      .from('active_nests')
      .delete()
      .in('id', idsToDelete);
    if (deleteError) {
      console.error('Error deleting unlocked active nests:', deleteError);
    }
  }
};

export const assignNestingId = async (nestingIds: string[]): Promise<string[]> => {
  const { supabase } = await import('./supabase');

  // Fetch all nesting_ids from active_nests
  const { data: activeData, error: activeError } = await supabase
    .from('active_nests')
    .select('nesting_id');
  if (activeError) {
    console.error('Error fetching active_nests nesting_ids:', activeError);
    return [];
  }

  // Fetch all nesting_ids from completed_nests
  const { data: completedData, error: completedError } = await supabase
    .from('completed_nests')
    .select('nesting_id');
  if (completedError) {
    console.error('Error fetching completed_nests nesting_ids:', completedError);
    return [];
  }

  // Gather all used nesting numbers
  const usedNumbers = new Set<number>();
  const extractNumber = (nestingId: string) => {
    const match = nestingId.match(/^NST-(\d+)$/);
    return match ? parseInt(match[1], 10) : null;
  };

  [...(activeData || []), ...(completedData || [])].forEach((row) => {
    const nestingId = typeof row.nesting_id === 'string' ? row.nesting_id : '';
    if (nestingId) {
      const num = extractNumber(nestingId);
      if (num !== null) usedNumbers.add(num);
    }
  });

  // Assign new, non-conflicting nesting IDs
  const newNestingIds: string[] = [];
  let nextNumber = 1;
  for (let i = 0; i < nestingIds.length; i++) {
    // Find the next available number
    while (usedNumbers.has(nextNumber)) {
      nextNumber++;
    }
    newNestingIds.push(`NST-${nextNumber}`);
    usedNumbers.add(nextNumber);
    nextNumber++;
  }

  return newNestingIds;
};
/**
 * SKU Mapping Configuration
 * 
 * This file contains mappings for composite SKUs that are made up of multiple sub-parts.
 * When a SKU is not found directly, the nesting algorithm will check this mapping
 * to see if it needs to fetch multiple SVG files for the composite part.
 * 
 * Note: SKU matching ignores the last 3 digits, so SFI-MTBS330K will match SFI-MTBS3
 */

// Mapping of composite SKUs to their constituent sub-parts with quantities
// The keys are base SKUs (without the last 3 digits)
const SKU_MAPPING = {
  // Example: SFI-MTBS3 (matches SFI-MTBS330K, SFI-MTBS350K, etc.) is made up of three sub-parts
  'SFI-MTBS3': [
    { sku: 'SFI-MTC2', quantity: 1 },
    { sku: 'SFI-MTCB2', quantity: 1 }, 
    { sku: 'SFI-MTO2', quantity: 1 }
  ],
  'SFI-FSYSC2': [
    { sku: 'SFI-MMC-01', quantity: 4 }, // Four of these 
    { sku: 'SFI-MMC-02', quantity: 4 }, // Four of these
  ],
  'SFI-FSYSC12': [
    { sku: 'SFI-FSYS12', quantity: 1 },
    { sku: 'SFI-FSYS12', quantity: 1 }
  ],
  'SFI-HAMT2': [
    { sku: 'SFI-HAMT2-01', quantity: 1 },
    { sku: 'SFI-HAMT2-02', quantity: 1 },
  ]

  
};

/**
 * Normalize a SKU by removing the last 3 digits for mapping purposes
 * @param {string} sku - The SKU to normalize
 * @returns {string} - The normalized SKU (without last 3 digits)
 */
function normalizeSku(sku) {
  if (!sku || typeof sku !== 'string') return sku;
  
  // Remove the last 3 digits if they exist
  if (sku.length >= 3) {
    return sku.slice(0, -3);
  }
  
  return sku;
}

/**
 * Check if a SKU is a composite SKU that maps to multiple sub-parts
 * @param {string} sku - The SKU to check
 * @returns {Array|null} - Array of sub-part objects with sku and quantity if composite, null if not found
 */
export function getCompositeSkuMapping(sku) {
  const normalizedSku = normalizeSku(sku);
  return SKU_MAPPING[normalizedSku] || null;
}

/**
 * Get the sub-part SKUs from a composite SKU mapping (without quantities)
 * @param {string} sku - The SKU to check
 * @returns {string[]|null} - Array of sub-part SKUs if composite, null if not found
 */
export function getCompositeSkuSkus(sku) {
  const mapping = getCompositeSkuMapping(sku);
  if (!mapping) return null;
  
  return mapping.map(item => item.sku);
}

/**
 * Get the total quantity of sub-parts needed for a composite SKU
 * @param {string} sku - The composite SKU to check
 * @returns {number} - Total quantity of all sub-parts needed
 */
export function getTotalSubPartQuantity(sku) {
  const mapping = getCompositeSkuMapping(sku);
  if (!mapping) return 0;
  
  return mapping.reduce((total, item) => total + item.quantity, 0);
}

/**
 * Check if a SKU exists in the mapping (either as a composite or sub-part)
 * @param {string} sku - The SKU to check
 * @returns {boolean} - True if the SKU is found in the mapping
 */
export function isSkuInMapping(sku) {
  const normalizedSku = normalizeSku(sku);
  
  // Check if it's a composite SKU
  if (SKU_MAPPING[normalizedSku]) {
    return true;
  }
  
  // Check if it's a sub-part of any composite SKU
  for (const compositeSku in SKU_MAPPING) {
    const subParts = SKU_MAPPING[compositeSku];
    if (subParts.some(item => item.sku === sku)) {
      return true;
    }
  }
  
  return false;
}

/**
 * Get all SKUs that are part of a composite SKU mapping
 * @returns {string[]} - Array of all SKUs (both composite and sub-parts)
 */
export function getAllMappedSkus() {
  const allSkus = new Set();
  
  // Add all composite SKUs (with their full form examples)
  Object.keys(SKU_MAPPING).forEach(baseSku => {
    // Add the base SKU
    allSkus.add(baseSku);
    // Add an example with 3 digits (e.g., SFI-MTBS3 -> SFI-MTBS300)
    allSkus.add(baseSku + '000');
  });
  
  // Add all sub-part SKUs
  Object.values(SKU_MAPPING).forEach(subParts => {
    subParts.forEach(item => allSkus.add(item.sku));
  });
  
  return Array.from(allSkus);
}

/**
 * Get the composite SKU that contains a given sub-part SKU
 * @param {string} subPartSku - The sub-part SKU to find
 * @returns {string|null} - The composite SKU if found, null otherwise
 */
export function getCompositeSkuForSubPart(subPartSku) {
  for (const [compositeSku, subParts] of Object.entries(SKU_MAPPING)) {
    if (subParts.some(item => item.sku === subPartSku)) {
      return compositeSku;
    }
  }
  return null;
}

/**
 * Get the quantity of a specific sub-part in a composite SKU
 * @param {string} compositeSku - The composite SKU
 * @param {string} subPartSku - The sub-part SKU
 * @returns {number} - The quantity of the sub-part, 0 if not found
 */
export function getSubPartQuantity(compositeSku, subPartSku) {
  const mapping = getCompositeSkuMapping(compositeSku);
  if (!mapping) return 0;
  
  const subPart = mapping.find(item => item.sku === subPartSku);
  return subPart ? subPart.quantity : 0;
}

/**
 * Validate the SKU mapping configuration
 * @returns {Object} - Validation result with errors and warnings
 */
export function validateSkuMapping() {
  const result = {
    errors: [],
    warnings: [],
    valid: true
  };
  
  // Check for duplicate sub-parts across different composite SKUs
  const subPartCounts = {};
  
  for (const [compositeSku, subParts] of Object.entries(SKU_MAPPING)) {
    if (!Array.isArray(subParts) || subParts.length === 0) {
      result.errors.push(`Composite SKU '${compositeSku}' has no sub-parts defined`);
      result.valid = false;
      continue;
    }
    
    for (const subPart of subParts) {
      if (!subPart || typeof subPart !== 'object' || !subPart.sku || typeof subPart.sku !== 'string') {
        result.errors.push(`Invalid sub-part in composite SKU '${compositeSku}': ${JSON.stringify(subPart)}`);
        result.valid = false;
        continue;
      }
      
      if (typeof subPart.quantity !== 'number' || subPart.quantity <= 0) {
        result.errors.push(`Invalid quantity for sub-part '${subPart.sku}' in composite SKU '${compositeSku}': ${subPart.quantity}`);
        result.valid = false;
        continue;
      }
      
      if (!subPartCounts[subPart.sku]) {
        subPartCounts[subPart.sku] = [];
      }
      subPartCounts[subPart.sku].push(compositeSku);
    }
  }
  
  // Check for sub-parts that appear in multiple composite SKUs
  for (const [subPart, compositeSkus] of Object.entries(subPartCounts)) {
    if (compositeSkus.length > 1) {
      result.warnings.push(`Sub-part '${subPart}' appears in multiple composite SKUs: ${compositeSkus.join(', ')}`);
    }
  }
  
  return result;
}

export default SKU_MAPPING; 
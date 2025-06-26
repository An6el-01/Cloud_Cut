/**
 * SKU Mapping Configuration
 * 
 * This file contains mappings for composite SKUs that are made up of multiple sub-parts.
 * When a SKU is not found directly, the nesting algorithm will check this mapping
 * to see if it needs to fetch multiple SVG files for the composite part.
 */

// Mapping of composite SKUs to their constituent sub-parts with quantities
const SKU_MAPPING = {
  // Example: SFI-MTBS330K is made up of three sub-parts
  'SFI-MTBS330K': [
    { sku: 'SFI-MTC2', quantity: 1 },
    { sku: 'SFI-MTCB2', quantity: 1 }, 
    { sku: 'SFI-MTO2', quantity: 1 }
  ],
  'SFI-FSYSC230K': [
    { sku: 'SFI-MMC-01', quantity: 4 }, // Four of these 
    { sku: 'SFI-MMC-02', quantity: 4 }, // Four of these
  ]
  
};

/**
 * Check if a SKU is a composite SKU that maps to multiple sub-parts
 * @param {string} sku - The SKU to check
 * @returns {Array|null} - Array of sub-part objects with sku and quantity if composite, null if not found
 */
export function getCompositeSkuMapping(sku) {
  return SKU_MAPPING[sku] || null;
}

/**
 * Get the sub-part SKUs from a composite SKU mapping (without quantities)
 * @param {string} sku - The SKU to check
 * @returns {string[]|null} - Array of sub-part SKUs if composite, null if not found
 */
export function getCompositeSkuSkus(sku) {
  const mapping = SKU_MAPPING[sku];
  if (!mapping) return null;
  
  return mapping.map(item => item.sku);
}

/**
 * Get the total quantity of sub-parts needed for a composite SKU
 * @param {string} sku - The composite SKU to check
 * @returns {number} - Total quantity of all sub-parts needed
 */
export function getTotalSubPartQuantity(sku) {
  const mapping = SKU_MAPPING[sku];
  if (!mapping) return 0;
  
  return mapping.reduce((total, item) => total + item.quantity, 0);
}

/**
 * Check if a SKU exists in the mapping (either as a composite or sub-part)
 * @param {string} sku - The SKU to check
 * @returns {boolean} - True if the SKU is found in the mapping
 */
export function isSkuInMapping(sku) {
  // Check if it's a composite SKU
  if (SKU_MAPPING[sku]) {
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
  
  // Add all composite SKUs
  Object.keys(SKU_MAPPING).forEach(sku => allSkus.add(sku));
  
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
  const mapping = SKU_MAPPING[compositeSku];
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
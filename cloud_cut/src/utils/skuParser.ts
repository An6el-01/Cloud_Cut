//Retail pack SKU mapping
const retailPacksSKUs: Record<string, { color: string, depth: string }> = {
    '0604565193520': { color: 'Red', depth: '30mm' },
    '0604565193544': { color: 'Blue', depth: '30mm' },
    '0604565344892': { color: 'Yellow', depth: '30mm' },
    '0604565344878': { color: 'Orange', depth: '30mm' },
    '0604565344946': { color: 'Black', depth: '30mm' },
    '0604565345097': { color: 'Black', depth: '50mm' },
    '0604565345042': { color: 'Yellow', depth: '50mm' },
    '0604565344960': { color: 'Red', depth: '50mm' },
    '0604565344984': { color: 'Blue', depth: '50mm' },
    '0604565345028': { color: 'Orange', depth: '50mm' },
    '0604565345004': { color: 'Green', depth: '50mm' },
    '0604565193568': { color: 'Green', depth: '30mm' },
};

//Color codes for short SKUs
const colorCodes: Record<string, string> = {
    'B': 'Blue',
    'K': 'Black',
    'R': 'Red',
    'O': 'Orange',
    'M': 'Pink',
    'P': 'Purple',
    'E': 'Grey',
    'T': 'Teal',
    'Y': 'Yellow',
    'G': 'Green',
};

export function getFoamSheetFromSKU(sku: string): string {
    if (retailPacksSKUs[sku]){
        const { color, depth } = retailPacksSKUs[sku];
        return `${color} ${depth}`;
    }

    if(sku.length >= 3){
        const lastChar = sku.slice(-1);
        const firstTwoCar = sku.slice(0,2);
        const depthPart = sku.slice(-3,-1);
        const color = colorCodes[lastChar] || 'N/A';
        let depth = /^\d{2}$/.test(depthPart) ? `${depthPart}mm` : 'N/A';

        if (firstTwoCar != 'SF' || `${color}`== 'N/A' ||`${depth}` == 'N/A' ){
            return 'N/A'
        } else if (depth == '20mm'){
            depth = '30mm';
        } else if (depth == '40mm'){
            depth ='50mm' 
        }
        return `${color} ${depth}`;
    }
    return 'N/A';
}

/**
 * Parse dimensions from SFC item names
 * Example: "[RED 50mm] Shadow Foam Custom Size (Length: 775mm, Width: 410mm)"
 * Returns: { width: 410, height: 775 }
 */
export function parseSfcDimensions(itemName: string): { width: number; height: number } | null {
  if (!itemName || typeof itemName !== 'string') {
    return null;
  }

  // Extract dimensions from the item name
  // Look for patterns like "Length: XXXmm, Width: XXXmm" or "Width: XXXmm, Length: XXXmm"
  const lengthMatch = itemName.match(/Length:\s*(\d+)mm/i);
  const widthMatch = itemName.match(/Width:\s*(\d+)mm/i);

  if (lengthMatch && widthMatch) {
    const length = parseInt(lengthMatch[1], 10);
    const width = parseInt(widthMatch[1], 10);
    
    if (!isNaN(length) && !isNaN(width) && length > 0 && width > 0) {
      return { width, height: length };
    }
  }

  return null;
}

/**
 * Get foam sheet information from SFC SKU
 * Example: SFC50R -> { color: 'RED', thickness: 50 }
 */
export function getSfcFoamSheetInfo(sku: string): { color: string; thickness: number } | null {
  if (!sku || !sku.startsWith('SFC')) {
    return null;
  }

  // SFC format: SFC{thickness}{color}
  // Example: SFC50R -> thickness: 50, color: R (RED)
  const match = sku.match(/^SFC(\d+)([A-Z]+)$/);
  if (!match) {
    return null;
  }

  const thickness = parseInt(match[1], 10);
  const colorCode = match[2];

  // Map color codes to color names
  const colorMap: Record<string, string> = {
    'K': 'BLACK',
    'B': 'BLUE',
    'G': 'GREEN',
    'O': 'ORANGE',
    'PK': 'PINK',
    'M': 'MAUVE',
    'P': 'PURPLE',
    'R': 'RED',
    'T': 'TAN',
    'Y': 'YELLOW',
    'E': 'GREY'
  };

  const color = colorMap[colorCode] || colorCode;

  if (!isNaN(thickness) && thickness > 0) {
    return { color, thickness };
  }

  return null;
}

/**
 * Get retail pack information from SKU
 * Example: SFP30E -> { color: 'GREY', thickness: 30, quantity: 5 }
 * Example: SFP50E -> { color: 'GREY', thickness: 50, quantity: 3 }
 */
export function getRetailPackInfo(sku: string): { color: string; thickness: number; quantity: number } | null {
  if (!sku || !sku.startsWith('SFP')) {
    return null;
  }

  // SFP format: SFP{thickness}{color}
  // Example: SFP30E -> thickness: 30, color: E (GREY)
  const match = sku.match(/^SFP(\d+)([A-Z])$/);
  if (!match) {
    return null;
  }

  const thickness = parseInt(match[1], 10);
  const colorCode = match[2];

  // Map color codes to color names
  const colorMap: Record<string, string> = {
    'E': 'GREY',
    'P': 'PURPLE',
    'T': 'TEAL'
  };

  const color = colorMap[colorCode];
  if (!color) {
    return null;
  }

  // Determine quantity based on thickness
  const quantityMap: Record<number, number> = {
    30: 5,
    50: 3
  };

  const quantity = quantityMap[thickness];
  if (!quantity) {
    return null;
  }

  if (!isNaN(thickness) && thickness > 0) {
    return { color, thickness, quantity };
  }

  return null;
}

/**
 * Get retail pack dimensions
 * All retail packs have the same dimensions: 600mm width x 420mm height
 */
export function getRetailPackDimensions(): { width: number; height: number } {
  return { width: 420, height: 600 };
}

/**
 * Get starter kit information from SKU
 * Example: SFSK30R -> { color: 'RED', thickness: 30, quantity: 3 }
 * Example: SFSK50B -> { color: 'BLUE', thickness: 50, quantity: 3 }
 */
export function getStarterKitInfo(sku: string): { color: string; thickness: number; quantity: number } | null {
  if (!sku || !sku.startsWith('SFSK')) {
    return null;
  }

  // SFSK format: SFSK{thickness}{color}
  // Example: SFSK30R -> thickness: 30, color: R (RED)
  const match = sku.match(/^SFSK(\d+)([A-Z])$/);
  if (!match) {
    return null;
  }

  const thickness = parseInt(match[1], 10);
  const colorCode = match[2];

  // Map color codes to color names
  const colorMap: Record<string, string> = {
    'K': 'BLACK',
    'B': 'BLUE',
    'G': 'GREEN',
    'O': 'ORANGE',
    'PK': 'PINK',
    'M': 'MAUVE',
    'P': 'PURPLE',
    'R': 'RED',
    'T': 'TAN',
    'Y': 'YELLOW',
    'E': 'GREY'
  };

  const color = colorMap[colorCode];
  if (!color) {
    return null;
  }

  // Starter kits always come in groups of 3
  const quantity = 3;

  if (!isNaN(thickness) && thickness > 0) {
    return { color, thickness, quantity };
  }

  return null;
}

/**
 * Get starter kit dimensions
 * All starter kits have the same dimensions: 420mm width x 600mm height
 */
export function getStarterKitDimensions(): { width: number; height: number } {
  return { width: 420, height: 600 };
}

/**
 * Get mixed pack info from SKU
 * Example: SFSKMPY -> { color: 'YELLOW', depths: [30, 50, 70], dimensions: { width: 320, height: 400 } }
 * Example: SFSKMPP -> { color: 'PURPLE', depths: [30, 50], dimensions: { width: 320, height: 400 } }
 */
export function getMixedPackInfo(sku: string): { color: string, depths: number[], dimensions: { width: number, height: number } } | null {
  if (!sku || !sku.startsWith('SFSKMP')) return null;
  const colorCode = sku.slice(6);
  const colorMap: Record<string, string> = {
    'K': 'Black', 'B': 'Blue', 'G': 'Green', 'O': 'Orange', 'P': 'Purple',
    'R': 'Red', 'T': 'Teal', 'Y': 'Yellow', 'E': 'Grey'
  };
  const color = colorMap[colorCode];
  if (!color) return null;
  // Purple only has 30mm and 50mm, others have 30, 50, 70
  const depths = color === 'Purple' ? [30, 50] : [30, 50, 70];
  return {
    color,
    depths,
    dimensions: { width: 320, height: 400 }
  };
}
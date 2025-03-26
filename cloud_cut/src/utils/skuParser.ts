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
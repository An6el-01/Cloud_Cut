import { inventoryMap } from "./inventoryMap";

interface OrderItem {
    sku: string;
    name: string;
    options: string;
}

export function optimizeItemName(item: OrderItem, orderStatus: string): string {
    const { sku, name, options } = item;
    let optimizedName = name;
    
    //Map the name using the SKU
    const inventoryName = inventoryMap.get(sku);
    if(inventoryName) {
        optimizedName = inventoryName;
    }

    // Check if this is a custom item by:
    // 1. Order status contains "Custom" OR
    // 2. The name/optimizedName contains "Custom" OR
    // 3. Options contains dimensions
    // Use case-insensitive checks for better reliability
    const isCustomItem = 
        (orderStatus && orderStatus.toLowerCase().includes("custom")) || 
        optimizedName.toLowerCase().includes("custom") ||
        (options && (options.includes("Length (mm):") || options.includes("Width (mm):")));

    if(isCustomItem && options){
        const lengthMatch = options.match(/Length \(mm\):(\d+)/);
        const widthMatch = options.match(/Width \(mm\):(\d+)/);
        const length = lengthMatch ? lengthMatch[1] : null;
        const width = widthMatch ? widthMatch[1] : null;

        if(length && width) {
            // Don't add dimensions if they're already in the name
            if(!optimizedName.includes(`Length: ${length}mm`) && !optimizedName.includes(`Width: ${width}mm`)) {
                optimizedName = `${optimizedName} (Length: ${length}mm, Width: ${width}mm)`;
            }
        }
    }
    return optimizedName;
}
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

    // If the order is "Custom", append dimensions with "Length" and "Width" labels
    if(orderStatus === "Custom" && options){
        const lengthMatch = options.match(/Length \(mm\):(\d+)/);
        const widthMatch = options.match(/Width \(mm\):(\d+)/);
        const length = lengthMatch ? lengthMatch[1] : null;
        const width = widthMatch ? widthMatch[1] : null;

        if(length && width) {
            optimizedName = `${optimizedName} (Length: ${length}mm, Width: ${width}mm)`;
        }
    }
    return optimizedName;
}
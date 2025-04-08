import { Order, OrderItem } from "@/types/redux";
import { DespatchCloudOrder } from "@/types/despatchCloud";

export const generateCSV = (orders: Order[], orderItems: Record<string, OrderItem[]>) => {
    const headers = [
        "ID",
        "SKU",
        "OrderID",
        "Width",
        "Length",
        "Quantity",
        "Total_Quantity",
        "Alt_ID",
        "DC_ID",
        "Priority",
    ];

    const rows: string[] = [headers.join(",")];

    //Flatten and sort items by priority
    const allItems = Object.entries(orderItems)
        .flatMap(([orderId, items]) => {
            const order = orders.find((o) => o.order_id === orderId);
            if (!order || order.status !== 'Pending') return [];

            const rawData: DespatchCloudOrder = order.raw_data;
            const inventory = rawData.inventory || [];
            
            // Calculate total quantity by summing up all item quantities
            const totalQuantity = inventory.reduce((sum, item) => sum + (item.quantity || 0), 0);

            return items
                .filter(item => {
                    const sku = item.sku_id.toUpperCase();
                    return sku.startsWith('SFI') || sku.startsWith('SFC');
                })
                .map((item) => {
                    // Parse width and length from extra_info
                    let width = '';
                    let length = '';
                    if (item.extra_info) {
                        const widthMatch = item.extra_info.match(/Width \(mm\):(\d+)/);
                        const lengthMatch = item.extra_info.match(/Length \(mm\):(\d+)/);
                        width = widthMatch ? widthMatch[1] : "";
                        length = lengthMatch ? lengthMatch[1] : "";
                    }

                    // Log the item data for debugging
                    console.log('Processing item:', {
                        id: item.id,
                        order_id: item.order_id,
                        sku: item.sku_id,
                        extra_info: item.extra_info
                    });

                    // Get the channel_order_id from the raw data if available, otherwise use order_id
                    const orderID = rawData.channel_order_id || orderId;

                    return {
                        ID: item.id,
                        SKU: item.sku_id,
                        OrderID: orderID, // Use the order ID (should match the channel_order_id)
                        Width: width,
                        Length: length,
                        Quantity: item.quantity.toString(),
                        Total_Quantity: totalQuantity.toString(),
                        Alt_ID: rawData.channel_alt_id || '',
                        DC_ID: rawData.id.toString(),
                        Priority: item.priority?.toString() || '0',
                    };
                });
        })
        .sort((a, b) => Number(b.Priority) - Number(a.Priority));

    //Convert items to CSV rows
    allItems.forEach((item) => {
        const row = headers.map((header) => `"${item[header as keyof typeof item] || ""}"`).join(",");
        rows.push(row);
    });

    return rows.join("\n");
};

export const downloadCSV = (csvContent: string, fileName: string) => {
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const link = document.createElement("a");
    const url = URL.createObjectURL(blob);
    link.setAttribute("href", url);
    link.setAttribute("download", fileName);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
};
import { DespatchCloudOrder } from "@/types/despatchCloud";

// Color categories
const PRIMARY_COLOURS = ['red', 'yellow', 'blue', 'teal'];
const SECONDARY_COLOURS = ['orange', 'black', 'green'];
const TERTIARY_COLOURS = ['pink', 'purple', 'grey'];

// Calculate Day-X based on 10 PM cutoff and the date_received
export function calculateDayNumber(dateReceived: string): number {
    const received = new Date(dateReceived);
    const now = new Date();
    const cutoffHour = 22;

    // Set cutoff time for today
    const todayCutOff = new Date(now);
    todayCutOff.setHours(cutoffHour, 0, 0, 0);

    // If received after today's cutoff, it starts as Day-1 tomorrow
    if (received > todayCutOff) {
        return 1;
    }

    // Calculate days elapsed, adjusting for cutoff
    let dayNumber = 1;
    const currentDate = new Date(received);
    while (currentDate < now) {
        const nextCutoff = new Date(currentDate);
        nextCutoff.setHours(cutoffHour, 0, 0, 0);
        if (currentDate < nextCutoff && now > nextCutoff) {
            dayNumber++;
        }
        currentDate.setDate(currentDate.getDate() + 1);
    }
    return dayNumber;
}

// Check if order is from Amazon
export function isAmazonOrder(order: DespatchCloudOrder): boolean {
    const accessUrl = order.access_url?.toLowerCase() || '';
    const email = order.email?.toLowerCase() || '';
    return accessUrl.includes('amazon') || email.includes('amazon');
}

// Assign Priority Level
export function getPriorityLevel(
    itemName: string,
    foamSheet: string,
    dayNumber: number,
    isAmazon: boolean,
    isOnHold: boolean = false
): number {
    itemName = itemName.toLowerCase();
    if (isOnHold) return 10;
    if (itemName.includes('manual')) return 0;

    // Handle case where foamSheet is empty or doesn't contain a color
    if (!foamSheet || foamSheet.trim() === 'N/A') {
        if (dayNumber >= 5) return 1;
        if (dayNumber === 4) return 3;
        if (dayNumber === 3) return 5;
        if (dayNumber === 2) return 7;
        if (dayNumber === 1) return 9;
        return 10;
    }

    const color = foamSheet.split(' ')[0].toLowerCase(); // Ensure color is lowercase
    const isPrimary = PRIMARY_COLOURS.includes(color);
    const isSecondary = SECONDARY_COLOURS.includes(color);
    const isTertiary = TERTIARY_COLOURS.includes(color);
    const isMediumSheet = itemName.includes('medium sheet');
    const isRetailOrValuePack = itemName.includes('retail pack') || itemName.includes('value pack');

    // Handle primary color items
    if (isPrimary) {
        if (dayNumber >= 2) return 1;
        if (dayNumber === 1) return 2;
    }

    // Handle secondary color items
    if (isSecondary) {
        if (dayNumber >= 3) return 1;
        if (dayNumber === 2) return 3;
        if (dayNumber === 1) return 6;
    }

    // Handle tertiary color items
    if (isTertiary) {
        if (dayNumber >= 5) return 1;
        if (dayNumber === 4) return 3;
        if (dayNumber === 3) return 5;
        if (dayNumber === 2) return 7;
        if (dayNumber === 1) return 9;
    }

    // Handle medium sheets
    if (isMediumSheet) {
        if (dayNumber >= 2) return 1;
        if (dayNumber === 1) return isAmazon ? 2 : 3;
    }

    // Handle retail or value packs
    if (isRetailOrValuePack) {
        if (dayNumber >= 2) return 1;
        if (dayNumber === 1) return isAmazon ? 2 : 3;
    }

    // Default priority for items that don't match any specific criteria
    if (dayNumber >= 5) return 1;
    if (dayNumber === 4) return 3;
    if (dayNumber === 3) return 5;
    if (dayNumber === 2) return 7;
    if (dayNumber === 1) return 9;
    return 10;
}
/**
 * Serve inventory.csv to client side from server side.
 * 
 * Helps us better map the name, and foam sheet for each item in an order. 
 */

import { NextResponse } from 'next/server';
import fs from 'fs/promises';
import path from "path";

const CSV_FILE = path.join(process.cwd(), 'src', 'csv', 'inventory.csv');

export async function GET() {
    try {
        const csvContent = await fs.readFile(CSV_FILE, 'utf8');
        const lines = csvContent.trim().split('\n');
        const headers = lines[0].split(',').map(h => h.trim());
        const inventory = lines.slice(1).map(line => {
            const values = line.split(',').map(v => v.trim().replace(/^"|"$/g, ''));
            return headers.reduce((obj, header, i) => {
                obj[header] = values[i];
                return obj;
            }, {} as Record<string, string>);
        });
        
        return NextResponse.json(inventory);
    } catch (error) {
        console.error('Error reading inventory.csv:', error);
        return NextResponse.json(
            {
                error: 'Failed to read inventory',
                details: error instanceof Error ? error.message : 'Unknown error',
            },
            { status: 500 }
        );
    }
} 
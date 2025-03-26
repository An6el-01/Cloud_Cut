/**
 * Serve inventory.csv to client side from server side.
 * 
 * Helps us better map the name, and foam sheet for each item in an order. 
 * 
 */

import type { NextApiRequest, NextApiResponse } from "next";
import fs from 'fs/promises';
import path from "path";

const CSV_FILE = path.join(process.cwd(), 'src', 'csv', 'inventory.csv');

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
    try{
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
        res.status(200).json(inventory);
    } catch(error){
        console.error('Error reading inventory.csv:', error);
        res.status(500).json({
            error: 'Failed to read inventory',
            details: error instanceof Error ? error.message : 'Unknown error',
        });
    }
}
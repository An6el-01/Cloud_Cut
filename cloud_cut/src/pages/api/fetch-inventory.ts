/**
 * This file creates an API route that fetches the entire Inventory from Despatch Cloud and writes it to a CSV
 */
import type { NextApiRequest, NextApiResponse } from "next";
import fs from 'fs/promises';
import path from "path";
import { fetchInventory } from "@/utils/despatchCloud";
import { InventoryItem } from "@/types/despatchCloud";

const CSV_DIR = path.join(process.cwd(), 'src', 'csv');
const CSV_FILE = path.join(CSV_DIR, 'inventory.csv');

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    console.log('Starting inventory fetch (all pages)...');
    const inventoryResponse = await fetchInventory(1, 100, {}, 'name_az', true); // Fetch all pages
    console.log('Inventory response received, total items:', inventoryResponse.total);

    const inventoryItems: InventoryItem[] = inventoryResponse.data;
    console.log('Inventory items count:', inventoryItems.length);

    // Prepare CSV content
    const csvHeader = [
      'sku', 'type', 'name', 'stock_available', 'stock_open', 'weight_kg', 'stock_level_available',
      'stock_level_open', 'stockwarn', 'syncstock', 'productweight', 'updated_at'
    ].join(',');

    const csvRows = inventoryItems.map(item => [
      item.sku,
      item.type,
      `"${item.name.replace(/"/g, '""')}"`, // Escape quotes in name
      item.stock_available,
      item.stock_open,
      item.weight_kg,
      item.stock_level_available || '',
      item.stock_level_open || '',
      item.stockwarn || '',
      item.syncstock || '',
      item.productweight || '',
      item.updated_at || '',
    ].join(',')).join('\n');

    const csvContent = `${csvHeader}\n${csvRows}`;
    console.log('CSV content prepared, length:', csvContent.length);

    // Ensure directory exists and write CSV file
    console.log('Creating directory if not exists:', CSV_DIR);
    await fs.mkdir(CSV_DIR, { recursive: true });
    console.log('Writing CSV file to:', CSV_FILE);
    await fs.writeFile(CSV_FILE, csvContent, 'utf8');
    console.log(`Inventory saved to ${CSV_FILE}. Location: ${CSV_DIR}`);

    res.status(200).json({ message: 'Entire inventory fetched and stored', data: inventoryResponse });
  } catch (error) {
    console.error('Error in fetch-inventory API:', error);
    res.status(500).json({
      error: 'Failed to fetch and store inventory',
      details: error instanceof Error ? error.message : 'Unknown error',
      stack: error instanceof Error ? error.stack : undefined,
    });
  }
}
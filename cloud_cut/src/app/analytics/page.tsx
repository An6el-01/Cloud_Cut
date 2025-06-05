"use client";

import React, { useState, useEffect, useRef } from 'react';
import Navbar from '@/components/Navbar';
import { AppDispatch, RootState } from '@/redux/store';
import { useDispatch, useSelector } from 'react-redux';
import dynamic from 'next/dynamic';
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip, LineChart, Line, XAxis, YAxis, CartesianGrid, Legend, BarChart, Bar, Radar, RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis } from 'recharts';
import { useRouter } from 'next/navigation';
import UkSalesMap from '@/components/UkSalesMap';


const FOAM_SHEET_COLOR_HEX: Record<string, string> = {
    'Blue 30mm': '#2563eb',      // Blue
    'Blue 50mm': '#60a5fa',      // Lighter Blue
    'Red 30mm': '#ef4444',       // Red
    'Red 50mm': '#f87171',       // Lighter Red
    'Green 30mm': '#22c55e',     // Green
    'Green 50mm': '#4ade80',     // Lighter Green
    'Orange 30mm': '#f59e42',    // Orange
    'Orange 50mm': '#fdba74',    // Lighter Orange
    'Black 30mm': '#222',        // Black
    'Black 50mm': '#4a4a4a',     // Grayish Black
    'Yellow 30mm': '#fbbf24',    // Yellow
    'Yellow 50mm': '#fde047',    // Lighter Yellow
    'Purple 30mm': '#a855f7',    // Purple
    'Purple 50mm': '#c4b5fd',    // Lighter Purple
    'Pink 30mm': '#ec4899',      // Pink
    'Pink 50mm': '#f9a8d4',      // Lighter Pink
    'Teal 30mm': '#14b8a6',      // Teal
    'Teal 50mm': '#5eead4',      // Lighter Teal
    'Grey 30mm': '#64748b',      // Slate
    'Grey 50mm': '#cbd5e1',      // Lighter Slate
  };
  const OTHERS_COLOR = '#aab1bf'; // Gray for 'Others'
  
  function getFoamSheetColorHex(name: string): string {
    // Try exact match
    if (FOAM_SHEET_COLOR_HEX[name]) return FOAM_SHEET_COLOR_HEX[name];
    // Try to match color and depth with flexible spacing/case
    const match = Object.keys(FOAM_SHEET_COLOR_HEX).find(
      key => key.toLowerCase() === name.toLowerCase()
    );
    if (match) return FOAM_SHEET_COLOR_HEX[match];
    // If 'Others', use neutral
    if (name === 'Others') return OTHERS_COLOR;
    // Fallback: try to match just color
    const color = name.split(' ')[0];
    const fallback = Object.keys(FOAM_SHEET_COLOR_HEX).find(key => key.startsWith(color));
    if (fallback) return FOAM_SHEET_COLOR_HEX[fallback];
    return OTHERS_COLOR;
  }


// Helper: Map UK postcode prefix to county (simplified, covers major areas)
const postcodeToCounty: Record<string, string> = {
    'AB': 'Aberdeenshire', 'AL': 'Hertfordshire', 'B': 'West Midlands', 'BA': 'Somerset', 'BB': 'Lancashire',
    'BD': 'West Yorkshire', 'BH': 'Dorset', 'BL': 'Greater Manchester', 'BN': 'East Sussex', 'BR': 'Greater London',
    'BS': 'Bristol', 'BT': 'Northern Ireland', 'CA': 'Cumbria', 'CB': 'Cambridgeshire', 'CF': 'Cardiff',
    'CH': 'Cheshire', 'CM': 'Essex', 'CO': 'Essex', 'CR': 'Greater London', 'CT': 'Kent', 'CV': 'West Midlands',
    'CW': 'Cheshire', 'DA': 'Kent', 'DD': 'Dundee', 'DE': 'Derbyshire', 'DG': 'Dumfries and Galloway',
    'DH': 'County Durham', 'DL': 'County Durham', 'DN': 'South Yorkshire', 'DT': 'Dorset', 'DY': 'West Midlands',
    'E': 'Greater London', 'EC': 'Greater London', 'EH': 'Edinburgh', 'EN': 'Hertfordshire', 'EX': 'Devon',
    'FK': 'Falkirk', 'FY': 'Lancashire', 'G': 'Glasgow', 'GL': 'Gloucestershire', 'GU': 'Surrey',
    'HA': 'Greater London', 'HD': 'West Yorkshire', 'HG': 'North Yorkshire', 'HP': 'Buckinghamshire',
    'HR': 'Herefordshire', 'HS': 'Outer Hebrides', 'HU': 'East Yorkshire', 'HX': 'West Yorkshire',
    'IG': 'Greater London', 'IP': 'Suffolk', 'IV': 'Inverness', 'KA': 'Ayrshire', 'KT': 'Surrey',
    'KW': 'Caithness', 'KY': 'Fife', 'L': 'Merseyside', 'LA': 'Cumbria', 'LD': 'Powys', 'LE': 'Leicestershire',
    'LL': 'Denbighshire', 'LN': 'Lincolnshire', 'LS': 'West Yorkshire', 'LU': 'Bedfordshire', 'M': 'Greater Manchester',
    'ME': 'Kent', 'MK': 'Buckinghamshire', 'ML': 'Lanarkshire', 'N': 'Greater London', 'NE': 'Tyne and Wear',
    'NG': 'Nottinghamshire', 'NN': 'Northamptonshire', 'NP': 'Newport', 'NR': 'Norfolk', 'NW': 'Greater London',
    'OL': 'Greater Manchester', 'OX': 'Oxfordshire', 'PA': 'Renfrewshire', 'PE': 'Cambridgeshire', 'PH': 'Perthshire',
    'PL': 'Devon', 'PO': 'Hampshire', 'PR': 'Lancashire', 'RG': 'Berkshire', 'RH': 'West Sussex', 'RM': 'Greater London',
    'S': 'South Yorkshire', 'SA': 'Swansea', 'SE': 'Greater London', 'SG': 'Hertfordshire', 'SK': 'Cheshire',
    'SL': 'Berkshire', 'SM': 'Greater London', 'SN': 'Wiltshire', 'SO': 'Hampshire', 'SP': 'Wiltshire',
    'SR': 'Tyne and Wear', 'SS': 'Essex', 'ST': 'Staffordshire', 'SW': 'Greater London', 'SY': 'Shropshire',
    'TA': 'Somerset', 'TD': 'Scottish Borders', 'TF': 'Shropshire', 'TN': 'Kent', 'TQ': 'Devon', 'TR': 'Cornwall',
    'TS': 'North Yorkshire', 'TW': 'Greater London', 'UB': 'Greater London', 'W': 'Greater London', 'WA': 'Cheshire',
    'WC': 'Greater London', 'WD': 'Hertfordshire', 'WF': 'West Yorkshire', 'WN': 'Greater Manchester',
    'WR': 'Worcestershire', 'WS': 'West Midlands', 'WV': 'West Midlands', 'YO': 'North Yorkshire', 'ZE': 'Shetland'
};

function extractCountyFromPostcode(postcode: string): string {
    if (!postcode) return 'Unknown';
    const cleaned = postcode.replace(/\s+/g, '').toUpperCase();
    // Try 2-letter prefix first
    const prefix2 = cleaned.slice(0, 2);
    if (postcodeToCounty[prefix2]) return postcodeToCounty[prefix2];
    // Try 1-letter prefix
    const prefix1 = cleaned.slice(0, 1);
    if (postcodeToCounty[prefix1]) return postcodeToCounty[prefix1];
    return 'Unknown';
}

export default function Analytics() {
    const dispatch = useDispatch<AppDispatch>();
    const { loading, error } = useSelector((state: RootState) => state.orders);
    const [isRefreshing, setIsRefreshing] = useState(false);
    const { orderItems, archivedOrderItems} = useSelector((state: RootState) => state.orders);
    const { packingOrders, manufacturingOrders, archivedOrders } = useSelector((state: RootState) =>  state.orders);


    {/**FOR PIE CHART */}
    // Combine all items from both tables
    const allOrderItems = [
    ...Object.values(orderItems || {}).flat(),
    ...Object.values(archivedOrderItems || {}).flat()
    ];

    //Aggregate by foam sheet, excluding 'N/A'
    const foamSheetMap: Record<string, number> = {};
    allOrderItems.forEach(item => {
        const sheet = item.foamsheet || 'Unknown';
        if (sheet === 'N/A') return; // Exclude N/A
        foamSheetMap[sheet] = (foamSheetMap[sheet] || 0) + (item.quantity || 0);
    });

    //Prepare data for Pie Chart
    const foamSheetData = Object.entries(foamSheetMap)
        .map(([name, value]) => ({ name, value }))
        .sort((a, b) => b.value - a.value);

    // Optionally, limit to top N and group the rest as 'Others'
    const TOP_N = 5;
    const topFoamSheets = foamSheetData.slice(0, TOP_N);
    const othersValue =  foamSheetData.slice(TOP_N).reduce((sum, d) => sum + d.value, 0);
    const pieChartData = [
        ...topFoamSheets,
        ...(othersValue > 0 ? [{ name: 'Others', value: othersValue }] : [])
    ];

    // Combine all orders from both active and archived tables
    const allOrders = [
        ...(manufacturingOrders || []),
        ...(packingOrders || []),
        ...(archivedOrders || [])
    ];

    // Aggregate total quantity per order_date for the last 30 days
    const today = new Date();
    const lastMonth = new Date(today);
    lastMonth.setDate(today.getDate() - 29); // 30 days including today

    // Helper to format date as YYYY-MM-DD
    const formatDate = (date: Date) => date.toISOString().split('T')[0];

    // Build a map of date -> total quantity
    const dateQuantityMap: Record<string, number> = {};
    // Go through all orders (active + archived)
    allOrders.forEach(order => {
        if (!order.order_date) return;
        const dateStr = order.order_date.split('T')[0];
        // Only consider orders in the last 30 days
        const orderDate = new Date(dateStr);
        if (orderDate >= lastMonth && orderDate <= today) {
            // Sum all items for this order
            const items = (orderItems[order.order_id] || []).concat(archivedOrderItems[order.order_id] || []);
            const totalQty = items.reduce((sum, item) => sum + (item.quantity || 0), 0);
            dateQuantityMap[dateStr] = (dateQuantityMap[dateStr] || 0) + totalQty;
        }
    });

    // Prepare data for the line chart: one entry per day for the last 30 days
    const lineChartData = [];
    for (let i = 0; i < 30; i++) {
        const d = new Date(lastMonth);
        d.setDate(lastMonth.getDate() + i);
        const dateStr = formatDate(d);
        lineChartData.push({
            date: dateStr,
            quantity: dateQuantityMap[dateStr] || 0
        });
    }

    // Calculate sales trends data
    const salesTrendsData = lineChartData.map(item => ({
        date: item.date,
        revenue: item.quantity * 10, // Assuming average price of £10 per item
    }));

    // Calculate product performance data
    const productPerformanceData = allOrderItems.reduce((acc: Record<string, number>, item) => {
        const productName = item.item_name;
        acc[productName] = (acc[productName] || 0) + (item.quantity || 0);
        return acc;
    }, {});

    const topProducts = Object.entries(productPerformanceData)
        .map(([name, quantity]) => ({ name, quantity }))
        .sort((a, b) => b.quantity - a.quantity)
        .slice(0, 10);

    // Calculate top customers data
    const customerData = allOrders.reduce((acc: Record<string, { totalOrders: number; totalItems: number }>, order) => {
        const customerName = order.customer_name;
        if (!acc[customerName]) {
            acc[customerName] = { totalOrders: 0, totalItems: 0 };
        }
        acc[customerName].totalOrders++;
        const items = (orderItems[order.order_id] || []).concat(archivedOrderItems[order.order_id] || []);
        acc[customerName].totalItems += items.reduce((sum, item) => sum + (item.quantity || 0), 0);
        return acc;
    }, {});

    const topCustomers = Object.entries(customerData)
        .map(([name, data]) => ({
            name,
            totalOrders: data.totalOrders,
            totalItems: data.totalItems,
            averageOrderSize: data.totalItems / data.totalOrders
        }))
        .sort((a, b) => b.totalItems - a.totalItems)
        .slice(0, 10);

    // Aggregate sales by UK county
    const countySalesMap: Record<string, number> = {};
    allOrders.forEach(order => {
        const postcode = order.raw_data?.shipping_address_postcode || '';
        const country = order.raw_data?.shipping_address_country || order.country || '';
        if (!postcode || !country.toLowerCase().includes('united kingdom')) return;
        const county = extractCountyFromPostcode(postcode);
        // Sum all items for this order
        const items = (orderItems[order.order_id] || []).concat(archivedOrderItems[order.order_id] || []);
        const totalQty = items.reduce((sum, item) => sum + (item.quantity || 0), 0);
        countySalesMap[county] = (countySalesMap[county] || 0) + totalQty;
    });

    return (
        <div className="relative min-h-screen ">
            {/* Navbar */}
            <div className="fixed top-0 left-0 w-full z-10">
                <Navbar/>
            </div>

            {/* Main Content */}
            <div className="pt-52 px-4 sm:px-6 lg:px-8 max-w-7xl mx-auto">
                {/* Grid Layout for Charts */}
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
                    {/* Best Performing Foam Sheets */}
                    <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
                        <div className="bg-gradient-to-r from-blue-600 to-blue-700 p-4">
                            <h2 className="text-xl font-semibold text-white">Best Performing Foam Sheets</h2>
                        </div>
                        <div className="p-4 sm:p-6">
                            <div className="flex flex-col sm:flex-row gap-4 sm:gap-8 lg:gap-11 justify-center items-center">
                                {/* Legend */}
                                <div className="flex flex-row sm:flex-col gap-2 sm:gap-3 justify-center flex-wrap">
                                    {pieChartData.map((entry) => (
                                        <div key={entry.name} className="flex items-center gap-2 min-w-[100px]">
                                            <div
                                                className="w-6 h-3 rounded-full border border-gray-300"
                                                style={{ backgroundColor: getFoamSheetColorHex(entry.name)}}
                                            />
                                            <span className="text-xs sm:text-sm text-gray-700">{entry.name}</span>
                                        </div>   
                                    ))}
                                </div>
                                {/* Pie Chart */}
                                <div className="w-full sm:flex-1 h-[200px] sm:h-[300px]">
                                    <ResponsiveContainer width="100%" height="100%">
                                        <PieChart>
                                            <Pie
                                                data={pieChartData}
                                                dataKey="value"
                                                nameKey="name"
                                                cx="70%"
                                                cy="50%"
                                                outerRadius={80}
                                                fill="#8884d8"
                                                paddingAngle={2}
                                            >
                                                {pieChartData.map((entry, index) => (
                                                    <Cell
                                                        key={`cell-${index}`}
                                                        fill={getFoamSheetColorHex(entry.name)}
                                                    />
                                                ))}
                                            </Pie>
                                            <Tooltip
                                                formatter={(value, name) => [`${value} sheets`, name]}
                                                contentStyle={{
                                                    backgroundColor: 'rgba(255,255,255,0.95)',
                                                    border: '1px solid #ccc',
                                                    borderRadius: '8px',
                                                    fontSize: '12px',
                                                    boxShadow: '0 2px 4px rgba(0,0,0,0.1)'
                                                }}
                                            />
                                        </PieChart>
                                    </ResponsiveContainer>
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* Order Quantities Over Time */}
                    <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
                        <div className="bg-gradient-to-r from-indigo-600 to-indigo-700 p-4">
                            <h2 className="text-xl font-semibold text-white">Order Quantities (Last 30 Days)</h2>
                        </div>
                        <div className="p-4 sm:p-6">
                            <ResponsiveContainer width="100%" height={300}>
                                <LineChart data={lineChartData} margin={{ top: 20, right: 30, left: 0, bottom: 5 }}>
                                    <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                                    <XAxis 
                                        dataKey="date" 
                                        tick={{ fontSize: 12, fill: '#666' }} 
                                        minTickGap={5}
                                        axisLine={{ stroke: '#ccc' }}
                                    />
                                    <YAxis 
                                        tick={{ fontSize: 12, fill: '#666' }} 
                                        allowDecimals={false}
                                        axisLine={{ stroke: '#ccc' }}
                                    />
                                    <Tooltip 
                                        formatter={(value) => [`${value} items`, 'Total Quantity']}
                                        contentStyle={{
                                            backgroundColor: 'rgba(255,255,255,0.95)',
                                            border: '1px solid #ccc',
                                            borderRadius: '8px',
                                            fontSize: '12px',
                                            boxShadow: '0 2px 4px rgba(0,0,0,0.1)'
                                        }}
                                    />
                                    <Legend />
                                    <Line 
                                        type="monotone" 
                                        dataKey="quantity" 
                                        stroke="#4f46e5" 
                                        strokeWidth={3} 
                                        dot={false} 
                                        name="Total Quantity"
                                        activeDot={{ r: 8, fill: '#4f46e5' }}
                                    />
                                </LineChart>
                            </ResponsiveContainer>
                        </div>
                    </div>

                    {/* Sales by County (UK) (Map) */}
                    <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden flex flex-col items-center justify-center h-[500px] lg:h-[600px] w-full">
                        <div className="bg-gray-800 flex items-center justify-between w-full p-3">
                            <span className="text-lg font-semibold text-white">Sales By County (UK)</span>
                            <span className="text-xl">🏴</span>
                        </div>
                        <div className="flex-1 w-full h-full">
                            <UkSalesMap countySalesMap={countySalesMap} />
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}

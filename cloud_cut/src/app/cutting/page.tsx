"use client";

import DxfConverterButton from "@/components/DxfConverterButton";
import { useEffect, useMemo, useRef, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import { AppDispatch, RootState } from "@/redux/store";
import { updateItemCompleted, updateOrderManufacturedStatus } from "@/redux/slices/ordersSlice";
import { selectManufacturingOrders, selectOrderItemsById, selectCurrentViewTotal } from "@/redux/slices/ordersSelectors";
import { OrderItem, Order, NestingItem, ProcessedNestingData, NestingResult, NestingPlacement, NestingPart } from "@/types/redux";
import { supabase, getSupabaseClient } from "@/utils/supabase";
import { store } from "@/redux/store";
import { NestingProcessor } from "@/nesting/nestingProcessor";
import { fetchInventory, reduceStock } from "@/utils/despatchCloud";
import { isColorCodedCompositeSku, getColorCodedCompositeMapping } from "@/nesting/skuMapping";
import RouteProtection from "@/components/RouteProtection";
import { fetchOrdersFromSupabase } from "@/redux/thunks/ordersThunks";
import Navbar from "@/components/Navbar";

export default function Cutting() {
    const dispatch = useDispatch<AppDispatch>();
    const allOrders = useSelector((state: RootState) => state.orders.allOrders);
    const allOrderItems = useSelector((state: RootState) => state.orders.orderItems);
    const [selectedFoamSheet, setSelectedFoamSheet] = useState<string | null>(null);
    const [orderIdsToPacking, setOrderIdsToPacking] = useState<string[]>([]);
    const [orderIdsToMarkCompleted, setOrderIdsToMarkCompleted] = useState<string[]>([]);
    const [pendingManufacturedOrders, setPendingManufacturedOrders] = useState<Set<string>>(new Set());
    const [currentOrderProgress, setCurrentOrderProgress] = useState<string>('0');
    const [nestingQueueData, setNestingQueueData] = useState<Record<string, ProcessedNestingData>>({});
    const [nestingLoading, setNestingLoading] = useState(false);
    const [selectedNestingRow, setSelectedNestingRow] = useState<string | null>(null);
    const [hoveredInsert, setHoveredInsert] = useState<{
        partKey: string;
        mouseX: number;
        mouseY: number;
    } | null>(null);
    const [damagedInserts, setDamagedInserts] = useState<Record<string, boolean>>({});
    const svgContainerRef = useRef<HTMLDivElement>(null);
    const svgRef = useRef<SVGSVGElement>(null);
    const [selectedSheetIndex, setSelectedSheetIndex] = useState<number>(0);
    const userProfile = useSelector((state: RootState) => state.auth.userProfile);
    const [importedNestingData, setImportedNestingData] = useState<{
        foamSheet: string;
        sheetIndex: number;
        nestingData: NestingPlacement;
    } | null>(null);

    useEffect(() => {
        // Try to load nesting data from sessionStorage
        if (typeof window !== 'undefined') {
            const data = window.sessionStorage.getItem('cutting_nesting_data');
            if (data) {
                try {
                    const parsed = JSON.parse(data);
                    if (parsed && parsed.foamSheet && typeof parsed.sheetIndex === 'number' && parsed.nestingData) {
                        setImportedNestingData(parsed);
                    }
                } catch (e) {
                    // Ignore parse errors
                }
            }
        }
    }, []);

    const NESTED_ORDER_COLOURS = [
        '#2196F3',
        '#F44336',
        '#4CAF50',
        '#FF9800',
        '#9C27B0',
        '#607D8B',
        '#FF5722',
        '#E91E63',
        '#00BCD4',
      ];

    const getOrderColor = (orderId: string, index: number) => {
        //Assign color based on the order's position in the uniqueOrders list (index)
        return NESTED_ORDER_COLOURS[index % NESTED_ORDER_COLOURS.length];
    }

    const orderItemsById = useSelector((state: RootState) =>
    allOrders.reduce((acc: Record<string, OrderItem[]>, order: Order) => {
        acc[order.order_id] = selectOrderItemsById(order.order_id)(state);
        return acc;
        }, {} as Record<string, OrderItem[]>)
    );

    const getSheetColorClass = (sheetName: string): string => {
        const name = sheetName.toUpperCase();

        if (name.includes('BLACK')) return 'bg-gray-900';
        if (name.includes('BLUE')) return 'bg-blue-600';
        if (name.includes('GREEN')) return 'bg-green-600';
        if (name.includes('GREY') || name.includes('GRAY')) return 'bg-gray-500';
        if (name.includes('ORANGE')) return 'bg-orange-500';
        if (name.includes('PINK')) return 'bg-pink-500';
        if (name.includes('PURPLE')) return 'bg-purple-600';
        if (name.includes('RED')) return 'bg-red-600';
        if (name.includes('TEAL')) return 'bg-teal-500';
        if (name.includes('YELLOW')) return 'bg-yellow-500';

        // Fallback color if no match is found
        return 'bg-gray-400';
    };

    const handleManufactureOrder = (orderId: string) => {
        //Mark order as manufactured
        setPendingManufacturedOrders(prev => new Set(prev).add(orderId));

        try{
            dispatch(updateOrderManufacturedStatus({ orderId, manufactured: true }));
        } catch (error) {
            console.error("Error marking order as manufactured (handleManufactureOrder):", error);
        }

        // Refresh the orders list after a delay to ensure updates complete
        /**ADD SOMETHING HERE THAT UPDATES THE ORDERS BEING CONSIDERED AS MANUFACTURED */
    }

    const formatSheetName = (sku: string): string => {
        const parts = sku.split('-');
        if (parts.length >= 3){
            const color = parts[1];
            const thickness = parts[2];
            return `${color} [${thickness}]`;
        }
         // For SFSxxY format (where xx is thickness and Y is color code)
    if (sku.startsWith('SFS') && sku.length >= 5) {
        // Extract color code (usually the last character)
        const colorCode = sku.charAt(sku.length - 1);
        // Extract thickness (usually numbers between SFC and color code)
        const thickness = sku.substring(3, sku.length - 1);
  
        // Map color codes to color names
        const colorMap: Record<string, string> = {
          'K': 'Black', 'B': 'Blue', 'G': 'Green', 'O': 'Orange', 'P': 'Purple',
          'R': 'Red', 'T': 'Teal', 'Y': 'Yellow', 'E': 'Grey'
        };
  
        const color = colorMap[colorCode] || colorCode;
        return `${color} [${thickness}mm]`;
      }
      return sku; // Return original if no formatting could be applied
    };

    const generateSVG = (placements: NestingPlacement[], foamSheetName: string): string => {
        const PADDING = 10;
        const VIEWBOX_WIDTH = 1000 + 2 * PADDING;
        const VIEWBOX_HEIGHT = 2000 + 2 * PADDING;

        // Get the selected sheet's placement data
        const selectedSheet = placements[0];
        const allParts = selectedSheet.parts || [];

        // Gather all points after translation/rotation
        let allPoints: { x: number, y: number }[] = [];
        allParts.forEach((part: NestingPart) => {
            if (part.polygons && part.polygons[0]) {
                const angle = (part.rotation || 0) * Math.PI / 180;
                const cos = Math.cos(angle);
                const sin = Math.sin(angle);
                part.polygons[0].forEach(pt => {
                    const x = pt.x * cos - pt.y * sin + (part.x || 0);
                    const y = pt.x * sin + pt.y * cos + (part.y || 0);
                    allPoints.push({ x, y });
                });
            }
        });

        // Compute bounding box of all points
        let minX = allPoints.length > 0 ? Math.min(...allPoints.map(p => p.x)) : 0;
        let minY = allPoints.length > 0 ? Math.min(...allPoints.map(p => p.y)) : 0;
        let maxX = allPoints.length > 0 ? Math.max(...allPoints.map(p => p.x)) : 1000;
        let maxY = allPoints.length > 0 ? Math.max(...allPoints.map(p => p.y)) : 2000;

        //Compute scale to fit the specified viewbox dimensions
        const polyWidth = maxX - minX;
        const polyHeight = maxY - minY;
        const scale = Math.min(
            VIEWBOX_WIDTH / polyWidth,
            VIEWBOX_HEIGHT / polyHeight
        );

        // Compute translation to center polygons in the viewbox
        const offsetX = (VIEWBOX_WIDTH - polyWidth * scale) / 2 - minX * scale;
        const offsetY = (VIEWBOX_HEIGHT - polyHeight * scale) / 2 - minY * scale;

        // SVG Header
        let svgContent = `<?xml version="1.0" encoding="UTF-8"?>
        <svg width="${VIEWBOX_WIDTH}mm" height="${VIEWBOX_HEIGHT}mm" viewBox="0 0 ${VIEWBOX_WIDTH} ${VIEWBOX_HEIGHT}" xmlns="http://www.w3.org/2000/svg">
        <defs>
            <style>
            .viewbox { stroke: #000000; stroke-width: 2; fill: #ffffff; }
            .part { stroke: #000000; stroke-width: 1; fill: none; }
            </style>
        </defs>`;

        // Add viewbox boundary
        const viewboxPolygon = [
            { x: PADDING, y: PADDING },
            { x: 1000 + PADDING, y: PADDING },
            { x: 1000 + PADDING, y: 2000 + PADDING },
            { x: PADDING, y: 2000 + PADDING }
        ];
        const viewboxPoints = viewboxPolygon.map(pt => `${pt.x},${pt.y}`).join(' ');
        svgContent += `
        <polygon points="${viewboxPoints}" class="viewbox" />`;

        //Add all parts
        selectedSheet.parts.forEach((part: NestingPart, partIndex: number) => {
            if (!part.polygons || !part.polygons[0]) return;
            
            // Transform polygon points
            const transformedPoints = part.polygons[0].map(pt => {
              const angle = (part.rotation || 0) * Math.PI / 180;
              const cos = Math.cos(angle);
              const sin = Math.sin(angle);
              const x = pt.x * cos - pt.y * sin + (part.x || 0) + PADDING;
              const y = pt.x * sin + pt.y * cos + (part.y || 0) + PADDING;
              return { x, y };
            });

            const points = transformedPoints.map(pt => `${pt.x},${pt.y}`).join(' ');

            // Add part polygon (outline only, no fill)
            svgContent +=
            `<polygon points="${points}" class="part" />`;
        });
        svgContent += `</svg>`;

        return svgContent;
     }

    // Use importedNestingData if present for visualization and cut details
    // For visualization:
    const visualizationFoamSheet = importedNestingData?.foamSheet || selectedNestingRow;
    const visualizationSheetIndex = importedNestingData?.sheetIndex ?? selectedSheetIndex;
    const visualizationNestingData = importedNestingData?.nestingData || null;

    // For cut details:
    const cutDetailsFoamSheet = importedNestingData?.foamSheet || selectedNestingRow;
    const cutDetailsSheetIndex = importedNestingData?.sheetIndex ?? selectedSheetIndex;
    const cutDetailsNestingData = importedNestingData?.nestingData || null;

    return (
        <div className="min-h-screen">
            <Navbar />

            <div className="w-full flex justify-center pt-10 mb-8 px-4 min-h-[calc(100vh-300px)]">
                <div className="flex flex-col lg:flex-row gap-6 max-w-[2800px] w-fu;; justify-center">
                    {/**Nesting Visualization Section */}
                    <div className="flex-1 min-w-0 max-w-96 flex flex-col bg-gradient-to-br from slate-900/95 via-slate-800/90 to-slate-900/95 rounded-2xl shadow-2xl border border-slate-700/50 backdrop-blur-sm overflow-hidden">
                        {/**Enhanced Header Section */}
                        <div className="relative">
                            {/**Background gradient overlay */}
                            <div className="absolute inset-0 bg-gradient-to-r from-slate-600/20 via-slate-600/20 to-slate-600/20"></div>

                            <div className="relative flex flex-col gap-2 p-4 border-b border-slate-700/50">
                                {/**Compact Title Row */}
                                <div className="flex items-center justify-between">
                                    <div className="flex items-center">
                                        <h1 className="text-lg font-bold text-white tracking-tight">
                                            Nesting Visualization
                                        </h1>
                                    </div>
                                    {/**Compact Status Indicator */}
                                    <div className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                                        visualizationFoamSheet
                                            ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                                            : 'bg-slate-500/20 text-slate-400 border-slate-500/30'
                                    }`}>
                                        {visualizationFoamSheet ? 'Active' : 'Inactive'}
                                    </div>
                                </div>

                                {/**Compact Sheet info and export row */}
                                {visualizationFoamSheet && (
                                    <div className="flex items-center justify-between bg-slate-800/50 rounded-md p-2 border border-slate-600/30">
                                        <div className="flex items-center gap-2">
                                            <div className={`w-2.5 h-2.5 rounded-full ${getSheetColorClass(formatSheetName(visualizationFoamSheet))}`}></div>
                                            <div>
                                                <p className="text-white font-medium text-lg">
                                                    {formatSheetName(visualizationFoamSheet)}
                                                </p>
                                            </div>
                                        </div>  
                                        {(() => {
                                            // Use imported nesting data if present
                                            const placements = visualizationNestingData ? [visualizationNestingData] : [];
                                            if (placements.length === 0) {
                                                return(
                                                    <div className="px-2 py-1 bg-slate-600/30 text-slate-400 text-xs rounded border border-slate-500/30">
                                                        No Data
                                                    </div>
                                                );
                                            }
                                            // Generate SVG content
                                            const svgContent = generateSVG(placements, visualizationFoamSheet);
                                            return (
                                                <DxfConverterButton
                                                    svgContent={svgContent}
                                                    userId={userProfile?.email || ''}
                                                    onConversionSuccess={(dxfUrl) => {
                                                        console.log('DXF conversion successful:', dxfUrl);
                                                    }}
                                                    onConversionError={(error) => {
                                                        console.error('DXF conversion failed:', error);
                                                    }}
                                                />
                                            );
                                        })()}
                                    </div>
                                )}
                            </div>
                        </div>

                        {/**Enhanced Visualization Content Area */}
                        <div className="flex-1 overflow-hidden relative">
                            {visualizationNestingData ? (
                                <div>
                                    {/* Render the visualization for the imported nesting data here */}
                                    {/* You can adapt the existing visualization logic to use visualizationNestingData */}
                                </div>
                            ) : (
                                <div className="flex flex-col items-center justify-center h-full text-slate-400 bg-slate-900/20">
                               
                                </div>
                            )}
                        </div>

                        {/**Nesting Result Information Section */}
                        <div className="flex-[1.2] min-w-0 max-w-[700px] flex flex-col bg-black/70 rounded-xl shadow-xl">
                            <div className="bg-black/70 rounded-t-lg">
                                <h1 className="text-2xl font-bold text-white p-4 flex justify-center">Cut Details</h1>
                            </div>
                            <div className="bg-black/70 border border-gray-200 p-6 h-[calc(100vh-300px)] overflow-y-auto">
                                <div className="overflow-x-auto h-full flex flex-col bg-black/70 rounded-xl shadow-xl">
                                    <table className="w-full text-white border-separate border-spacing-y-2">
                                        <thead>
                                            <tr>
                                                <th className="px-6 py-3 text-center text-lg font-semibold text-white underline"></th>
                                                <th className="px-6 py-3 text-center text-lg font-semibold text-white underline">Customer Name</th>
                                                <th className="px-6 py-3 text-center text-lg font-semibold text-white underline">Order ID</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {(() => {
                                                // Use imported nesting data if present
                                                if (cutDetailsNestingData) {
                                                    // Extract unique orders from the parts in the imported nesting data
                                                    const partsInSheet = cutDetailsNestingData.parts || [];
                                                    const ordersInThisSheet = new Map<string, { orderId: string; customerName: string }>();
                                                    partsInSheet.forEach((part: NestingPart) => {
                                                        const orderId = part.source?.orderId || part.orderId || 'unknown';
                                                        const customerName = part.source?.customerName || part.customerName || '(No Name in Order)';
                                                        const key = `${orderId}-${customerName}`;
                                                        if (!ordersInThisSheet.has(key)) {
                                                            ordersInThisSheet.set(key, { orderId, customerName });
                                                        }
                                                    });
                                                    const uniqueOrdersInSheet = Array.from(ordersInThisSheet.values());
                                                    if(uniqueOrdersInSheet.length === 0) {
                                                        return (
                                                            <tr>
                                                                <td colSpan={3} className="px-6 py-4 text-center text-lg font-semibold text-white h-[calc(100vh-500px)]">
                                                                    <div className="flex items-center justify-center h-full">
                                                                        <p className="text-white text-lg">No orders found in this specific sheet.</p>
                                                                    </div>
                                                                </td>
                                                            </tr>
                                                        );
                                                    }
                                                    return uniqueOrdersInSheet.map((order: { orderId: string; customerName: string }, localIndex: number) => {
                                                        return(
                                                            <tr key={`${order.orderId}-${localIndex}`} className="hover:bg-gray-800/30 transition-colors">
                                                                <td className="px-6 py-4 text-center text-md font-semibold">
                                                                    <span className= "inline-block w-4 h-4 mr-4">
                                                                        {localIndex + 1}
                                                                    </span>
                                                                </td>
                                                                <td className="px-3 py-4 text-center text-md font-semibold text-white">
                                                                    {order.customerName || '(No Name in Order)'}
                                                                </td>
                                                                <td className="px-6 py-4 text-center text-md font-semibold text-white">
                                                                    {order.orderId}
                                                                </td>
                                                            </tr>
                                                        );
                                                    });
                                                }
                                                // Fallback to existing logic if no imported data
                                                // Get the nesting data for the selectedn nest
                                                const selectedFoamSheet = Object.keys(nestingQueueData).find(sheet =>
                                                    formatSheetName(sheet) === selectedNestingRow
                                                );

                                                if (!selectedFoamSheet || !nestingQueueData[selectedFoamSheet]) {
                                                    return(
                                                        <tr>
                                                            <td colSpan={3} className="px-6 py-4 text-center text-lg font-semibold text-white h-[calc(100vh-500px)]">
                                                                <div className="flex items-center justify-center h-full">
                                                                    <p className="text-white text-lg">No nest selected. Please choose a nest from the nesting queue.</p>
                                                                </div>
                                                            </td>
                                                        </tr>
                                                    );
                                                }

                                                //Get the nesting data for the selected foam sheet
                                                const nestingData = nestingQueueData[selectedFoamSheet];
                                                const sheets = nestingData?.nestingResult?.placements || [];

                                                // Check if we have a valid sheet selection
                                                if (sheets.length === 0 || selectedSheetIndex >= sheets.length) {
                                                    return(
                                                        <tr>
                                                            <td colSpan={3} className="px-6 py-4 text-center text-lg font-semibold text-white h-[calc(100vh-500px)]">
                                                                <div className="flex items-center justify-center h-full">
                                                                    <p className="text-white text-lg">No placement data available for this sheet.</p>
                                                                </div>
                                                            </td>
                                                        </tr>
                                                    );
                                                }

                                                // Get the specific selected sheet and its parts
                                                const selectedSheet = sheets[selectedSheetIndex];
                                                const partsInSheet = selectedSheet.parts || [];

                                                // First, get the global unique orders for this entire foam sheet type (for consistent coloring)
                                                const globalUniqueOrders = (() => {
                                                    const items = nestingData?.items || [];
                                                    const grouped = items.reduce((acc: Record<string, { orderId: string; customerName: string; items: NestingItem[] }>, item: NestingItem) => {
                                                        const key = `${item.orderId}-${item.customerName}`;
                                                        if (!acc[key]) {
                                                            acc[key] = { orderId: item.orderId, customerName: item.customerName, items: [] };
                                                        }
                                                        acc[key].items.push(item);
                                                        return acc;
                                                    }, {});
                                                    return Object.values(grouped);
                                                })();

                                                // Extract unique orders from the parts that are actually placed in this specific sheet
                                                const ordersInThisSheet = new Map<string, { orderId: string; customerName: string }>();

                                                partsInSheet.forEach((part: NestingPart) => {
                                                    const orderId = part.source?.orderId || part.orderId || 'unknown';
                                                    const customerName = part.source?.customerName || part.customerName || '(No Name in Order)';
                                                    const key = `${orderId}-${customerName}`;

                                                    if (!ordersInThisSheet.has(key)) {
                                                        ordersInThisSheet.set(key, { orderId, customerName });
                                                    }
                                                });
                                                
                                                const uniqueOrdersInSheet = Array.from(ordersInThisSheet.values());

                                                if(uniqueOrdersInSheet.length === 0) {
                                                    return (
                                                        <tr>
                                                            <td colSpan={3} className="px-6 py-4 text-center text-lg font-semibold text-white h-[calc(100vh-500px)]">
                                                                <div className="flex items-center justify-center h-full">
                                                                    <p className="text-white text-lg">No orders found in this specific sheet.</p>
                                                                </div>
                                                            </td>
                                                        </tr>
                                                    );
                                                }

                                                return uniqueOrdersInSheet.map((order: { orderId: string; customerName: string }, localIndex: number) => {
                                                    // Find the global index of this order for consistent coloring across all sheets
                                                    const globalIndex = globalUniqueOrders.findIndex(globalOrder => 
                                                        globalOrder.orderId === order.orderId && globalOrder.customerName === order.customerName
                                                    );

                                                    return(
                                                        <tr key={`${order.orderId}-${localIndex}`} className="hover:bg-gray-800/30 transition-colors">
                                                            <td className="£px-6 py-4 text-center text-md font-semibold">
                                                                <span className= "inline-block w-4 h-4 mr-4">
                                                                    {globalIndex + 1}
                                                                </span>
                                                                <span
                                                                    className="inline-block w-10 h-3 rounded-full"
                                                                    style={{ backgroundColor: getOrderColor(order.orderId, globalIndex >= 0 ? globalIndex : localIndex)}}
                                                                    title={`Order color for ${order.customerName}`}
                                                                />
                                                            </td>
                                                            <td className="px-3 py-4 text-center text-md font-semibold text-white">
                                                                {order.customerName || '(No Name in Order'}
                                                            </td>
                                                            <td className="px-6 py-4 text-center text-md font-semibold text-white">
                                                                {order.orderId}
                                                            </td>
                                                        </tr>
                                                    );
                                                });
                                            })() as React.ReactNode}
                                        </tbody>
                                    </table>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    )
}
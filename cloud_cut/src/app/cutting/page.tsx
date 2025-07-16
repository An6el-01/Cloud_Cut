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
    // Add state for activeNests
    const [activeNests, setActiveNests] = useState<any[]>([]);
    // Timer state
    const [timerSeconds, setTimerSeconds] = useState<number | null>(null);
    const timerIntervalRef = useRef<NodeJS.Timeout | null>(null);

    // Fetch active_nests on mount
    useEffect(() => {
        const fetchNests = async () => {
            const supabase = getSupabaseClient();
            const { data: active, error: activeError } = await supabase
                .from('active_nests')
                .select('*');
            if (!activeError && active) setActiveNests(active);
        };
        fetchNests();
    }, []);

    // Determine which nest row to use (by foam sheet or nesting id)
    const selectedNestRow = (() => {
        if (importedNestingData?.foamSheet) {
            return activeNests.find(n => n.foamsheet === importedNestingData.foamSheet);
        }
        if (selectedNestingRow) {
            return activeNests.find(n => n.foamsheet === selectedNestingRow);
        }
        return null;
    })();

    // Parse nest and cut_details
    let nestData: any = null;
    let cutDetails: any[] = [];
    if (selectedNestRow) {
        try {
            nestData = selectedNestRow.nest ? JSON.parse(selectedNestRow.nest) : null;
        } catch {}
        try {
            cutDetails = Array.isArray(selectedNestRow.cut_details)
                ? selectedNestRow.cut_details
                : (selectedNestRow.cut_details ? JSON.parse(selectedNestRow.cut_details) : []);
        } catch {}
    }

    // Assign a unique color to each order in cutDetails
    const orderColorMap: Record<string, string> = {};
    cutDetails.forEach((order, idx) => {
        orderColorMap[order.orderId] = NESTED_ORDER_COLOURS[idx % NESTED_ORDER_COLOURS.length];
    });

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

    useEffect(() => {
        // Lock the nest when a sheet is selected and we are on the cutting page
        const lockNest = async () => {
            const foamSheet = importedNestingData?.foamSheet || selectedNestRow?.foamsheet;
            if (!foamSheet) return;
            try {
                const supabase = getSupabaseClient();
                await supabase
                    .from('active_nests')
                    .update({ locked: true })
                    .eq('foamsheet', foamSheet);
            } catch (err) {
                console.error('Failed to lock nest:', err);
            }
        };
        lockNest();

        // Unlock the nest on unmount or tab close
        const unlockNest = async () => {
            const foamSheet = importedNestingData?.foamSheet || selectedNestRow?.foamsheet;
            if (!foamSheet) return;
            try {
                const supabase = getSupabaseClient();
                await supabase
                    .from('active_nests')
                    .update({ locked: false })
                    .eq('foamsheet', foamSheet);
            } catch (err) {
                console.error('Failed to unlock nest:', err);
            }
        };

        const handleBeforeUnload = (e: BeforeUnloadEvent) => {
            unlockNest();
        };
        window.addEventListener('beforeunload', handleBeforeUnload);

        return () => {
            window.removeEventListener('beforeunload', handleBeforeUnload);
            unlockNest();
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [importedNestingData?.foamSheet, selectedNestRow?.foamsheet]);

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


    // Add this helper function for centroid calculation (if not already present)
    const getPolygonCentroid = (pointsArr: {x: number, y: number}[]) => {
        let x = 0, y = 0, len = pointsArr.length;
        for (let i = 0; i < len; i++) {
          x += pointsArr[i].x;
          y += pointsArr[i].y;
        }
        return { x: x / len, y: y / len };
    };

    // Helper to parse time string (e.g., '27m 44s') to seconds
    function parseTimeStringToSeconds(timeStr: string): number {
        if (!timeStr) return 0;
        let total = 0;
        const minMatch = timeStr.match(/(\d+)m/);
        const secMatch = timeStr.match(/(\d+)s/);
        if (minMatch) total += parseInt(minMatch[1], 10) * 60;
        if (secMatch) total += parseInt(secMatch[1], 10);
        return total;
    }

    // Helper to format seconds as mm:ss
    function formatSecondsToMMSS(secs: number): string {
        const m = Math.floor(secs / 60);
        const s = secs % 60;
        return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
    }

    // Start timer when selectedNestRow changes
    useEffect(() => {
        if (timerIntervalRef.current) {
            clearInterval(timerIntervalRef.current);
        }
        if (selectedNestRow && selectedNestRow.time) {
            const initial = parseTimeStringToSeconds(selectedNestRow.time);
            setTimerSeconds(initial);
            if (initial > 0) {
                timerIntervalRef.current = setInterval(() => {
                    setTimerSeconds(prev => {
                        if (prev === null) return null;
                        if (prev <= 1) {
                            if (timerIntervalRef.current) clearInterval(timerIntervalRef.current);
                            return 0;
                        }
                        return prev - 1;
                    });
                }, 1000);
            }
        } else {
            setTimerSeconds(null);
        }
        return () => {
            if (timerIntervalRef.current) clearInterval(timerIntervalRef.current);
        };
    }, [selectedNestRow?.time]);

    return (
        <RouteProtection requiredPermission="canAccessManufacturing">
            <div className="min-h-screen ">
            <Navbar />
                <div className="w-full flex flex-col lg:flex-row gap-6 max-w-[1800px] mx-auto pt-6 px-4 justify-center h-[calc(100vh-80px)]">
                    {/* Nesting Visualization Section */}
                    <div className="flex-1 min-w-0 max-w-2xl flex flex-col bg-gradient-to-br from-slate-900/95 via-slate-800/90 to-slate-900/95 rounded-2xl shadow-2xl border border-slate-700/50 backdrop-blur-sm overflow-hidden h-[85vh] mt-24">
                        {/* Header */}
                            <div className="relative flex flex-col gap-2 p-4 border-b border-slate-700/50">
                                <div className="flex items-center justify-between">
                                <h1 className="text-lg font-bold text-white tracking-tight flex items-center gap-3">
                                            Nesting Visualization
                                    {/* Timer pill */}
                                    {timerSeconds !== null && (
                                        <span className="ml-3 px-4 py-1 rounded-full bg-blue-600 text-white text-base font-semibold shadow border border-blue-400/60">
                                            {formatSecondsToMMSS(timerSeconds)}
                                        </span>
                                    )}
                                        </h1>
                                <div className={`px-2 py-0.5 rounded-full text-xs font-medium ${selectedNestRow ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30' : 'bg-slate-500/20 text-slate-400 border-slate-500/30'}`}>{selectedNestRow ? 'Active' : 'Inactive'}</div>
                                    </div>
                            {selectedNestRow && (
                                <div className="flex items-center justify-between bg-slate-800/50 rounded-md p-2 border border-slate-600/30 mt-2">
                                    <div className="flex items-center gap-2">
                                        <div className={`w-4 h-4 rounded-full ${getSheetColorClass(formatSheetName(selectedNestRow.foamsheet))}`}></div>
                                        <span className="text-white text-lg font-medium">{formatSheetName(selectedNestRow.foamsheet)}</span>
                                    </div>
                                    <div className="flex items-center gap-2">
                                        {/* Cut Finished Button - styled like Export DXF */}
                                        <button
                                            type="button"
                                            className="group relative px-3 py-1.5 rounded-md font-medium transition-all duration-300 shadow overflow-hidden text-xs text-white bg-gradient-to-r from-green-600 to-green-700 hover:from-green-500 hover:to-green-600 border border-green-500/30 hover:shadow-green-500/25 hover:shadow-lg transform hover:scale-105 active:scale-95 flex items-center gap-1.5"
                                        >
                                            <svg xmlns="http://www.w3.org/2000/svg" className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                                            </svg>
                                            <span>Cut finished</span>
                                        </button>
                                        {nestData && nestData.placements && nestData.placements.length > 0 ? (
                                            <DxfConverterButton
                                                svgContent={generateSVG(nestData.placements, selectedNestRow.foamsheet)}
                                                userId={userProfile?.email || ''}
                                                onConversionSuccess={() => {}}
                                                onConversionError={() => {}}
                                            />
                                        ) : (
                                            <div className="px-2 py-1 bg-slate-600/30 text-slate-400 text-xs rounded border border-slate-500/30">No Data</div>
                                        )}
                                    </div>
                                </div>
                            )}
                        </div>
                        {/* Visualization Content */}
                        <div className="flex-1 overflow-auto relative bg-slate-900/80 flex items-center justify-center h-0 min-h-0">
                            {nestData && nestData.placements && nestData.placements.length > 0 ? (
                                (() => {
                                    const selectedSheet = nestData.placements[0];
                                    const allParts: any[] = selectedSheet.parts || [];
                                    let allPoints: {x: number, y: number}[] = [];
                                    allParts.forEach((part) => {
                                        if (part.polygons && part.polygons[0]) {
                                            const angle = (part.rotation || 0) * Math.PI / 180;
                                            const cos = Math.cos(angle);
                                            const sin = Math.sin(angle);
                                            part.polygons[0].forEach((pt: any) => {
                                                const x = pt.x * cos - pt.y * sin + (part.x || 0);
                                                const y = pt.x * sin + pt.y * cos + (part.y || 0);
                                                allPoints.push({ x, y });
                                            });
                                        }
                                    });
                                    const PADDING = 10;
                                    const VIEWBOX_WIDTH = 1000 + 2 * PADDING;
                                    const VIEWBOX_HEIGHT = 2000 + 2 * PADDING;
                                    const viewBox = `0 0 ${VIEWBOX_WIDTH} ${VIEWBOX_HEIGHT}`;
                                    return (
                                        <svg
                                            width="100%"
                                            height="100%"
                                            viewBox={viewBox}
                                            style={{ background: 'linear-gradient(135deg, rgba(30,41,59,0.95) 0%, rgba(30,41,59,0.9) 50%, rgba(30,41,59,0.95) 100%)', width: '100%', height: '100%' }}
                                        >
                                            {/* Bin polygon */}
                                            <polygon
                                                points={`${PADDING},${PADDING} ${1000 + PADDING},${PADDING} ${1000 + PADDING},${2000 + PADDING} ${PADDING},${2000 + PADDING}`}
                                                fill="black"
                                                opacity="0.6"
                                            />
                                            <g transform={`scale(1,-1) translate(0, -${VIEWBOX_HEIGHT})`}>
                                                {selectedSheet.parts.map((part: any, partIndex: number) => {
                                                    if (!part.polygons || !part.polygons[0]) return null;
                                                    // Assign color by orderId using orderColorMap
                                                    const orderId = part.source?.orderId || part.orderId || '';
                                                    const fillColor = orderColorMap[orderId] || NESTED_ORDER_COLOURS[partIndex % NESTED_ORDER_COLOURS.length];
                                                    const orderIdx = cutDetails.findIndex(order => order.orderId === orderId);
                                                    const displayNumber = orderIdx >= 0 ? orderIdx + 1 : '';
                                                    const pointsArr = part.polygons[0].map((pt: any) => {
                                                        const angle = (part.rotation || 0) * Math.PI / 180;
                                                        const cos = Math.cos(angle);
                                                        const sin = Math.sin(angle);
                                                        let x = pt.x * cos - pt.y * sin + (part.x || 0) + PADDING;
                                                        let y = pt.x * sin + pt.y * cos + (part.y || 0) + PADDING;
                                                        return { x, y };
                                                    });
                                                    const points = pointsArr.map((pt: {x: number, y: number}) => `${pt.x},${pt.y}`).join(' ');
                                                    const centroid = getPolygonCentroid(pointsArr);
                                                    const scale = Math.min(VIEWBOX_WIDTH / 1000, VIEWBOX_HEIGHT / 2000);
                                                    return (
                                                        <>
                                                            <polygon
                                                                key={partIndex}
                                                                points={points}
                                                                fill={fillColor}
                                                                fillOpacity={0.7}
                                                                stroke="#fff"
                                                                strokeWidth="2"
                                                            />
                                                            {/* Add order index number at centroid, matching color legend */}
                                                            <text
                                                                x={centroid.x}
                                                                y={centroid.y}
                                                                textAnchor="middle"
                                                                dominantBaseline="middle"
                                                                fontSize={`${40 * scale}px`}
                                                                fill="#fff"
                                                                fontWeight="bold"
                                                                pointerEvents="none"
                                                                transform={`scale(1,-1) translate(0, -${2 * centroid.y})`}
                                                            >
                                                                {displayNumber}
                                                            </text>
                                                        </>
                                                    );
                                                })}
                                            </g>
                                        </svg>
                                    );
                                })()
                            ) : (
                                <div className="flex flex-col items-center justify-center h-full text-slate-400 bg-slate-900/20">
                                    <span>No nesting data available.</span>
                                </div>
                            )}
                        </div>
                    </div>
                    {/* Cut Details and Cut Finished Button as siblings in a flex row */}
                    <div className="flex flex-row items-center">
                        {/* Cut Details Section */}
                        <div className="flex-1 min-w-0 max-w-4xl flex flex-col bg-black/80 rounded-2xl shadow-2xl border border-white backdrop-blur-sm overflow-hidden h-[85vh] mt-24">
                            <div className="bg-black/80 rounded-t-lg border-b border-slate-200/50 p-4">
                                <h1 className="text-2xl font-bold text-white text-center">Cut Details</h1>
                            </div>
                            <div className="bg-black/80 p-6 flex-1 overflow-auto relative">
                                    <table className="w-full text-white border-separate border-spacing-y-2">
                                        <thead>
                                            <tr>
                                                <th className="px-6 py-3 text-center text-lg font-semibold text-white underline"></th>
                                                <th className="px-6 py-3 text-center text-lg font-semibold text-white underline">Customer Name</th>
                                                <th className="px-6 py-3 text-center text-lg font-semibold text-white underline">Order ID</th>
                                        <th className="px-6 py-3 text-center text-lg font-semibold text-white underline">Print</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                    {cutDetails.length > 0 ? (
                                        cutDetails.map((order, idx) => (
                                            <tr key={`${order.orderId}-${idx}`} className="hover:bg-gray-800/30 transition-colors">
                                                                <td className="px-6 py-4 text-center text-md font-semibold">
                                                    <span className="inline-block w-4 h-4 mr-4">{idx + 1}</span>
                                                    <span
                                                        className="inline-block w-10 h-3 rounded-full"
                                                        style={{ backgroundColor: orderColorMap[order.orderId] }}
                                                        title={`Order color for ${order.customerName}`}
                                                    ></span>
                                                                </td>
                                                <td className="px-3 py-4 text-center text-md font-semibold text-white">{order.customerName || '(No Name in Order)'}</td>
                                                <td className="px-6 py-4 text-center text-md font-semibold text-white">{order.orderId}</td>
                                                <td className="px-6 py-4 text-center">
                                                    <button className="text-white hover:text-blue-400 transition-colors">
                                                        <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" />
                                                        </svg>
                                                    </button>
                                                                </td>
                                                            </tr>
                                        ))
                                    ) : (
                                                        <tr>
                                                            <td colSpan={3} className="px-6 py-4 text-center text-lg font-semibold text-white h-[calc(100vh-500px)]">
                                                                <div className="flex items-center justify-center h-full">
                                                                    <p className="text-white text-lg">No nest selected. Please choose a nest from the nesting queue.</p>
                                                                </div>
                                                            </td>
                                                        </tr>
                                    )}
                                        </tbody>
                                    </table>
                            {/* Print All Orders Button at the bottom */}
                            <div className="w-full flex justify-center absolute left-0 bottom-0 p-4 bg-black/80 z-10">
                                <button className="px-6 py-3 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-lg shadow transition-all">
                                    Print All Orders
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
        </RouteProtection>
    );
}
"use client"

import NavBar from "@/components/Navbar";
import { useEffect, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import { AppDispatch, RootState} from '@/redux/store';
import * as Sentry from '@sentry/nextjs';
import Image from "next/image";
import { fetchFinishedStockFromSupabase, syncFinishedStock } from "@/redux/thunks/stockThunk";
import { getSupabaseClient } from "@/utils/supabase";
import SheetBookingOut from "@/components/sheetBookingOut";
import { increaseStock, reduceStock, updateStockItem } from '@/utils/despatchCloud';
import { table } from "console";

// Define the type for stock items
interface StockItem {
    id: number;
    sku: string;
    stock: number;
    item_name: string;
    created_at: string;
    updated_at: string;
}


// Add helper function to get color class for medium sheet
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
    
    return 'bg-gray-400';
};

export default function Stock() {
    const dispatch = useDispatch<AppDispatch>();
    const [activeTab, setActiveTab] = useState<'StockManagement' | 'DamageTracking'>('StockManagement');
    const {loading, error, items} = useSelector((state: RootState) => state.stock);
    const userProfile = useSelector((state: RootState) => state.auth.userProfile);
    const [currentPage, setCurrentPage] = useState(1);
    const itemsPerPage = 15;
    const [searchQuery, setSearchQuery] = useState('');
    const [editingItem, setEditingItem] = useState<StockItem | null>(null);
    const [editValue, setEditValue] = useState<number>(0);
    const [quickAdjustEditValue, setQuickAdjustEditValue] = useState<number>(0);
    const [quickAdjustItem, setQuickAdjustItem] = useState<StockItem | null>(null);
    const [deleteConfirmItem, setDeleteConfirmItem] = useState<StockItem | null>(null);
    const [tableTab, setTableTab] = useState<'Medium Sheets' | '2 X 1 Sheets' | 'Packing Boxes' | 'Retail Packs'>('2 X 1 Sheets');
    const [showSheetBookingOut, setShowSheetBookingOut] = useState(false);
    const [damageTrackingTab, setDamageTrackingTab] = useState<'Aesthetic' | 'Dimensional'>('Aesthetic');
    const [damageTitleTab, setDamageTitleTab] = useState<'2 X 1 Sheets' | 'Medium Sheets' | 'Accessories' | 'Inserts'>('2 X 1 Sheets');
    const [selectedDepth, setSelectedDepth] = useState<'30mm' | '50mm' | '70mm'>('30mm');
    const [selectedTimeRange, setSelectedTimeRange] = useState<'1 Month' | '6 Months' | '1 Year'>('1 Month');
    const [quickAdjustError, setQuickAdjustError] = useState<string | null>(null);


    // Check if user has restricted role
    const isRestrictedRole = userProfile?.role === 'Operator' || userProfile?.role === 'Packer';

    // If user has restricted role, show access denied message
    if (isRestrictedRole) {
        console.log('Showing restricted access UI');
        return (
            <>
                <NavBar />
                <SheetBookingOut />
            </>
        );
    }

    // Filter items to only show medium sheets and apply search filter
    const mediumSheetItems = items
        .filter(item => item.sku?.toLowerCase().includes('sfs-100/50'))
        .filter(item => 
            item.item_name.toLowerCase().includes(searchQuery.toLowerCase()) ||
            item.sku.toLowerCase().includes(searchQuery.toLowerCase()) ||
            item.stock.toString().includes(searchQuery)
        );

    const twoByOneItems = items
        .filter(item => /^SFS\d+[A-Z]$/.test(item.sku?.toUpperCase() || ''))
        .filter(item => 
            item.item_name.toLowerCase().includes(searchQuery.toLowerCase()) ||
            item.sku.toLowerCase().includes(searchQuery.toLowerCase()) ||
            item.stock.toString().includes(searchQuery)
        );

    const packingBoxItems = items
        .filter(item => item.sku?.toUpperCase().startsWith('SHA'))
        .filter(item => 
            item.item_name.toLowerCase().includes(searchQuery.toLowerCase()) ||
            item.sku.toLowerCase().includes(searchQuery.toLowerCase()) ||
            item.stock.toString().includes(searchQuery)
        );

    const retailPackItems = items
        .filter(item => {
            const matches = item.item_name.toLowerCase().includes('retail pack');
            return matches;
        })
        .filter(item => 
            item.item_name.toLowerCase().includes(searchQuery.toLowerCase()) ||
            item.sku.toLowerCase().includes(searchQuery.toLowerCase()) ||
            item.stock.toString().includes(searchQuery)
        );
        
    
    // Calculate pagination
    const totalPages = Math.ceil(mediumSheetItems.length / itemsPerPage);
    const totalTwoByOnePages = Math.ceil(twoByOneItems.length / itemsPerPage);
    const totalPackingBoxPages = Math.ceil(packingBoxItems.length / itemsPerPage);
    const totalRetailPackPages = Math.ceil(retailPackItems.length / itemsPerPage);
    const startIndex = (currentPage - 1) * itemsPerPage;
    const endIndex = startIndex + itemsPerPage;
    const currentMediumSheetItems = mediumSheetItems.slice(startIndex, endIndex);
    const currentTwoByOneItems = twoByOneItems.slice(startIndex, endIndex);
    const currentPackingBoxItems = packingBoxItems.slice(startIndex, endIndex);
    const currentRetailPackItems = retailPackItems.slice(startIndex, endIndex);

    useEffect(() => {
        dispatch(fetchFinishedStockFromSupabase({
            page: 1,
            perPage: 15
        }));
    }, [dispatch]);

    const handlePageChange = (newPage: number) => {
        setCurrentPage(newPage);
    };


    const handleEdit = async (item: StockItem) => {
        try { 
            
            //Get the current session from Supabase
            const supabase = getSupabaseClient();
            const { data: { session } } = await supabase.auth.getSession();

            if(!session) {
                console.error("You must be logged in to edit stock item");
                return;
            }

            //Find the item with matching sku from the session
            const currentItem = items.find(i => i.sku === item.sku);

            const allowedRoles = ['GlobalAdmin', 'SiteAdmin', 'Manager'];
            
            if (!userProfile || !allowedRoles.includes(userProfile.role)) {
                console.error("You do not have permission to edit stock items");
                return;
            }

            // Set the item being edited and its current stock value
            setEditingItem(item);
            setEditValue(item.stock);
            // Clear quick adjust state to prevent conflicts
            setQuickAdjustEditValue(0);
            setQuickAdjustItem(null);
            
        } catch (error) {
            console.error("Error in handleEdit:", error);
        }
    }  

    const handleSave = async () => {
        if (!editingItem) return;

        try {
            const supabase = getSupabaseClient();
            // First update Supabase
            const { error } = await supabase
                .from('finished_stock')
                .update({ 
                    stock: editValue,
                    updated_at: new Date().toISOString()
                })
                .eq('sku', editingItem.sku);

            if (error) {
                console.error("Error updating stock in Supabase:", error);
                return;
            }

            // Always update DespatchCloud for any item
            try {
                

                // Find the corresponding DespatchCloud inventory item (by id)
                // We already have editingItem.id, which should match the inventoryId in DespatchCloud
                if (typeof editingItem.id === 'number') {
                    await updateStockItem(editingItem.id,{stock_level: editValue.toString()}, 1);
                    console.log('Successfully updated DespatchCloud inventory');
                } else {
                    // Fallback: fetch id from Supabase if not present
                const { data: inventoryItem } = await supabase
                    .from('finished_stock')
                    .select('id')
                    .eq('sku', editingItem.sku)
                    .single();
                if (inventoryItem && typeof inventoryItem.id === 'number') {
                    await updateStockItem(inventoryItem.id, { stock_level: editValue.toString()
                    }, 0,
                    );
                        console.log('Successfully updated DespatchCloud inventory (fallback)');
                    } else {
                        console.warn('Could not find inventory id for DespatchCloud update');
                    }
                }
            } catch (despatchError) {
                console.error("Error updating DespatchCloud inventory:", despatchError);
                // Continue with the UI update even if DespatchCloud update fails
            }

            // Clear editing state first
            setEditingItem(null);
            setEditValue(0);
            setQuickAdjustEditValue(0);
            setQuickAdjustItem(null);

            // Then refresh the stock data
            await dispatch(fetchFinishedStockFromSupabase({
                page: currentPage,
                perPage: itemsPerPage
            })).unwrap();

        } catch (error) {
            console.error("Error saving stock update:", error);
            // Optionally show an error message to the user
        }
    }

    const handleCancel = () => {
        setEditingItem(null);
        setEditValue(0);
        setQuickAdjustEditValue(0);
        setQuickAdjustItem(null);
    }

    const handleDelete = async (item: StockItem) => {
        try {
            //Get the current session from Supabase
            const supabase = getSupabaseClient();
            const { data: { session } } = await supabase.auth.getSession();

            if(!session) {
                console.error("You must be logged in to delete stock item");
                return;
            }

            const allowedRoles = ['GlobalAdmin', 'SiteAdmin', 'Manager'];
            
            if (!userProfile || !allowedRoles.includes(userProfile.role)) {
                console.error("You do not have permission to delete stock items");
                console.log(userProfile?.role);
                return;
            }

            // Set the item to be deleted for confirmation
            setDeleteConfirmItem(item);
            
        } catch (error) {
            console.error("Error in handleDelete:", error);
        }
    }

    const confirmDelete = async () => {
        if (!deleteConfirmItem) return;

        try {
            const supabase = getSupabaseClient();
            const { error } = await supabase
                .from('finished_stock')
                .delete()
                .eq('sku', deleteConfirmItem.sku);

            if (error) {
                console.error("Error deleting stock item:", error);
                return;
            }

            // Refresh the stock data
            dispatch(fetchFinishedStockFromSupabase({
                page: currentPage,
                perPage: itemsPerPage
            }));

            // Clear delete confirmation state
            setDeleteConfirmItem(null);
        } catch (error) {
            console.error("Error confirming delete:", error);
        }
    }

    const cancelDelete = () => {
        setDeleteConfirmItem(null);
    }

    const handleTableTabChange = (tab: 'Medium Sheets' | '2 X 1 Sheets' | 'Packing Boxes' | 'Retail Packs') => {
        setTableTab(tab);
        setCurrentPage(1);  // Reset to page 1 when switching tabs
    };

    const handleSubmit = () => {
        console.log('Report Damage Form Submitted');
    }

    const handleDamageTrackingTabChange = (tab: 'Aesthetic' | 'Dimensional') => {
        setDamageTrackingTab(tab);
    }
    // Mock data for the bar graph - replace with real data from your backend
    const getBarGraphData = () => {
        const colors = ['Blue', 'Green', 'Black', 'Orange', 'Red', 'Teal', 'Yellow', 'Pink', 'Purple', 'Grey'];
        const mockData = {
            '30mm': [4, 3, 2, 1, 5, 3, 2, 1, 4, 2],
            '50mm': [3, 4, 1, 2, 4, 2, 3, 2, 3, 1],
            '70mm': [2, 2, 3, 4, 3, 1, 1, 3, 2, 2]
        };
        
        return colors.map((color, index) => ({
            color,
            value: mockData[selectedDepth][index] || 0
        }));
    };

    const handleQuickAdjustAdd = async (item: StockItem, quantity: number) => {
        try{
            // Validate the quantity
            if (quantity <= 0) {
                setQuickAdjustError('Quantity must be greater than 0');
                return;
            }

            const supabase = getSupabaseClient();

            //Update the stock in Supabase
            const { error: updateError } = await supabase
                .from('finished_stock')
                .update({
                    stock: item.stock + quantity,
                    updated_at: new Date().toISOString()
                })
                .eq('sku', item.sku);
            if(updateError){
                setQuickAdjustError('Failed to update stock in supabase: ' + updateError.message);
                return;
            }

            //Update the stock in DespatchCloud
            try{
                if(tableTab === '2 X 1 Sheets'){
                    await increaseStock(item.id, quantity);
                    console.log('Successfully updated DespatchCloud inventory');
                } else {
                    console.warn('Could not find inventory id for DespatchCloud update');
                } 
            } catch (despatchError) {
                console.error("Error updating DespatchCloud inventory:", despatchError);
            }

            // Refresh the stock data to reflect changes immediately
            await dispatch(fetchFinishedStockFromSupabase({
                page: currentPage,
                perPage: itemsPerPage
            }));

            // Clear any previous errors on success
            setQuickAdjustError(null);

        } catch (err: any) {
            setQuickAdjustError('Error on quick adjust add: ' + (err.message || err.toString()));
        }
        setQuickAdjustItem(null);
        setQuickAdjustEditValue(0);
    };

    const handleQuickAdjustSubtract = async (item: StockItem, quantity: number) => {
        try{
            // Validate the quantity
            if (quantity <= 0) {
                setQuickAdjustError('Quantity must be greater than 0');
                return;
            }
            
            if (quantity > item.stock) {
                setQuickAdjustError('Cannot subtract more than current stock');
                return;
            }

            const supabase = getSupabaseClient();

            //Update the stock in Supabase
            const { error: updateError } = await supabase
                .from('finished_stock')
                .update({
                    stock: item.stock - quantity,
                    updated_at: new Date().toISOString()
                })
                .eq('sku', item.sku);
            if(updateError){
                setQuickAdjustError('Failed to update stock in supabase: ' + updateError.message);
                return;
            }

            //Update the stock in DespatchCloud
            try{
                if(tableTab === '2 X 1 Sheets'){
                    await reduceStock(item.id, quantity);
                    console.log('Successfully updated DespatchCloud inventory');
                } else {
                    console.warn('Could not find inventory id for DespatchCloud update');
                }
            } catch (despatchError) {
                console.error("Error updating DespatchCloud inventory:", despatchError);
            }

            // Refresh the stock data to reflect changes immediately
            await dispatch(fetchFinishedStockFromSupabase({
                page: currentPage,
                perPage: itemsPerPage
            }));

            // Clear any previous errors on success
            setQuickAdjustError(null);

        } catch (err: any) {
            setQuickAdjustError('Error on quick adjust subtract: ' + (err.message || err.toString()));
        }
        setQuickAdjustItem(null);
        setQuickAdjustEditValue(0);
    }

    return (
        <div className="min-h-screen">
            {/**NavBar */}
            <NavBar />

            {/**Pill Section */}
            <div className="container mx-auto pt-28 flex justify-center gap-8">
                <div className="flex justify-center">
                    <div className="relative bg-[#2b3544] rounded-full shadow-xl p-1 inline-flex border border-gray-700 w-[450px] overflow-hidden">
                        {/* Sliding background that moves based on active tab */}
                        <div className={`sliding-pill ${activeTab === 'StockManagement' ? 'pill-first' : 'pill-second'}`}></div>
                        {/* Stock Management Tab */}
                        <button
                            onClick={async () => {
                                await Sentry.startSpan({
                                    name: 'setActiveTab-StockManagement',
                                }, async () => {
                                    setActiveTab('StockManagement');
                                });
                            }}
                            className="relative rounded-full font-medium transition-all duration-300 z-10 flex-1 flex items-center justify-center py-2 px-6 min-w-[150px] h-12"
                        >
                            <span className={`relative z-10 flex items-center justify-center gap-2 px-2 whitespace-nowrap ${
                                activeTab === 'StockManagement' ? 'text-white font-semibold' : 'text-gray-300 hover:text-white'
                            }`}>
                                {/* Clipboard Icon */}
                                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 flex-shrink-0 mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 2a1 1 0 00-1 1v1H7a2 2 0 00-2 2v14a2 2 0 002 2h10a2 2 0 002-2V6a2 2 0 00-2-2h-1V3a1 1 0 00-1-1H9zm0 2h6v1H9V4z" />
                                </svg>
                                Stock Management
                            </span>
                        </button>
                        {/* Damage Tracking Tab */}
                        <button
                            onClick={async () => {
                                await Sentry.startSpan({
                                    name: 'setActiveTab-DamageTracking',
                                }, async () => {
                                    setActiveTab('DamageTracking');
                                });
                            }}
                            className="relative rounded-full font-medium transition-all duration-300 z-10 flex-1 flex items-center justify-center py-2 px-6 min-w-[150px] h-12"
                        >
                            <span className={`relative z-10 flex items-center justify-center gap-2 px-2 whitespace-nowrap ${
                                activeTab === 'DamageTracking' ? 'text-white font-semibold' : 'text-gray-300 hover:text-white'
                            }`}>
                                {/* Warning Icon */}
                                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 flex-shrink-0 mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01M21 20H3a2 2 0 01-1.72-2.97l9-16a2 2 0 013.44 0l9 16A2 2 0 0121 20z" />
                                </svg>
                                Damage Tracking
                            </span>
                        </button>
                    </div>
                </div>
            </div>
            
            {/**Stock Management Tab */}
            {activeTab === 'StockManagement' && (
                <div className="container mx-auto pt-10 mb-8 p-6 flex justify-center gap-8">
                {/**Stock Table */}
                <div className="flex-1 max-w-8xl">
                    <div className="bg-[#1d1d1d]/90 rounded-t-lg backdrop-blur-sm p-4">
                        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
                            <h1 className="text-white text-3xl font-semibold">
                                {tableTab === 'Medium Sheets' ? 'Medium Sheet Stock' : tableTab === '2 X 1 Sheets' ? '2 X 1 Stock' : tableTab === 'Packing Boxes' ? 'Packing Boxes Stock' : 'Retail Packs Stock'}
                            </h1>

                            <div className="flex flex-wrap items-center gap-3">
                                <div className="flex items-center gap-4">
                                    {/* Search Bar */}
                                    <div className="relative">
                                        <input
                                            type="text"
                                            placeholder="Search items..."
                                            value={searchQuery}
                                            onChange={(e) => setSearchQuery(e.target.value)}
                                            className="w-64 px-4 py-2 rounded-lg border border-gray-300 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                                        />
                                        <svg
                                            className="absolute right-3 top-2.5 h-5 w-5 text-gray-400"
                                            xmlns="http://www.w3.org/2000/svg"
                                            viewBox="0 0 20 20"
                                            fill="currentColor"
                                        >
                                            <path
                                                fillRule="evenodd"
                                                d="M8 4a4 4 0 100 8 4 4 0 000-8zM2 8a6 6 0 1110.89 3.476l4.817 4.817a1 1 0 01-1.414 1.414l-4.816-4.816A6 6 0 012 8z"
                                                clipRule="evenodd"
                                            />
                                        </svg>
                                    </div>
                                    {/* Sheet Booking Out Toggle Button */}
                                    {tableTab === '2 X 1 Sheets' && (
                                        <button
                                            className="flex items-center gap-2 px-4 py-2 text-white font-semibold rounded-lg shadow transition-all duration-200 bg-gradient-to-br from-blue-600 to-blue-700 hover:from-blue-500 hover:to-blue-600 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-400"
                                            aria-label="Sheet Booking Out"
                                            onClick={() => setShowSheetBookingOut((prev) => !prev)}
                                        >
                                            Sheet Booking Out
                                        </button>
                                    )}
                                    {/* Add New Item Button */}
                                    <button
                                        className="flex items-center gap-2 px-4 py-2 text-white font-semibold rounded-lg shadow transition-all duration-200 bg-gradient-to-br from-green-600 to-green-700 hover:from-green-500 hover:to-green-600 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-green-400"
                                        aria-label="Add New Item"
                                    >
                                        <span>
                                            Add New Item
                                        </span>
                                    </button>
                                </div>
                            </div>
                        </div>

                        {/* Quick Adjust Error Display */}
                        {quickAdjustError && (
                            <div className="mt-4 p-3 bg-red-100 border border-red-400 text-red-700 rounded-lg flex items-center justify-between">
                                <span>{quickAdjustError}</span>
                                <button
                                    onClick={() => setQuickAdjustError(null)}
                                    className="text-red-500 hover:text-red-700 font-bold text-xl"
                                >
                                    ×
                                </button>
                            </div>
                        )}

                        {/**Navigation Tools */}
                        <div className="mt-4 mb-2">
                            <div>
                                <button
                                    className={`px-4 py-2 text-md font-medium ${tableTab === '2 X 1 Sheets' ? 'text-white border-b-2 border-white' : 'text-gray-500 border-border-transparent'} bg-transparent focus:outline-none`}
                                    style={{ marginBottom: '-1px' }}
                                    onClick={() => handleTableTabChange('2 X 1 Sheets')}
                                >
                                    2 X 1
                                </button>
                                <button
                                    className={`px-4 py-2 text-md font-medium ${tableTab === 'Medium Sheets' ? 'text-white border-b-2 border-white' : 'text-gray-500 border-border-transparent'} bg-transparent focus:outline-none`}
                                    style={{ marginBottom: '-1px' }}
                                    onClick={() => handleTableTabChange('Medium Sheets')}
                                >
                                    Medium Sheets
                                </button>
                                <button
                                    className={`px-4 py-2 text-md font-medium ${tableTab === 'Packing Boxes' ? 'text-white border-b-2 border-white' : 'text-gray-500 border-border-transparent'} bg-transparent focus:outline-none`}
                                    style={{ marginBottom: '-1px' }}
                                    onClick={() => handleTableTabChange('Packing Boxes')}
                                >
                                    Packing Boxes
                                </button>
                                <button
                                    className={`px-4 py-2 text-md font-medium ${tableTab === 'Retail Packs' ? 'text-white border-b-2 border-white' :
                                        'text-gray-500 border-border-transparent'} bg-transparent focus:outline-none`}
                                        style={{ marginBottom: '-1px' }}
                                        onClick={() => handleTableTabChange('Retail Packs')}
                                >
                                    Retail Packs
                                </button>
                               
                            </div>
                        </div>

                    </div>
                    <div className="overflow-x-auto bg-white h-[calc(94vh-300px)] flex flex-col">
                        {tableTab === '2 X 1 Sheets' ? (
                            <div className="flex-1 flex flex-col">
                                <div className="flex-1 overflow-y-auto">
                                    <table className="w-full bg-white/90 backdrop-blur-sm border border-gray-20 table-auto">
                                        <thead className="bg-gray-100/90 sticky top-0">
                                            <tr>
                                                <th className="px-4 py-4 text-left text-black text-md">2 X 1</th>
                                                <th className="px-4 py-4 text-center text-black text-md">SKU</th>
                                                <th className="px-4 py-4 text-center text-black text-md">Stock</th>
                                                <th className="px-4 py-4 text-center text-black text-md">Quick Adjust</th>
                                                <th className="px-4 py-4 text-center text-black text-md">Edit</th>
                                                <th className="px-4 py-4 text-center text-black text-md">Delete</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {currentTwoByOneItems.length > 0 ? (
                                                currentTwoByOneItems.map((item: StockItem) => (
                                                    <tr
                                                        key={item.id}
                                                        className="transition-all duration-200 text-center h-16"
                                                    >
                                                        <td className= 'px-4 py-2 text-left'>
                                                            <div className="flex items-center">
                                                                <span className={`w-8 h-4 rounded-full mr-3 ${getSheetColorClass(item.item_name)}`}></span>
                                                                <span className="text-black text-lg">
                                                                    {item.item_name}
                                                                </span>
                                                            </div>
                                                        </td>
                                                        <td className="px-4 py-2 text-center">
                                                            <span className="text-black text-lg">
                                                                {item.sku}
                                                            </span>
                                                        </td>
                                                        <td className="px-4 py-2 text-black">
                                                            {editingItem?.id === item.id ? (
                                                                <div className="flex items-center justify-center gap-2">
                                                                    <input
                                                                        type="number"
                                                                        value={editValue}
                                                                        onChange={(e) => setEditValue(Number(e.target.value))}
                                                                        className="w-20 px-2 py-1 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                                                                        min='0'
                                                                    />
                                                                    <button
                                                                        onClick={handleSave}
                                                                        className="p-1 text-green-600 hover:text-green-700"
                                                                        aria-label="Save Changes"
                                                                    >
                                                                        <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                                                                            <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                                                                        </svg>
                                                                    </button>
                                                                    <button
                                                                        onClick={handleCancel}
                                                                        className="p-1 text-red-600 hover:text-red-700"
                                                                        aria-label="Cancel Changes"
                                                                    >
                                                                        <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                                                                            <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
                                                                        </svg>
                                                                    </button>
                                                                </div>
                                                            ) : (
                                                            <span className="inline-flex items-center justify-center min-w-[2.5rem] px-3 py-1 shadow-sm rounded-full text-lg text-black">
                                                                {item.stock}
                                                            </span>
                                                            )}
                                                        </td>
                                                        <td className="px-4 py-2 text-black">
                                                            <div className="flex items-center justify-center gap-2">
                                                                <button
                                                                    className="flex items-center justify-center w-8 h-8 rounded-full bg-red-100 hover:bg-red-200 transition-colors focus:outline-none focus:ring-2 focus:ring-red-300"
                                                                    onClick={(e) => {
                                                                        e.stopPropagation();
                                                                        // Handle minus click - use the value from the input field
                                                                        const inputValue = quickAdjustItem?.id === item.id ? quickAdjustEditValue : 0;
                                                                        setQuickAdjustItem(item);
                                                                        handleQuickAdjustSubtract(item, inputValue);
                                                                    }}
                                                                    aria-label="Decrease stock"
                                                                    disabled={editingItem !== null}
                                                                >
                                                                    <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-red-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 12H4" />
                                                                    </svg>
                                                                </button>
                                                                <input
                                                                    type="number"
                                                                    value={quickAdjustItem?.id === item.id ? quickAdjustEditValue : 0}
                                                                    onChange={(e) => {
                                                                        const value = Math.max(0, Number(e.target.value));
                                                                        setQuickAdjustEditValue(value);
                                                                        if (quickAdjustItem?.id !== item.id) {
                                                                            setQuickAdjustItem(item);
                                                                        }
                                                                    }}
                                                                    className="w-16 px-2 py-1 text-center border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
                                                                    min="0"
                                                                    disabled={editingItem !== null}
                                                                />
                                                                <button
                                                                    className="flex items-center justify-center w-8 h-8 rounded-full bg-green-100 hover:bg-green-200 transition-colors focus:outline-none focus:ring-2 focus:ring-green-300"
                                                                    onClick={(e) => {
                                                                        e.stopPropagation();
                                                                        // Handle plus click - use the value from the input field
                                                                        const inputValue = quickAdjustItem?.id === item.id ? quickAdjustEditValue : 0;
                                                                        setQuickAdjustItem(item);
                                                                        handleQuickAdjustAdd(item, inputValue);
                                                                    }}
                                                                    aria-label="Increase stock"
                                                                    disabled={editingItem !== null}
                                                                >
                                                                    <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                                                                    </svg>
                                                                </button>
                                                            </div>
                                                        </td>
                                                        <td className="px-4 py-2 text-black">
                                                            <button
                                                                className="flex justify-center items-center h-full w-full hover: bg-gray-100 rounded-full p-2 transition-colors focus:outline-none focus:ring-2 focus:ring-gray-300"
                                                                onClick={(e) => {
                                                                    e.stopPropagation();
                                                                    handleEdit(item);
                                                                }}
                                                                aria-label="Edit an item"
                                                                disabled={editingItem !== null}
                                                            >
                                                                <Image
                                                                    src="/editPencil.png"
                                                                    alt=""
                                                                    width={15}
                                                                    height={15}
                                                                />
                                                            </button>
                                                        </td>
                                                        <td className="px-4 py-2 text-black">
                                                            <button
                                                                className="flex justify-center items-center h-full w-full hover: bg-gray-100 rounded-full p-2 transition-colors focus:outline-none focus:ring-2 focus:ring-gray-300"
                                                                onClick={(e) => {
                                                                    e.stopPropagation();
                                                                    handleDelete(item);
                                                                }}
                                                                aria-label="Delete an item"
                                                                disabled={editingItem !== null}
                                                            >
                                                                <Image
                                                                    src="/binClosed.png"
                                                                    alt=""
                                                                    width={15}
                                                                    height={15}
                                                                />
                                                            </button>
                                                        </td>
                                                    </tr>
                                                ))
                                            ) : (
                                                <tr>
                                                    <td colSpan={5} className="px-4 py-8 text-center text-gray-500">
                                                        No 2 X 1 items found
                                                    </td>
                                                </tr>
                                            )}
                                        </tbody>
                                    </table>
                                </div>
                                {/** 2 X 1 Pagination Controls */}
                                <div className="sticky bottom-0 flex justify-center items-center gap-4 py-4 bg-white border-t border-gray-200">
                                    <button
                                        onClick={() => handlePageChange(currentPage - 1)}
                                        disabled={currentPage === 1}
                                        className="px-4 py-2 rounded-md bg-gray-100 text-gray-700 hover:bg-gray-200 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                                    >
                                        Previous
                                    </button>
                                    <div className="flex items-center gap-2">
                                        {Array.from({ length: totalTwoByOnePages }, (_, i) => i + 1).map((pageNum) => (
                                            <button
                                                key={pageNum}
                                                onClick={() => handlePageChange(pageNum)}
                                                className={`w-8 h-8 rounded-md ${
                                                    currentPage === pageNum
                                                        ? 'bg-red-600 text-white'
                                                        : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                                                } transition-colors`}
                                            >
                                                {pageNum}
                                            </button>
                                        ))}
                                    </div>
                                    <button
                                        onClick={() => handlePageChange(currentPage + 1)}
                                        disabled={currentPage === totalTwoByOnePages}
                                        className="px-4 py-2 rounded-md bg-gray-100 text-gray-700 hover:bg-gray-200 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                                    >
                                        Next
                                    </button>
                                </div>
                            </div>
                                                    
                        ) : tableTab === 'Packing Boxes' ? (
                            <div className="flex-1 flex flex-col">
                                <div className="flex-1 overflow-y-auto">
                                    <table className="w-full bg-white/90 backdrop-blur-sm border border-gray-20 table-auto">
                                        <thead className="bg-gray-100/90 sticky top-0">
                                            <tr>
                                                <th className="px-4 py-4 text-left text-black text-md">Packing Box</th>
                                                <th className="px-4 py-4 text-center text-black text-md">SKU</th>
                                                <th className="px-4 py-4 text-center text-black text-md">Stock</th>
                                                <th className="px-4 py-4 text-center text-black text-md">Quick Adjust</th>
                                                <th className="px-4 py-4 text-center text-black text-md">Edit</th>
                                                <th className="px-4 py-4 text-center text-black text-md">Delete</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {currentPackingBoxItems.length > 0 ? (
                                                currentPackingBoxItems.map((item: StockItem) => (
                                                    <tr
                                                        key={item.id}
                                                        className="transition-all duration-200 text-center h-16"
                                                    >
                                                        <td className="px-4 py-2 text-left">
                                                            <div className="flex items-center">
                                                                <span className="text-black text-lg">
                                                                    {item.item_name}
                                                                </span>
                                                            </div>
                                                        </td>
                                                        <td className="px-4 py-2 text-center">
                                                            <span className="text-black text-lg">
                                                                {item.sku}
                                                            </span>
                                                        </td>
                                                        <td className="px-4 py-2 text-black">
                                                            {editingItem?.id === item.id ? (
                                                                <div className="flex items-center justify-center gap-2">
                                                                    <input
                                                                        type="number"
                                                                        value={editValue}
                                                                        onChange={(e) => setEditValue(Number(e.target.value))}
                                                                        className="w-20 px-2 py-1 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                                                                        min="0"
                                                                    />
                                                                    <button
                                                                        onClick={handleSave}
                                                                        className="p-1 text-green-600 hover:text-green-700"
                                                                        aria-label="Save Changes"
                                                                    >
                                                                        <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                                                                            <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                                                                        </svg>
                                                                    </button>
                                                                    <button
                                                                        onClick={handleCancel}
                                                                        className="p-1 text-red-600 hover:text-red-700"
                                                                        aria-label="Cancel Changes"
                                                                    >
                                                                        <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                                                                            <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
                                                                        </svg>
                                                                    </button>
                                                                </div>
                                                            ) : (
                                                                <span className="inline-flex items-center justify-center min-w-[2.5rem] px-3 py-1 shadow-sm rounded-full text-lg text-black">
                                                                    {item.stock}
                                                                </span>
                                                            )}
                                                        </td>
                                                        <td className="px-4 py-2 text-black">
                                                        <div className="flex items-center justify-center gap-2">
                                                                <button
                                                                    className="flex items-center justify-center w-8 h-8 rounded-full bg-red-100 hover:bg-red-200 transition-colors focus:outline-none focus:ring-2 focus:ring-red-300"
                                                                    onClick={(e) => {
                                                                        e.stopPropagation();
                                                                        // Handle minus click - use the value from the input field
                                                                        const inputValue = quickAdjustItem?.id === item.id ? quickAdjustEditValue : 0;
                                                                        setQuickAdjustItem(item);
                                                                        handleQuickAdjustSubtract(item, inputValue);
                                                                    }}
                                                                    aria-label="Decrease stock"
                                                                    disabled={editingItem !== null}
                                                                >
                                                                    <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-red-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 12H4" />
                                                                    </svg>
                                                                </button>
                                                                <input
                                                                    type="number"
                                                                    value={quickAdjustItem?.id === item.id ? quickAdjustEditValue : 0}
                                                                    onChange={(e) => {
                                                                        const value = Math.max(0, Number(e.target.value));
                                                                        setQuickAdjustEditValue(value);
                                                                        if (quickAdjustItem?.id !== item.id) {
                                                                            setQuickAdjustItem(item);
                                                                        }
                                                                    }}
                                                                    className="w-16 px-2 py-1 text-center border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
                                                                    min="0"
                                                                    disabled={editingItem !== null}
                                                                />
                                                                <button
                                                                    className="flex items-center justify-center w-8 h-8 rounded-full bg-green-100 hover:bg-green-200 transition-colors focus:outline-none focus:ring-2 focus:ring-green-300"
                                                                    onClick={(e) => {
                                                                        e.stopPropagation();
                                                                        // Handle plus click - use the value from the input field
                                                                        const inputValue = quickAdjustItem?.id === item.id ? quickAdjustEditValue : 0;
                                                                        setQuickAdjustItem(item);
                                                                        handleQuickAdjustAdd(item, inputValue);
                                                                    }}
                                                                    aria-label="Increase stock"
                                                                    disabled={editingItem !== null}
                                                                >
                                                                    <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                                                                    </svg>
                                                                </button>
                                                            </div>
                                                        </td>
                                                        <td className="px-4 py-2 text-black">
                                                            <button
                                                                className="flex justify-center items-center h-full w-full hover:bg-gray-100 rounded-full p-2 transition-colors focus:outline-none focus:ring-2 focus:ring-gray-300"
                                                                onClick={(e) => {
                                                                    e.stopPropagation();
                                                                    handleEdit(item);
                                                                }}
                                                                aria-label="Edit an item"
                                                                disabled={editingItem !== null}
                                                            >
                                                                <Image
                                                                    src="/editPencil.png"
                                                                    alt=""
                                                                    width={15}
                                                                    height={15}
                                                                />
                                                            </button>
                                                        </td>
                                                        <td className="px-4 py-2 text-black">
                                                            <button
                                                                className="flex justify-center items-center h-full w-full hover:bg-gray-100 rounded-full p-2 transition-colors focus:outline-none focus:ring-2 focus:ring-gray-300"
                                                                onClick={(e) => {
                                                                    e.stopPropagation();
                                                                    handleDelete(item);
                                                                }}
                                                                aria-label="Delete an item"
                                                                disabled={editingItem !== null}
                                                            >
                                                                <Image
                                                                    src="/binClosed.png"
                                                                    alt=""
                                                                    width={15}
                                                                    height={15}
                                                                />
                                                            </button>
                                                        </td>
                                                    </tr>
                                                ))
                                            ) : (
                                                <tr>
                                                    <td colSpan={5} className="px-4 py-8 text-center text-gray-500">
                                                        No packing box items found
                                                    </td>
                                                </tr>
                                            )}
                                        </tbody>
                                    </table>
                                </div>
                                {/* Packing Boxes Pagination Controls */}
                                <div className="sticky bottom-0 flex justify-center items-center gap-4 py-4 bg-white border-t border-gray-200">
                                    <button
                                        onClick={() => handlePageChange(currentPage - 1)}
                                        disabled={currentPage === 1}
                                        className="px-4 py-2 rounded-md bg-gray-100 text-gray-700 hover:bg-gray-200 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                                    >
                                        Previous
                                    </button>
                                    <div className="flex items-center gap-2">
                                        {Array.from({ length: totalPackingBoxPages }, (_, i) => i + 1).map((pageNum) => (
                                            <button
                                                key={pageNum}
                                                onClick={() => handlePageChange(pageNum)}
                                                className={`w-8 h-8 rounded-md ${
                                                    currentPage === pageNum
                                                        ? 'bg-red-600 text-white'
                                                        : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                                                } transition-colors`}
                                            >
                                                {pageNum}
                                            </button>
                                        ))}
                                    </div>
                                    <button
                                        onClick={() => handlePageChange(currentPage + 1)}
                                        disabled={currentPage === totalPackingBoxPages}
                                        className="px-4 py-2 rounded-md bg-gray-100 text-gray-700 hover:bg-gray-200 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                                    >
                                        Next
                                    </button>
                                </div>
                            </div>
                        ) : tableTab === 'Retail Packs' ? (
                            <div className="flex-1 flex flex-col">
                                <div className="flex-1 overflow-y-auto">
                                    <table className="w-full bg-white/90 backdrop-blur-sm border border-gray-200 table-auto">
                                        <thead className="bg-gray-100/90 sticky top-0">
                                            <tr>
                                                <th className="px-4 py-4 text-left text-black text-md">Retail Pack</th>
                                                <th className="px-4 py-4 text-center text-black text-md">SKU</th>
                                                <th className="px-4 py-4 text-center text-black text-md">Stock</th>
                                                <th className="px-4 py-4 text-center text-black text-md">Quick Adjust</th>
                                                <th className="px-4 py-4 text-center text-black text-md">Edit</th>
                                                <th className="px-4 py-4 text-center text-black text-md">Delete</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {currentRetailPackItems.length > 0 ? (
                                                currentRetailPackItems.map((item: StockItem) => (
                                                    <tr
                                                        key={item.id}
                                                        className="transition-all duration-200 text-center h-16"
                                                    >
                                                        <td className="px-4 py-2 text-left">
                                                            <div className="flex items-center">
                                                                {/** Color pill using item_name for color matching */}
                                                                <span className={`w-8 h-4 rounded-full mr-3 ${getSheetColorClass(item.item_name)}`}></span>
                                                                <span className="text-black text-lg">
                                                                    {item.item_name}
                                                                </span>
                                                            </div>
                                                        </td>
                                                        <td className="px-4 py-2 text-center">
                                                            <span className="text-black text-lg">
                                                                {item.sku}
                                                            </span>
                                                        </td>
                                                        <td className="px-4 py-2 text-black">
                                                            {editingItem?.id === item.id ? (
                                                                <div className="flex items-center justify-center gap-2">
                                                                    <input
                                                                        type="number"
                                                                        value={editValue}
                                                                        onChange={(e) => setEditValue(Number(e.target.value))}
                                                                        className="w-20 px-2 py-1 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                                                                        min="0"
                                                                    />
                                                                    <button
                                                                        onClick={handleSave}
                                                                        className="p-1 text-green-600 hover:text-green-700"
                                                                        aria-label="Save changes"
                                                                    >
                                                                        <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                                                                            <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                                                                        </svg>
                                                                    </button>
                                                                    <button
                                                                        onClick={handleCancel}
                                                                        className='p-1 text-red-600 hover:text-red-700'
                                                                        aria-label="Cancel changes"
                                                                    >
                                                                        <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                                                                            <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
                                                                    </svg>
                                                                </button>
                                                            </div>
                                                        ) : (
                                                            <span className="inline-flex items-center justify-center min-w-[2.5rem] px-3 py-1 shadow-sm rounded-full text-lg text-black">
                                                                {item.stock}
                                                            </span>
                                                        )}
                                                    </td>
                                                    <td className="px-4 py-2 text-black">
                                                    <div className="flex items-center justify-center gap-2">
                                                            <button
                                                                className="flex items-center justify-center w-8 h-8 rounded-full bg-red-100 hover:bg-red-200 transition-colors focus:outline-none focus:ring-2 focus:ring-red-300"
                                                                onClick={(e) => {
                                                                    e.stopPropagation();
                                                                    // Handle minus click - use the value from the input field
                                                                    const inputValue = quickAdjustItem?.id === item.id ? quickAdjustEditValue : 0;
                                                                    setQuickAdjustItem(item);
                                                                    handleQuickAdjustSubtract(item, inputValue);
                                                                }}
                                                                aria-label="Decrease stock"
                                                                disabled={editingItem !== null}
                                                            >
                                                                <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-red-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 12H4" />
                                                                </svg>
                                                            </button>
                                                            <input
                                                                type="number"
                                                                value={quickAdjustItem?.id === item.id ? quickAdjustEditValue : 0}
                                                                onChange={(e) => {
                                                                    const value = Math.max(0, Number(e.target.value));
                                                                    setQuickAdjustEditValue(value);
                                                                    if (quickAdjustItem?.id !== item.id) {
                                                                        setQuickAdjustItem(item);
                                                                    }
                                                                }}
                                                                className="w-16 px-2 py-1 text-center border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
                                                                min="0"
                                                                disabled={editingItem !== null}
                                                            />
                                                            <button
                                                                className="flex items-center justify-center w-8 h-8 rounded-full bg-green-100 hover:bg-green-200 transition-colors focus:outline-none focus:ring-2 focus:ring-green-300"
                                                                onClick={(e) => {
                                                                    e.stopPropagation();
                                                                    // Handle plus click - use the value from the input field
                                                                    const inputValue = quickAdjustItem?.id === item.id ? quickAdjustEditValue : 0;
                                                                    setQuickAdjustItem(item);
                                                                    handleQuickAdjustAdd(item, inputValue);
                                                                }}
                                                                aria-label="Increase stock"
                                                                disabled={editingItem !== null}
                                                            >
                                                                <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                                                                </svg>
                                                            </button>
                                                        </div>
                                                    </td>
                                                    <td className="px-4 py-2 text-black">
                                                        <button
                                                            className="flex justify-center items-center h-full w-full hover:bg-gray-100 rounded-full p-2 transition-colors focus:outline-none focus:ring-2 focus:ring-gray-300"
                                                            onClick={(e) => {
                                                                e.stopPropagation();
                                                                handleEdit(item);
                                                            }}
                                                            aria-label="Edit an item"
                                                            disabled={editingItem !== null}
                                                        >
                                                            <Image
                                                                src="/editPencil.png"
                                                                alt=""
                                                                width={15}
                                                                height={15}
                                                            />
                                                        </button>
                                                    </td>
                                                    <td className="px-4 py-2 text-black">
                                                        <button
                                                            className="flex justify-center items-center h-full w-full hover:bg-gray-100 rounded-full p-2 transition-colors focus:outline-none focus:ring-2 focus:ring-gray-300"
                                                            onClick={(e) => {
                                                                e.stopPropagation();
                                                                handleDelete(item);
                                                            }}
                                                            aria-label="Delete an item"
                                                            disabled={editingItem !== null}
                                                        >
                                                            <Image
                                                                src="/binClosed.png"
                                                                alt=""
                                                                width={15}
                                                                height={15}
                                                            />
                                                        </button>
                                                    </td>
                                                </tr>
                                            ))
                                        ) : (
                                            <tr>
                                                <td colSpan={5} className="px-4 py-8 text-center text-gray-500">
                                                    No retail pack items found
                                                </td>
                                            </tr>
                                        )}
                                    </tbody>
                                </table>
                                </div>
                                {/* Retail Packs Pagination Controls */}
                                <div className="sticky bottom-0 flex justify-center items-center gap-4 py-4 bg-white border-t border-gray-200">
                                    <button
                                        onClick={() => handlePageChange(currentPage - 1)}
                                        disabled={currentPage === 1}
                                        className="px-4 py-2 rounded-md bg-gray-100 text-gray-700 hover:bg-gray-200 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                                    >
                                        Previous
                                    </button>
                                    <div className="flex items-center gap-2">
                                        {Array.from({ length: totalRetailPackPages }, (_, i) => i + 1).map((pageNum) => (
                                            <button
                                                key={pageNum}
                                                onClick={() => handlePageChange(pageNum)}
                                                className={`w-8 h-8 rounded-md ${
                                                    currentPage === pageNum
                                                        ? 'bg-red-600 text-white'
                                                        : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                                                } transition-colors`}
                                            >
                                                {pageNum}
                                            </button>
                                        ))}
                                    </div>
                                    <button
                                        onClick={() => handlePageChange(currentPage + 1)}
                                        disabled={currentPage === totalRetailPackPages}
                                        className="px-4 py-2 rounded-md bg-gray-100 text-gray-700 hover:bg-gray-200 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                                    >
                                        Next
                                    </button>
                                </div>
                            </div> 
                        ) : loading ? (
                            <div className="flex-1 flex flex-col items-center justify-center bg-gray-50 p-6">
                                <div className="w-12 h-12 rounded-full border-4 border-gray-300 border-t-blue-600 animate-spin mb-4"></div>
                                <p className="text-gray-700 font-medium">Loading Stock Data...</p>
                                <p className="text-gray-500 text-sm mt-2">Retrieving data from database</p>
                            </div>
                        ) : error ? (
                            <div className="text-center py-4">
                                <p className="text-red-500">{error}</p>
                            </div>
                        ) : (
                            <>
                                <div className="flex-1 overflow-y-auto">
                                    <table className="w-full bg-white/90 backdrop-blur-sm border border-gray-20 table-auto">
                                        <thead className="bg-gray-100/90 sticky top-0">
                                            <tr>
                                                <th className="px-4 py-4 text-left text-black text-md">Medium Sheet</th>
                                                <th className="px-4 py-4 text-center text-black text-md">SKU</th>
                                                <th className="px-4 py-4 text-center text-black text-md">Stock</th>
                                                <th className="px-4 py-4 text-center text-black text-md">Quick Adjust</th>
                                                <th className="px-4 py-4 text-center text-black text-md">Edit</th>
                                                <th className="px-4 py-4 text-center text-black text-md">Delete</th>
                                            </tr> 
                                        </thead>
                                        <tbody>
                                            {currentMediumSheetItems.length > 0 ? (
                                                currentMediumSheetItems.map((item: StockItem) => (
                                                    <tr
                                                        key={item.id}
                                                        className="transition-all duration-200 text-center h-16"
                                                    >
                                                        <td className="px-4 py-2 text-left">
                                                            <div className="flex items-center">
                                                                {/* Color pill using item_name for color matching */}
                                                                <span className={`w-8 h-4 rounded-full mr-3 ${getSheetColorClass(item.item_name)}`}></span>
                                                                <span className="text-black text-lg">
                                                                    {item.item_name}
                                                                </span>
                                                            </div>
                                                        </td>
                                                        <td className="px-4 py-2 text-center">
                                                            <span className="text-black text-lg">
                                                                {item.sku}
                                                            </span>
                                                        </td>
                                                        <td className="px-4 py-2 text-black">
                                                            {editingItem?.id === item.id ? (
                                                                <div className="flex items-center justify-center gap-2">
                                                                    <input
                                                                        type="number"
                                                                        value={editValue}
                                                                        onChange={(e) => setEditValue(Number(e.target.value))}
                                                                        className="w-20 px-2 py-1 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                                                                        min="0"
                                                                    />
                                                                    <button
                                                                        onClick={handleSave}
                                                                        className="p-1 text-green-600 hover:text-green-700"
                                                                        aria-label="Save changes"
                                                                    >
                                                                        <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                                                                            <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                                                                        </svg>
                                                                    </button>
                                                                    <button
                                                                        onClick={handleCancel}
                                                                        className="p-1 text-red-600 hover:text-red-700"
                                                                        aria-label="Cancel changes"
                                                                    >
                                                                        <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                                                                            <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
                                                                        </svg>
                                                                    </button>
                                                                </div>
                                                            ) : (
                                                                <span className="inline-flex items-center justify-center min-w-[2.5rem] px-3 py-1 shadow-sm rounded-full text-lg text-black">
                                                                    {item.stock}
                                                                </span>
                                                            )}
                                                        </td>
                                                        <td className="px-4 py-2 text-black">
                                                            <div className="flex items-center justify-center gap-2">
                                                              <button
                                                                className="flex items-center justify-center w-8 h-8 rounded-full bg-red-100 hover:bg-red-200 transition-colors focus:outline-none focus:ring-2 focus:ring-red-300"
                                                                onClick={(e) => {
                                                                    e.stopPropagation();
                                                                    // Handle minus click - use the value from the input field
                                                                    const inputValue = quickAdjustItem?.id === item.id ? quickAdjustEditValue : 0;
                                                                    setQuickAdjustItem(item);
                                                                    handleQuickAdjustSubtract(item, inputValue);
                                                                }}
                                                                aria-label="Decrease stock"
                                                                disabled={editingItem !== null}
                                                            >
                                                                <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-red-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 12H4" />
                                                                </svg>
                                                            </button>
                                                            <input
                                                                type="number"
                                                                value={quickAdjustItem?.id === item.id ? quickAdjustEditValue : 0}
                                                                onChange={(e) => {
                                                                    const value = Math.max(0, Number(e.target.value));
                                                                    setQuickAdjustEditValue(value);
                                                                    if (quickAdjustItem?.id !== item.id) {
                                                                        setQuickAdjustItem(item);
                                                                    }
                                                                }}
                                                                className="w-16 px-2 py-1 text-center border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
                                                                min="0"
                                                                disabled={editingItem !== null}
                                                            />
                                                                <button
                                                                    className="flex items-center justify-center w-8 h-8 rounded-full bg-green-100 hover:bg-green-200 transition-colors focus:outline-none focus:ring-2 focus:ring-green-300"
                                                                    onClick={(e) => {
                                                                        e.stopPropagation();
                                                                        // Handle plus click - use the value from the input field
                                                                        const inputValue = quickAdjustItem?.id === item.id ? quickAdjustEditValue : 0;
                                                                        setQuickAdjustItem(item);
                                                                        handleQuickAdjustAdd(item, inputValue);
                                                                    }}
                                                                    aria-label="Increase stock"
                                                                    disabled={editingItem !== null}
                                                                >
                                                                    <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                                                                    </svg>
                                                                </button>
                                                            </div>
                                                        </td>
                                                        <td className="px-4 py-2 text-black">
                                                            <button 
                                                                className="flex justify-center items-center h-full w-full hover:bg-gray-100 rounded-full p-2 transition-colors focus:outline-none focus:ring-2 focus:ring-gray-300"
                                                                onClick={(e) => {
                                                                    e.stopPropagation();
                                                                    handleEdit(item);
                                                                }}
                                                                aria-label="Edit an item"
                                                                disabled={editingItem !== null}
                                                            >
                                                                <Image
                                                                    src="/editPencil.png"
                                                                    alt=""
                                                                    width={15}
                                                                    height={15}
                                                                />
                                                            </button>
                                                        </td>
                                                        <td className="px-4 py-2 text-black">
                                                            <button
                                                                className="flex justify-center items-center h-full w-full hover:bg-gray-100 rounded-full p-2 transition-colors focus:outline-none focus:ring-2 focus:ring-gray-300"
                                                                onClick={(e) => {
                                                                    e.stopPropagation();
                                                                    handleDelete(item);
                                                                }}
                                                                aria-label="Delete an item"
                                                                disabled={editingItem !== null}
                                                            >
                                                                <Image
                                                                    src="/binClosed.png"
                                                                    alt=""
                                                                    width={15}
                                                                    height={15}
                                                                />
                                                            </button>
                                                        </td>
                                                    </tr>
                                                ))
                                            ) : (
                                                <tr>
                                                    <td colSpan={5} className="px-4 py-8 text-center    text-gray-500">
                                                        No medium sheet items found
                                                    </td>
                                                </tr>
                                            )}
                                        </tbody>
                                    </table>
                                </div>
                                {/* Pagination Controls */}
                                <div className="flex justify-center items-center gap-4 py-4 bg-white border-t border-gray-200">
                                    <button
                                        onClick={() => handlePageChange(currentPage - 1)}
                                        disabled={currentPage === 1}
                                        className="px-4 py-2 rounded-md bg-gray-100 text-gray-700 hover:bg-gray-200 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                                    >
                                        Previous
                                    </button>
                                    <div className="flex items-center gap-2">
                                        {Array.from({ length: totalPages }, (_, i) => i + 1).map((pageNum) => (
                                            <button
                                                key={pageNum}
                                                onClick={() => handlePageChange(pageNum)}
                                                className={`w-8 h-8 rounded-md ${
                                                    currentPage === pageNum
                                                        ? 'bg-red-600 text-white'
                                                        : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                                                } transition-colors`}
                                            >
                                                {pageNum}
                                            </button>
                                        ))}
                                    </div>
                                    <button
                                        onClick={() => handlePageChange(currentPage + 1)}
                                        disabled={currentPage === totalPages}
                                        className="px-4 py-2 rounded-md bg-gray-100 text-gray-700 hover:bg-gray-200 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                                    >
                                        Next
                                    </button>
                                </div>
                            </>
                        )}
                    </div>
                </div>
            </div>
            )}
            
            {/**Damage Tracking Tab */}
            {activeTab === 'DamageTracking' && (
                <div className="container mx-auto pt-40 ob-8 px-4 flex flex-col lg:flex-row gap-6 max-w-[1520px]">
                    {/**Report Damage Section*/}
                    <div className="flex-1 min-w-0 max-w-[600px] flex flex-col bg-[#1d1d1d]/90 rounded-xl shadow-xl mb-8">
                        <div className="bg-[#1d1d1d]/90 rounded-t-lg backdrop-blur-sm p-4">
                            <h1 className="text-2xl font-bold text-white">Report A Damage: {damageTitleTab}</h1>
                        </div>
                        <form onSubmit={handleSubmit} className="flex-1 flex flex-col justify-between bg-white rounded-b-xl p-6">
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                                <div className="flex flex-col gap-4">
                                    <label className="font-semibold text-black" htmlFor="Type">Type Of Damage:</label>
                                    <select
                                        id="type"
                                        name="type"
                                        className="border border-gray-400 rounded-lg px-4 py-2 text-black focus:outline-none focus:ring-2 focus:ring-blue-400"
                                        defaultValue=""
                                        required
                                    >
                                        <option value="" disabled>Type...</option>
                                        <option value="Aesthetic">Aesthetic Damage</option>
                                        <option value="Dimensional">Dimensional Damage</option>
                                        <option value="Other">Other</option>
                                    </select>
                                    <label className="font-semibold text-black mt-2" htmlFor="description">How/What/Why?:</label>
                                    <textarea
                                        id="description"
                                        name="description"
                                        placeholder="Briefly describe the damage and the reason for it..."
                                        className="border border-gray-400 rounded-lg px-4 py-2 text-black focus:outline-none focus:ring-2 focus:ring-blue-400 h-40 resize-none align-top"
                                        required
                                        rows={12}
                                        style={{ verticalAlign: 'top', minHeight: '250px' }}
                                    />
                                </div>
                                <div className="flex flex-col gap-4">
                                    <label className="font-semibold text-black mt-2" htmlFor="damage-date">Date of Damage:</label>
                                        <input
                                        id="damage-date"
                                        name="damage-date"
                                        type="date"
                                        className="border border-gray-400 rounded-lg px-4 py-2 text-black focus:outline-none focus:ring-2 focus:ring-blue-400"
                                        required
                                        />
                                    <label className="font-semibold text-black" htmlFor="depth">Depth:</label>
                                    <select
                                        id="depth"
                                        name="depth"
                                        className="border border-gray-400 rounded-lg px-4 py-2 text-black focus:outline-none focus:ring-2 focus:ring-blue-400"
                                        required
                                        defaultValue="30mm"
                                    >
                                        <option value="30mm">30mm</option>
                                        <option value="50mm">50mm</option>
                                        <option value="70mm">70mm</option>
                                    </select>
                                    <label className="font-semibold text-black mt-2" htmlFor="quantity">Quantity:</label>
                                    <input
                                        id="quantity"
                                        name="quantity"
                                        type="number"
                                        defaultValue="1"
                                        min="1"
                                        placeholder="Quantity..."
                                        className="border border-gray-400 rounded-lg px-4 py-2 text-black focus:outline-none focus:ring-2 focus:ring-blue-400"
                                        required
                                    />
                                    <label className="font-semibold text-black mt-2" htmlFor="colour">Colour:</label>
                                    <select
                                        id="colour"
                                        name="colour"
                                        className="border border-gray-400 rounded-lg px-4 py-2 text-black focus:outline-none focus:ring-2 focus:ring-blue-400"
                                        required
                                        defaultValue="Red"
                                    >
                                        <option value="Blue">Blue</option>
                                        <option value="Green">Green</option>
                                        <option value="Black">Black</option>
                                        <option value="Orange">Orange</option>
                                        <option value="Red">Red</option>
                                        <option value="Teal">Teal</option>
                                        <option value="Yellow">Yellow</option>
                                        <option value="Purple">Purple</option>
                                        <option value="Grey">Grey</option>
                                    </select>
                                    
                                </div>
                            </div>
                            <button
                                type="submit"
                                className="mt-8 px-6 py-3 bg-gradient-to-r from-gray-950 to-red-600 text-white font-semibold rounded-lg shadow hover:bg-blue-700 transition-colors focus:outline-none focus:ring-2 focus:ring-black"
                            >
                                Submit
                            </button>
                        </form>
                    </div>

                    {/** Damage Tracking Section */}
                    <div className="flex-1 min-w-0 max-w-[900px] flex flex-col rounded-xl shadow-xl mb-8 min-h-[600px]" style={{minHeight: '100%'}}>
                        <div className="bg-[#1d1d1d]/90 rounded-t-lg backdrop-blur-sm p-4">
                            <div className="flex flex-row items-center justify-between w-full">
                                <h1 className="text-white text-3xl font-semibold flex items-center gap-2">
                                    {damageTitleTab}
                                    <button
                                        className="ml-2 p-1 rounded-full hover:bg-gray-700 transition-colors"
                                        onClick={() => {
                                            const tabs = ['2 X 1 Sheets', 'Medium Sheets', 'Accessories', 'Inserts'];
                                            const currentIdx = tabs.indexOf(damageTitleTab);
                                            setDamageTitleTab(tabs[(currentIdx + 1) % tabs.length] as typeof damageTitleTab);
                                        }}
                                        aria-label="Next Title"
                                    >
                                        <svg width="22" height="22" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" /></svg>
                                    </button>
                                </h1>
                            </div>
                            {/**Navigation Tools and Dropdowns */}
                            <div className="mt-4 mb-2 w-full flex flex-row items-center justify-between gap-4">
                                <div className="flex flex-row items-center gap-2">
                                    <button
                                        className={`px-4 py-2 text-md font-medium ${damageTrackingTab === 'Aesthetic' ? 'text-white border-b-2 border-white' : 'text-gray-500 border-border-transparent'} bg-transparent focus:outline-none`}
                                        style={{ marginBottom: '-1px' }}
                                        onClick={() => handleDamageTrackingTabChange('Aesthetic')}
                                    >
                                        Aesthetic Damage
                                    </button>
                                    <button
                                        className={`px-4 py-2 text-md font-medium ${damageTrackingTab === 'Dimensional' ? 'text-white border-b-2 border-white' : 'text-gray-500 border-border-transparent'} bg-transparent focus:outline-none`}
                                        style={{ marginBottom: '-1px' }}
                                        onClick={() => handleDamageTrackingTabChange('Dimensional')}
                                    >
                                        Dimensional Damage
                                    </button>
                                </div>
                                <div className="flex flex-row items-center gap-6">
                                    {/* Depth Dropdown */}
                                    <label className="font-semibold text-white whitespace-nowrap" htmlFor="depth-select">Depth:</label>
                                    <select
                                        id="depth-select"
                                        name="depth"
                                        className="border border-gray-400 rounded-lg px-w px-1 py-2 text-black focus:outline-none focus:ring-2 focus:ring-blue-400 mr-6"
                                        value={selectedDepth}
                                        onChange={e => setSelectedDepth(e.target.value as '30mm' | '50mm' | '70mm')}
                                    >
                                        <option value="30mm">30mm</option>
                                        <option value="50mm">50mm</option>
                                        <option value="70mm">70mm</option>
                                    </select>
                                    {/* Time Range Dropdown */}
                                    <label className="font-semibold text-white whitespace-nowrap" htmlFor="timeRange-select">Time Range:</label>
                                    <select
                                        id="timeRange-select"
                                        name="timeRange"
                                        className="border border-gray-400 rounded-lg px-3 py-2 text-black focus:outline-none focus:ring-2 focus:ring-blue-400"
                                        value={selectedTimeRange}
                                        onChange={e => setSelectedTimeRange(e.target.value as '1 Month' | '6 Months' | '1 Year')}
                                    >
                                        <option value="1 Month">1 Month</option>
                                        <option value="6 Months">6 Months</option>
                                        <option value="1 Year">1 Year</option>
                                    </select>
                                </div>
                            </div>
                        </div>
                        {/**Bar Graph Section */}
                        <div className="rounded-b-xl p-6 flex flex-col items-center gap-6 w-full justify-center flex-1 bg-white">
                            {/* Bar Graph */}
                            <div className="w-full h-full flex flex-col justify-center items-center">
                                <div className="w-full flex justify-center mb-6">
                                    <h3 className="text-2xl font-bold text-gray-800 text-center w-full">
                                        Damage Frequency by Color: ({selectedDepth} / {selectedTimeRange})
                                    </h3>
                                </div>
                                <div className="flex items-end justify-center gap-6 w-[90%] h-[400px] min-h-[350px] max-w-7xl mx-auto border-b-2 border-gray-300 border-l-2 border-gray-300 relative bg-white">
                                    {/* Y-axis labels */}
                                    <div className="absolute left-0 top-0 bottom-0 flex flex-col justify-between text-sm text-gray-500 pr-3 h-full">
                                        <span>25</span>
                                        <span>20</span>
                                        <span>15</span>
                                        <span>10</span>
                                        <span>5</span>
                                        <span>0</span>
                                    </div>
                                    <div className="flex flex-1 items-end justify-between w-full h-full pl-10">
                                        {getBarGraphData().map((item, index) => (
                                            <div key={item.color} className="flex flex-col items-center gap-2 flex-1">
                                                {/* Bar */}
                                                <div 
                                                    className="w-12 bg-gradient-to-t from-red-400 to-red-600 rounded-t-md transition-all duration-300 hover:from-red-500 hover:to-red-700 cursor-pointer"
                                                    style={{ height: `${(item.value / 5) * 100}%`, minHeight: '8px' }}
                                                    title={`${item.color}: ${item.value} damages`}
                                                ></div>
                                                {/* X-axis label */}
                                                <span className="text-sm font-medium text-gray-700 text-center w-full">
                                                    {item.color}
                                                </span>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
                        
            )}


            {/* Delete Confirmation Modal */}
            {deleteConfirmItem && (
              <div
                className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-60 animate-fadeIn"
                role="dialog"
                aria-modal="true"
                aria-labelledby="delete-modal-title"
              >
                <div className="bg-white rounded-xl shadow-2xl p-8 max-w-md w-full mx-4 relative flex flex-col items-center animate-scaleIn">
                  {/* Warning Icon */}
                  <div className="mb-4">
                    <svg className="w-12 h-14 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M21 20H3a2 2 0 01-1.72-2.97l9-16a2 2 0 013.44 0l9 16A2 2 0 0121 20z" />
                    </svg>
                  </div>
                  {/* Close Button */}
                  <button
                    onClick={cancelDelete}
                    className="absolute top-3 right-3 text-gray-400 hover:text-gray-700 text-2xl font-bold focus:outline-none"
                    aria-label="Close"
                  >
                    &times;
                  </button>
                  {/* Title */}
                  <h3 id="delete-modal-title" className="text-xl font-bold text-red-600 mb-2 text-center">
                    Delete Stock Item?
                  </h3>
                  {/* Description */}
                  <p className="text-gray-700 text-center mb-4">
                    Are you sure you want to <span className="font-semibold text-red-600">permanently delete</span> the stock item
                    <br />
                    <span className="font-semibold text-black">
                      {deleteConfirmItem.item_name}
                    </span>
                    <span className="text-gray-500"> (SKU: {deleteConfirmItem.sku})</span>?
                    <br />
                    <span className="text-sm text-gray-500">This action cannot be undone.</span>
                  </p>
                  {/* Action Button */}
                  <div className="flex justify-center gap-4 mt-2 w-full">
                    <button
                      onClick={confirmDelete}
                      className="px-5 py-2 rounded-md bg-red-600 text-white hover:bg-red-700 transition-colors font-medium w-full"
                    >
                      Delete
                    </button>
                  </div>
                </div>
                {/* Optional: Add fade/scale-in animation classes in your CSS */}
                <style jsx>{`
                  .animate-fadeIn {
                    animation: fadeIn 0.2s;
                  }
                  .animate-scaleIn {
                    animation: scaleIn 0.2s;
                  }
                  @keyframes fadeIn {
                    from { opacity: 0 }
                    to { opacity: 1 }
                  }
                  @keyframes scaleIn {
                    from { transform: scale(0.95); opacity: 0 }
                    to { transform: scale(1); opacity: 1 }
                  }
                `}</style>
              </div>
            )}

            {/* SheetBookingOut Modal/Section */}
            {showSheetBookingOut && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-80" onClick={() => setShowSheetBookingOut(false)}>
                    <div className="relative rounded-lg shadow-lg p-8 max-w-lg w-full" onClick={(e) => e.stopPropagation()}>
                        <button
                            className="absolute top-2 right-2 text-gray-500 hover:text-gray-700 text-2xl font-bold"
                            onClick={() => setShowSheetBookingOut(false)}
                            aria-label="Close Sheet Booking Out"
                        >
                            &times;
                        </button>
                        <SheetBookingOut />
                    </div>
                </div>
            )}
        </div>
    )
}

"use client"

import { useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import { AppDispatch, RootState } from '@/redux/store';
import { fetchFinishedStockFromSupabase } from '@/redux/thunks/stockThunk';
import { getSupabaseClient } from '@/utils/supabase';
import { bookOutStock, updateStockItem } from "@/utils/despatchCloud";

// // Define the type for stock items
// interface StockItem {
//     id: number;
//     item_name: string;
//     sku: string;
// }

export default function SheetBookingOut() {
    const dispatch = useDispatch<AppDispatch>();
    const items = useSelector((state: RootState) => state.stock.items);
    // Only 2 X 1 items
    const twoByOneItems = items.filter(item => /^SFS\d+[A-Z]$/.test(item.sku?.toUpperCase() || ''));

    const [colour, setColour] = useState('');
    const [depth, setDepth] = useState('');
    const [quantity, setQuantity] = useState(1);
    const [loading, setLoading] = useState(false);
    const [message, setMessage] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setMessage(null);
        setError(null);
        if (!colour || !depth || quantity < 1) {
            setError('Please select colour, depth, and enter a valid quantity.');
            return;
        }
        // Find the matching 2 X 1 item
        const match = twoByOneItems.find(item => {
            const name = item.item_name.toLowerCase();
            return name.includes(colour.toLowerCase()) && name.includes(depth.toLowerCase());
        });
        

        if (!match) {
            setError('No matching 2 X 1 item found for the selected colour and depth.');
            return;
        }
        if (match.stock < quantity) {
            setError(`Not enough stock. Current stock: ${match.stock}`);
            return;
        }
        setLoading(true);
        try {
            const supabase = getSupabaseClient();
            // Update stock in Supabase
            const { error: updateError } = await supabase
                .from('finished_stock')
                .update({
                    stock: match.stock - quantity,
                    updated_at: new Date().toISOString()
                })
                .eq('sku', match.sku);
            if (updateError) {
                setError('Failed to update stock: ' + updateError.message);
                setLoading(false);
                return;
            }
            // Optionally: update DespatchCloud here if needed
            try{
                if (typeof match.id === 'number') {
                    await bookOutStock(match.id, quantity)
                    console.log('Successfully updated DespatchCloud inventory');
                } else {
                    console.warn('Could not find inventory id for DespatchCloud update');
                }
            } catch (despatchError) {
                console.error("Error updating DespatchCloud inventory:", despatchError);
            }

            // Refresh Redux state
            await dispatch(fetchFinishedStockFromSupabase({ page: 1, perPage: 15 }));
            setMessage(`Successfully booked out ${quantity} sheet(s) of ${colour} ${depth}.`);
            setColour('');
            setDepth('');
            setQuantity(1);
        } catch (err: any) {
            setError('Error booking out sheet: ' + (err.message || err.toString()));
        } finally {
            setLoading(false);
        }
    };



    return (
        <div className="min-h-screen flex items-center justify-center">
            <div className="w-full max-w-lg mx-auto bg-[#222] rounded-xl shadow-lg p-10 flex flex-col items-center">
                <h1 className="text-3xl md:text-4xl font-extrabold text-white text-center mb-10 tracking-wide">
                    SHEET BOOKING OUT SYSTEM
                </h1>
                <form className="w-full flex flex-col gap-8" onSubmit={handleSubmit}>
                    <div>
                        <label className="block text-white text-2xl font-bold mb-2 text-center" htmlFor="colour">
                            COLOUR
                        </label>
                        <select
                            id="colour"
                            className="w-full bg-white text-black text-xl rounded-md px-4 py-3 focus:outline-none cursor-pointer"
                            value={colour}
                            onChange={e => setColour(e.target.value)}
                            required
                        >
                            <option value="" disabled>Select Colour...</option>
                            <option>Blue</option>
                            <option>Green</option>
                            <option>Black</option>
                            <option>Orange</option>
                            <option>Red</option>
                            <option>Teal</option>
                            <option>Yellow</option>
                            <option>Pink</option>
                            <option>Purple</option>
                            <option>Grey</option>
                        </select>
                    </div>
                    <div>
                        <label className="block text-white text-2xl font-bold mb-2 text-center" htmlFor="depth">
                            DEPTH
                        </label>
                        <select
                            id="depth"
                            className="w-full bg-white text-black text-xl rounded-md px-4 py-3 focus:outline-none cursor-pointer"
                            value={depth}
                            onChange={e => setDepth(e.target.value)}
                            required
                        >
                            <option value="" disabled>Select Depth...</option>
                            <option>30mm</option>
                            <option>50mm</option>
                            <option>70mm</option>
                        </select>
                    </div>
                    <div>
                        <label className="block text-white text-2xl font-bold mb-2 text-center" htmlFor="quantity">
                            QUANTITY
                        </label>
                        <input
                            id="quantity"
                            type="number"
                            className="w-full bg-white text-black text-xl rounded-md px-4 py-3 focus:outline-none text-center"
                            value={quantity}
                            min={1}
                            max={999}
                            onChange={e => setQuantity(Number(e.target.value))}
                            required
                        />
                    </div>
                    <button
                        type="submit"
                        className="w-full bg-red-600 text-white text-2xl font-semibold rounded-md py-3 mt-2 transition-opacity disabled:opacity-60"
                        disabled={loading}
                    >
                        {loading ? 'Processing...' : 'Submit'}
                    </button>
                    {message && <div className="text-green-400 text-center font-bold">{message}</div>}
                    {error && <div className="text-red-400 text-center font-bold">{error}</div>}
                </form>
            </div>
        </div>
    );
}
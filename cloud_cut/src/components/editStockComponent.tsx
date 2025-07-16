"use client"

import { useState, useEffect } from "react";
import { useDispatch, useSelector } from "react-redux";
import { AppDispatch, RootState } from "@/redux/store";
import { fetchFinishedStockFromSupabase } from "@/redux/thunks/stockThunk";
import { getSupabaseClient } from "@/utils/supabase";

interface EditStockComponentProps {
    activeTab: '2 X 1 Sheets' | 'Medium Sheets' | 'Packing Boxes' | 'Retail Packs';
    onClose: () => void;
    itemToEdit?: any; // The stock item being edited
}

export default function EditStockComponent({ activeTab, onClose, itemToEdit }: EditStockComponentProps) {
    const dispatch = useDispatch<AppDispatch>();
    const items = useSelector((state: RootState) => state.stock.items);
    
    // Form state
    const [colour, setColour] = useState('');
    const [depth, setDepth] = useState('');
    const [type, setType] = useState('');
    const [boxType, setBoxType] = useState('');
    const [quantity, setQuantity] = useState(1);
    const [loading, setLoading] = useState(false);
    const [message, setMessage] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);

    // Initialize form with item data if editing
    useEffect(() => {
        if (itemToEdit) {
            // Extract color and depth from item name for 2 X 1 and Medium Sheets
            if (activeTab === '2 X 1 Sheets' || activeTab === 'Medium Sheets') {
                const itemName = itemToEdit.item_name.toLowerCase();
                
                // Extract color
                const colors = ['black', 'blue', 'green', 'grey', 'gray', 'orange', 'pink', 'purple', 'red', 'teal', 'yellow'];
                const foundColor = colors.find(color => itemName.includes(color));
                if (foundColor) {
                    setColour(foundColor.charAt(0).toUpperCase() + foundColor.slice(1));
                }
                
                // Extract depth
                const depthMatch = itemName.match(/(\d+)mm/);
                if (depthMatch) {
                    setDepth(depthMatch[0]);
                }
            }
            
            // For packing boxes, extract box type from item name
            if (activeTab === 'Packing Boxes') {
                setBoxType(itemToEdit.item_name);
            }
            
            // For retail packs, extract color and depth
            if (activeTab === 'Retail Packs') {
                const itemName = itemToEdit.item_name.toLowerCase();
                const colors = ['black', 'blue', 'green', 'grey', 'gray', 'orange', 'pink', 'purple', 'red', 'teal', 'yellow'];
                const foundColor = colors.find(color => itemName.includes(color));
                if (foundColor) {
                    setColour(foundColor.charAt(0).toUpperCase() + foundColor.slice(1));
                }
                
                const depthMatch = itemName.match(/(\d+)mm/);
                if (depthMatch) {
                    setDepth(depthMatch[0]);
                }
            }
        }
    }, [itemToEdit, activeTab]);

    // Get available depths based on color
    const getAvailableDepths = (selectedColour: string) => {
        if (activeTab === 'Retail Packs') {
            return ['30mm', '50mm'];
        }
        
        if (selectedColour === 'Pink' || selectedColour === 'Purple') {
            return ['30mm', '50mm'];
        }
        
        return ['30mm', '50mm', '70mm'];
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);
        setMessage(null);
        setError(null);

        try {
            // Validate form based on active tab
            if (activeTab === '2 X 1 Sheets' || activeTab === 'Medium Sheets') {
                if (!colour || !depth || !type || quantity < 1) {
                    setError('Please fill in all required fields.');
                    setLoading(false);
                    return;
                }
            } else if (activeTab === 'Retail Packs') {
                if (!colour || !depth || !type || quantity < 1) {
                    setError('Please fill in all required fields.');
                    setLoading(false);
                    return;
                }
            } else if (activeTab === 'Packing Boxes') {
                if (!boxType || !type || quantity < 1) {
                    setError('Please fill in all required fields.');
                    setLoading(false);
                    return;
                }
            }

            // Here you would implement the actual stock update logic
            // For now, just log the form data
            console.log('Form submitted:', {
                activeTab,
                colour,
                depth,
                type,
                boxType,
                quantity,
                itemToEdit
            });

            setMessage('Stock updated successfully!');
            
            // Close the component after a short delay
            setTimeout(() => {
                onClose();
            }, 2000);

        } catch (err: any) {
            setError('Error updating stock: ' + (err.message || err.toString()));
        } finally {
            setLoading(false);
        }
    };

    const handleClose = () => {
        onClose();
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-80" onClick={handleClose}>
            <div className="relative w-full max-w-lg mx-auto bg-[#222] rounded-xl shadow-lg p-10 flex flex-col items-center" onClick={(e) => e.stopPropagation()}>
                {/* Close button */}
                <button
                    className="absolute top-4 right-4 text-gray-400 hover:text-white text-2xl font-bold"
                    onClick={handleClose}
                    aria-label="Close"
                >
                    &times;
                </button>

                <h1 className="text-3xl md:text-4xl font-extrabold text-white text-center mb-10 tracking-wide">
                    Edit Stock
                </h1>

                <form className="w-full flex flex-col gap-8" onSubmit={handleSubmit}>
                    {/* 2 X 1 Sheets and Medium Sheets Form */}
                    {(activeTab === '2 X 1 Sheets' || activeTab === 'Medium Sheets') && (
                        <>
                            <div>
                                <label className="block text-white text-2xl font-bold mb-2 text-center" htmlFor="colour">
                                    COLOUR
                                </label>
                                <select
                                    id="colour"
                                    className="w-full bg-white text-black text-xl rounded-md px-4 py-3 focus:outline-none cursor-pointer"
                                    value={colour}
                                    onChange={e => {
                                        setColour(e.target.value);
                                        setDepth(''); // Reset depth when color changes
                                    }}
                                    required
                                >
                                    <option value="" disabled>Select Colour...</option>
                                    <option>Black</option>
                                    <option>Blue</option>
                                    <option>Green</option>
                                    <option>Grey</option>
                                    <option>Orange</option>
                                    <option>Pink</option>
                                    <option>Purple</option>
                                    <option>Red</option>
                                    <option>Teal</option>
                                    <option>Yellow</option>
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
                                    disabled={!colour}
                                >
                                    <option value="" disabled>Select Depth...</option>
                                    {getAvailableDepths(colour).map(depthOption => (
                                        <option key={depthOption} value={depthOption}>{depthOption}</option>
                                    ))}
                                </select>
                            </div>

                            <div>
                                <label className="block text-white text-2xl font-bold mb-2 text-center" htmlFor="type">
                                    TYPE
                                </label>
                                <select
                                    id="type"
                                    className="w-full bg-white text-black text-xl rounded-md px-4 py-3 focus:outline-none cursor-pointer"
                                    value={type}
                                    onChange={e => setType(e.target.value)}
                                    required
                                >
                                    <option value="" disabled>Select Type...</option>
                                    <option>Set</option>
                                    <option>Increase</option>
                                    <option>Decrease</option>
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
                        </>
                    )}

                    {/* Retail Packs Form */}
                    {activeTab === 'Retail Packs' && (
                        <>
                            <div>
                                <label className="block text-white text-2xl font-bold mb-2 text-center" htmlFor="colour">
                                    COLOUR
                                </label>
                                <select
                                    id="colour"
                                    className="w-full bg-white text-black text-xl rounded-md px-4 py-3 focus:outline-none cursor-pointer"
                                    value={colour}
                                    onChange={e => {
                                        setColour(e.target.value);
                                        setDepth(''); // Reset depth when color changes
                                    }}
                                    required
                                >
                                    <option value="" disabled>Select Colour...</option>
                                    <option>Black</option>
                                    <option>Blue</option>
                                    <option>Green</option>
                                    <option>Grey</option>
                                    <option>Orange</option>
                                    <option>Pink</option>
                                    <option>Purple</option>
                                    <option>Red</option>
                                    <option>Teal</option>
                                    <option>Yellow</option>
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
                                    disabled={!colour}
                                >
                                    <option value="" disabled>Select Depth...</option>
                                    <option>30mm</option>
                                    <option>50mm</option>
                                </select>
                            </div>

                            <div>
                                <label className="block text-white text-2xl font-bold mb-2 text-center" htmlFor="type">
                                    TYPE
                                </label>
                                <select
                                    id="type"
                                    className="w-full bg-white text-black text-xl rounded-md px-4 py-3 focus:outline-none cursor-pointer"
                                    value={type}
                                    onChange={e => setType(e.target.value)}
                                    required
                                >
                                    <option value="" disabled>Select Type...</option>
                                    <option>Set</option>
                                    <option>Increase</option>
                                    <option>Decrease</option>
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
                        </>
                    )}

                    {/* Packing Boxes Form */}
                    {activeTab === 'Packing Boxes' && (
                        <>
                            <div>
                                <label className="block text-white text-2xl font-bold mb-2 text-center" htmlFor="boxType">
                                    BOX TYPE
                                </label>
                                <select
                                    id="boxType"
                                    className="w-full bg-white text-black text-xl rounded-md px-4 py-3 focus:outline-none cursor-pointer"
                                    value={boxType}
                                    onChange={e => setBoxType(e.target.value)}
                                    required
                                >
                                    <option value="" disabled>Select Box Type...</option>
                                    <option>Small Box</option>
                                    <option>Medium Box</option>
                                    <option>Large Box</option>
                                    <option>Extra Large Box</option>
                                </select>
                            </div>

                            <div>
                                <label className="block text-white text-2xl font-bold mb-2 text-center" htmlFor="type">
                                    TYPE
                                </label>
                                <select
                                    id="type"
                                    className="w-full bg-white text-black text-xl rounded-md px-4 py-3 focus:outline-none cursor-pointer"
                                    value={type}
                                    onChange={e => setType(e.target.value)}
                                    required
                                >
                                    <option value="" disabled>Select Type...</option>
                                    <option>Standard</option>
                                    <option>Premium</option>
                                    <option>Custom</option>
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
                        </>
                    )}

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
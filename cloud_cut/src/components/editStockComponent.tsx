"use client"

import { useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import { AppDispatch, RootState } from "@/redux/store";
import { fetchFinishedStockFromSupabase } from "@/redux/thunks/stockThunk";
import { getSupabaseClient } from "@/utils/supabase";
import {  } from "@/redux/thunks/stockThunk";

export default function EditStockComponent(){
    const dispatch = useDispatch<AppDispatch>();
    const items = useSelector((state: RootState) => state.stock.items);
    /**Make four constants one for Each stock type */
    const [colour, setColour] = useState('');
    const [depth, setDepth] = useState('');
    const [quantity, setQuantity] = useState(0);
    const [loading, setLoading] = useState(false);
    const [message, setMessage] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);
        console.log(colour, depth, quantity);
        setLoading(false);
    }

    return (
        <div className="min-h-screen flex items-center justify-center">
            <div className="w-full max-w-lg mx-auto bg-[#222] rounded-xl shadow-lg p-10 flex flex-col items-center">
                <h1 className="text-3xl md:text-4xl font-extrabold text-white text-center mb-10 tracking-wide">
                    Edit Stock
                </h1>
                <form className="w-full flex flex-col gap-8" onSubmit={handleSubmit}>
                    
                </form>
            </div>
        </div>
    )
}
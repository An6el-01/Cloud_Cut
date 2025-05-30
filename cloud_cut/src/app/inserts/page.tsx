"use client";

import React, { useState, useEffect, useRef, useCallback } from 'react';
import Navbar from '@/components/Navbar';
import Image from 'next/image';
import { AppDispatch, RootState } from '@/redux/store';
import { useDispatch, useSelector } from 'react-redux';
import * as Sentry from '@sentry/nextjs';
import { supabase } from '@/utils/supabase';
import { useSearchParams } from 'next/navigation';

interface Insert {
    sku: string;
    stock_available: number;
    svgUrl?: string | null;
    brand: string | null;
}

interface FormData {
    brand: string;
    sku: string;
    dxf: File[];
}

export default function Inserts() {
    const dispatch = useDispatch<AppDispatch>();
    const { loading, error } = useSelector((state: RootState) => state.stock);
    const [isRefreshing, setIsRefreshing] = useState(false);
    const [isImporting, setIsImporting] = useState(false);
    const [importMessage, setImportMessage] = useState('');
    const searchParams = useSearchParams();
    const [selectedBrand, setSelectedBrand] = useState<string | null>(() => {
        // Initialize from URL if available
        if (typeof window !== 'undefined') {
            const params = new URLSearchParams(window.location.search);
            return params.get('brand');
        }
        return null;
    });
    const [inserts, setInserts] = useState<Insert[]>([]);
    const [isLoadingInserts, setIsLoadingInserts] = useState(false);
    const selectedBrandRef = useRef<HTMLDivElement>(null);
    const brandsContainerRef = useRef<HTMLDivElement>(null);
    const dxfInputRef = useRef<HTMLInputElement>(null);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [submitMessage, setSubmitMessage] = useState<{ type: 'success' | 'error', text: string } | null>(null);
    const [selectedDXFFiles, setSelectedDXFFiles] = useState<File[]>([]);
    const [svgPreview, setSvgPreview] = useState<string | null>(null);
    const [selectedInsert, setSelectedInsert] = useState<Insert | null>(null);
    const [isMultipleParts, setIsMultipleParts] = useState(false);
    const [currentSlideIndex, setCurrentSlideIndex] = useState(0);
    const [relatedSkus, setRelatedSkus] = useState<Array<{sku: string, svgUrl: string | null}>>([]);
    const [isAddingNewInsert, setIsAddingNewInsert] = useState(false);

    // Auto-dismiss submitMessage after 5 seconds
    useEffect(() => {
        if (submitMessage) {
            const timer = setTimeout(() => {
                setSubmitMessage(null);
            }, 5000);
            return () => clearTimeout(timer);
        }
    }, [submitMessage]);

    // Effect to handle URL parameter
    useEffect(() => {
        if (searchParams) {
            const brandFromUrl = searchParams.get('brand');
            if (brandFromUrl) {
                setSelectedBrand(brandFromUrl);
            }
        }
    }, [searchParams]);

    // Effect to scroll selected brand into view
    useEffect(() => {
        if (selectedBrand && selectedBrandRef.current && brandsContainerRef.current) {
            // Get the container's dimensions
            const container = brandsContainerRef.current;
            const element = selectedBrandRef.current;
            
            // Calculate positions
            const elementRect = element.getBoundingClientRect();
            const containerRect = container.getBoundingClientRect();
            
            // Calculate the scroll position that would center the element
            const scrollTop = element.offsetTop - (container.clientHeight / 2) + (element.clientHeight / 2);
            
            // Smooth scroll to the calculated position
            container.scrollTo({
                top: scrollTop,
                behavior: 'smooth'
            });
        }
    }, [selectedBrand]);

    const brands = [
        {name: 'DeWalt', image: '/dewalt.png'},
        {name: 'Milwaukee', image: '/milwaukee.png'},
        {name: 'Makita', image: '/makita.png'},
        {name: 'Peli', image: '/peli.png'},
        {name: 'Erbauer', image: '/erbauer.png'},
        {name: 'Festool', image: '/festool.png'},
        {name: 'Bosch', image: '/bosch.png'},
        {name: 'Stanley', image: '/stanley.png'},
        {name: 'Halfords', image: '/halfords.png'},
        {name: 'Husky', image: '/husky.png'},
        {name: 'Einhell', image: '/einhell.png'},
        {name: 'Magnusson', image: '/magnusson.png'},
        {name: 'OX', image: '/ox.png'},
        {name: 'Klein', image: '/klein.png'},
        {name: 'Craftsman', image: '/craftsman.png'},
        {name: 'Trend', image: '/trend.png'},
        {name: 'Ryobi', image: '/ryobi.png'},
        {name: 'Nuprol', image: '/nuprol.png'},
        {name: 'Hikoki', image: '/hikoki.png'},
        {name: 'Ridgid', image: '/ridgid.png'},
        {name: 'Toughbuilt', image: '/toughbilt.png'},
        {name: 'Facom', image: '/facom.png'},
        {name: 'AEG', image: '/AEG.png'},
        {name: 'Tanos', image: '/tanos.png'},
        {name: 'JCB', image: '/jcb.png'},
        {name: 'Panasonic', image: '/panasonic.png'},
        {name: 'Flex', image: '/flex.png'},
        {name: 'Sortimo', image: '/sortimo.png'},
        {name: 'Reisser', image: '/reisser.png'},
        {name: 'QBRICK', image: '/qbrick.png'},
        {name: 'Rothenberger', image: '/rothenberger.png'},
        {name: 'V-TUF', image: '/vtuf.png'},
        {name: 'Engelbert Strauss', image: '/strauss.png'},
        {name: 'Metabo', image: '/metabo.png'},
        {name: 'Industrial by Hornbach', image: '/industrial.png'},
        {name: 'Keter', image: '/keter.png'},
        {name: 'Hart', image: '/hart.png'},
        {name: 'Worx', image: '/worx.png'},
        {name: 'Wisent', image: '/wisent.png'},
        {name: 'Würth', image: '/wurth.png'},
        {name: 'HASTA', image: '/hasta.png'},
    ]

    // Fetch inserts for a brand and attach SVG URLs by longest prefix match
    const fetchInsertsForBrand = async (brandName: string) => {
        try {
            setIsLoadingInserts(true);
            const { data, error } = await supabase
                .from('inserts')
                .select('sku, stock_available')
                .eq('brand_name', brandName);

            if (error) throw error;

            // List all SVG files in the bucket
            console.log('Attempting to list files from storage bucket...');
            const { data: svgList, error: svgListError } = await supabase.storage
                .from('inserts')
                .list('', { 
                    limit: 1000,
                    sortBy: { column: 'name', order: 'asc' }
                });
            
            console.log('Storage bucket response:', {
                hasData: !!svgList,
                dataLength: svgList?.length,
                error: svgListError?.message
            });

            if (svgListError) {
                console.error('Storage bucket error:', svgListError);
                throw svgListError;
            }

            // Get all SVG file names (without .svg), lowercased and trimmed
            const svgNames = (svgList || [])
                .filter(file => file.name.endsWith('.svg'))
                .map(file => file.name.replace(/\.svg$/, '').trim());

            console.log('SVG file names in bucket:', svgNames);

            // Attach SVG public URL for each insert by longest prefix match
            let allInsertsWithSvg: Insert[] = [];
            (data || []).forEach((insert) => {
                const skuOriginal = String(insert.sku);
                const sku = skuOriginal.toLowerCase().trim();
                const stock_available = Number(insert.stock_available);
                // Remove last three characters from SKU for matching and convert to uppercase
                const shortenedSku = (sku.length > 3 ? sku.slice(0, -3) : sku).toUpperCase();
                // Find all SVGs that are a prefix of the shortened SKU
                const matchingSvgs = svgNames.filter(svgName => shortenedSku.startsWith(svgName));
                // Pick the longest prefix (most specific match)
                let matchedSvg = null;
                if (matchingSvgs.length > 0) {
                    matchedSvg = matchingSvgs.reduce((a, b) => (a.length > b.length ? a : b));
                }
                let svgUrl = null;
                if (matchedSvg) {
                    const { data: urlData } = supabase.storage
                        .from('inserts')
                        .getPublicUrl('/' + matchedSvg + '.svg');
                    svgUrl = urlData?.publicUrl || null;
                    allInsertsWithSvg.push({
                        ...insert,
                        sku: matchedSvg, // Display the matched SVG filename
                        stock_available,
                        svgUrl,
                        brand: brandName
                    });
                } else {
                    // No match, try trimmed version (first 8 chars of shortenedSku)
                    const trimmedShortenedSku = shortenedSku.slice(0, -1);
                    console.log('DEBUG: For SKU', skuOriginal, 'shortened:', shortenedSku, 'trimmedShortenedSku:', trimmedShortenedSku);
                    // Find all SVGs that start with the trimmed shortened SKU
                    const partSvgs = svgNames.filter(svgName => svgName.startsWith(trimmedShortenedSku));
                    console.log('DEBUG: SVGs matching', trimmedShortenedSku, ':', partSvgs);
                    if (partSvgs.length > 0) {
                        partSvgs.forEach((svgName, idx) => {
                            const { data: urlData } = supabase.storage
                                .from('inserts')
                                .getPublicUrl('/' + svgName + '.svg');
                            const svgUrl = urlData?.publicUrl || null;
                            console.log('DEBUG: Adding part', idx + 1, 'for', skuOriginal, 'SVG:', svgName);
                            allInsertsWithSvg.push({
                                ...insert,
                                sku: svgName, // Display the matched SVG filename
                                stock_available,
                                svgUrl,
                                brand: brandName
                            });
                        });
                    } else {
                        // No SVG at all
                        allInsertsWithSvg.push({
                            ...insert,
                            sku: skuOriginal,
                            stock_available,
                            svgUrl: null,
                            brand: brandName
                        });
                    }
                }
            });

            setInserts(allInsertsWithSvg);
        } catch (error) {
            console.error('Error fetching inserts:', error);
            setInserts([]);
        } finally {
            setIsLoadingInserts(false);
        }
    };

    // Effect to fetch inserts when brand is selected
    useEffect(() => {
        if (selectedBrand) {
            fetchInsertsForBrand(selectedBrand);
        } else {
            setInserts([]);
        }
    }, [selectedBrand]);

    // Handle brand selection
    const handleBrandSelect = (brandName: string) => {
        if (selectedBrand === brandName) {
            setSelectedBrand(null);
            setIsAddingNewInsert(false);
            setSelectedInsert(null);
            setRelatedSkus([]);
            setCurrentSlideIndex(0);
            setIsMultipleParts(false);
            // Update URL to remove brand parameter
            window.history.pushState({}, '', '/inserts');
        } else {
            setSelectedBrand(brandName);
            // Update URL with selected brand
            window.history.pushState({}, '', `/inserts?brand=${encodeURIComponent(brandName)}`);
        }
    };

    const handleRefresh = async () => {
        try {
            setIsRefreshing(true);
            console.log('Refreshing Inserts...');
            // This would normally call syncInserts, but the module is gone
            // Just simulate a refresh for now
            await new Promise(resolve => setTimeout(resolve, 1000));
            console.log('Refresh completed');
        } catch (error) {
            console.error('Error refreshing inserts:', error);
        } finally {
            setIsRefreshing(false);
        }
    }

    const handleImportFromCSV = async () => {
        try {
            setIsImporting(true);
            setImportMessage('Importing inserts from CSV...');
            
            const response = await fetch('/api/inserts/import', { 
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                }
            });
            
            const result = await response.json();
            
            if (result.success) {
                setImportMessage(`Success: ${result.message}`);
            } else {
                setImportMessage(`Error: ${result.message}`);
            }
        } catch (error) {
            console.error('Error importing from CSV:', error);
            setImportMessage(`Failed to import: ${error instanceof Error ? error.message : 'Unknown error'}`);
        } finally {
            setIsImporting(false);
        }
    };

    // Handler for file selection
    const handleDXFClick = () => {
        dxfInputRef.current?.click();
    };
    const handleDXFChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files && e.target.files.length > 0) {
            const files = Array.from(e.target.files);
            setSelectedDXFFiles(prev => [...prev, ...files]);
            // Convert the first file for preview (optional: you may want to preview the last added file)
            convertDXFToSVG(files[0]);
        } else {
            setSvgPreview(null);
        }
    };
    const handleRemoveDXF = (index?: number) => {
        if (typeof index === 'number') {
            setSelectedDXFFiles(prev => prev.filter((_, i) => i !== index));
        } else {
            setSelectedDXFFiles([]);
            if (dxfInputRef.current) dxfInputRef.current.value = '';
        }
    };

    const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
        e.preventDefault();
        setIsSubmitting(true);
        setSubmitMessage(null);

        const form = e.currentTarget;
        const formData = new FormData(form);

        // Validate form
        const brand = formData.get('brand') as string;
        const sku = formData.get('sku') as string;

        if (!brand || !sku || selectedDXFFiles.length === 0) {
            setSubmitMessage({
                type: 'error',
                text: 'Please fill in all fields and select at least one DXF file'
            });
            setIsSubmitting(false);
            return;
        }

        // Validate SKU format
        if (!sku.toUpperCase().startsWith('SFI')) {
            setSubmitMessage({
                type: 'error',
                text: 'SKU must start with SFI'
            });
            setIsSubmitting(false);
            return;
        }

        try {
            // Add each DXF file to the form data
            selectedDXFFiles.forEach(file => {
                formData.append('dxf', file);
            });

            const response = await fetch('/api/inserts/add', {
                method: 'POST',
                body: formData
            });

            const result = await response.json();

            if (result.success) {
                setSubmitMessage({
                    type: 'success',
                    text: result.message
                });
                // Reset form
                form.reset();
                setSelectedDXFFiles([]);
                // Refresh inserts list if the brand is selected
                if (selectedBrand === brand) {
                    await fetchInsertsForBrand(brand);
                }
            } else {
                setSubmitMessage({
                    type: 'error',
                    text: result.message
                });
            }
        } catch (error) {
            setSubmitMessage({
                type: 'error',
                text: 'Failed to add insert. Please try again.'
            });
        } finally {
            setIsSubmitting(false);
        }
    };

    const convertDXFToSVG = async(file: File) => {
        const formData = new FormData();
        formData.append('file', file);

        try{
            const response = await fetch('/api/inserts/add', {
                method: 'POST',
                body: formData,
            });
            if(!response.ok) throw new Error('Failed to convert DXF');
            const svgText = await response.text();
            setSvgPreview(svgText);
        } catch (err) {
            setSvgPreview(null);
            //Optionally handle error
        }
    };

    const handleMultiplePartsChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        setIsMultipleParts(e.target.value === 'yes');
        setCurrentSlideIndex(0);
    };

    const handleSlideChange = (direction: 'prev' | 'next') => {
        if (relatedSkus.length === 0) return;
        if (direction === 'prev') {
            setCurrentSlideIndex(prev => (prev === 0 ? relatedSkus.length - 1 : prev - 1));
        } else {
            setCurrentSlideIndex(prev => (prev === relatedSkus.length - 1 ? 0 : prev + 1));
        }
    };

    const fetchRelatedSkus = async (baseSku: string, brand: string) => {
        try {
            // Get all SKUs that start with the base SKU
            const { data, error } = await supabase
                .from('inserts')
                .select('sku')
                .eq('brand_name', brand)
                .ilike('sku', `${baseSku}%`);

            if (error) throw error;

            // Get SVG URLs for each SKU
            const skusWithSvg = await Promise.all(
                (data as { sku: string }[] || []).map(async (insert) => {
                    const { data: urlData } = supabase.storage
                        .from('inserts')
                        .getPublicUrl('/' + insert.sku + '.svg');
                    return {
                        sku: insert.sku,
                        svgUrl: urlData?.publicUrl || null
                    };
                })
            );

            setRelatedSkus(skusWithSvg);
        } catch (error) {
            console.error('Error fetching related SKUs:', error);
            setRelatedSkus([]);
        }
    };

    // Add this function to get all related SKUs for a base SKU
    const getAllRelatedSkus = (baseSku: string, brand: string): Insert[] => {
        // Filter inserts to find all SKUs that start with the base SKU
        return inserts.filter(insert => 
            insert.sku.startsWith(baseSku) && 
            insert.brand === brand
        );
    };

    const handleInsertSelect = (insert: Insert) => {
        setIsAddingNewInsert(false);
        // If the clicked insert is already selected, unselect it
        if (selectedInsert && insert.sku === relatedSkus[currentSlideIndex]?.sku) {
            setSelectedInsert(null);
            setRelatedSkus([]);
            setCurrentSlideIndex(0);
            setIsMultipleParts(false);
            return;
        }
        const updatedInsert: Insert = {
            ...insert,
            brand: selectedBrand
        };
        setSelectedInsert(updatedInsert);
        if (insert.sku && selectedBrand) {
            // Extract base SKU (remove any part numbers)
            const baseSku = insert.sku.replace(/-\d{2}$/, '');
            // Check if this is a multi-part insert
            const hasMultipleParts = insert.sku.includes('-');
            setIsMultipleParts(hasMultipleParts);
            if (hasMultipleParts) {
                // Get all related SKUs for this insert
                const relatedInserts = getAllRelatedSkus(baseSku, selectedBrand);
                // Sort the SKUs to ensure they're in order (01, 02, 03, etc.)
                const sortedSkus = relatedInserts.sort((a, b) => {
                    const aPart = parseInt(a.sku.split('-').pop() || '0');
                    const bPart = parseInt(b.sku.split('-').pop() || '0');
                    return aPart - bPart;
                });
                // Filter out duplicates by svgUrl
                const uniqueSkus = sortedSkus.filter(
                    (insert, idx, arr) =>
                        insert.svgUrl && arr.findIndex(i => i.svgUrl === insert.svgUrl) === idx
                );
                // Update the related SKUs state with all unique parts
                setRelatedSkus(uniqueSkus.map(insert => ({
                    sku: insert.sku,
                    svgUrl: insert.svgUrl || null
                })));
            } else {
                // For single-part inserts, just set the current SKU
                setRelatedSkus([{
                    sku: insert.sku,
                    svgUrl: insert.svgUrl || null
                }]);
            }
        }
    };

    // Add this handler for deleting an insert
    const handleDeleteInsert = async () => {
        if (!selectedInsert) return;
        try {
            console.log('[Delete Insert] Attempting to delete:', selectedInsert);
            
            // Delete SVG from storage if it exists
            if (selectedInsert.svgUrl) {
                // Extract the path relative to the bucket root
                const svgMatch = selectedInsert.svgUrl.match(/\/inserts\/(.*\.svg)$/);
                const svgPath = svgMatch ? svgMatch[1] : null;
                console.log('[Delete Insert] SVG URL:', selectedInsert.svgUrl);
                console.log('[Delete Insert] Extracted SVG path:', svgPath);
                
                if (svgPath) {
                    // Remove any leading/trailing slashes and ensure proper path format
                    const cleanPath = svgPath.replace(/^\/+|\/+$/g, '');
                    console.log('[Delete Insert] Cleaned SVG path:', cleanPath);
                    
                    const { data: storageData, error: storageError } = await supabase.storage
                        .from('inserts')
                        .remove([cleanPath]);
                    
                    console.log('[Delete Insert] Storage remove result:', {
                        data: storageData,
                        error: storageError?.message,
                        path: cleanPath
                    });
                    
                    if (storageError) {
                        console.error('Error deleting SVG from storage:', storageError.message);
                    }
                } else {
                    console.warn('[Delete Insert] Could not extract SVG path from URL:', selectedInsert.svgUrl);
                }
            } else {
                console.log('[Delete Insert] No SVG URL to delete.');
            }

            // Delete the insert from the table
            console.log('[Delete Insert] Deleting from table where sku =', selectedInsert.sku);
            const { data: tableData, error: tableError } = await supabase
                .from('inserts')
                .delete()
                .eq('sku', selectedInsert.sku);
            
            console.log('[Delete Insert] Table delete result:', {
                data: tableData,
                error: tableError?.message
            });
            
            if (tableError) {
                console.error('Error deleting insert from table:', tableError.message);
            }

            // Clear selection and refresh
            setSelectedInsert(null);
            setRelatedSkus([]);
            setCurrentSlideIndex(0);
            setIsMultipleParts(false);
            setIsAddingNewInsert(false);
            
            // Refresh the inserts list if the brand is selected
            if (selectedInsert.brand) {
                await fetchInsertsForBrand(selectedInsert.brand);
            }
        } catch (err) {
            console.error('Error deleting insert:', err);
        }
    };

    return (
        <div className="relative min-h-screen text-white ">
            {/**NavBar */}
            <div className="fixed top-0 left-0 w-full z-10">
                <Navbar />
            </div>

            {/**Brands Section*/}
            <div className="flex justify-center items-start min-h-[40vh] pt-24">
                <div className="w-[70vw] max-w-6xl rounded-xl shadow-lg">
                    <div className="bg-[#1d1d1d]/90 rounded-t-xl p-4">
                        <div className="flex justify-between items-center">
                            <h1 className="text-2xl font-bold text-white">Brands</h1>
                            <div className="flex gap-4">
                                {/* Import from CSV button */}
                                <button
                                    onClick={handleImportFromCSV}
                                    disabled={isImporting || isRefreshing}
                                    className="flex items-center gap-2 px-4 py-2 text-white font-semibold rounded-lg shadow transition-all duration-200 bg-gradient-to-br from-blue-700 to-blue-800 hover:from-blue-500 hover:to-blue-600 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-400 disabled:opacity-70 disabled:cursor-not-allowed"
                                    aria-label="Import Inserts from CSV"
                                >
                                    <span className={`${isImporting ? "animate-pulse" : ""}`}>
                                        {isImporting ? "Importing..." : "Import from CSV"}
                                    </span>
                                </button>
                                
                                {/* Refresh button */}
                                <button
                                    onClick={async () => {
                                        try {
                                            await Sentry.startSpan({
                                                name: 'handleRefresh-Inserts'
                                            }, async () => {
                                                handleRefresh();
                                            });
                                        } catch (error) {
                                            console.error('Entry in Sentry span:', error);
                                            handleRefresh();
                                        }
                                    }}
                                    className={"flex items-center gap-2 px-4 py-2 text-white font-semibold rounded-lg shadow transition-all duration-200 bg-gradient-to-br from-gray-700 to-gray-800 hover:from-gray-500 hover:to-gray-600 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-gray-400 disabled:opacity-70 disabled:cursor-not-allowed"}
                                    disabled={loading || isRefreshing || isImporting}
                                    aria-label={isRefreshing ? "Syncing Inserts" : "Refresh Inserts"}
                                >
                                    <span className={`${isRefreshing ? "animate-spin" : ""} text-red-400`}>
                                        <svg xmlns="http://ww.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                            <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/>
                                            <path d="M21 3v5h-5"/>
                                            <path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/>
                                            <path d="M8 16H3v5"/>
                                        </svg>
                                    </span>
                                    <span>{isRefreshing ? "Syncing..." : "Refresh"}</span>
                                </button>
                            </div>
                        </div>
                        
                        {/* Import status message */}
                        {importMessage && (
                            <div className={`mt-2 text-sm p-2 rounded ${importMessage.includes('Success') ? 'bg-green-800/50 text-green-100' : 'bg-red-800/50 text-red-100'}`}>
                                {importMessage}
                            </div>
                        )}
                    </div>
                    <div ref={brandsContainerRef} className="bg-white rounded-b-xl p-6 h-[46vh] overflow-y-auto scroll-smooth">
                        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-6">
                            {brands.map((brand) => (
                                <div
                                    key={brand.name}
                                    ref={brand.name === selectedBrand ? selectedBrandRef : null}
                                    onClick={() => handleBrandSelect(brand.name)}
                                    className={`flex flex-col items-center justify-center rounded-lg shadow h-32 w-full bg-white hover:shadow-xl transition-all duration-200 p-4 border cursor-pointer
                                        ${selectedBrand === brand.name 
                                            ? 'border-blue-500 ring-2 ring-blue-500' 
                                            : 'border-gray-200 hover:border-blue-300'}`}
                                >
                                    <Image
                                        src={brand.image}
                                        alt={brand.name}
                                        width={120}
                                        height={60}
                                        className="object-contain max-h-16 mb-2"
                                    />
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
            </div>

            {/**Divider */}
            <div className="flex justify-center my-8">
                <div className="w-[70vw] max-w-6xl border-t border-gray-700 opacity-40"></div>
            </div>

            {/**Inserts Section*/}
            <div className="w-full flex justify-center px-4 min-h-[50vh]">
                <div className="flex flex-col lg:flex-row gap-16 max-w-6xl w-full justify-center">
                    {/**Inserts Column*/}
                    <div className="flex-1 min-w-0 max-w-[600px] flex flex-col  rounded-xl shadow-xl mb-8">
                        <div className="bg-[#1d1d1d]/90 rounded-t-lg backdrop-blur-sm p-4 flex items-center justify-between">
                            <h1 className="text-2xl font-bold text-white">
                                {selectedBrand ? `${selectedBrand} Inserts` : 'Inserts'}
                            </h1>
                            <div className="flex items-center gap-2">
                                <button
                                    type="button"
                                    className="group flex items-center gap-2 px-4 py-2 rounded-xl bg-gradient-to-r from-blue-700 to-blue-500 hover:from-blue-700 hover:to-blue-600 border border-blue-700 shadow-lg text-white font-semibold transition-all duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-300"
                                    aria-label="Add new insert"
                                    onClick={() => {
                                        setIsAddingNewInsert(true);
                                        setSelectedInsert(null);
                                        setRelatedSkus([]);
                                        setCurrentSlideIndex(0);
                                        setIsMultipleParts(false);
                                    }}
                                >
                                    <span className="flex items-center justify-center w-7 h-7 rounded-full bg-white/20 group-hover:bg-white/30 transition">
                                        <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                                            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
                                        </svg>
                                    </span>
                                    <span className="hidden sm:inline">Add Insert</span>
                                </button>
                        </div>
                        </div>
                        <div className="overflow-x-auto bg-white h-[48vh] flex flex-col rounded-b-xl">
                            {isLoadingInserts ? (
                                <div className="flex-1 flex items-center justify-center bg-gray-50">
                                    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500"></div>
                                </div>
                            ) : !selectedBrand ? (
                                <div className="flex-1 flex flex-col items-center justify-center bg-gray-50 p-6">
                                    <p className="text-gray-700 font-medium text-lg">Select a brand to view inserts</p>
                                </div>
                            ) : inserts.length === 0 ? (
                                <div className="flex-1 flex flex-col items-center justify-center bg-gray-50 p-6">
                                    <p className="text-gray-700 font-medium text-lg">No inserts found for {selectedBrand}</p>
                                </div>
                            ) : (
                                <div className="flex-1 overflow-y-auto p-2">
                                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
                                        {(() => {
                                            // First, separate SKUs into single and multi-parts
                                            let { singleParts, multiParts } = inserts.reduce<{
                                                singleParts: Insert[],
                                                multiParts: Record<string, Insert[]>
                                            }>((acc, insert) => {
                                                // Check if SKU has a part number (ends with -XX)
                                                const hasPartNumber = /-\d{2}$/.test(insert.sku);
                                                if (hasPartNumber) {
                                                    // Get base SKU by removing the part number
                                                    const baseSku = insert.sku.replace(/-\d{2}$/, '');
                                                    if (!acc.multiParts[baseSku]) {
                                                        acc.multiParts[baseSku] = [];
                                                    }
                                                    acc.multiParts[baseSku].push(insert);
                                                } else {
                                                    acc.singleParts.push(insert);
                                                }
                                                return acc;
                                            }, { singleParts: [], multiParts: {} });

                                            // Filter out duplicates by svgUrl in singleParts
                                            singleParts = singleParts.filter(
                                                (insert, idx, arr) =>
                                                    insert.svgUrl && arr.findIndex(i => i.svgUrl === insert.svgUrl) === idx
                                            );

                                            // Filter out duplicates by svgUrl in each multiParts group
                                            Object.keys(multiParts).forEach(baseSku => {
                                                const group = multiParts[baseSku];
                                                multiParts[baseSku] = group.filter(
                                                    (insert, idx, arr) =>
                                                        insert.svgUrl && arr.findIndex(i => i.svgUrl === insert.svgUrl) === idx
                                                );
                                            });

                                            // Render single-part SKUs
                                            const singlePartCards = singleParts.map((insert) => {
                                                const isSelected = selectedInsert && insert.sku === relatedSkus[currentSlideIndex]?.sku;
                                                return (
                                                <div
                                                    key={insert.sku}
                                                        className={`bg-white rounded-lg shadow flex flex-col items-center p-3 border transition-colors duration-150 cursor-pointer ${
                                                            isSelected ? 'bg-blue-100 border-blue-500 ring-2 ring-blue-300' : 'border-gray-200 hover:border-blue-300'
                                                        }`}
                                                        onClick={() => handleInsertSelect(insert)}
                                                >
                                                    <div className="flex items-center justify-center w-24 h-20 bg-gray-200 rounded mb-2 overflow-hidden">
                                                        {insert.svgUrl ? (
                                                            <img
                                                                src={insert.svgUrl}
                                                                alt={insert.sku}
                                                                className="object-contain w-20 h-16"
                                                            />
                                                        ) : (
                                                            <span className="text-gray-400 text-xs">No image</span>
                                                        )}
                                                    </div>
                                                    <div className="text-center font-bold text-black text-sm mt-1">
                                                        {insert.sku}
                                                    </div>
                                                </div>
                                                );
                                            });

                                            // Render multi-part SKUs
                                            const multiPartCards = Object.entries(multiParts).map(([baseSku, groupedInserts]) => {
                                                const sortedInserts = groupedInserts.sort((a, b) => {
                                                    const aPart = parseInt(a.sku.split('-').pop() || '0');
                                                    const bPart = parseInt(b.sku.split('-').pop() || '0');
                                                    return aPart - bPart;
                                                });
                                                // Highlight if any part is selected
                                                const isSelected = selectedInsert && sortedInserts.some(insert => insert.sku === relatedSkus[currentSlideIndex]?.sku);
                                                return (
                                                    <div
                                                        key={baseSku}
                                                        className={`bg-white rounded-lg shadow flex flex-col items-center p-3 border transition-colors duration-150 cursor-pointer ${
                                                            isSelected ? 'bg-blue-100 border-blue-500 ring-2 ring-blue-300' : 'border-gray-200 hover:border-blue-300'
                                                        }`}
                                                        onClick={() => handleInsertSelect(sortedInserts[0])}
                                                    >
                                                        <div className="flex items-center justify-center w-24 h-20 bg-gray-200 rounded mb-2 overflow-hidden">
                                                            {sortedInserts[0].svgUrl ? (
                                                                <img
                                                                    src={sortedInserts[0].svgUrl}
                                                                    alt={baseSku}
                                                                    className="object-contain w-20 h-16"
                                                                />
                                                            ) : (
                                                                <span className="text-gray-400 text-xs">No image</span>
                                                            )}
                                                        </div>
                                                        <div className="text-center font-bold text-black text-sm mt-1">
                                                            {baseSku}
                                                        </div>
                                                        <div className="mt-2 w-full">
                                                            <details className="w-full">
                                                                <summary className="text-sm text-gray-600 cursor-pointer hover:text-blue-600">
                                                                    {sortedInserts.length} parts
                                                                </summary>
                                                                <div className="mt-2 pl-2 border-l-2 border-gray-200">
                                                                    {sortedInserts.map((insert: Insert, idx: number) => (
                                                                        <div key={idx} className="text-xs text-gray-600 py-1">
                                                                            {insert.sku}
                                                                        </div>
                                                                    ))}
                                                                </div>
                                                            </details>
                                                        </div>
                                                    </div>
                                                );
                                            });

                                            return [
                                                ...singlePartCards,
                                                ...multiPartCards,
                                                // Add New Insert Card
                                                <div
                                                    key="add-new-insert"
                                                    className="flex flex-col items-center justify-center rounded-lg shadow h-32 w-full bg-white hover:shadow-xl transition-all duration-200 p-4 border-2 border-dashed border-blue-400 cursor-pointer group"
                                                    onClick={() => {
                                                        setIsAddingNewInsert(true);
                                                        setSelectedInsert(null);
                                                        setRelatedSkus([]);
                                                        setCurrentSlideIndex(0);
                                                        setIsMultipleParts(false);
                                                    }}
                                                    aria-label="Add new insert"
                                                >
                                                    <div className="flex flex-col items-center justify-center h-full w-full">
                                                        <div className="flex items-center justify-center w-16 h-16 rounded-full bg-blue-100 group-hover:bg-blue-200 transition-colors">
                                                            <svg xmlns="http://www.w3.org/2000/svg" className="h-10 w-10 text-blue-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                                                                <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
                                                            </svg>
                                                        </div>
                                                        <span className="mt-2 text-blue-600 font-semibold text-sm">Add New Insert</span>
                                                    </div>
                                                </div>
                                            ];
                                        })()}
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>
                            
                    {/* Edit An Insert Section */}
                    <div className="flex-1 min-w-0 max-w-[600px] flex flex-col bg-[#1d1d1d]/90 rounded-xl shadow-xl mb-8 relative">
                        <div className="bg-[#1d1d1d]/90 rounded-t-lg backdrop-blur-sm p-4 flex items-center justify-between">
                            {isAddingNewInsert ? (
                                <h1 className="text-2xl font-bold text-white">Add New Insert</h1>
                            ) : selectedInsert?.brand ? (
                                <>
                                    <h1 className="text-2xl font-bold text-white">Insert: {relatedSkus[currentSlideIndex]?.sku}</h1>
                                    <button
                                        type="button"
                                        className="group flex items-center gap-2 px-4 py-2 rounded-xl bg-gradient-to-r from-red-700 to-red-500 hover:from-red-800 hover:to-red-600 border border-red-800 shadow-lg text-white font-semibold transition-all duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-300 ml-4"
                                        aria-label="Delete this insert"
                                        title="Delete this insert"
                                        onClick={handleDeleteInsert}
                                    >
                                        <span className="flex items-center justify-center w-7 h-7 rounded-full bg-white/20 group-hover:bg-white/30 transition">
                                            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                                                <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0 1 16.138 21H7.862a2 2 0 0 1-1.995-1.858L5 7m5-4h4a2 2 0 0 1 2 2v2H7V5a2 2 0 0 1 2-2zm-2 6h8" />
                                            </svg>
                                        </span>
                                        <span className="hidden sm:inline">Delete Insert</span>
                                    </button>
                                </>
                            ) : (
                                <h1 className="text-2xl font-bold text-white">No Insert Selected</h1>
                            )}
                        </div>
                        {isAddingNewInsert ? (
                        <form onSubmit={handleSubmit} className="flex-1 flex flex-col justify-between bg-white rounded-b-xl p-6">
                                {/* Add New Insert form fields (empty/default values) */}
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                                <div className="flex flex-col gap-4">
                                    <label className="font-semibold text-black" htmlFor="brand">Brand:</label>
                                    <select
                                        id="brand"
                                        name="brand"
                                        className="border border-gray-400 rounded-lg px-4 py-2 text-black focus:outline-none focus:ring-2 focus:ring-blue-400"
                                            defaultValue={selectedBrand || ''}
                                        required
                                    >
                                        <option value="" disabled>Brand...</option>
                                        {brands.map((brand) => (
                                            <option key={brand.name} value={brand.name}>{brand.name}</option>
                                        ))}
                                    </select>
                                    <label className="font-semibold text-black mt-2" htmlFor="sku">SKU:</label>
                                    <input
                                        id="sku"
                                        name="sku"
                                        type="text"
                                            placeholder="Enter SKU"
                                        className="border border-gray-400 rounded-lg px-4 py-2 text-black focus:outline-none focus:ring-2 focus:ring-blue-400"
                                        required
                                        pattern="SFI.*"
                                        title="SKU must start with SFI"
                                    />
                                        <div className="mt-4">
                                            <label className="font-semibold text-black block mb-2">Multiple Parts?</label>
                                            <div className="flex gap-4">
                                                <label className="flex items-center space-x-2 cursor-pointer">
                                                    <input
                                                        type="radio"
                                                        name="multipleParts"
                                                        value="yes"
                                                        className="w-4 h-4 text-blue-600 border-gray-300 focus:ring-blue-500"
                                                        aria-label="Yes, this insert has multiple parts"
                                                        onChange={handleMultiplePartsChange}
                                                    />
                                                    <span className="text-gray-700">Yes</span>
                                                </label>
                                                <label className="flex items-center space-x-2 cursor-pointer">
                                                    <input
                                                        type="radio"
                                                        name="multipleParts"
                                                        value="no"
                                                        className="w-4 h-4 text-blue-600 border-gray-300 focus:ring-blue-500"
                                                        aria-label="No, this insert has a single part"
                                                        defaultChecked
                                                        onChange={handleMultiplePartsChange}
                                                    />
                                                    <span className="text-gray-700">No</span>
                                                </label>
                                            </div>
                                        </div>
                                </div>
                                {/* Right: DXF Upload */}
                                <div className="flex flex-col gap-4 items-center justify-center">
                                    <label className="font-semibold text-black " htmlFor="dxf">Upload DXF:</label>
                                    {selectedDXFFiles.length > 0 ? (
                                        <div className="w-full bg-gray-50 border border-gray-400 rounded-lg shadow-sm p-4 h-[30vh] overflow-y-auto">
                                            <button
                                                type="button"
                                                className="mx-auto mb-3 flex items-center gap-2 px-3 py-1 rounded bg-blue-100 hover:bg-blue-200 text-blue-700 text-xs font-medium focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400"
                                                aria-label="Add more DXF files"
                                                title="Add more DXF files"
                                                onClick={handleDXFClick}
                                            >
                                                <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                                                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
                                                </svg>
                                                Add more DXF files
                                            </button>
                                            <ul className="space-y-2">
                                                {selectedDXFFiles.map((file, index) => (
                                                    <li key={index} className="flex items-center gap-4 bg-white  p-3 border-b border-gray-300">
                                                        <span className="text-sm text-gray-700 truncate flex-1" title={file.name}>{file.name}</span>
                                                        <button
                                                            type="button"
                                                            className="ml-2 p-1 rounded-full bg-red-100 hover:bg-red-200 text-red-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-400"
                                                            aria-label={`Remove ${file.name}`}
                                                            title="Remove file"
                                                            onClick={e => { e.stopPropagation(); handleRemoveDXF(index); }}
                                                        >
                                                            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                                                                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                                                            </svg>
                                                        </button>
                                                    </li>
                                                ))}
                                            </ul>
                                            <input
                                                id="dxf"
                                                name="dxf"
                                                type="file"
                                                accept=".dxf"
                                                className="hidden"
                                                ref={dxfInputRef}
                                                onChange={handleDXFChange}
                                                onClick={e => e.stopPropagation()}
                                                multiple
                                            />
                                        </div>
                                    ) : (
                                        <div
                                            className="w-full flex flex-col items-center justify-center border-2 border-dashed border-gray-400 rounded-lg p-6 bg-gray-50 text-center cursor-pointer hover:border-blue-400 transition-colors"
                                            onClick={handleDXFClick}
                                        >
                                            <svg xmlns="http://www.w3.org/2000/svg" className="mx-auto mb-2" width="40" height="40" fill="none" viewBox="0 0 24 24" stroke="#1d1d1d" strokeWidth="2">
                                                <path strokeLinecap="round" strokeLinejoin="round" d="M12 16v-8m0 0l-4 4m4-4l4 4" />
                                                <rect x="3" y="17" width="18" height="4" rx="2" fill="#fcfafa" />
                                            </svg>
                                            <span className="text-gray-700">Browse files to upload</span>
                                            <input
                                                id="dxf"
                                                name="dxf"
                                                type="file"
                                                accept=".dxf"
                                                className="hidden"
                                                ref={dxfInputRef}
                                                onChange={handleDXFChange}
                                                onClick={e => e.stopPropagation()}
                                                multiple
                                                required
                                            />
                                            <div className="w-full mt-4">
                                                <div className="text-sm text-gray-500 flex items-center justify-center h-10">No files selected</div>
                                            </div>
                                        </div>
                                    )}
                                </div>
                            </div>
                                {/* Submit message */}
                                {submitMessage && (
                                    <div className={`mt-4 p-3 rounded-lg ${
                                        submitMessage.type === 'success' 
                                            ? 'bg-green-100 text-green-700' 
                                            : 'bg-red-100 text-red-700'
                                    }`}>
                                        {submitMessage.text}
                                    </div>
                                )}
                                <div className="flex justify-center mt-8">
                                    <button
                                        type="submit"
                                        disabled={isSubmitting}
                                        className={`px-8 py-2 rounded-full font-semibold text-white bg-gradient-to-r from-gray-800 to-red-700 hover:from-red-800 hover:to-red-600 transition-colors shadow-md ${
                                            isSubmitting ? 'opacity-50 cursor-not-allowed' : ''
                                        }`}
                                    >
                                        {isSubmitting ? 'Uploading...' : 'Add Insert'}
                                    </button>
                                </div>
                            </form>
                        ) : (!selectedInsert || !selectedBrand) ? (
                            <div className="flex-1 flex flex-col items-center justify-center bg-white rounded-b-xl p-8">
                                <span className="text-gray-500 text-lg font-semibold">No insert has been selected.</span>
                            </div>
                        ) : (
                        <form onSubmit={handleSubmit} className="flex-1 flex flex-col justify-between bg-white rounded-b-xl p-6">
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                                {/* Left: Brand and SKU */}
                                <div className="flex flex-col gap-4">
                                    <label className="font-semibold text-black" htmlFor="brand">Brand:</label>
                                    <select
                                        id="brand"
                                        name="brand"
                                        className="border border-gray-400 rounded-lg px-4 py-2 text-black focus:outline-none focus:ring-2 focus:ring-blue-400"
                                            value={selectedInsert?.brand || ''}
                                            onChange={(e) => {
                                                if (selectedInsert) {
                                                    setSelectedInsert({
                                                        ...selectedInsert,
                                                        brand: e.target.value || null
                                                    });
                                                }
                                            }}
                                        required
                                    >
                                        <option value="" disabled>Brand...</option>
                                        {brands.map((brand) => (
                                            <option key={brand.name} value={brand.name}>{brand.name}</option>
                                        ))}
                                    </select>
                                    <label className="font-semibold text-black mt-2" htmlFor="sku">SKU:</label>
                                    <input
                                        id="sku"
                                        name="sku"
                                        type="text"
                                            placeholder={relatedSkus[currentSlideIndex]?.sku}
                                        className="border border-gray-400 rounded-lg px-4 py-2 text-black focus:outline-none focus:ring-2 focus:ring-blue-400"
                                        required
                                        pattern="SFI.*"
                                        title="SKU must start with SFI"
                                    />
                                        <div className="mt-4">
                                            <label className="font-semibold text-black block mb-2">Multiple Parts?</label>
                                            <div className="flex gap-4">
                                                <label className="flex items-center space-x-2 cursor-pointer">
                                                    <input
                                                        type="radio"
                                                        name="multipleParts"
                                                        value="yes"
                                                        className="w-4 h-4 text-blue-600 border-gray-300 focus:ring-blue-500"
                                                        aria-label="Yes, this insert has multiple parts"
                                                        onChange={handleMultiplePartsChange}
                                                    />
                                                    <span className="text-gray-700">Yes</span>
                                                </label>
                                                <label className="flex items-center space-x-2 cursor-pointer">
                                                    <input
                                                        type="radio"
                                                        name="multipleParts"
                                                        value="no"
                                                        className="w-4 h-4 text-blue-600 border-gray-300 focus:ring-blue-500"
                                                        aria-label="No, this insert has a single part"
                                                        defaultChecked
                                                        onChange={handleMultiplePartsChange}
                                                    />
                                                    <span className="text-gray-700">No</span>
                                                </label>
                                            </div>
                                        </div>
                                </div>
                                {/* Right: DXF Upload */}
                                <div className="flex flex-col gap-4 items-center justify-center">
                                    <label className="font-semibold text-black mb-2" htmlFor="dxf">Upload DXF:</label>
                                        {/* Only show the slider if there are multiple unique parts */}
                                        {relatedSkus.length > 1 ? (
                                            <div className="w-full">
                                                <div className="relative w-full flex items-center justify-center border-2 border-dashed border-gray-400 rounded-lg p-6 bg-gray-50 text-center cursor-pointer hover:border-blue-400 transition-colors">
                                                    <div className="w-full">
                                                        <div className="relative flex items-center justify-center">
                                                            {/* Improved Previous Button */}
                                                            <button
                                                                type="button"
                                                                onClick={(e) => { e.stopPropagation(); handleSlideChange('prev'); }}
                                                                className="absolute left-[-32px] top-1/2 -translate-y-1/2 z-10 w-12 h-12 flex items-center justify-center rounded-full bg-white/70 backdrop-blur border border-gray-300 shadow-lg hover:bg-blue-100 hover:scale-110 active:scale-95 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 transition-all duration-150"
                                                                aria-label="Previous part"
                                                            >
                                                                <svg xmlns="http://www.w3.org/2000/svg" className="h-7 w-7 text-gray-700" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                                                </svg>
                                                            </button>
                                                            <div className="w-full flex flex-col items-center">
                                                                <div className="w-24 h-20 bg-gray-200 rounded mb-2 overflow-hidden flex items-center justify-center">
                                                                    {relatedSkus[currentSlideIndex]?.svgUrl ? (
                                                                        <img
                                                                            src={relatedSkus[currentSlideIndex].svgUrl!}
                                                                            alt={`Part ${currentSlideIndex + 1}`}
                                                                            className="object-contain w-full h-full"
                                                                        />
                                                                    ) : (
                                                                        <span className="text-gray-400 text-xs">No preview</span>
                                                                    )}
                                                                </div>
                                                                <span className="text-sm text-gray-700 font-semibold tracking-wide mt-2">
                                                                    {relatedSkus[currentSlideIndex]?.sku} 
                                                                </span>
                                                            </div>
                                                            {/* Improved Next Button */}
                                                            <button
                                                                type="button"
                                                                onClick={(e) => { e.stopPropagation(); handleSlideChange('next'); }}
                                                                className="absolute right-[-32px] top-1/2 -translate-y-1/2 z-10 w-12 h-12 flex items-center justify-center rounded-full bg-white/70 backdrop-blur border border-gray-300 shadow-lg hover:bg-blue-100 hover:scale-110 active:scale-95 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 transition-all duration-150"
                                                                aria-label="Next part"
                                                            >
                                                                <svg xmlns="http://www.w3.org/2000/svg" className="h-7 w-7 text-gray-700" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                                                                </svg>
                                                            </button>
                                                        </div>
                                                        <div className="mt-4 flex justify-center gap-2">
                                                            {relatedSkus.map((_, index) => (
                                                                <button
                                                                    key={index}
                                                                    type="button"
                                                                    onClick={(e) => { e.stopPropagation(); setCurrentSlideIndex(index); }}
                                                                    className={`w-3 h-3 rounded-full border-2 ${
                                                                        index === currentSlideIndex ? 'bg-blue-500 border-blue-500' : 'bg-gray-200 border-gray-300'
                                                                    } transition-all duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400`}
                                                                    aria-label={`Go to part ${index + 1}`}
                                                                />
                                                            ))}
                                                        </div>
                                                    </div>
                                                </div>
                                            </div>
                                        ) : (
                                    <div
                                        className="w-full flex flex-col items-center justify-center border-2 border-dashed border-gray-400 rounded-lg p-6 bg-gray-50 text-center cursor-pointer hover:border-blue-400 transition-colors"
                                        onClick={handleDXFClick}
                                    >
                                        {selectedInsert?.svgUrl ? (
                                            <>
                                                <img src={selectedInsert.svgUrl} alt={selectedInsert.sku} className="w-20 h-16 object-contain" />
                                                <input
                                                    id="dxf"
                                                    name="dxf"
                                                    type="file"
                                                    accept=".dxf"
                                                    className="hidden"
                                                    ref={dxfInputRef}
                                                    onChange={handleDXFChange}
                                                    onClick={(e) => e.stopPropagation()}
                                                    multiple
                                                    required
                                                />
                                                <div className="w-full mt-4">
                                                    {selectedDXFFiles.length > 0 ? (
                                                        <div className="space-y-2">
                                                            {selectedDXFFiles.map((file, index) => (
                                                                <div key={index} className="flex items-center justify-between bg-white p-2 rounded border">
                                                                    <span className="text-sm text-gray-700 truncate">{file.name}</span>
                                                                    <button
                                                                    type="button"
                                                                    className="ml-2 text-gray-400 hover:text-red-500"
                                                                onClick={e => { e.stopPropagation(); handleRemoveDXF(index); }}
                                                                    tabIndex={-1}
                                                                    >
                                                                        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                                                                            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                                                                        </svg>
                                                                    </button>
                                                                </div>
                                                            ))}
                                                        </div>
                                                    ) : (
                                                                <div className="text-sm text-gray-500 flex items-center justify-center h-10">{relatedSkus[currentSlideIndex]?.sku}</div>
                                                    )}
                                                </div>
                                            </>
                                        ) : (
                                            <>
                                                <svg xmlns="http://www.w3.org/2000/svg" className="mx-auto mb-2" width="40" height="40" fill="none" viewBox="0 0 24 24" stroke="#1d1d1d" strokeWidth="2">
                                                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 16v-8m0 0l-4 4m4-4l4 4" />
                                                    <rect x="3" y="17" width="18" height="4" rx="2" fill="#fcfafa" />
                                                </svg>
                                                <span className="text-gray-700">Browse files to upload</span>
                                            </>
                                        )}
                                        <input
                                            id="dxf"
                                            name="dxf"
                                            type="file"
                                            accept=".dxf"
                                            className="hidden"
                                            ref={dxfInputRef}
                                            onChange={handleDXFChange}
                                            onClick={e => e.stopPropagation()}
                                            multiple
                                            required
                                        />
                                    </div>
                                        )}
                                        {/* SVG URLs List Section */}
                                        {relatedSkus.length > 0 && relatedSkus[currentSlideIndex] && (
                                            <div className="w-full bg-gray-50 border border-gray-400 rounded-lg shadow-sm ">
                                                <ul className="space-y-1">
                                                    <li className="flex items-center gap-4 bg-white rounded-md p-3 border border-gray-100 shadow-sm">
                                                        <div className="flex-1 min-w-0">
                                                            <div className="font-semibold text-gray-800 text-[10px] truncate" title={relatedSkus[currentSlideIndex].sku}>{relatedSkus[currentSlideIndex].sku}</div>
                                                            <div className="text-xs text-gray-500 truncate" title={relatedSkus[currentSlideIndex].svgUrl || ''}>{relatedSkus[currentSlideIndex].svgUrl || 'No SVG URL'}</div>
                                                        </div>
                                                        <div className="flex items-center gap-2 ml-2">
                                                            
                                                            {/* Copy Icon */}
                                                            {relatedSkus[currentSlideIndex].svgUrl && (
                                                            <button
                                                                type="button"
                                                                    className="p-1 rounded-full hover:bg-blue-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400"
                                                                    aria-label="Copy SVG URL"
                                                                    title="Copy SVG URL"
                                                                    onClick={() => {
                                                                        navigator.clipboard.writeText(relatedSkus[currentSlideIndex].svgUrl!);
                                                                    }}
                                                                >
                                                                    <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-blue-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                                                                        <rect x="9" y="9" width="13" height="13" rx="2" />
                                                                        <path d="M5 15V5a2 2 0 012-2h10" />
                                                                    </svg>
                                                                </button>
                                                            )}
                                                            {/* Edit Icon */}
                                                            <button
                                                                type="button"
                                                                className="p-1 rounded-full hover:bg-blue-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400"
                                                                aria-label="Edit this SVG"
                                                                title="Edit this SVG"
                                                                onClick={() => {/* TODO: Implement edit functionality */}}
                                                            >
                                                                <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-blue-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                                                                    <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 3.487a2.25 2.25 0 113.182 3.182L7.5 19.213l-4 1 1-4 12.362-12.726z" />
                                                                </svg>
                                                            </button>
                                                            {/* Delete Icon */}
                                                            <button
                                                                type="button"
                                                                className="p-1 rounded-full hover:bg-red-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-400"
                                                                aria-label="Delete this SVG"
                                                                title="Delete this SVG"
                                                                onClick={() => {/* TODO: Implement delete functionality */}}
                                                            >
                                                                <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-red-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                                                                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                                                                </svg>
                                                            </button>
                                                        </div>
                                                    </li>
                                                </ul>
                                                </div>
                                            )}
                                        </div>
                                    
                            </div>
                            {/* Submit message */}
                            {submitMessage && (
                                <div className={`mt-4 p-3 rounded-lg ${
                                    submitMessage.type === 'success' 
                                        ? 'bg-green-100 text-green-700' 
                                        : 'bg-red-100 text-red-700'
                                }`}>
                                    {submitMessage.text}
                                </div>
                            )}
                            <div className="flex justify-center mt-8">
                                <button
                                    type="submit"
                                    disabled={isSubmitting}
                                    className={`px-8 py-2 rounded-full font-semibold text-white bg-gradient-to-r from-gray-800 to-red-700 hover:from-red-800 hover:to-red-600 transition-colors shadow-md ${
                                        isSubmitting ? 'opacity-50 cursor-not-allowed' : ''
                                    }`}
                                >
                                        {isSubmitting ? 'Saving...' : 'Confirm'}
                                </button>
                            </div>
                        </form>
                        )}
                    </div>
                </div>
            </div>

            {svgPreview && (
                <div className="mt-4 border rounded bg-white p-2">
                    <div className="text-xs text-gray-500 mb-1">SVG Preview:</div>
                    <div
                        className="w-full flex justify-center"
                        dangerouslySetInnerHTML={{ __html: svgPreview }}
                    />
                </div>
            )}
        </div>
    )
}
'use client';

import React, { useState } from 'react';

interface DxfConverterButtonProps {
    svgContent: string;
    userId: string;
    onConversionSuccess?: (dxfUrl: string) =>  void;
    onConversionError?: (error: string) => void;
}

const DxfConverterButton: React.FC<DxfConverterButtonProps> = ({
    svgContent,
    userId,
    onConversionSuccess,
    onConversionError,
}) => {
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [dxfDownloadUrl, setDxfDownloadUrl] = useState<string | null>(null);

    const handleConvert = async () => {
        setLoading(true);
        setError(null);
        setDxfDownloadUrl(null);

        try{
            // Call the Next.js API route
            const response = await fetch('/api/converter-cloud', {
                method: 'POST',
                headers: {
                    'Content-Type' : 'application/json',
                },
                body: JSON.stringify({ svgContent, userId }),
            });

            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.message || 'Failed to initiate conversion');
            }

            const data = await response.json();
            const dxfUrl = data.dxfUrl;
            setDxfDownloadUrl(dxfUrl);
            onConversionSuccess?.(dxfUrl);

            // Programmatically trigger download
            const link = document.createElement('a');
            link.href = dxfUrl;
            link.download = `nested_layout_${Date.now()}.dxf`;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            window.URL.revokeObjectURL(link.href);
        } catch (err) {
            const errorMessage = (err instanceof Error) ? err.message : String(err);
            setError(errorMessage);
            onConversionError?.(errorMessage);
            console.error('Conversion failed:', err);
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="relative">
            <button 
                onClick={handleConvert} 
                disabled={loading}
                className={`group relative px-3 py-1.5 rounded-md font-medium transition-all duration-300 shadow overflow-hidden text-xs ${
                    loading 
                        ? 'text-slate-400 bg-slate-600/50 cursor-not-allowed border border-slate-500/30' 
                        : 'text-white bg-gradient-to-r from-blue-600 to-blue-700 hover:from-blue-500 hover:to-blue-600 border border-blue-500/30 hover:shadow-blue-500/25 hover:shadow-lg transform hover:scale-105 active:scale-95'
                }`}
            >
                {/* Background animation */}
                {!loading && (
                    <div className="absolute inset-0 bg-gradient-to-r from-blue-400/0 via-blue-300/20 to-blue-400/0 translate-x-[-100%] group-hover:translate-x-[100%] transition-transform duration-700"></div>
                )}
                
                <div className="relative flex items-center gap-1.5">
                    {loading ? (
                        <>
                            <div className="w-3 h-3 border-2 border-slate-300/30 border-t-slate-300 rounded-full animate-spin"></div>
                            <span>Converting...</span>
                        </>
                    ) : (
                        <>
                            <svg xmlns="http://www.w3.org/2000/svg" className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                            </svg>
                            <span>Export DXF</span>
                        </>
                    )}
                </div>
            </button>
            
            {error && (
                <div className="absolute top-full left-0 right-0 mt-1 p-2 bg-red-500/10 border border-red-500/30 rounded backdrop-blur-sm">
                    <div className="flex items-center gap-1.5">
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-3 w-3 text-red-400 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                        <p className="text-red-400 text-xs font-medium">
                            {error}
                        </p>
                    </div>
                </div>
            )}
            
            {dxfDownloadUrl && (
                <div className="absolute top-full left-0 right-0 mt-1 p-2 bg-emerald-500/10 border border-emerald-500/30 rounded backdrop-blur-sm">
                    <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-1.5">
                            <div className="w-1.5 h-1.5 bg-emerald-400 rounded-full animate-pulse"></div>
                            <span className="text-emerald-400 text-xs font-medium">DXF ready!</span>
                        </div>
                        <a 
                            href={dxfDownloadUrl} 
                            target='_blank' 
                            rel='noopener noreferrer' 
                            className="inline-flex items-center gap-1 px-2 py-1 bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-400 text-xs font-medium rounded transition-colors duration-200 border border-emerald-500/30"
                        >
                            <svg xmlns="http://www.w3.org/2000/svg" className="h-2.5 w-2.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                            </svg>
                            Download
                        </a>
                    </div>
                </div>
            )}
        </div>
    );
};

export default DxfConverterButton;
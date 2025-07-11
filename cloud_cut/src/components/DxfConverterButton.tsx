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
        <div>
            <button 
                onClick={handleConvert} 
                disabled={loading}
                className={`px-4 py-2 rounded-md transition-all duration-300 ${
                    loading 
                        ? 'text-gray-400 bg-gray-500 cursor-not-allowed' 
                        : 'text-white bg-blue-500 hover:bg-blue-600'
                }`}
            >
                {loading ? 'Converting...' : 'Export DXF'}
            </button>
            {error && (
                <p className="text-red-500 text-sm mt-2">
                    Error: {error}
                </p>
            )}
            {dxfDownloadUrl && (
                <p className="text-green-500 text-sm mt-2">
                    DXF ready! <a href={dxfDownloadUrl} target='_blank' rel='noopener noreferrer' className="underline">Download here</a>
                </p>
            )}
        </div>
    );
};

export default DxfConverterButton;
import type { NextApiRequest, NextApiResponse } from 'next';

const DESPATCH_CLOUD_DOMAIN = process.env.NEXT_PUBLIC_DESPATCH_CLOUD_DOMAIN || "";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
    const { path, ...queryParams } = req.query;
    
    // Construct the base URL with the path
    const pathString = Array.isArray(path) ? path.join('/') : path;
    const baseUrl = `${DESPATCH_CLOUD_DOMAIN}/public-api/${pathString}`;
    
    // Build query string, excluding the path parameter
    const queryString = Object.entries(queryParams)
        .map(([key, value]) => {
            const paramValue = Array.isArray(value) ? value[0] : value;
            return paramValue ? `${key}=${encodeURIComponent(paramValue)}` : null;
        })
        .filter(Boolean)
        .join('&');

    const url = `${baseUrl}${queryString ? `?${queryString}` : ''}`;

    try {
        console.log('Proxying request to:', url);
        console.log('Request method:', req.method);
        console.log('Request headers:', req.headers);

        const response = await fetch(url, {
            method: req.method,
            headers: {
                'Content-Type': 'application/json',
                'Accept': 'application/json',
                ...(req.method === 'POST' && req.body ? {} : { 
                    'Authorization': req.headers.authorization || '',
                }),
            },
            body: req.method === 'POST' ? JSON.stringify(req.body) : undefined,
        });

        if (!response.ok) {
            console.error('Proxy error:', {
                status: response.status,
                statusText: response.statusText,
                url: url,
            });
            return res.status(response.status).json({ 
                error: response.statusText,
                details: `Failed to fetch from ${url}` 
            });
        }

        const data = await response.json();
        res.status(200).json(data);
    } catch (error) {
        console.error('Proxy error:', error);
        res.status(500).json({ 
            error: 'Internal Server Error',
            details: error instanceof Error ? error.message : 'Unknown error'
        });
    }
}
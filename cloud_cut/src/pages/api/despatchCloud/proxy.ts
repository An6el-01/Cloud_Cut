import type { NextApiRequest, NextApiResponse } from 'next';

const DESPATCH_CLOUD_DOMAIN = process.env.NEXT_PUBLIC_DESPATCH_CLOUD_DOMAIN || "";
const DESPATCH_CLOUD_EMAIL = process.env.DESPATCH_CLOUD_EMAIL;
const DESPATCH_CLOUD_PASSWORD = process.env.DESPATCH_CLOUD_PASSWORD;

// CORS headers helper
const setCorsHeaders = (res: NextApiResponse, req: NextApiRequest) => {
    // Allowed origins
    const allowedOrigins = [
        'http://localhost:3000',
        'https://cloud-9bcf5b671-angel-salinas-projects.vercel.app',
        'https://cloud-cut.vercel.app',
        'https://cloud-cut-angel-salinas-projects.vercel.app',
        'https://cloud-cut-asalinas-shadowfoamc-angel-salinas-projects.vercel.app',
    ];
    
    const origin = req.headers.origin;
    
    // Set 'Access-Control-Allow-Origin' if the origin is in the allowed origins list
    if (origin && allowedOrigins.includes(origin)) {
        res.setHeader('Access-Control-Allow-Origin', origin);
    } else {
        // Fallback to any origin if none matched (for development)
        res.setHeader('Access-Control-Allow-Origin', '*');
    }
    
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
    res.setHeader(
        'Access-Control-Allow-Headers',
        'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version, Authorization'
    );
};

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
    // Set CORS headers for all requests
    setCorsHeaders(res, req);
    
    // Handle preflight OPTIONS request - MUST return 200 status
    if (req.method === 'OPTIONS') {
        res.status(200).end();
        return;
    }
    
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

        // Special handling for login requests
        if (pathString === 'auth/login') {
            // Use server-side environment variables for authentication
            const loginBody = {
                email: DESPATCH_CLOUD_EMAIL,
                password: DESPATCH_CLOUD_PASSWORD
            };

            const response = await fetch(url, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Accept': 'application/json'
                },
                body: JSON.stringify(loginBody)
            });

            if (!response.ok) {
                console.error('Login error:', {
                    status: response.status,
                    statusText: response.statusText,
                });
                return res.status(response.status).json({
                    error: response.statusText,
                    details: 'Authentication failed'
                });
            }

            const data = await response.json();
            return res.status(200).json(data);
        }

        // For all other requests
        const response = await fetch(url, {
            method: req.method,
            headers: {
                'Content-Type': 'application/json',
                'Accept': 'application/json',
                'Authorization': req.headers.authorization || '',
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
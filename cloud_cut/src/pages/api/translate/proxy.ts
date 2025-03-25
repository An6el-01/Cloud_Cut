import type { NextApiRequest, NextApiResponse } from 'next';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
    if (req.method !== 'GET') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    const { text, sourceLang } = req.query;

    if (!text || typeof text !== 'string') {
        return res.status(400).json({ error: 'Text parameter is required' });
    }

    if (!sourceLang || typeof sourceLang !== 'string') {
        return res.status(400).json({ error: 'Source language parameter is required' });
    }

    try {
        const params = new URLSearchParams({
            q: text,
            langpair: `${sourceLang}|en`,
            de: 'a.salinas@shadowfoam.com',
        });

        const response = await fetch(`https://api.mymemory.translated.net/get?${params.toString()}`, {
            method: 'GET',
            headers: {
                'Content-Type': 'application/json',
            },
        });

        if (!response.ok) {
            throw new Error(`Translation API error: ${response.statusText}`);
        }

        const data = await response.json();
        res.status(200).json(data);
    } catch (error) {
        console.error('Translation proxy error:', error);
        res.status(500).json({ 
            error: 'Translation failed',
            details: error instanceof Error ? error.message : 'Unknown error'
        });
    }
} 
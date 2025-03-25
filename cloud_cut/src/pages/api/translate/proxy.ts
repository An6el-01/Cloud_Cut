import type { NextApiRequest, NextApiResponse } from "next";

const DEEPL_API_KEY = process.env.DEEPL_API_KEY || '';
const DEEPL_BASE_URL = 'https://api-free.deepl.com/v2';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
    const { text, source_lang, target_lang, type } = req.query;

    if(!DEEPL_API_KEY) {
        return res.status(500).json({error: "DeepL API key is not configured"});
    }

    try{
        const endpoint = type === 'detect' ? '/usage' : '/translate';
        const url = new URL(`${DEEPL_BASE_URL}${endpoint}`);
            url.searchParams.append('auth_key', DEEPL_API_KEY);

        if (type === 'detect') {
            url.searchParams.append('text', text as string);
            url.searchParams.append('target_lang', 'EN');
        } else{
            url.searchParams.append('text', text as string);
            if (source_lang) url.searchParams.append('source_lang', source_lang as string);
            url.searchParams.append('target_lang', target_lang as string || 'EN');
        }

        const response = await fetch(url.toString(), { method: 'POST' });
        if(!response.ok) {
            throw new Error(`DeepL API error: ${response.statusText}`);
        }

        const data = await response.json();
        if (type === 'detect') {
            const detectedLang = data.translations?.[0]?.detected_source_language || 'EN';
            res.status(200).json({ langauge: detectedLang });
        }else{
            const translatedText = data.translations?.[0]?.text || text;
            res.status(200).json({ translatedText });
        }
    } catch (error) {
        console.error('Translation proxy error: ', error);
        res.status(500).json({ error: "Translation failed", details: error instanceof Error ? error.message : 'Unknown error' });
    }
}
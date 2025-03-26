// import { OrderDetails } from "@/types/despatchCloud";

// //Languages Translating
// // eslint-disable-next-line @typescript-eslint/no-unused-vars
// const SUPPORTED_LANGUAGES = ['DE', 'FR', 'ES', 'PT', 'IT', 'NL', 'PL'] as const;
// type LanguageCode = typeof SUPPORTED_LANGUAGES[number];

// //DeepL API Config
// const DEEPL_API_KEY = process.env.NEXT_PUBLIC_DEEPL_API_KEY || '';
// const TRANSLATE_API_URL = '/api/translate/proxy';

// //Detect if text needs translation
// function needsTranslation(text: string): boolean {
//     if(!text || text.length < 3) return false;

//     const englishPattern = /^[A-Za-z0-9\s.,!?-]+$/;
//     if (englishPattern.test(text)) return false;

//     const mixedPattern = /\[.*[A-Za-z].*\]/;
//     if (mixedPattern.test(text)) return true;

//     const nonEnglishPattern = /[^\x00-\x7F]+/;
    
//     return nonEnglishPattern.test(text);
// }

// //Detect Language with DeepL
// async function detectLanguage(text: string): Promise<LanguageCode | 'EN'> {
//     const url = `${TRANSLATE_API_URL}?text=${encodeURIComponent(text)}&type=detect`;
//     const response = await fetch(url);
//     if(!response.ok) throw new Error('Language detection failed');
//     const { language } = await response.json();
//     return language as LanguageCode | 'EN';
// }


// async function translateText(text: string, sourceLang?: LanguageCode): Promise<string>{
//     if(!DEEPL_API_KEY) throw new Error('DeepL API key is not configured');

//     //DETECT SOURCE LANGAUGE IF IT IS NOT PROVIDED
//     const detectedLang = sourceLang || (await detectLanguage(text));
//     if(detectedLang === 'EN') return text;

//     const url = `${TRANSLATE_API_URL}?text=${encodeURIComponent(text)}&source_lang=${detectedLang}&target_lang=EN`;
//     const response = await fetch(url);
//     if(!response.ok) throw new Error(`Translation failed: ${response.statusText}`);
//     const { translatedText } = await response.json()
//     return translatedText;
// }

// // //Translate items in order details
// // export async function translateOrderDetails(order: OrderDetails): Promise<OrderDetails>{
// //     const translatedItems = await Promise.all(
// //         order.items.map(async (item) => {
// //             if (needsTranslation(item.name)) {
// //                 try{
// //                     const translatedName = await translateText(item.name);
// //                     return { ...item, name: translatedName };
// //                 } catch (error){
// //                     console.error(`Failed to translate item "${item.name}":`, error);
// //                     return item;
// //                 }
// //             }
// //             return item;
// //         })
// //     );

// //     return { ...order, items: translatedItems };
// // }
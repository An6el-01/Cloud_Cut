// List of supported European languages and their character patterns
const SUPPORTED_LANGUAGES = {
  'fr': {
    patterns: [
      /[à-ÿÀ-ÿä-ÿÄ-ÿö-ÿÖ-ÿü-ÿÜ-ÿßæøåéèêëïîíìïòóôõöùúûüýÿñ]/,
      /\b(et|ou|le|la|les|un|une|des|de|du|en|dans|sur|avec|sans|pour|par|dans|entre|devant|derrière|sous|sur|avant|après|pendant|depuis|jusqu'à)\b/i
    ],
    weight: 1
  },
  'de': {
    patterns: [
      /[äöüßÄÖÜ]/,
      /\b(und|oder|aber|dass|wenn|weil|damit|obwohl|sodass|indem|während|bevor|nachdem|bis|seit|seitdem|solange|sobald|sooft)\b/i,
      /\b(der|die|das|ein|eine|eines|einer|einem|einen|den|dem|des|der|die|das)\b/i
    ],
    weight: 1
  },
  'es': {
    patterns: [
      /[áéíóúñÁÉÍÓÚÑ]/,
      /\b(y|o|pero|que|si|porque|para|con|sin|en|sobre|entre|detrás|delante|debajo|encima|antes|después|durante|desde|hasta)\b/i
    ],
    weight: 1
  },
  'it': {
    patterns: [
      /[àèéìòóùÀÈÉÌÒÓÙ]/,
      /\b(e|o|ma|che|se|perché|per|con|senza|in|su|tra|dietro|davanti|sotto|sopra|prima|dopo|durante|da|fino)\b/i
    ],
    weight: 1
  },
  'pt': {
    patterns: [
      /[áéíóúâêîôûãõàèìòùÁÉÍÓÚÂÊÎÔÛÃÕÀÈÌÒÙ]/,
      /\b(e|ou|mas|que|se|porque|para|com|sem|em|sobre|entre|atrás|frente|abaixo|acima|antes|depois|durante|desde|até)\b/i
    ],
    weight: 1
  },
  'nl': {
    patterns: [
      /[éëïöüÉËÏÖÜ]/,
      /\b(en|of|maar|dat|als|omdat|voor|met|zonder|in|op|tussen|achter|voor|onder|boven|voor|na|tijdens|sinds|tot)\b/i
    ],
    weight: 1
  },
  'pl': {
    patterns: [
      /[ąćęłńóśźżĄĆĘŁŃÓŚŹŻ]/,
      /\b(i|lub|ale|że|jeśli|ponieważ|dla|z|bez|w|na|między|za|przed|pod|nad|przed|po|podczas|od|do)\b/i
    ],
    weight: 1
  },
  'cs': {
    patterns: [
      /[áčďéěíňóřšťúůýžÁČĎÉĚÍŇÓŘŠŤÚŮÝŽ]/,
      /\b(a|nebo|ale|že|pokud|protože|pro|s|bez|v|na|mezi|za|před|pod|nad|před|po|během|od|do)\b/i
    ],
    weight: 1
  },
  'sk': {
    patterns: [
      /[áäčďéíĺľňóôŕšťúýžÁÄČĎÉÍĹĽŇÓÔŔŠŤÚÝŽ]/,
      /\b(a|alebo|ale|že|ak|pretože|pre|s|bez|v|na|medzi|za|pred|pod|nad|pred|po|počas|od|do)\b/i
    ],
    weight: 1
  },
  'hu': {
    patterns: [
      /[áéíóöőúüűÁÉÍÓÖŐÚÜŰ]/,
      /\b(és|vagy|de|hogy|ha|mert|a|az|és|vagy|de|hogy|ha|mert|a|az)\b/i
    ],
    weight: 1
  },
  'ro': {
    patterns: [
      /[ăâîșțĂÂÎȘȚ]/,
      /\b(și|sau|dar|că|dacă|pentru|cu|fără|în|pe|între|în spatele|în fața|sub|deasupra|înainte|după|în timpul|din|până)\b/i
    ],
    weight: 1
  },
  'bg': {
    patterns: [
      /[а-яА-Я]/,
      /\b(и|или|но|че|ако|защото|за|с|без|в|на|между|зад|пред|под|над|преди|след|по време на|от|до)\b/i
    ],
    weight: 1
  },
  'hr': {
    patterns: [
      /[čćđšžČĆĐŠŽ]/,
      /\b(i|ili|ali|da|ako|jer|za|s|bez|u|na|između|iza|ispred|ispod|iznad|prije|nakon|tijekom|od|do)\b/i
    ],
    weight: 1
  },
  'sr': {
    patterns: [
      /[čćđšžČĆĐŠŽ]/,
      /\b(i|ili|ali|da|ako|jer|za|s|bez|u|na|između|iza|ispred|ispod|iznad|pre|nakon|tokom|od|do)\b/i
    ],
    weight: 1
  },
  'sl': {
    patterns: [
      /[čšžČŠŽ]/,
      /\b(in|ali|ampak|da|če|ker|za|z|brez|v|na|med|za|pred|pod|nad|pred|po|medtem|od|do)\b/i
    ],
    weight: 1
  },
  'el': {
    patterns: [
      /[α-ωΑ-Ω]/,
      /\b(και|ή|αλλά|ότι|αν|γιατί|για|με|χωρίς|σε|πάνω|μεταξύ|πίσω|μπροστά|κάτω|πάνω|πριν|μετά|κατά|από|έως)\b/i
    ],
    weight: 1
  },
  'ru': {
    patterns: [
      /[а-яА-Я]/,
      /\b(и|или|но|что|если|потому что|для|с|без|в|на|между|за|перед|под|над|до|после|во время|от|до)\b/i
    ],
    weight: 1
  },
  'uk': {
    patterns: [
      /[а-яА-ЯіїєІЇЄ]/,
      /\b(і|або|але|що|якщо|тому що|для|з|без|в|на|між|за|перед|під|над|до|після|під час|від|до)\b/i
    ],
    weight: 1
  },
  'da': {
    patterns: [
      /[æøåÆØÅ]/,
      /\b(og|eller|men|at|hvis|fordi|for|med|uden|i|på|mellem|bag|foran|under|over|før|efter|under|fra|til)\b/i
    ],
    weight: 1
  },
  'sv': {
    patterns: [
      /[åäöÅÄÖ]/,
      /\b(och|eller|men|att|om|eftersom|för|med|utan|i|på|mellan|bakom|framför|under|över|före|efter|under|från|till)\b/i
    ],
    weight: 1
  },
  'fi': {
    patterns: [
      /[äöåÄÖÅ]/,
      /\b(ja|tai|mutta|että|jos|koska|varten|kanssa|ilman|sisällä|päällä|välissä|takana|edessä|alla|yläpuolella|ennen|jälkeen|aikana|alkaen|asti)\b/i
    ],
    weight: 1
  },
  'no': {
    patterns: [
      /[æøåÆØÅ]/,
      /\b(og|eller|men|at|hvis|fordi|for|med|uten|i|på|mellom|bak|foran|under|over|før|etter|under|fra|til)\b/i
    ],
    weight: 1
  },
  'is': {
    patterns: [
      /[áéíóúýþæöÁÉÍÓÚÝÞÆÖ]/,
      /\b(og|eða|en|að|ef|vegna|fyrir|með|án|í|á|milli|á bak við|fyrir framan|undir|yfir|fyrir|eftir|á meðan|frá|til)\b/i
    ],
    weight: 1
  },
  'lv': {
    patterns: [
      /[āčēģīķļņšūžĀČĒĢĪĶĻŅŠŪŽ]/,
      /\b(un|vai|bet|ka|ja|jo|priekš|ar|bez|iekš|uz|starp|aiz|priekšā|zem|virs|pirms|pēc|laikā|no|līdz)\b/i
    ],
    weight: 1
  },
  'lt': {
    patterns: [
      /[ąčęėįšųūžĄČĘĖĮŠŲŪŽ]/,
      /\b(ir|arba|bet|kad|jei|nes|dėl|su|be|į|ant|tarp|už|prieš|po|virš|prieš|po|metu|nuo|iki)\b/i
    ],
    weight: 1
  },
  'et': {
    patterns: [
      /[äöõšžÄÖÕŠŽ]/,
      /\b(ja|või|aga|et|kui|sest|jaoks|koos|ilma|sisse|peale|vahel|taha|ette|alla|üle|enne|pärast|ajal|alates|kuni)\b/i
    ],
    weight: 1
  },
  'mt': {
    patterns: [
      /[ċġħżĊĠĦŻ]/,
      /\b(u|jew|imma|li|jekk|għaliex|għal|ma|mingħajr|f|fuq|bejn|wara|quddiem|taħt|fuq|qabel|wara|matul|minn|sa)\b/i
    ],
    weight: 1
  },
  'ga': {
    patterns: [
      /[áéíóúÁÉÍÓÚ]/,
      /\b(agus|nó|ach|go|má|mar|do|le|gan|i|ar|idir|i gcoinne|roimh|faoi|os cionn|roimh|tar éis|le linn|ó|go dtí)\b/i
    ],
    weight: 1
  },
  'cy': {
    patterns: [
      /[âêîôûŵŷÂÊÎÔÛŴŶ]/,
      /\b(a|neu|ond|bod|os|am|i|gyda|heb|yn|ar|rhwng|tu ôl|o flaen|dan|uwch|cyn|ar ôl|yn ystod|o|hyd)\b/i
    ],
    weight: 1
  },
  'gd': {
    patterns: [
      /[àèìòùÀÈÌÒÙ]/,
      /\b(agus|no|ach|gu|ma|oirbh|air|le|gun|ann|air|eadar|air cùlaibh|air beulaibh|fo|os cionn|ro|an dèidh|ri linn|bho|gu)\b/i
    ],
    weight: 1
  },
  'lb': {
    patterns: [
      /[äéëïöüÄÉËÏÖÜ]/,
      /\b(an|oder|awer|datt|wann|well|fir|mat|ouni|an|op|tëscht|hannert|virun|ënner|iwwer|vir|no|wärend|vun|bis)\b/i
    ],
    weight: 1
  }
};

// Function to detect the language of the text
function detectLanguage(text: string): string {
  let bestScore = 0;
  let bestLanguage = 'en';

  // Convert text to lowercase for better matching
  const lowerText = text.toLowerCase();

  for (const [langCode, langData] of Object.entries(SUPPORTED_LANGUAGES)) {
    let score = 0;

    // Check each pattern for this language
    for (const pattern of langData.patterns) {
      if (pattern.test(lowerText)) {
        score += langData.weight;
      }
    }

    // Update best score if this language has a higher score
    if (score > bestScore) {
      bestScore = score;
      bestLanguage = langCode;
    }
  }

  // If no language was detected with a score > 0, return English
  return bestScore > 0 ? bestLanguage : 'en';
}

export async function translateToEnglish(text: string): Promise<string> {
  if (!text || text.trim() === '') return text;
  
  // Detect the language
  const sourceLang = detectLanguage(text);
  
  // If text is already in English, return it
  if (sourceLang === 'en') {
    return text;
  }

  try {
    // Use our proxy endpoint to avoid CORS issues
    const params = new URLSearchParams({
      text: text,
      sourceLang: sourceLang,
    });

    const response = await fetch(`/api/translate/proxy?${params.toString()}`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      },
      // Add timeout to prevent hanging
      signal: AbortSignal.timeout(5000),
      // Add cache control
      cache: 'no-cache',
    });

    if (!response.ok) {
      console.error('Translation failed:', response.statusText);
      return text; // Return original text if translation fails
    }

    const data = await response.json();
    if (data.responseStatus === 200) {
      return data.responseData.translatedText;
    } else {
      console.error('Translation API error:', data.responseDetails);
      return text;
    }
  } catch (error) {
    console.error('Translation error:', error);
    return text; // Return original text if translation fails
  }
} 
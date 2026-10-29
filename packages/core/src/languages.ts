// The languages ClipCat's two speech engines hear. Parakeet (Apple Silicon)
// knows 25 European languages and finds which one by itself; whisper.cpp
// knows the rest, runs everywhere, and is the one that can guess the language.

/** Every language whisper.cpp hears, by its code, in whisper's own order (most training data first). */
export const SPEECH_LANGUAGES = [
  ["en", "English"], ["zh", "Chinese"], ["de", "German"], ["es", "Spanish"], ["ru", "Russian"], ["ko", "Korean"],
  ["fr", "French"], ["ja", "Japanese"], ["pt", "Portuguese"], ["tr", "Turkish"], ["pl", "Polish"], ["ca", "Catalan"],
  ["nl", "Dutch"], ["ar", "Arabic"], ["sv", "Swedish"], ["it", "Italian"], ["id", "Indonesian"], ["hi", "Hindi"],
  ["fi", "Finnish"], ["vi", "Vietnamese"], ["he", "Hebrew"], ["uk", "Ukrainian"], ["el", "Greek"], ["ms", "Malay"],
  ["cs", "Czech"], ["ro", "Romanian"], ["da", "Danish"], ["hu", "Hungarian"], ["ta", "Tamil"], ["no", "Norwegian"],
  ["th", "Thai"], ["ur", "Urdu"], ["hr", "Croatian"], ["bg", "Bulgarian"], ["lt", "Lithuanian"], ["la", "Latin"],
  ["mi", "Māori"], ["ml", "Malayalam"], ["cy", "Welsh"], ["sk", "Slovak"], ["te", "Telugu"], ["fa", "Persian"],
  ["lv", "Latvian"], ["bn", "Bengali"], ["sr", "Serbian"], ["az", "Azerbaijani"], ["sl", "Slovenian"], ["kn", "Kannada"],
  ["et", "Estonian"], ["mk", "Macedonian"], ["br", "Breton"], ["eu", "Basque"], ["is", "Icelandic"], ["hy", "Armenian"],
  ["ne", "Nepali"], ["mn", "Mongolian"], ["bs", "Bosnian"], ["kk", "Kazakh"], ["sq", "Albanian"], ["sw", "Swahili"],
  ["gl", "Galician"], ["mr", "Marathi"], ["pa", "Punjabi"], ["si", "Sinhala"], ["km", "Khmer"], ["sn", "Shona"],
  ["yo", "Yoruba"], ["so", "Somali"], ["af", "Afrikaans"], ["oc", "Occitan"], ["ka", "Georgian"], ["be", "Belarusian"],
  ["tg", "Tajik"], ["sd", "Sindhi"], ["gu", "Gujarati"], ["am", "Amharic"], ["yi", "Yiddish"], ["lo", "Lao"],
  ["uz", "Uzbek"], ["fo", "Faroese"], ["ht", "Haitian Creole"], ["ps", "Pashto"], ["tk", "Turkmen"], ["nn", "Norwegian Nynorsk"],
  ["mt", "Maltese"], ["sa", "Sanskrit"], ["lb", "Luxembourgish"], ["my", "Burmese"], ["bo", "Tibetan"], ["tl", "Tagalog"],
  ["mg", "Malagasy"], ["as", "Assamese"], ["tt", "Tatar"], ["haw", "Hawaiian"], ["ln", "Lingala"], ["ha", "Hausa"],
  ["ba", "Bashkir"], ["jw", "Javanese"], ["su", "Sundanese"], ["yue", "Cantonese"],
] as const satisfies readonly (readonly [string, string])[];

export type SpeechLanguage = (typeof SPEECH_LANGUAGES)[number][0];

/** The languages Parakeet v3 was trained on. Everything else goes to whisper. */
export const PARAKEET_LANGUAGES: ReadonlySet<string> = new Set([
  "bg", "cs", "da", "de", "el", "en", "es", "et", "fi", "fr", "hr", "hu", "it",
  "lt", "lv", "mt", "nl", "pl", "pt", "ro", "ru", "sk", "sl", "sv", "uk",
]);

/** "auto" has whisper guess the language from the first seconds of speech. */
export const AUTO_LANGUAGE = "auto";

const NAMES = new Map<string, string>(SPEECH_LANGUAGES);

export const isSpeechLanguage = (code: string): boolean => code === AUTO_LANGUAGE || NAMES.has(code);

/** A language's English name, "Detect automatically" for auto, or the code itself when it isn't one ClipCat knows. */
export const languageName = (code: string): string => (code === AUTO_LANGUAGE ? "Detect automatically" : (NAMES.get(code) ?? code));

/** The languages sorted by name, for a picker. */
export const languagesByName = (): { code: string; name: string }[] =>
  SPEECH_LANGUAGES.map(([code, name]) => ({ code, name })).sort((a, b) => a.name.localeCompare(b.name));

export interface ParsedLine {
  original: string;
  speakerRaw: string;
  speakerClean: string; // "Jethalal"
  metadata: string; // "(to audience, excited)" or "(Male Speaker)"
  dialogue: string; // "Aaj ka topic hai..."
}

// Helper to clean up names like "Tappu (smiling)( Kid Male Speaker )" -> "Tappu"
export const cleanSpeakerName = (raw: string): string => {
  // 1. Remove content in parentheses
  let name = raw.replace(/\(.*?\)/g, '');
  
  // 2. Remove " - Description" or " -- Description" patterns often output by AI
  // Split by " - ", " -- ", " — " (em dash), " – " (en dash)
  const separatorMatch = name.match(/\s+[-—–]\s+/);
  if (separatorMatch && separatorMatch.index) {
      name = name.substring(0, separatorMatch.index);
  }
  
  // 3. Remove emojis and symbols (keep letters, numbers, spaces, hyphens, apostrophes)
  name = name.replace(/[^\p{L}\p{N}\s'-]/gu, '');
  
  return name.trim();
};

export const isMetadataLine = (speakerClean: string): boolean => {
  const lower = speakerClean.toLowerCase().trim();
  
  // 1. Prefix Checks: Starts with these words
  const startsWithBanned = [
    'scene', 'act', 'act:', // "act" catches "Act 2", "Act III"
    'cue', 'sound', 'fx', 'lighting', 
    'camera', 'cut to', 'fade',
    'narrator opening', 'closing', 'entry', 'exit',
    'int.', 'ext.', 'est.', // Screenplay headers
    'total', // "Total 10 Characters"
    'time', 'date', 'setting', 'location', 'place', // Metadata
    'drama', 'dance', 'duration', // Meta info
    'order', 'gen', 'gen-z', // Specific artifacts
    // AI Conversational Fillers
    "here's", "here is", "sure", "okay", "certainly", 
    "revised", "humanized", "generated", "script", "title", "synopsis", "summary", "cast", "characters",
    "note", "disclaimer"
  ];
  
  // 2. Content Checks: Contains these words anywhere
  const containsBanned = [
    'transition', 'background', 'theme', 'fade out', 'fade in',
    'music', 'song', 'beat', 'flute', 'track', // Music related
    'entry', 'enters', 'descends', 'appear', // Action related
    'bow', 'applause', 'laugh', 'cheer', 'crowd', // Crowd reactions
    'end', 'begin', 'start', 'finish'
  ];

  if (startsWithBanned.some(prefix => lower === prefix || lower.startsWith(prefix + ' '))) return true;
  if (containsBanned.some(word => lower.includes(word))) return true;

  // 3. Regex Checks for "Act 2", "Scene 1", "Order #637"
  if (/^act\s*\d+/i.test(lower)) return true;
  if (/^scene\s*\d+/i.test(lower)) return true;
  if (/^order\s*#?\d+/i.test(lower)) return true;

  // 4. Redundant Word Check (splitting by space) for safety against "NameCue" vs "Name Cue"
  const words = lower.split(/[\s-]+/); 
  if (words.includes('cue')) return true;

  // 5. Heuristic: Names are rarely very long. 
  if (words.length > 4) return true;

  // 6. Filter out names that are just numbers or symbols
  if (lower.replace(/[^a-z]/g, '').length === 0) return true;

  return false;
};

export const parseScriptContent = (scriptText: string): ParsedLine[] => {
  const lines = scriptText.split('\n');
  const parsedLines: ParsedLine[] = [];
  
  let currentSpeaker: ParsedLine | null = null;

  for (const line of lines) {
    const trimmedLine = line.trim();
    if (!trimmedLine) continue;

    // STRATEGY: 
    // We try to find a separator (colon or dash).
    // Colon is High Confidence. Dash is Low Confidence (needs validation).

    let match = trimmedLine.match(/^([^:]{1,60}):(.*)$/);
    let isDashMatch = false;

    // If no colon, try Dash/Em-dash, but stricter regex
    if (!match) {
        // Must have some whitespace around dash usually, or be strictly formatted
        match = trimmedLine.match(/^([^—–-]{1,50})\s*[—–-]\s*(.*)$/);
        isDashMatch = true;
    }

    if (match) {
        const speakerRaw = match[1].trim();
        const potentialDialogue = match[2].trim();
        
        // Skip if speakerRaw looks like a header (Markdown)
        if (speakerRaw.startsWith('*') || speakerRaw.startsWith('#')) {
            continue;
        }

        const speakerClean = cleanSpeakerName(speakerRaw);

        // STRICT VALIDATION FOR DASH MATCHES
        if (isDashMatch) {
             // 1. Rejection: Indentation Check
             if (line.match(/^\s/)) continue;

             // 2. Rejection: Starts with lowercase (e.g. "and then - he died")
             if (/^[a-z]/.test(speakerRaw)) continue;

             // 3. Rejection: Contains Numbers or #
             // "Order #637", "Act 2", "Scene 1" -> Rejected.
             if (/[0-9#]/.test(speakerRaw)) continue;

             // 4. Rejection: Common Sentence Starters
             const commonStarters = new Set([
                 "i", "we", "you", "he", "she", "it", "they", 
                 "the", "a", "an", "this", "that", "these", "those",
                 "but", "and", "so", "or", "because", "when", "if", "then", "while",
                 "what", "why", "where", "who", "how", 
                 "wait", "look", "stop", "go", "come", "listen", "no", "yes", "well",
                 "total", "act", "scene", "order"
             ]);
             
             const firstWord = speakerRaw.split(/[\s\p{P}]+/u)[0].toLowerCase();
             if (commonStarters.has(firstWord)) continue;

             // 5. Rejection: Word count check on CLEAN name
             // "Heroic entry" -> 2 words. "Shaktimaan" -> 1 word.
             if (speakerClean.split(/\s+/).length > 3) continue;
             
             // 6. Rejection: If the dialogue part starts with lowercase, it's likely a continuation sentence
             if (potentialDialogue.length > 0 && /^[a-z]/.test(potentialDialogue)) continue;

             // 7. Rejection: Character Definition Line Check
             const firstDialogueWord = potentialDialogue.trim().split(/[\s\p{P}]+/u)[0].toLowerCase();
             const bioStarters = ['male', 'female', 'boy', 'girl', 'man', 'woman', 'kid', 'adult', 'voice', 'character', 'role', 'age', 'narrator', 'speaker'];
             if (bioStarters.includes(firstDialogueWord)) continue;
             
             // 8. Rejection: Specific Metadata Patterns
             if (/^act\s*\d+/i.test(speakerRaw)) continue;

             // 9. Rejection: Scene Header Check (ALL CAPS Speaker + ALL CAPS Dialogue or Short Dialogue)
             const isSpeakerCaps = speakerClean === speakerClean.toUpperCase() && /[A-Z]/.test(speakerClean);
             const isDialogueCaps = potentialDialogue === potentialDialogue.toUpperCase() && /[A-Z]/.test(potentialDialogue);
             const wordCount = potentialDialogue.split(/\s+/).length;
             
             if (isSpeakerCaps) {
                  if (isDialogueCaps || wordCount < 4) continue;
             }
        }
        
        // COLON MATCH EXTRA CHECKS
        else {
             // Rejection: Contains Numbers or # for Colon matches too?
             // "ACT 2:" or "SCENE 1:"
             if (/[0-9#]/.test(speakerRaw)) continue;
        }

        // Check if this "speaker" is actually a character and not metadata
        if (speakerClean && !isMetadataLine(speakerClean)) {
            
            // Push previous
            if (currentSpeaker) {
                parsedLines.push(currentSpeaker);
            }

            // Extract metadata (parentheses)
            const parenMatches = speakerRaw.match(/\((.*?)\)/g);
            const metadata = parenMatches ? parenMatches.join(' ') : "";

            currentSpeaker = {
                original: line,
                speakerRaw,
                speakerClean,
                metadata,
                dialogue: potentialDialogue // Can be empty or description
            };
            continue;
        }
    }

    // Continuation logic
    if (currentSpeaker) {
        // Skip pure metadata lines in parens
        if (trimmedLine.startsWith('(') && trimmedLine.endsWith(')')) {
            continue;
        }
        // Skip symbols
        if (trimmedLine.startsWith('🎵') || trimmedLine.startsWith('🌟') || trimmedLine.startsWith('⏳') || trimmedLine.startsWith('🔥') || trimmedLine.startsWith('👉')) {
            continue;
        }
        // Skip separators
        if (trimmedLine.match(/^[-*_]{3,}$/)) continue;
        if (trimmedLine.startsWith('·')) continue;

        if (currentSpeaker.dialogue) {
            currentSpeaker.dialogue += " " + trimmedLine;
        } else {
            currentSpeaker.dialogue = trimmedLine;
        }
    }
  }

  // Final push
  if (currentSpeaker) {
      parsedLines.push(currentSpeaker);
  }

  return parsedLines;
};
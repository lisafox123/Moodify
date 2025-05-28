import { DynamicTool } from '@langchain/core/tools';

// Environment variables
const braveApiKey = process.env.BRAVE_API_KEY;
const openaiApiKey = process.env.OPENAI_API_KEY;
const geniusApiKey = process.env.GENIUS_API_KEY;

if (!braveApiKey) {
  throw new Error('BRAVE_API_KEY is missing');
}

if (!openaiApiKey) {
  throw new Error('OPENAI_API_KEY is missing');
}

if (!geniusApiKey) {
  throw new Error('GENIUS_API_KEY is missing');
}

// OpenAI client for evaluation and formatting
async function callOpenAI(messages, temperature = 0.3, maxTokens = 4000) {
  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${openaiApiKey}`
      },
      body: JSON.stringify({
        model: 'gpt-4-turbo',
        messages: messages,
        temperature: temperature,
        max_tokens: maxTokens
      })
    });

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(`OpenAI API request failed: ${response.status} - ${errorData.error?.message || 'Unknown error'}`);
    }

    const data = await response.json();
    return data.choices[0].message.content;
  } catch (error) {
    console.error('OpenAI API error:', error.message);
    throw error;
  }
}

// Improved song matching function
async function searchSongOnGenius(artist, song) {
  try {
    console.log(`Searching for song on Genius API: ${artist} - ${song}`);

    const searchQuery = `${artist} ${song}`;
    const searchUrl = `https://api.genius.com/search?q=${encodeURIComponent(searchQuery)}`;

    const response = await fetch(searchUrl, {
      headers: {
        'Authorization': `Bearer ${geniusApiKey}`,
        'Accept': 'application/json'
      }
    });

    if (!response.ok) {
      throw new Error(`Genius API search failed: ${response.status}`);
    }

    const data = await response.json();

    if (!data.response || !data.response.hits || data.response.hits.length === 0) {
      console.log('No results found on Genius API');
      return null;
    }

    const hits = data.response.hits;
    let bestMatch = null;
    let bestScore = 0;

    // Normalize inputs for comparison
    const queryArtist = normalizeString(artist);
    const queryTitle = normalizeString(song);

    for (const hit of hits) {
      const result = hit.result;
      if (!result) continue;

      const resultArtist = normalizeString(result.primary_artist?.name || '');
      const resultTitle = normalizeString(result.title || '');

      // Calculate improved similarity score
      const score = calculateSongSimilarity(
        queryArtist, queryTitle,
        resultArtist, resultTitle,
        artist, song
      );

      console.log(`Candidate: ${result.primary_artist?.name} - ${result.title} (Score: ${score})`);

      if (score > bestScore) {
        bestScore = score;
        bestMatch = result;
      }
    }

    // Require minimum threshold for acceptance
    const MIN_SCORE_THRESHOLD = 70;

    if (bestMatch && bestScore >= MIN_SCORE_THRESHOLD) {
      console.log(`✓ Best match: ${bestMatch.primary_artist.name} - ${bestMatch.title} (Score: ${bestScore})`);
      return bestMatch;
    }

    console.log(`✗ No good match found. Best score: ${bestScore} (threshold: ${MIN_SCORE_THRESHOLD})`);
    return null;
  } catch (error) {
    console.error('Genius API search error:', error.message);
    return null;
  }
}

// Normalize strings for better comparison
function normalizeString(str) {
  return str
    .toLowerCase()
    .replace(/[^\w\s]/g, '') // Remove punctuation
    .replace(/\s+/g, ' ')    // Normalize whitespace
    .trim();
}

// Improved similarity calculation
function calculateSongSimilarity(queryArtist, queryTitle, resultArtist, resultTitle, originalArtist, originalTitle) {
  let score = 0;

  // Exact matches (highest priority)
  if (queryArtist === resultArtist) {
    score += 40;
  } else if (isCloseMatch(queryArtist, resultArtist)) {
    score += 30;
  } else if (resultArtist.includes(queryArtist) || queryArtist.includes(resultArtist)) {
    const lengthRatio = Math.min(queryArtist.length, resultArtist.length) /
      Math.max(queryArtist.length, resultArtist.length);
    score += 15 * lengthRatio;
  }

  if (queryTitle === resultTitle) {
    score += 40;
  } else if (isCloseMatch(queryTitle, resultTitle)) {
    score += 30;
  } else if (resultTitle.includes(queryTitle) || queryTitle.includes(resultTitle)) {
    const lengthRatio = Math.min(queryTitle.length, resultTitle.length) /
      Math.max(queryTitle.length, resultTitle.length);
    score += 15 * lengthRatio;
  }

  // Bonus for exact case-sensitive matches
  if (originalArtist.toLowerCase() === resultArtist.toLowerCase()) {
    score += 10;
  }
  if (originalTitle.toLowerCase() === resultTitle.toLowerCase()) {
    score += 10;
  }

  // Penalty for extra words
  const artistWordDiff = Math.abs(queryArtist.split(' ').length - resultArtist.split(' ').length);
  const titleWordDiff = Math.abs(queryTitle.split(' ').length - resultTitle.split(' ').length);
  score -= (artistWordDiff + titleWordDiff) * 5;

  // Bonus for common artist patterns
  if (isCommonArtistVariation(queryArtist, resultArtist)) {
    score += 15;
  }

  return Math.max(0, score);
}

// Check if two strings are close matches
function isCloseMatch(str1, str2) {
  const variations = [
    [str1, str2],
    [str1.replace(/\s+/g, ''), str2.replace(/\s+/g, '')],
    [str1.replace(/&/g, 'and'), str2.replace(/&/g, 'and')],
    [str1.replace(/ft|feat/g, 'featuring'), str2.replace(/ft|feat/g, 'featuring')],
  ];

  for (const [v1, v2] of variations) {
    if (v1 === v2) return true;
    if (levenshteinDistance(v1, v2) <= 2 && Math.abs(v1.length - v2.length) <= 2) {
      return true;
    }
  }

  return false;
}

// Check for common artist name variations
function isCommonArtistVariation(query, result) {
  const withoutThe1 = query.replace(/^the\s+/i, '');
  const withoutThe2 = result.replace(/^the\s+/i, '');
  if (withoutThe1 === result || withoutThe2 === query) return true;

  const baseName1 = query.split(/\s+(?:ft|feat|featuring)\s+/i)[0];
  const baseName2 = result.split(/\s+(?:ft|feat|featuring)\s+/i)[0];
  if (baseName1 === baseName2) return true;

  return false;
}

// Levenshtein distance implementation
function levenshteinDistance(str1, str2) {
  const matrix = Array(str2.length + 1).fill(null).map(() => Array(str1.length + 1).fill(null));

  for (let i = 0; i <= str1.length; i++) matrix[0][i] = i;
  for (let j = 0; j <= str2.length; j++) matrix[j][0] = j;

  for (let j = 1; j <= str2.length; j++) {
    for (let i = 1; i <= str1.length; i++) {
      const cost = str1[i - 1] === str2[j - 1] ? 0 : 1;
      matrix[j][i] = Math.min(
        matrix[j][i - 1] + 1,
        matrix[j - 1][i] + 1,
        matrix[j - 1][i - 1] + cost
      );
    }
  }

  return matrix[str2.length][str1.length];
}

// Enhanced function to fetch raw content from URL
async function fetchContentFromUrl(url) {
  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
        'Accept-Encoding': 'gzip, deflate, br',
        'Connection': 'keep-alive',
        'Upgrade-Insecure-Requests': '1'
      }
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const html = await response.text();
    console.log(`Fetched content length: ${html.length} characters`);
    return html;

  } catch (error) {
    console.error(`Error fetching from ${url}:`, error.message);
    return null;
  }
}

// Enhanced Genius content extraction
async function extractGeniusContentEnhanced(html) {
  console.log('Starting enhanced Genius content extraction...');

  // Method 1: Specific structure extractor
  let result = extractFromSpecificGeniusStructure(html);
  if (result && result.length > 200) {
    console.log('✓ Specific structure extraction successful');
    return result;
  }

  // Method 2: Enhanced container extraction
  result = extractFromLyricsContainers(html);
  if (result && result.length > 200) {
    console.log('✓ Enhanced container extraction successful');
    return result;
  }

  console.log('✗ All extraction methods failed');
  return '';
}

// Specific extractor for Genius HTML structure
function extractFromSpecificGeniusStructure(html) {
  console.log('Attempting extraction from specific Genius structure...');

  const specificPattern = /<div[^>]*data-lyrics-container="true"[^>]*class="[^"]*Lyrics__Container[^"]*"[^>]*>[\s\S]*?<p[^>]*>([\s\S]*?)<\/p>[\s\S]*?<\/div>/gi;
  const matches = [...html.matchAll(specificPattern)];

  if (matches.length > 0) {
    console.log(`Found ${matches.length} specific structure matches`);

    let allLyrics = matches
      .map((match, index) => {
        console.log(`Processing specific match ${index + 1}`);
        let content = match[1];

        content = content
          .replace(/<br\s*\/?>/gi, '\n')
          .replace(/<[^>]+>/g, '')
          .replace(/&quot;/g, '"')
          .replace(/&#x27;|&#39;/g, "'")
          .replace(/&amp;/g, '&')
          .replace(/&lt;/g, '<')
          .replace(/&gt;/g, '>')
          .replace(/&nbsp;/g, ' ')
          .replace(/[ \t]+/g, ' ')
          .replace(/\n\s*\n\s*\n/g, '\n\n')
          .replace(/^\s+|\s+$/gm, '')
          .trim();

        console.log(`Specific match ${index + 1} length: ${content.length}`);
        return content;
      })
      .filter(content => content.length > 50)
      .join('\n\n');

    if (allLyrics.length > 200) {
      console.log(`Specific extraction successful: ${allLyrics.length} characters`);
      return allLyrics;
    }
  }

  return null;
}

// Enhanced container extraction method
function extractFromLyricsContainers(html) {
  console.log('Extracting from lyrics containers with enhanced logic...');

  const containerPattern = /<div[^>]*data-lyrics-container="true"[^>]*>([\s\S]*?)<\/div>/gi;
  const containers = [...html.matchAll(containerPattern)];

  if (containers.length === 0) {
    console.log('No lyrics containers found');
    return null;
  }

  console.log(`Found ${containers.length} lyrics containers`);

  let allLyrics = [];

  for (let i = 0; i < containers.length; i++) {
    let containerContent = containers[i][1];
    console.log(`Processing container ${i + 1}, raw size: ${containerContent.length}`);

    if (containerContent.includes('LyricsHeader') && containerContent.length < 1000) {
      console.log(`Container ${i + 1} appears to be header, skipping`);
      continue;
    }

    containerContent = removeHeaderSections(containerContent);
    let lyrics = extractLyricsFromContainer(containerContent);

    if (lyrics && lyrics.length > 30) {
      console.log(`Container ${i + 1} extracted: ${lyrics.length} chars`);
      allLyrics.push(lyrics);
    }
  }

  if (allLyrics.length === 0) {
    console.log('No valid lyrics found in any container');
    return null;
  }

  let combined = allLyrics.join('\n\n');
  combined = smartDeduplicate(combined);
  combined = combined.replace(/\n{3,}/g, '\n\n').trim();

  console.log(`Combined lyrics: ${combined.length} characters from ${allLyrics.length} containers`);
  return combined;
}

// Remove header sections
function removeHeaderSections(content) {
  return content
    .replace(/<div[^>]*class="[^"]*LyricsHeader[^"]*"[^>]*>[\s\S]*?<\/div>(?:\s*<\/div>)*/gi, '')
    .replace(/<button[^>]*class="[^"]*Contributors[^"]*"[^>]*>[\s\S]*?<\/button>/gi, '')
    .replace(/<div[^>]*class="[^"]*Dropdown[^"]*"[^>]*>[\s\S]*?<\/div>/gi, '')
    .replace(/<div[^>]*class="[^"]*MetadataTooltip[^"]*"[^>]*>[\s\S]*?<\/div>/gi, '')
    .replace(/<svg[\s\S]*?<\/svg>/gi, '')
    .replace(/<div[^>]*class="[^"]*(?:Header|Title|Menu|Nav)[^"]*"[^>]*>[\s\S]*?<\/div>/gi, '');
}

// Extract lyrics content from container
function extractLyricsFromContainer(content) {
  if (!content) return '';

  const pTagMatch = content.match(/<p[^>]*>([\s\S]*?)<\/p>/);
  if (pTagMatch) {
    content = pTagMatch[1];
  }

  let lyrics = content
    .replace(/<a[^>]*href="[^"]*"[^>]*(?:class="[^"]*ReferentFragment[^"]*"[^>]*)?>([\s\S]*?)<\/a>/g, '$1')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n\s*\n/g, '\n\n')
    .replace(/^\s+|\s+$/gm, '')
    .trim();

  return lyrics;
}

// Smart deduplication
function smartDeduplicate(content) {
  const lines = content.split('\n');
  const result = [];
  const seenContent = new Map();

  for (const line of lines) {
    const trimmed = line.trim();

    if (!trimmed) {
      result.push(line);
      continue;
    }

    if (trimmed.match(/^\[[\w\s:-]+\]$/)) {
      result.push(line);
      continue;
    }

    const normalized = trimmed.toLowerCase();
    const count = seenContent.get(normalized) || 0;

    if (count < 3) {
      seenContent.set(normalized, count + 1);
      result.push(line);
    }
  }

  return result.join('\n');
}

// Fetch lyrics from Genius
async function fetchLyricsFromGenius(songData) {
  try {
    console.log(`Fetching lyrics from Genius for: ${songData.title}`);

    if (!songData.url) {
      throw new Error('No URL provided for song');
    }

    const html = await fetchContentFromUrl(songData.url);

    if (!html) {
      throw new Error('Failed to fetch song page content');
    }

    const lyrics = await extractGeniusContentEnhanced(html);

    if (!lyrics || lyrics.length < 100) {
      throw new Error('Failed to extract sufficient lyrics from Genius page');
    }

    console.log(`✓ Successfully extracted lyrics from Genius (${lyrics.length} characters)`);
    return lyrics;
  } catch (error) {
    console.error('Enhanced Genius lyrics fetch error:', error.message);
    throw error;
  }
}

// Primary function to fetch lyrics using Genius API
async function fetchLyricsWithGeniusAPI(artist, song) {
  try {
    console.log(`\n=== Attempting Genius API First ===`);

    const songData = await searchSongOnGenius(artist, song);

    if (!songData) {
      console.log('Song not found on Genius API, will try Brave Search as fallback');
      return null;
    }

    const lyrics = await fetchLyricsFromGenius(songData);

    if (lyrics) {
      console.log('Successfully fetched lyrics via Genius API');
      return lyrics;
    }

    console.log('Failed to extract lyrics from Genius page, will try Brave Search as fallback');
    return null;
  } catch (error) {
    console.error('Genius API lyrics fetch error:', error.message);
    return null;
  }
}

// Generic content extraction for other sites
async function extractGenericContent(html, url) {
  console.log(`Extracting content from generic site: ${url}`);

  if (url.includes('azlyrics.com')) {
    const lyricsMatch = html.match(/<!-- Usage of azlyrics\.com content[\s\S]*?-->([\s\S]*?)<!-- MxM banner -->/);
    if (lyricsMatch) {
      return lyricsMatch[1].replace(/<[^>]*>/g, '').trim();
    }
  } else if (url.includes('lyrics.com')) {
    const lyricsMatch = html.match(/<div[^>]*id="lyric-body-text"[^>]*>([\s\S]*?)<\/div>/gi);
    if (lyricsMatch) {
      return lyricsMatch
        .map(match => match.replace(/<[^>]*>/g, '').trim())
        .join('\n')
        .trim();
    }
  }

  const cleanedHtml = html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<head[\s\S]*?<\/head>/gi, '');

  const textBlocks = [...cleanedHtml.matchAll(/<div[^>]*>([\s\S]*?)<\/div>/gi)];
  const candidates = textBlocks
    .map(match => match[1].replace(/<[^>]*>/g, '').trim())
    .filter(text => text.length > 200 && text.includes('\n'))
    .sort((a, b) => b.length - a.length);

  return candidates.length > 0 ? candidates[0] : '';
}

// Evaluate search results using OpenAI
async function evaluateSearchResults(results, artist, song) {
  try {
    console.log('Evaluating search results with OpenAI...');

    const top5Results = results.slice(0, 5).map((result, index) => ({
      index: index + 1,
      title: result.title || 'No title',
      url: result.url || 'No URL',
      description: result.description || 'No description'
    }));

    const evaluationPrompt = [
      {
        role: 'system',
        content: `You are an expert at evaluating search results for song lyrics. Analyze and rank results based on:
1. URL credibility (lyrics sites like Genius, AZLyrics, Lyrics.com preferred)
2. Title relevance (should contain artist and song name)
3. Description quality (should indicate lyrics content)
4. Overall trustworthiness

Return ONLY valid JSON with rankings from best to worst.`
      },
      {
        role: 'user',
        content: `Evaluate these search results for "${song}" by "${artist}":

${JSON.stringify(top5Results, null, 2)}

Return JSON:
{
  "rankings": [
    {
      "original_index": 1,
      "score": 95,
      "reasoning": "High-quality site with exact match"
    }
  ],
  "best_choice": {
    "original_index": 1,
    "confidence": "high"
  }
}`
      }
    ];

    const evaluation = await callOpenAI(evaluationPrompt, 0.1, 1000);

    try {
      let cleanedEvaluation = evaluation.trim();
      if (cleanedEvaluation.startsWith('```json')) {
        cleanedEvaluation = cleanedEvaluation.replace(/^```json\s*/, '').replace(/\s*```$/, '');
      } else if (cleanedEvaluation.startsWith('```')) {
        cleanedEvaluation = cleanedEvaluation.replace(/^```\s*/, '').replace(/\s*```$/, '');
      }

      return JSON.parse(cleanedEvaluation);
    } catch (parseError) {
      console.error('Failed to parse evaluation:', parseError.message);
      return {
        rankings: top5Results.map((result, index) => ({
          original_index: result.index,
          score: 100 - (index * 10),
          reasoning: "Fallback ranking"
        })),
        best_choice: { original_index: 1, confidence: "low" }
      };
    }
  } catch (error) {
    console.error('OpenAI evaluation error:', error.message);
    return null;
  }
}

// Format content using OpenAI
async function formatContentWithAI(rawContent, artist, song) {
  try {
    console.log('Formatting content with OpenAI...');

    let preCleanedContent = rawContent
      .replace(/^.*?".*?" is an? .*? (lament|song|track|piece).*?\n/gim, '')
      .replace(/^.*?Lyrics$/gim, '')
      .replace(/^\s*\d+\s*Contributors?\s*$/gim, '')
      .replace(/^\s*(Translations?|Share|Embed)\s*$/gim, '')
      .replace(/^.*?View.*?Stats.*$/gim, '')
      .trim();

    const maxInputLength = 15000;
    const truncatedContent = preCleanedContent.length > maxInputLength
      ? preCleanedContent.substring(0, maxInputLength) + '\n...[truncated]'
      : preCleanedContent;

    const formattingPrompt = [
      {
        role: 'system',
        content: `You are an expert at cleaning and formatting song lyrics. Your task is to:

1. PRESERVE ALL ACTUAL SONG LYRICS - this is the most important rule
2. Remove only obvious website elements, navigation, and metadata
3. Keep section labels like [Verse], [Chorus], [Bridge] etc. - they are part of the lyrics structure
4. Remove only these specific elements: "Contributors", "Translations", "Share", "Embed", song descriptions
5. Clean up excessive whitespace but preserve line breaks that separate verses/sections
6. Keep all the actual singing/vocal content
7. Preserve intentional repetition (choruses, refrains, etc.)
8. Do NOT summarize or shorten the actual lyrics content
9. Return the complete, cleaned lyrics text

The goal is to clean formatting while keeping 100% of the actual song lyrics intact.`
      },
      {
        role: 'user',
        content: `Please clean and format these lyrics for "${song}" by "${artist}". Keep ALL the actual lyrics content:

${truncatedContent}

Return the complete cleaned lyrics without any summarization.`
      }
    ];

    const formattedContent = await callOpenAI(formattingPrompt, 0.1, 4000);
    console.log(`OpenAI formatting completed - Input: ${truncatedContent.length} chars, Output: ${formattedContent.length} chars`);

    if (formattedContent.length < truncatedContent.length * 0.3) {
      console.log('OpenAI formatting resulted in too much content loss, using basic cleanup instead');
      return basicCleanup(rawContent);
    }

    return formattedContent.trim();
  } catch (error) {
    console.error('OpenAI formatting error:', error.message);
    return basicCleanup(rawContent);
  }
}

// Basic cleanup fallback
function basicCleanup(rawContent) {
  return rawContent
    .replace(/<[^>]*>/g, '')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/^\s*\d+\s*Contributors?\s*$/gim, '')
    .replace(/^\s*(Translations?|Share|Embed)\s*$/gim, '')
    .replace(/^.*?Lyrics$/gim, '')
    .replace(/^.*?".*?" is an? .*? (lament|song|track|piece).*$/gim, '')
    .replace(/\n{4,}/g, '\n\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/^\s+|\s+$/gm, '')
    .trim();
}

// Fallback function using Brave Search API
async function fetchLyricsWithBraveAPI(artist, song) {
  try {
    console.log(`\n=== Fallback: Using Brave Search API ===`);
    console.log(`Fetching lyrics via Brave Search API: ${artist} - ${song}`);

    const searchQuery = `${artist} ${song} lyrics`;
    const braveUrl = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(searchQuery)}`;

    const response = await fetch(braveUrl, {
      headers: {
        'Accept': 'application/json',
        'Accept-Encoding': 'gzip',
        'X-Subscription-Token': braveApiKey
      }
    });

    if (!response.ok) {
      throw new Error(`Brave Search API request failed: ${response.status}`);
    }

    const data = await response.json();
    console.log('Brave Search API search completed');

    if (!data.web || !data.web.results || data.web.results.length === 0) {
      throw new Error('No search results found');
    }

    const evaluation = await evaluateSearchResults(data.web.results, artist, song);
    let rawContent = null;
    const rankedResults = evaluation.rankings.sort((a, b) => b.score - a.score);

    for (const ranking of rankedResults.slice(0, 3)) {
      const resultIndex = ranking.original_index - 1;
      const result = data.web.results[resultIndex];

      if (!result || !result.url) continue;

      if (result.url.includes('genius.com') ||
        result.url.includes('azlyrics.com') ||
        result.url.includes('lyrics.com') ||
        result.url.includes('metrolyrics.com') ||
        result.url.includes('lyricfind.com') ||
        result.url.includes('songlyrics.com')) {

        try {
          console.log(`Trying ranked result #${ranking.original_index}: ${result.url}`);
          const html = await fetchContentFromUrl(result.url);

          if (html) {
            if (result.url.includes('genius.com')) {
              rawContent = await extractGeniusContentEnhanced(html);
            } else {
              rawContent = await extractGenericContent(html, result.url);
            }

            if (rawContent && rawContent.length > 50) {
              console.log(`Successfully extracted content (score: ${ranking.score}, length: ${rawContent.length})`);
              break;
            }
          }
        } catch (error) {
          console.log(`Failed to fetch from ${result.url}: ${error.message}`);
          continue;
        }
      }
    }

    if (!rawContent || rawContent.length < 50) {
      console.log('Trying fallback: checking search result descriptions...');
      for (const result of data.web.results.slice(0, 5)) {
        if (result.description && result.description.length > 200) {
          if (result.description.includes('lyrics') ||
            result.description.includes('verse') ||
            result.description.includes('chorus')) {
            rawContent = result.description;
            console.log('Found potential lyrics in search result description');
            break;
          }
        }
      }
    }

    return rawContent;
  } catch (error) {
    console.error('Brave Search API lyrics', error.message);
    return null;
  }
}

// POST API Handler for fetching lyrics
export async function POST(req) {
  try {
    const { artist, song } = await req.json();

    if (!artist || !song) {
      return new Response(
        JSON.stringify({
          success: false,
          error: '必須提供 artist 和 song 參數'
        }),
        {
          status: 400,
          headers: { 'Content-Type': 'application/json' }
        }
      );
    }

    console.log(`\n=== Enhanced Lyrics Fetch Request ===`);
    console.log(`Artist: ${artist}`);
    console.log(`Song: ${song}`);
    console.log(`Strategy: Genius API first, then Brave Search fallback`);
    console.log(`=====================================\n`);

    let rawLyrics = null;
    let fetchMethod = '';

    // Step 1: Try Genius API first
    rawLyrics = await fetchLyricsWithGeniusAPI(artist, song);

    if (rawLyrics && rawLyrics.length >= 50) {
      fetchMethod = 'genius_api';
      console.log(`✓ Successfully fetched lyrics via Genius API (${rawLyrics.length} chars)`);
    } else {
      // Step 2: Fallback to Brave Search API
      console.log('⚠ Genius API failed, trying Brave Search API as fallback...');
      rawLyrics = await fetchLyricsWithBraveAPI(artist, song);

      if (rawLyrics && rawLyrics.length >= 50) {
        fetchMethod = 'brave_search_api';
        console.log(`✓ Successfully fetched lyrics via Brave Search API (${rawLyrics.length} chars)`);
      }
    }

    if (!rawLyrics || rawLyrics.length < 50) {
      return new Response(
        JSON.stringify({
          success: false,
          error: `無法獲取《${song}》的歌詞，已嘗試 Genius API 和 Brave Search API`,
          suggestion: '請確認歌手和歌曲名稱的正確性，或稍後再試',
          methods_tried: ['genius_api', 'brave_search_api']
        }),
        {
          status: 404,
          headers: { 'Content-Type': 'application/json' }
        }
      );
    }

    console.log(`Raw lyrics fetched via ${fetchMethod} (${rawLyrics.length} chars)`);

    // Format lyrics using enhanced OpenAI processing
    const formattedLyrics = await formatContentWithAI(rawLyrics, artist, song);
    console.log(`Lyrics formatted with enhanced AI processing (${formattedLyrics.length} chars)`);

    return new Response(
      JSON.stringify({
        success: true,
        lyrics: formattedLyrics,
        artist: artist,
        song: song,
        lyrics_length: formattedLyrics.length,
        processing_method: 'enhanced_openai_extraction',
        fetch_method: fetchMethod,
        fetched_at: new Date().toISOString()
      }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      }
    );

  } catch (error) {
    console.error('Enhanced Lyrics API Error:', error.message);
    return new Response(
      JSON.stringify({
        success: false,
        error: `歌詞獲取錯誤: ${error.message}`,
        timestamp: new Date().toISOString()
      }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      }
    );
  }
}
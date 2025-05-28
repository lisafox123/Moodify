import { DynamicTool } from '@langchain/core/tools';

// Environment variables
const braveApiKey = process.env.BRAVE_API_KEY;
const openaiApiKey = process.env.OPENAI_API_KEY;

if (!braveApiKey) {
  throw new Error('BRAVE_API_KEY is missing');
}

if (!openaiApiKey) {
  throw new Error('OPENAI_API_KEY is missing');
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

// Enhanced function to fetch raw content from a specific URL
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
// Enhanced Genius.com specific extraction - handles the data-lyrics-container structure
async function extractGeniusContent(html) {
  console.log('Extracting content from Genius.com with enhanced methods...');

  // Method 1: More precise extraction from data-lyrics-container divs
  // This pattern ensures we only get the actual lyrics content
  const lyricsContainerPattern = /<div[^>]*data-lyrics-container="true"[^>]*>([\s\S]*?)(?=<\/div>\s*(?:<div[^>]*data-lyrics-container|<div[^>]*class="[^"]*Sidebar|<aside|<footer|$))/gi;
  const containerMatches = [...html.matchAll(lyricsContainerPattern)];
  
  if (containerMatches.length > 0) {
    console.log(`Found ${containerMatches.length} lyrics containers`);
    
    const allContent = containerMatches.map((match, index) => {
      console.log(`Processing container ${index + 1}, raw length: ${match[1].length}`);
      
      // Skip containers that are too large (likely contain non-lyrical content)
      if (match[1].length > 20000) {
        console.log(`Container ${index + 1} is too large (${match[1].length} chars), likely contains non-lyrical content`);
        return '';
      }
      
      let content = match[1];
      
      // Remove entire header section and all its nested content
      content = content.replace(/<div[^>]*class="[^"]*LyricsHeader[^"]*"[^>]*>[\s\S]*?(?:<\/div>\s*){3,}/gi, '');
      
      // Remove any remaining UI elements
      content = content
        .replace(/<button[^>]*>[\s\S]*?<\/button>/gi, '')
        .replace(/<div[^>]*class="[^"]*Dropdown[^"]*"[^>]*>[\s\S]*?<\/div>/gi, '')
        .replace(/<div[^>]*class="[^"]*Contributors[^"]*"[^>]*>[\s\S]*?<\/div>/gi, '');
      
      // Extract text from links, preserving lyrics content
      content = content.replace(/<a[^>]*href="[^"]*"[^>]*(?:class="[^"]*ReferentFragment[^"]*"[^>]*)?>((?:<span[^>]*>)?)([\s\S]*?)((?:<\/span>)?)<\/a>/g, '$2');
      
      // Remove all span tags but keep their content
      content = content.replace(/<span[^>]*>/g, '').replace(/<\/span>/g, '');
      
      // Handle section markers
      content = content.replace(/\[(Verse|Chorus|Bridge|Pre-Chorus|Outro|Intro|Instrumental Break|Refrain).*?\]/gi, '\n[$1]\n');
      
      // Convert <br> tags to newlines
      content = content.replace(/<br\s*\/?>/gi, '\n');
      
      // Remove any remaining HTML tags
      content = content.replace(/<[^>]+>/g, '');
      
      // Clean up HTML entities
      content = content
        .replace(/&quot;/g, '"')
        .replace(/&#x27;|&#39;/g, "'")
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&nbsp;/g, ' ');
      
      // Remove non-lyrical content patterns
      content = content
        .replace(/See .* Live/gi, '')
        .replace(/Get tickets as low as .*/gi, '')
        .replace(/You might also like.*/gi, '')
        .replace(/\d+ Contributors?/gi, '')
        .replace(/Embed/gi, '')
        .replace(/Share/gi, '')
        .replace(/Translations?/gi, '');
      
      // Clean up whitespace
      content = content
        .replace(/[\u200B-\u200D\uFEFF]/g, '') // Remove zero-width characters
        .replace(/[ \t]+/g, ' ') // Normalize horizontal spaces
        .replace(/\n\s*\n\s*\n/g, '\n\n') // Max 2 consecutive newlines
        .replace(/^\s+|\s+$/gm, '') // Trim each line
        .trim();
      
      console.log(`Container ${index + 1} processed, final length: ${content.length}`);
      if (content.length > 0 && content.length < 50) {
        console.log(`Container ${index + 1} full content: ${content}`);
      } else if (content.length > 0) {
        console.log(`Container ${index + 1} preview: ${content.substring(0, 100)}...`);
      }
      
      return content;
    });
    
    // Filter out empty or very short containers, and containers with non-lyrical content
    const validContent = allContent.filter(content => {
      if (content.length < 50) return false;
      // Check if content looks like lyrics (has newlines, typical lyrics patterns)
      if (!content.includes('\n')) return false;
      // Skip if it's mostly numbers or special characters
      const alphaRatio = (content.match(/[a-zA-Z]/g) || []).length / content.length;
      if (alphaRatio < 0.5) return false;
      return true;
    });
    
    console.log(`Valid containers: ${validContent.length}/${allContent.length}`);
    
    if (validContent.length > 0) {
      const combinedContent = validContent
        .join('\n\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
      
      console.log(`Successfully extracted ${combinedContent.length} characters of lyrics`);
      return combinedContent;
    }
  }

  // Method 2: More targeted extraction for specific lyrics sections
  console.log('Attempting alternative extraction method...');
  
  // Try to find lyrics between specific markers
  const lyricsSectionPattern = /<div[^>]*data-lyrics-container="true"[^>]*>([\s\S]*?)<\/div>(?=\s*<div[^>]*(?:data-lyrics-container|class="[^"]*(?:Sidebar|Footer|Ad)[^"]*")|$)/gi;
  const lyricsMatches = [...html.matchAll(lyricsSectionPattern)];
  
  for (const match of lyricsMatches) {
    let sectionContent = match[1];
    
    // Skip if it contains too many non-lyrical elements
    if (sectionContent.includes('LyricsHeader') || 
        sectionContent.includes('Contributors') || 
        sectionContent.includes('Dropdown')) {
      
      // Clean it first
      sectionContent = sectionContent
        .replace(/<div[^>]*class="[^"]*(?:Header|Contributors|Dropdown)[^"]*"[^>]*>[\s\S]*?<\/div>(?:\s*<\/div>)*/gi, '')
        .replace(/<button[^>]*>[\s\S]*?<\/button>/gi, '');
    }
    
    // Extract lyrics content
    let lyrics = sectionContent
      // Extract text from all links
      .replace(/<a[^>]*>([\s\S]*?)<\/a>/g, (match, content) => {
        // Remove nested spans but keep text
        return content.replace(/<span[^>]*>([\s\S]*?)<\/span>/g, '$1').replace(/<[^>]+>/g, '');
      })
      // Remove remaining spans
      .replace(/<span[^>]*>([\s\S]*?)<\/span>/g, '$1')
      // Convert breaks
      .replace(/<br\s*\/?>/gi, '\n')
      // Remove remaining tags
      .replace(/<[^>]+>/g, '')
      // Decode entities
      .replace(/&quot;/g, '"')
      .replace(/&#x27;|&#39;/g, "'")
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      // Clean whitespace
      .replace(/[\u200B-\u200D\uFEFF]/g, '')
      .replace(/[ \t]+/g, ' ')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
    
    // Check if this looks like actual lyrics
    if (lyrics.length > 100 && lyrics.includes('\n')) {
      console.log(`Found lyrics section with ${lyrics.length} characters`);
      return lyrics;
    }
  }
  
  // Method 3: Find lyrics by looking for verse/chorus patterns
  console.log('Attempting pattern-based extraction...');
  
  // Remove script and style tags first
  const cleanedHtml = html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '');
  
  // Look for sections that contain lyrics patterns
  const versePattern = /(?:\[(?:Verse|Chorus|Bridge|Pre-Chorus|Outro|Intro|Refrain).*?\][\s\S]*?){2,}/gi;
  const matches = cleanedHtml.match(versePattern);
  
  if (matches) {
    for (const match of matches) {
      const cleaned = match
        .replace(/<[^>]+>/g, '')
        .replace(/&quot;/g, '"')
        .replace(/&#x27;|&#39;/g, "'")
        .replace(/&amp;/g, '&')
        .trim();
      
      if (cleaned.length > 200) {
        console.log(`Pattern-based extraction found ${cleaned.length} characters`);
        return cleaned;
      }
    }
  }

  // Method 3: Extract from script tags if other methods fail
  console.log('Attempting to extract from embedded JSON...');
  
  const scriptPattern = /<script[^>]*>[\s\S]*?window\.__PRELOADED_STATE__\s*=\s*JSON\.parse\(([\s\S]*?)\);[\s\S]*?<\/script>/;
  const scriptMatch = html.match(scriptPattern);
  
  if (scriptMatch) {
    try {
      // Extract and clean the JSON string
      let jsonString = scriptMatch[1];
      if (jsonString.startsWith("'") || jsonString.startsWith('"')) {
        jsonString = jsonString.slice(1, -1);
      }
      
      // Unescape the JSON string
      jsonString = jsonString
        .replace(/\\"/g, '"')
        .replace(/\\'/g, "'")
        .replace(/\\\\/g, '\\')
        .replace(/\\n/g, '\n')
        .replace(/\\r/g, '\r')
        .replace(/\\t/g, '\t');
      
      const data = JSON.parse(jsonString);
      
      // Navigate through possible paths to find lyrics
      const possiblePaths = [
        data?.songPage?.lyricsData?.body?.html,
        data?.songPage?.lyrics?.body?.html,
        data?.lyrics?.body?.html,
        data?.song?.lyrics
      ];
      
      for (const lyricsHtml of possiblePaths) {
        if (lyricsHtml) {
          const cleanedLyrics = lyricsHtml
            .replace(/<br\s*\/?>/gi, '\n')
            .replace(/<[^>]+>/g, '')
            .replace(/&quot;/g, '"')
            .replace(/&#x27;|&#39;/g, "'")
            .replace(/&amp;/g, '&')
            .replace(/\n{3,}/g, '\n\n')
            .trim();
          
          if (cleanedLyrics.length > 100) {
            console.log(`Extracted ${cleanedLyrics.length} characters from embedded JSON`);
            return cleanedLyrics;
          }
        }
      }
    } catch (e) {
      console.error('Error parsing embedded JSON:', e.message);
    }
  }
  
  console.log('All extraction methods exhausted');
  return '';
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
  
  // Generic extraction - look for substantial text blocks
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
      // Fallback ranking
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

// Format content using OpenAI - enhanced for better cleaning
async function formatContentWithAI(rawContent, artist, song) {
  try {
    console.log('Formatting content with OpenAI...');
    
    const maxInputLength = 15000;
    const truncatedContent = rawContent.length > maxInputLength 
      ? rawContent.substring(0, maxInputLength) + '\n...[truncated]'
      : rawContent;
    
    const formattingPrompt = [
      {
        role: 'system',
        content: `You are an expert at cleaning and formatting song lyrics from web content. Your task is to:

1. Extract ONLY the main lyrics content from the raw text
2. Remove all HTML tags, metadata, and navigation elements
3. Remove section labels like [Verse], [Chorus], [Bridge], [Pre-Chorus], [Outro], [Intro], etc.
4. Remove website elements like "Contributors", "Translations", "Share", "Embed"
5. Remove copyright notices, website names, and advertisements
6. Clean up spacing and line breaks for proper readability
7. Preserve the natural structure and flow of the lyrics
8. Remove duplicate lines while preserving intentional repetition (like choruses)
9. Ensure proper capitalization and punctuation
10. Return ONLY the cleaned lyrics text without markdown or additional formatting

Focus on extracting the core lyrical content while removing all web page artifacts and metadata.`
      },
      {
        role: 'user',
        content: `Please clean and format these raw lyrics for "${song}" by "${artist}":

${truncatedContent}

Return only the cleaned lyrics text without any additional formatting or commentary.`
      }
    ];

    const formattedContent = await callOpenAI(formattingPrompt, 0.1, 2000);
    console.log('OpenAI formatting completed');
    return formattedContent.trim();
  } catch (error) {
    console.error('OpenAI formatting error:', error.message);
    return basicCleanup(rawContent);
  }
}

// Basic cleanup fallback
function basicCleanup(rawContent) {
  return rawContent
    // Remove HTML tags
    .replace(/<[^>]*>/g, '')
    // Remove section labels
    .replace(/\[Verse\s*\d*\]/gi, '')
    .replace(/\[Chorus\]/gi, '')
    .replace(/\[Bridge\]/gi, '')
    .replace(/\[Outro\]/gi, '')
    .replace(/\[Intro\]/gi, '')
    .replace(/\[Pre-Chorus\]/gi, '')
    .replace(/\[.*?\]/g, '')
    // Remove HTML entities
    .replace(/&quot;/g, '"')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    // Remove website elements
    .replace(/\d+\s*Contributors?/gi, '')
    .replace(/Translations?/gi, '')
    .replace(/Share/gi, '')
    .replace(/Embed/gi, '')
    // Clean up spacing
    .replace(/\n{3,}/g, '\n\n')
    .replace(/\s{2,}/g, ' ')
    .replace(/^\s+|\s+$/gm, '')
    .trim();
}

// Main function to fetch lyrics using Brave Search API
async function fetchLyricsWithBraveAPI(artist, song) {
  try {
    console.log(`Fetching lyrics via enhanced Brave Search API: ${artist} - ${song}`);
    
    // Search for lyrics using Brave Search API
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

    // Evaluate results using OpenAI
    const evaluation = await evaluateSearchResults(data.web.results, artist, song);
    
    // Try to fetch content from URLs in ranked order
    let rawContent = null;
    const rankedResults = evaluation.rankings.sort((a, b) => b.score - a.score);
    
    for (const ranking of rankedResults.slice(0, 3)) { // Only try top 3 results
      const resultIndex = ranking.original_index - 1;
      const result = data.web.results[resultIndex];
      
      if (!result || !result.url) continue;
      
      // Check if it's a lyrics site
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
              rawContent = await extractGeniusContent(html);
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
    
    // Fallback: Check search result descriptions if no URL worked
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
    console.error('Enhanced Brave Search API lyrics fetch error:', error.message);
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
    console.log(`Using enhanced extraction methods with OpenAI formatting`);
    console.log(`=====================================\n`);

    // Fetch lyrics using enhanced Brave Search API
    const rawLyrics = await fetchLyricsWithBraveAPI(artist, song);
    
    if (!rawLyrics || rawLyrics.length < 50) {
      return new Response(
        JSON.stringify({ 
          success: false,
          error: `無法通過Brave Search API獲取《${song}》的歌詞，請檢查歌曲名稱或稍後再試`,
          suggestion: '請確認歌手和歌曲名稱的正確性'
        }),
        { 
          status: 404,
          headers: { 'Content-Type': 'application/json' }
        }
      );
    }

    console.log(`Raw lyrics fetched (${rawLyrics.length} chars)`);

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
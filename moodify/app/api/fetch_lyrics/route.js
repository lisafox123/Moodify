const axios = require('axios');

// Environment variables
const braveApiKey = process.env.BRAVE_API_KEY;
const geniusApiKey = process.env.GENIUS_API_KEY;
const FASTAPI_BASE_URL = 'http://54.152.238.168:8000';

// Validate required API keys
if (!braveApiKey || !geniusApiKey) {
  throw new Error('Missing required API keys: BRAVE_API_KEY, GENIUS_API_KEY');
}

// Normalize text for comparison (supports multiple languages)
function normalizeText(text) {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, '') // Unicode-aware: keep letters, numbers, spaces
    .replace(/\s+/g, ' ')
    .trim();
}

// Calculate similarity score between two strings
function calculateSimilarity(str1, str2) {
  const normalized1 = normalizeText(str1);
  const normalized2 = normalizeText(str2);
  
  if (normalized1 === normalized2) return 100;
  if (normalized1.includes(normalized2) || normalized2.includes(normalized1)) return 80;
  
  // Simple word overlap scoring
  const words1 = new Set(normalized1.split(' '));
  const words2 = new Set(normalized2.split(' '));
  const intersection = new Set([...words1].filter(x => words2.has(x)));
  const union = new Set([...words1, ...words2]);
  
  return Math.round((intersection.size / union.size) * 100);
}

// Enhanced Brave Search to get top 3 results and verify Genius.com presence
async function searchBraveAndVerifyGenius(artist, song) {
  try {
    console.log(`Searching Brave for top 3 results: ${artist} - ${song}`);
    
    const query = `${artist} ${song} genius.com lyrics`;
    const response = await axios.get(`https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}`, {
      headers: {
        'Accept': 'application/json',
        'X-Subscription-Token': braveApiKey
      }
    });

    const results = response.data.web?.results || [];
    
    if (results.length === 0) {
      console.log('No search results found');
      return {
        success: false,
        message: 'No search results found',
        top3Results: [],
        geniusFound: false
      };
    }

    // Get top 3 results
    const top3Results = results.slice(0, 3).map((result, index) => ({
      rank: index + 1,
      title: result.title || 'No title',
      url: result.url || 'No URL',
      description: result.description || 'No description',
      isGenius: result.url ? result.url.includes('genius.com') : false
    }));

    // Check if any of the top 3 results contain genius.com
    const geniusResults = top3Results.filter(result => result.isGenius);
    const geniusFound = geniusResults.length > 0;

    console.log('Top 3 search results:');
    top3Results.forEach(result => {
      console.log(`${result.rank}. ${result.title}`);
      console.log(`   URL: ${result.url}`);
      console.log(`   Genius: ${result.isGenius ? 'YES' : 'NO'}`);
      console.log(`   Description: ${result.description.substring(0, 100)}...`);
      console.log('---');
    });

    if (geniusFound) {
      console.log(`Found ${geniusResults.length} Genius.com result(s) in top 3`);
    } else {
      console.log('No Genius.com URLs found in top 3 results');
    }

    return {
      success: true,
      top3Results,
      geniusFound,
      geniusResults,
      totalResults: results.length,
      query: query
    };

  } catch (error) {
    console.error('Enhanced Brave search error:', error.message);
    return {
      success: false,
      error: error.message,
      top3Results: [],
      geniusFound: false
    };
  }
}

// Search for song on Genius API
async function searchGenius(artist, song) {
  try {
    const query = `${artist} ${song}`;
    const response = await fetch(`https://api.genius.com/search?q=${encodeURIComponent(query)}`, {
      headers: {
        'Authorization': `Bearer ${geniusApiKey}`,
        'Accept': 'application/json'
      }
    });

    if (!response.ok) throw new Error(`Genius API error: ${response.status}`);

    const data = await response.json();
    const hits = data.response?.hits || [];

    if (hits.length === 0) return null;

    // Find best match
    let bestMatch = null;
    let bestScore = 0;

    for (const hit of hits) {
      const result = hit.result;
      if (!result) continue;

      const artistScore = calculateSimilarity(artist, result.primary_artist?.name || '');
      const titleScore = calculateSimilarity(song, result.title || '');
      const combinedScore = (artistScore + titleScore) / 2;

      if (combinedScore > bestScore && combinedScore >= 60) {
        bestScore = combinedScore;
        bestMatch = result;
      }
    }

    return bestMatch;
  } catch (error) {
    console.error('Genius search error:', error.message);
    return null;
  }
}

// Fetch page content
async function fetchPageContent(url) {
  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    });

    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.text();
  } catch (error) {
    console.error(`Error fetching ${url}:`, error.message);
    return null;
  }
}

// Send HTML content to FastAPI for extraction and formatting
async function extractLyricsViaAPI(htmlContent, artist, song, url = null) {
  try {
    const response = await axios.post(`${FASTAPI_BASE_URL}/lyrics/extract`, {
      html_content: htmlContent,
      artist: artist,
      song: song,
      url: url
    });

    if (response.data.success) {
      return response.data.lyrics;
    } else {
      console.error('FastAPI extraction error:', response.data.error);
      return null;
    }
  } catch (error) {
    console.error('FastAPI request error:', error.message);
    return null;
  }
}

// Enhanced fetch lyrics using Brave Search with Genius verification
async function fetchBraveLyricsEnhanced(artist, song) {
  try {
    // First, get top 3 results and verify Genius presence
    const searchResult = await searchBraveAndVerifyGenius(artist, song);
    
    if (!searchResult.success) {
      console.error('Brave search failed:', searchResult.error);
      return null;
    }

    let lyrics = null;
    let sourceUrl = null;

    // If Genius.com is found in top 3, prioritize it
    if (searchResult.geniusFound) {
      console.log('Genius.com found in top 3 results, trying Genius URLs first...');
      
      for (const geniusResult of searchResult.geniusResults) {
        console.log(`Trying Genius URL: ${geniusResult.url}`);
        const html = await fetchPageContent(geniusResult.url);
        if (html) {
          lyrics = await extractLyricsViaAPI(html, artist, song, geniusResult.url);
          if (lyrics && lyrics.length > 100) {
            sourceUrl = geniusResult.url;
            console.log('Successfully extracted lyrics from Genius.com');
            break;
          }
        }
      }
    }

    // If no lyrics from Genius or Genius not found, try other results
    if (!lyrics) {
      console.log('Trying other URLs from top 3 results...');
      
      const nonGeniusResults = searchResult.top3Results.filter(result => !result.isGenius);
      const lyricsSites = ['azlyrics.com', 'lyrics.com', 'metrolyrics.com', 'lyricsmode.com'];
      
      for (const result of nonGeniusResults) {
        const isLyricsSite = lyricsSites.some(site => result.url.includes(site));
        if (!isLyricsSite) continue;

        console.log(`Trying lyrics site: ${result.url}`);
        const html = await fetchPageContent(result.url);
        if (html) {
          lyrics = await extractLyricsViaAPI(html, artist, song, result.url);
          if (lyrics && lyrics.length > 100) {
            sourceUrl = result.url;
            console.log(`Successfully extracted lyrics from: ${result.url}`);
            break;
          }
        }
      }
    }

    return lyrics ? {
      lyrics,
      sourceUrl,
      searchAnalysis: searchResult
    } : null;

  } catch (error) {
    console.error('Enhanced Brave search error:', error.message);
    return null;
  }
}

// Fetch lyrics from Genius
async function fetchGeniusLyrics(artist, song) {
  try {
    console.log(`Searching Genius for: ${artist} - ${song}`);
    
    const songData = await searchGenius(artist, song);
    if (!songData?.url) return null;

    const html = await fetchPageContent(songData.url);
    if (!html) return null;

    // Send HTML to FastAPI for extraction and formatting
    const lyrics = await extractLyricsViaAPI(html, artist, song, songData.url);
    return lyrics && lyrics.length > 100 ? lyrics : null;
  } catch (error) {
    console.error('Genius fetch error:', error.message);
    return null;
  }
}

// Original Brave Search function (kept for backward compatibility)
async function fetchBraveLyrics(artist, song) {
  try {
    console.log(`Using Brave Search for: ${artist} - ${song}`);
    
    const query = `${artist} ${song} lyrics`;
    const response = await axios.get(`https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}`, {
      headers: {
        'Accept': 'application/json',
        'X-Subscription-Token': braveApiKey
      }
    });

    const results = response.data.web?.results || [];
    if (results.length === 0) return null;

    // Try top results from known lyrics sites
    const lyricsSites = ['genius.com', 'azlyrics.com', 'lyrics.com', 'metrolyrics.com'];
    
    for (const result of results.slice(0, 5)) {
      if (!result.url) continue;
      
      const isLyricsSite = lyricsSites.some(site => result.url.includes(site));
      if (!isLyricsSite) continue;

      const html = await fetchPageContent(result.url);
      if (!html) continue;

      // Send HTML to FastAPI for extraction and formatting
      const lyrics = await extractLyricsViaAPI(html, artist, song, result.url);
      if (lyrics && lyrics.length > 100) {
        return lyrics;
      }
    }

    return null;
  } catch (error) {
    console.error('Brave search error:', error.message);
    return null;
  }
}

// Main API handler - Updated to use enhanced Brave search
export async function POST(req) {
  try {
    const { artist, song } = await req.json();

    if (!artist || !song) {
      return new Response(JSON.stringify({
        success: false,
        error: 'Artist and song parameters are required'
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    console.log(`Fetching lyrics: ${artist} - ${song}`);

    let formattedLyrics = null;
    let source = '';
    let sourceUrl = '';
    let searchAnalysis = null;

    // Try Genius API first
    formattedLyrics = await fetchGeniusLyrics(artist, song);
    if (formattedLyrics) {
      source = 'genius_api';
    } else {
      // Use enhanced Brave Search with Genius verification
      const braveResult = await fetchBraveLyricsEnhanced(artist, song);
      if (braveResult) {
        formattedLyrics = braveResult.lyrics;
        sourceUrl = braveResult.sourceUrl;
        searchAnalysis = braveResult.searchAnalysis;
        source = braveResult.sourceUrl.includes('genius.com') ? 'brave_search_genius' : 'brave_search_other';
      }
    }

    if (!formattedLyrics || formattedLyrics.length < 50) {
      return new Response(JSON.stringify({
        success: false,
        error: `Could not find lyrics for "${song}" by ${artist}`,
        suggestion: 'Please check the artist and song name spelling',
        searchAnalysis: searchAnalysis || null
      }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    return new Response(JSON.stringify({
      success: true,
      lyrics: formattedLyrics,
      artist,
      song,
      source,
      sourceUrl,
      length: formattedLyrics.length,
      timestamp: new Date().toISOString(),
      searchAnalysis: searchAnalysis || null
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });

  } catch (error) {
    console.error('Lyrics API error:', error.message);
    return new Response(JSON.stringify({
      success: false,
      error: `Failed to fetch lyrics: ${error.message}`,
      timestamp: new Date().toISOString()
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}
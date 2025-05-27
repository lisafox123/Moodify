import OpenAI from "openai";
import { fetchFromSpotify } from './spotifyHelpers.js';
import { ProgressTracker } from '../../lib/progressStore.js';

// Environment variables
const braveApiKey = process.env.BRAVE_API_KEY;
const openaiApiKey = process.env.OPENAI_API_KEY;

if (!braveApiKey) {
  throw new Error('BRAVE_API_KEY is missing');
}

if (!openaiApiKey) {
  throw new Error('OPENAI_API_KEY is missing');
}

const openai = new OpenAI({
  apiKey: openaiApiKey,
});

// ENHANCED CONFIGURATION
const EMBEDDING_CONFIG = {
  maxCandidatesForEmbedding: 30,
  preFilteringEnabled: true,
  embeddingModel: "text-embedding-3-small",
  cacheDuration: 3600000, // 1 hour cache
  parallelRequests: 5
};

// Cache for embeddings and search results
const cache = new Map();

// MAIN ENHANCED FUNCTION WITH PARALLEL PROCESSING
export async function generateClassicRecommendations(prompt, token, requestId) {
  let progressTracker = null;
  
  try {
    // Initialize progress tracker
    progressTracker = new ProgressTracker(requestId, 'classic');
    
    console.log("=== ENHANCED CLASSIC RECOMMENDATION WORKFLOW ===");
    console.log("Original prompt:", prompt);

    // Step 1: Initialize workflow
    await progressTracker.updateStep('classic_workflow', 'active', 'Setting up enhanced recommendation engine');
    await progressTracker.completeStep('classic_workflow', 'Classic workflow initialized');

    // Step 2: Analyze prompt with caching
    await progressTracker.updateStep('prompt_analysis', 'active', 'Analyzing your music preferences');
    const analysisResult = await analyzeUserPromptWithOpenAI(prompt);
    await progressTracker.completeStep('prompt_analysis', `Identified: ${analysisResult.originalIntent}`);

    // Step 3: Parallel execution of search and AI generation
    await progressTracker.updateStep('parallel_processing', 'active', 'Running parallel search and AI generation');
    
    const [webResults, aiResults] = await Promise.all([
      // Web search
      searchWithBraveAPI(analysisResult.searchQueries, progressTracker).catch(err => {
        console.error("Web search failed:", err);
        return [];
      }),
      
      // AI generation
      generateAIRecommendationsWithOpenAI(
        analysisResult.refinedPrompt, 
        analysisResult.constraints,
        analysisResult.culturalContext,
        progressTracker
      ).catch(err => {
        console.error("AI generation failed:", err);
        return generateFallbackSongs(prompt, analysisResult.constraints);
      })
    ]);

    await progressTracker.completeStep('parallel_processing', `Found ${webResults.length + aiResults.length} total candidates`);

    // Step 4: Smart deduplication with preference for AI results
    await progressTracker.updateStep('smart_deduplication', 'active', 'Intelligently combining results');
    const combinedResults = smartDeduplicate(webResults, aiResults, analysisResult);
    await progressTracker.completeStep('smart_deduplication', `${combinedResults.length} unique songs identified`);

    // Step 5: Fast semantic ranking
    await progressTracker.updateStep('semantic_ranking', 'active', 'Ranking songs by relevance');
    const rankedResults = await fastSemanticRanking(
      combinedResults, 
      analysisResult.originalEmbedding,
      analysisResult.semanticKeywords,
      progressTracker
    );
    await progressTracker.completeStep('semantic_ranking', `Ranked ${rankedResults.length} songs`);

    // Step 6: Quick alignment check
    await progressTracker.updateStep('alignment_check', 'active', 'Ensuring perfect matches');
    const alignedSongs = await quickAlignmentCheck(
      rankedResults,
      prompt,
      analysisResult,
      progressTracker
    );
    await progressTracker.completeStep('alignment_check', `${alignedSongs.length} songs verified`);

    // Step 7: Ensure minimum count
    const finalSongs = ensureMinimumCount(alignedSongs, analysisResult.constraints, prompt);

    // Step 8: Parallel Spotify search
    await progressTracker.updateStep('spotify_search', 'active', 'Finding your songs on Spotify');
    const spotifyTracks = await parallelSpotifySearch(finalSongs, token, progressTracker);
    await progressTracker.completeStep('spotify_search', `Found ${spotifyTracks.length} tracks on Spotify`);

    // Complete workflow
    await progressTracker.complete({
      tracks: spotifyTracks,
      totalFound: spotifyTracks.length,
      originalPrompt: prompt,
      processingTime: Date.now() - progressTracker.startTime
    });

    return spotifyTracks;

  } catch (err) {
    console.error("Enhanced workflow failed:", err.message);
    
    if (progressTracker) {
      await progressTracker.setError(progressTracker.currentStep || 'classic_workflow', err.message);
    }
    
    // Emergency fallback
    const emergencyFallback = generateFallbackSongs(prompt, { targetCount: 10 });
    const spotifyTracks = await searchTracksOnSpotify(emergencyFallback, token);
    
    if (progressTracker) {
      await progressTracker.complete({
        tracks: spotifyTracks,
        totalFound: spotifyTracks.length,
        fallback: true,
        error: err.message
      });
    }
    
    return spotifyTracks;
  }
}

// ENHANCED PROMPT ANALYSIS WITH BETTER PATTERN RECOGNITION
async function analyzeUserPromptWithOpenAI(prompt) {
  // Check cache first
  const cacheKey = `analysis_${prompt}`;
  if (cache.has(cacheKey)) {
    console.log("Using cached analysis");
    return cache.get(cacheKey);
  }

  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4-turbo",
      messages: [
        {
          role: "system",
          content: `You are an expert music analyst. Analyze the user's request and extract:

1. Musical elements (genre, mood, era, themes)
2. Specific constraints (count, decade, artist, language)
3. Cultural context and preferences
4. Search optimization strategies

Be extremely accurate in understanding user intent. Common patterns:
- "songs like X" → find similar style/mood to X
- "X songs" where X is a number → exact count needed
- Cultural indicators: language, country, regional styles
- Mood indicators: sad, happy, energetic, calm, romantic
- Era indicators: 80s, 90s, classic, vintage, modern

Return JSON with:
{
  "originalIntent": "concise summary",
  "musicalElements": ["genre", "mood", "era"],
  "constraints": {
    "targetCount": number,
    "minCount": number,
    "decade": "1980s" or null,
    "specificArtist": "artist name" or null,
    "mood": "specific mood",
    "language": "language preference"
  },
  "searchQueries": ["optimized query 1", "query 2"],
  "refinedPrompt": "enhanced prompt for AI",
  "semanticKeywords": ["key", "words"],
  "culturalContext": {
    "language": "detected language",
    "culture": "cultural context",
    "region": "geographic region",
    "keywords": ["cultural", "keywords"]
  },
  "confidenceScore": 0.95
}`
        },
        {
          role: "user",
          content: `Analyze this request with high accuracy: "${prompt}"`
        }
      ],
      temperature: 0.2,
      max_tokens: 1000,
    });

    const content = response.choices[0]?.message?.content || "";
    const analysis = JSON.parse(content.replace(/```json|```/g, '').trim());

    // Generate embedding for the prompt
    const embeddingText = `${prompt} ${analysis.semanticKeywords?.join(' ') || ''}`;
    const embeddingResponse = await openai.embeddings.create({
      model: EMBEDDING_CONFIG.embeddingModel,
      input: embeddingText,
    });

    const result = {
      ...analysis,
      originalEmbedding: embeddingResponse.data[0].embedding
    };

    // Cache the result
    cache.set(cacheKey, result);
    setTimeout(() => cache.delete(cacheKey), EMBEDDING_CONFIG.cacheDuration);

    return result;

  } catch (err) {
    console.error("Prompt analysis failed:", err.message);
    return getFallbackAnalysis(prompt);
  }
}
// FIXED: Enhanced web search with proper headers and error handling
async function searchWithBraveAPI(searchQueries, progressTracker) {
  if (!braveApiKey) {
    console.error('Brave API key missing');
    return [];
  }

  try {
    const allResults = [];
    
    // Process queries sequentially to avoid rate limiting
    for (const query of searchQueries) {
      const cacheKey = `search_${query}`;
      if (cache.has(cacheKey)) {
        allResults.push(...cache.get(cacheKey));
        continue;
      }

      const braveUrl = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}`;
      
      try {
        const response = await fetch(braveUrl, {
          headers: {
            'Accept': 'application/json',
            'Accept-Encoding': 'gzip',  // FIXED: Added missing header
            'X-Subscription-Token': braveApiKey
          }
        });

        // FIXED: Better error handling with detailed logging
        if (!response.ok) {
          console.error(`Brave Search API request failed: ${response.status} ${response.statusText} for query: ${query}`);
          
          // Log response body for debugging
          try {
            const errorBody = await response.text();
            console.error('Error response body:', errorBody);
          } catch (e) {
            console.error('Could not read error response');
          }
          
          continue; // Skip this query but continue with others
        }

        const data = await response.json();
        console.log(`Brave Search API search completed for: ${query}`);
        
        // FIXED: Check for proper response structure
        if (!data.web || !data.web.results || data.web.results.length === 0) {
          console.warn(`No search results found for query: ${query}`);
          continue;
        }

        const results = extractSongsFromBraveResults(data, query);
        
        // Cache results
        cache.set(cacheKey, results);
        setTimeout(() => cache.delete(cacheKey), EMBEDDING_CONFIG.cacheDuration);
        
        allResults.push(...results);
        
        // FIXED: Add delay between requests to avoid rate limiting
        if (searchQueries.indexOf(query) < searchQueries.length - 1) {
          await new Promise(resolve => setTimeout(resolve, 200));
        }
        
      } catch (fetchError) {
        console.error(`Request failed for query "${query}":`, fetchError.message);
        continue;
      }
    }

    console.log(`Total songs extracted from Brave Search: ${allResults.length}`);
    return allResults;

  } catch (err) {
    console.error("Brave Search failed with error:", err.message);
    return [];
  }
}

// FIXED: Enhanced extraction with better validation
function extractSongsFromBraveResults(data, query) {
  const songs = [];
  const seenSongs = new Set();
  
  // FIXED: Better null checking
  const results = data?.web?.results || [];
  
  results.forEach((result, index) => {
    if (!result) return;
    
    const title = result.title || '';
    const description = result.description || '';
    const content = `${title}\n${description}`;
    
    // FIXED: Better content filtering
    if (content.includes('wikipedia') || content.includes('imdb') || 
        content.includes('reddit.com') || content.length > 1000) {
      return;
    }
    
    // Enhanced patterns for song extraction
    const patterns = [
      /"([^"]+)"\s*(?:by|–|-|from)\s*([^,\n\r.]+)/gi,
      /^(\d+\.\s*)?([^–\-]+)\s*[–\-]\s*([^,\n\r.]+)/gm,
      /(?:^|\n)([^:]+):\s*"?([^"\n]+)"?/g,
      /\b([A-Z][^–\-\n]{2,})\s*[–\-]\s*([A-Z][^,\n]{2,})/g
    ];
    
    patterns.forEach(pattern => {
      let match;
      while ((match = pattern.exec(content)) !== null && songs.length < 30) {
        let songTitle, artistName;
        
        if (match.length === 4) {
          songTitle = match[2]?.trim();
          artistName = match[3]?.trim();
        } else {
          songTitle = match[1]?.trim();
          artistName = match[2]?.trim();
        }
        
        // FIXED: Better validation
        if (!songTitle || !artistName) continue;
        
        // Clean up
        songTitle = songTitle.replace(/^\d+\.\s*/, '').replace(/["""]/g, '').trim();
        artistName = artistName.replace(/["""]/g, '').trim();
        
        // FIXED: Enhanced validation
        if (songTitle.length > 2 && songTitle.length < 100 &&
            artistName.length > 2 && artistName.length < 80 &&
            !songTitle.includes('http') && !artistName.includes('http') &&
            !songTitle.includes('...') && !artistName.includes('...') &&
            !/^\d+$/.test(songTitle) && !/^\d+$/.test(artistName)) {
          
          const songKey = `${songTitle.toLowerCase()}_${artistName.toLowerCase()}`;
          if (!seenSongs.has(songKey)) {
            seenSongs.add(songKey);
            songs.push({
              title: songTitle,
              artist: artistName,
              source: 'brave_search',
              sourceUrl: result.url,
              confidence: 0.7,
              query: query // Track which query found this
            });
          }
        }
      }
    });
  });
  
  console.log(`Extracted ${songs.length} songs from query: ${query}`);
  return songs.slice(0, 25);
}

// ENHANCED AI GENERATION WITH CULTURAL AWARENESS
async function generateAIRecommendationsWithOpenAI(refinedPrompt, constraints, culturalContext, progressTracker) {
  try {
    const culturalInstructions = culturalContext ? `
IMPORTANT: The user has specified ${culturalContext.language || culturalContext.culture} preferences.
- Focus on ${culturalContext.language} language songs if language was specified
- Include artists from ${culturalContext.region || culturalContext.culture} if culture was specified
- Use these keywords as guides: ${culturalContext.keywords?.join(', ')}` : '';

    const response = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        {
          role: "system",
          content: `You are a music expert. Generate song recommendations that EXACTLY match the user's request.
${culturalInstructions}

Rules:
1. If a specific artist is mentioned, include ONLY their songs
2. If a genre/mood is specified, match it precisely
3. If a count is specified, return EXACTLY that many songs
4. Include mix of popular hits and quality deep cuts
5. Ensure cultural/language preferences are respected

Return ONLY a JSON array of songs with these fields:
{
  "title": "exact song title",
  "artist": "exact artist name",
  "album": "album name",
  "year": year as number,
  "genre": "specific genre",
  "match_reason": "why this perfectly matches",
  "popularity_score": 1-10,
  "cultural_relevance": true/false
}`
        },
        {
          role: "user",
          content: `Generate ${constraints.targetCount || 15} songs for: "${refinedPrompt}"
          
Constraints: ${JSON.stringify(constraints)}`
        }
      ],
      temperature: 0.3,
      max_tokens: 3000,
    });

    const content = response.choices[0]?.message?.content || "";
    const songs = JSON.parse(content.replace(/```json|```/g, '').trim());
    
    return Array.isArray(songs) ? songs.map(song => ({
      ...song,
      source: 'ai_generation',
      confidence: 0.9
    })) : [];

  } catch (err) {
    console.error("AI generation failed:", err);
    return generateFallbackSongs(refinedPrompt, constraints);
  }
}

// SMART DEDUPLICATION WITH AI PREFERENCE
function smartDeduplicate(webResults, aiResults, analysis) {
  const songMap = new Map();
  
  // First add AI results (higher priority)
  aiResults.forEach(song => {
    const key = `${song.title?.toLowerCase()}_${song.artist?.toLowerCase()}`.replace(/[^a-z0-9]/g, '');
    songMap.set(key, { ...song, priority: 2 });
  });
  
  // Then add web results (lower priority)
  webResults.forEach(song => {
    const key = `${song.title?.toLowerCase()}_${song.artist?.toLowerCase()}`.replace(/[^a-z0-9]/g, '');
    if (!songMap.has(key)) {
      songMap.set(key, { ...song, priority: 1 });
    }
  });
  
  return Array.from(songMap.values());
}

// FAST SEMANTIC RANKING WITHOUT EMBEDDINGS FOR ALL
async function fastSemanticRanking(songs, originalEmbedding, keywords, progressTracker) {
  // Quick keyword-based scoring for initial ranking
  const keywordLower = keywords.map(k => k.toLowerCase());
  
  const scoredSongs = songs.map(song => {
    let score = song.priority || 1; // Base score from source
    
    // Keyword matching
    const songText = `${song.title} ${song.artist} ${song.genre || ''} ${song.match_reason || ''}`.toLowerCase();
    keywordLower.forEach(keyword => {
      if (songText.includes(keyword)) score += 0.5;
    });
    
    // Boost for AI-generated songs
    if (song.source === 'ai_generation') score += 1;
    
    // Boost for high confidence
    if (song.confidence > 0.8) score += 0.5;
    
    // Cultural relevance boost
    if (song.cultural_relevance) score += 0.7;
    
    return { ...song, relevance_score: score };
  });
  
  // Sort by score
  scoredSongs.sort((a, b) => b.relevance_score - a.relevance_score);
  
  // Calculate embeddings only for top candidates
  if (originalEmbedding && scoredSongs.length > 0) {
    const topCandidates = scoredSongs.slice(0, 15);
    const embeddings = await calculateBatchEmbeddings(topCandidates);
    
    topCandidates.forEach((song, i) => {
      if (embeddings[i]) {
        song.semantic_score = cosineSimilarity(originalEmbedding, embeddings[i]);
        song.final_score = (song.relevance_score * 0.6) + (song.semantic_score * 0.4);
      }
    });
    
    // Re-sort by final score
    topCandidates.sort((a, b) => (b.final_score || b.relevance_score) - (a.final_score || a.relevance_score));
    
    return [...topCandidates, ...scoredSongs.slice(15)];
  }
  
  return scoredSongs;
}

// QUICK ALIGNMENT CHECK
async function quickAlignmentCheck(songs, originalPrompt, analysis, progressTracker) {
  // Fast rule-based filtering instead of another AI call
  const aligned = songs.filter(song => {
    // Check artist constraint
    if (analysis.constraints.specificArtist) {
      const artistMatch = song.artist.toLowerCase().includes(analysis.constraints.specificArtist.toLowerCase());
      if (!artistMatch) return false;
    }
    
    // Check decade constraint
    if (analysis.constraints.decade && song.year) {
      const decade = Math.floor(song.year / 10) * 10;
      const targetDecade = parseInt(analysis.constraints.decade);
      if (Math.abs(decade - targetDecade) > 10) return false;
    }
    
    // Check language/cultural constraint
    if (analysis.culturalContext?.language) {
      const hasLanguageKeyword = analysis.culturalContext.keywords.some(keyword => 
        song.title.toLowerCase().includes(keyword.toLowerCase()) ||
        song.artist.toLowerCase().includes(keyword.toLowerCase())
      );
      if (!hasLanguageKeyword && song.source !== 'ai_generation') return false;
    }
    
    // Pass songs with high scores
    return (song.final_score || song.relevance_score || 0) > 0.5;
  });
  
  return aligned;
}

// PARALLEL SPOTIFY SEARCH
async function parallelSpotifySearch(songs, token, progressTracker) {
  const results = [];
  const batchSize = 5;
  
  for (let i = 0; i < songs.length; i += batchSize) {
    const batch = songs.slice(i, i + batchSize);
    
    if (progressTracker) {
      await progressTracker.updateStep('spotify_search', 'active', 
        `Searching Spotify: ${results.length}/${songs.length} found`);
    }
    
    const batchPromises = batch.map(song => 
      searchSingleTrackOptimized(song, token).catch(err => {
        console.error(`Spotify search failed for ${song.title}:`, err);
        return null;
      })
    );
    
    const batchResults = await Promise.all(batchPromises);
    results.push(...batchResults.filter(Boolean));
    
    // Avoid rate limits
    if (i + batchSize < songs.length) {
      await new Promise(r => setTimeout(r, 100));
    }
  }
  
  return results;
}

// OPTIMIZED SINGLE TRACK SEARCH
async function searchSingleTrackOptimized(song, token) {
  // Clean search terms
  const cleanTitle = song.title.replace(/[^\w\s]/g, '').trim();
  const cleanArtist = song.artist.replace(/[^\w\s]/g, '').trim();
  
  // Try exact match first
  const exactQuery = `track:"${cleanTitle}" artist:"${cleanArtist}"`;
  
  try {
    const response = await fetchFromSpotify(
      `https://api.spotify.com/v1/search?q=${encodeURIComponent(exactQuery)}&type=track&limit=1`,
      token
    );
    
    if (response?.tracks?.items?.length > 0) {
      const track = response.tracks.items[0];
      track.classicMetadata = song;
      return track;
    }
    
    // Fallback to simple search
    const simpleQuery = `${cleanTitle} ${cleanArtist}`;
    const fallbackResponse = await fetchFromSpotify(
      `https://api.spotify.com/v1/search?q=${encodeURIComponent(simpleQuery)}&type=track&limit=3`,
      token
    );
    
    const tracks = fallbackResponse?.tracks?.items || [];
    const bestMatch = findBestTrackMatch(tracks, song);
    
    if (bestMatch) {
      bestMatch.classicMetadata = song;
      return bestMatch;
    }
    
    return null;
  } catch (err) {
    console.error(`Spotify search error for ${song.title}:`, err);
    return null;
  }
}

// UTILITY FUNCTIONS

function ensureMinimumCount(songs, constraints, prompt) {
  const target = constraints.targetCount || 10;
  const current = songs.length;
  
  if (current >= target) {
    return songs.slice(0, target);
  }
  
  // Add fallback songs
  const fallbacks = generateFallbackSongs(prompt, constraints);
  const needed = target - current;
  
  return [...songs, ...fallbacks.slice(0, needed)];
}

async function calculateBatchEmbeddings(songs) {
  try {
    const texts = songs.map(song => 
      `${song.title} ${song.artist} ${song.genre || ''}`
    );
    
    const response = await openai.embeddings.create({
      model: EMBEDDING_CONFIG.embeddingModel,
      input: texts,
    });
    
    return response.data.map(d => d.embedding);
  } catch (err) {
    console.error("Batch embedding failed:", err);
    return songs.map(() => null);
  }
}

function getFallbackAnalysis(prompt) {
  const count = extractNumberFromPrompt(prompt) || 10;
  return {
    originalIntent: prompt,
    musicalElements: ["music", "songs"],
    constraints: {
      targetCount: count,
      minCount: Math.min(count, 5)
    },
    searchQueries: [`${prompt} best songs`, `${prompt} popular music`],
    refinedPrompt: prompt,
    semanticKeywords: prompt.split(' ').filter(w => w.length > 3),
    confidenceScore: 0.5
  };
}

// Enhanced fallback songs with better variety
function generateFallbackSongs(prompt, constraints) {
  const lowerPrompt = prompt.toLowerCase();
  const count = constraints?.targetCount || 10;
  
  // Extended genre-specific fallbacks
  const genreFallbacks = {
    'korean|k-pop|kpop': [
      { title: "Dynamite", artist: "BTS", year: 2020, genre: "K-Pop" },
      { title: "How You Like That", artist: "BLACKPINK", year: 2020, genre: "K-Pop" },
      { title: "Gangnam Style", artist: "PSY", year: 2012, genre: "K-Pop" },
      { title: "LOVE SCENARIO", artist: "iKON", year: 2018, genre: "K-Pop" },
      { title: "Spring Day", artist: "BTS", year: 2017, genre: "K-Pop" },
      { title: "DDU-DU DDU-DU", artist: "BLACKPINK", year: 2018, genre: "K-Pop" },
      { title: "Fancy", artist: "TWICE", year: 2019, genre: "K-Pop" },
      { title: "God's Menu", artist: "Stray Kids", year: 2020, genre: "K-Pop" },
      { title: "Psycho", artist: "Red Velvet", year: 2019, genre: "K-Pop" },
      { title: "ON", artist: "BTS", year: 2020, genre: "K-Pop" }
    ],
    'rock': [
      { title: "Bohemian Rhapsody", artist: "Queen", year: 1975, genre: "Rock" },
      { title: "Hotel California", artist: "Eagles", year: 1976, genre: "Rock" },
      { title: "Stairway to Heaven", artist: "Led Zeppelin", year: 1971, genre: "Rock" },
      { title: "Sweet Child O' Mine", artist: "Guns N' Roses", year: 1987, genre: "Rock" },
      { title: "Smells Like Teen Spirit", artist: "Nirvana", year: 1991, genre: "Rock" },
      { title: "Dream On", artist: "Aerosmith", year: 1973, genre: "Rock" },
      { title: "November Rain", artist: "Guns N' Roses", year: 1991, genre: "Rock" },
      { title: "Free Bird", artist: "Lynyrd Skynyrd", year: 1973, genre: "Rock" },
      { title: "Paradise City", artist: "Guns N' Roses", year: 1987, genre: "Rock" },
      { title: "Born to Be Wild", artist: "Steppenwolf", year: 1968, genre: "Rock" }
    ],
    'pop': [
      { title: "Billie Jean", artist: "Michael Jackson", year: 1982, genre: "Pop" },
      { title: "Like a Prayer", artist: "Madonna", year: 1989, genre: "Pop" },
      { title: "I Want It That Way", artist: "Backstreet Boys", year: 1999, genre: "Pop" },
      { title: "Toxic", artist: "Britney Spears", year: 2003, genre: "Pop" },
      { title: "Rolling in the Deep", artist: "Adele", year: 2010, genre: "Pop" },
      { title: "Shape of You", artist: "Ed Sheeran", year: 2017, genre: "Pop" },
      { title: "Uptown Funk", artist: "Mark Ronson ft. Bruno Mars", year: 2014, genre: "Pop" },
      { title: "Can't Stop the Feeling!", artist: "Justin Timberlake", year: 2016, genre: "Pop" },
      { title: "Havana", artist: "Camila Cabello", year: 2017, genre: "Pop" },
      { title: "Blinding Lights", artist: "The Weeknd", year: 2019, genre: "Pop" }
    ]
  };
  
  // Find matching genre
  for (const [pattern, songs] of Object.entries(genreFallbacks)) {
    if (new RegExp(pattern, 'i').test(lowerPrompt)) {
      return songs.slice(0, count).map(song => ({
        ...song,
        match_reason: `Classic ${song.genre} recommendation`,
        source: 'fallback'
      }));
    }
  }
  
  // Default classics
  const defaultClassics = [
    { title: "Imagine", artist: "John Lennon", year: 1971, genre: "Pop" },
    { title: "What's Going On", artist: "Marvin Gaye", year: 1971, genre: "Soul" },
    { title: "Respect", artist: "Aretha Franklin", year: 1967, genre: "Soul" },
    { title: "Yesterday", artist: "The Beatles", year: 1965, genre: "Pop" },
    { title: "My Way", artist: "Frank Sinatra", year: 1969, genre: "Traditional Pop" },
    { title: "I Will Always Love You", artist: "Whitney Houston", year: 1992, genre: "Pop" },
    { title: "Don't Stop Believin'", artist: "Journey", year: 1981, genre: "Rock" },
    { title: "Dancing Queen", artist: "ABBA", year: 1976, genre: "Pop" },
    { title: "Wonderwall", artist: "Oasis", year: 1995, genre: "Rock" },
    { title: "Hey Jude", artist: "The Beatles", year: 1968, genre: "Pop" }
  ];
  
  return defaultClassics.slice(0, count).map(song => ({
    ...song,
    match_reason: "Classic timeless recommendation",
    source: 'fallback'
  }));
}

// Keep existing utility functions
function cosineSimilarity(vecA, vecB) {
  if (!vecA || !vecB) return 0;
  const dotProduct = vecA.reduce((sum, a, i) => sum + a * vecB[i], 0);
  const magnitudeA = Math.sqrt(vecA.reduce((sum, a) => sum + a * a, 0));
  const magnitudeB = Math.sqrt(vecB.reduce((sum, b) => sum + b * b, 0));
  return dotProduct / (magnitudeA * magnitudeB);
}

function extractNumberFromPrompt(prompt) {
  const match = prompt.match(/\b(\d+)\b/);
  return match ? parseInt(match[1]) : null;
}

function findBestTrackMatch(tracks, targetSong) {
  if (!tracks.length) return null;

  const scoredTracks = tracks.map(track => {
    const titleSim = calculateStringSimilarity(track.name.toLowerCase(), targetSong.title.toLowerCase());
    const artistSim = Math.max(...track.artists.map(artist => 
      calculateStringSimilarity(artist.name.toLowerCase(), targetSong.artist.toLowerCase())
    ));
    
    return {
      track,
      score: (titleSim * 0.6) + (artistSim * 0.4)
    };
  });

  scoredTracks.sort((a, b) => b.score - a.score);
  return scoredTracks[0].score > 0.5 ? scoredTracks[0].track : tracks[0];
}

function calculateStringSimilarity(str1, str2) {
  const longer = str1.length > str2.length ? str1 : str2;
  const shorter = str1.length > str2.length ? str2 : str1;
  
  if (longer.length === 0) return 1.0;
  
  const distance = levenshteinDistance(longer, shorter);
  return (longer.length - distance) / longer.length;
}

function levenshteinDistance(str1, str2) {
  const matrix = [];
  
  for (let i = 0; i <= str2.length; i++) {
    matrix[i] = [i];
  }
  
  for (let j = 0; j <= str1.length; j++) {
    matrix[0][j] = j;
  }
  
  for (let i = 1; i <= str2.length; i++) {
    for (let j = 1; j <= str1.length; j++) {
      if (str2.charAt(i - 1) === str1.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1,
          matrix[i][j - 1] + 1,
          matrix[i - 1][j] + 1
        );
      }
    }
  }
  
  return matrix[str2.length][str1.length];
}

import OpenAI from "openai";
import { fetchFromSpotify } from './spotifyHelpers.js';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const SERPAPI_KEY = process.env.SERPAPI_KEY;

// CONFIGURATION: Make the filtering configurable
const EMBEDDING_CONFIG = {
  maxCandidatesForEmbedding: 30,  // Maximum songs to embed
  preFilteringEnabled: true,      // Enable basic scoring before embedding
  embeddingModel: "text-embedding-3-small"
};

// MAIN ENHANCED FUNCTION
export async function generateClassicRecommendations(prompt, token) {
  try {
    console.log("=== ENHANCED CLASSIC RECOMMENDATION WORKFLOW ===");
    console.log("Original prompt:", prompt);

    // Step 1: Analyze user's prompt and generate refined search queries
    const analysisResult = await analyzeUserPrompt(prompt);
    console.log("Prompt analysis completed:", analysisResult);

    // Step 2: Search Google using SerpAPI with refined queries
    const webResults = await searchWithSerpAPI(analysisResult.searchQueries);
    console.log(`Web search completed: ${webResults.length} results`);

    // Step 3: Generate AI recommendations using refined prompt
    const aiResults = await generateAIRecommendations(analysisResult.refinedPrompt, analysisResult.constraints);
    console.log(`AI generation completed: ${aiResults.length} results`);

    // Step 4: Combine results and verify alignment using semantic similarity (OPTIMIZED)
    const alignedSongs = await combineAndVerifyAlignmentEnhanced(
      webResults, 
      aiResults, 
      prompt, 
      analysisResult.originalEmbedding,
      analysisResult.constraints
    );
    console.log(`Alignment verification completed: ${alignedSongs.length} aligned songs`);

    if (alignedSongs.length < analysisResult.constraints.minCount) {
      throw new Error(`Not enough quality results: found ${alignedSongs.length}, need ${analysisResult.constraints.minCount}`);
    }

    // Step 5: Search on Spotify and create final playlist
    const spotifyTracks = await searchTracksOnSpotify(
      alignedSongs.slice(0, Math.max(analysisResult.constraints.targetCount, 20)), 
      token
    );
    
    console.log(`Final playlist created: ${spotifyTracks.length} tracks`);
    return spotifyTracks;

  } catch (err) {
    console.error("Enhanced workflow failed:", err.message);
    return [];
  }
}

// STEP 1: ANALYZE USER PROMPT WITH ADVANCED PROMPT ENGINEERING
async function analyzeUserPrompt(prompt) {
  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4",
      messages: [
        {
          role: "system",
          content: `You are an expert music analyst and search query optimizer. Your task is to:
1. Extract key musical elements (genre, mood, era, artist, themes)
2. Identify specific constraints (count, decade, specific artists, style preferences)
3. Generate optimized search queries for finding songs
4. Create a refined prompt for AI song generation

Return a JSON object with:
- originalIntent: Brief summary of user's request
- musicalElements: Array of key elements (genre, mood, era, themes, album, artist)
- constraints: Object with {targetCount, minCount, decade, specificArtist, mood}
- searchQueries: Array of 2~3 best Google search queries
- refinedPrompt: Enhanced prompt for AI generation
- semanticKeywords: Array of keywords for similarity matching`
        },
        {
          role: "user",
          content: `Analyze this music request and optimize it for search: "${prompt}"`
        }
      ],
      temperature: 0.3,
      max_tokens: 1000,
    });

    const content = response.choices[0]?.message?.content || "";
    const jsonStr = content.replace(/```json|```/g, '').trim();
    const analysis = JSON.parse(jsonStr);

    // Generate embedding for semantic similarity
    const embeddingResponse = await openai.embeddings.create({
      model: EMBEDDING_CONFIG.embeddingModel,
      input: `${prompt} ${analysis.semanticKeywords?.join(' ') || ''}`,
    });

    return {
      ...analysis,
      originalEmbedding: embeddingResponse.data[0].embedding
    };

  } catch (err) {
    console.error("Prompt analysis failed:", err.message);
    
    // Fallback analysis
    const fallbackCount = extractNumberFromPrompt(prompt) || 10;
    return {
      originalIntent: prompt,
      musicalElements: ["classic", "popular"],
      constraints: { 
        targetCount: fallbackCount, 
        minCount: Math.min(fallbackCount, 5),
        decade: null,
        specificArtist: null,
        mood: "balanced"
      },
      searchQueries: [`"${prompt}" songs`, `${prompt} music`],
      refinedPrompt: `Find songs that match: ${prompt}`,
      semanticKeywords: prompt.split(' '),
      originalEmbedding: null
    };
  }
}

// STEP 2: ENHANCED WEB SEARCH WITH SERPAPI (removed node-fetch dependency)
async function searchWithSerpAPI(searchQueries) {
  if (!SERPAPI_KEY) {
    console.warn("SerpAPI key not found, returning empty results");
    return [];
  }

  try {
    const allResults = [];
    
    for (const query of searchQueries) {
      console.log(`Searching: ${query}`);
      
      const response = await fetch(`https://serpapi.com/search.json?` + new URLSearchParams({
        q: query,
        engine: 'google',
        api_key: SERPAPI_KEY,
        num: 10
      }));

      if (!response.ok) continue;

      const data = await response.json();
      const results = extractSongsFromSerpResults(data, query);
      allResults.push(...results);
      
      // Rate limiting
      await new Promise(r => setTimeout(r, 1000));
    }

    return removeDuplicateSongs(allResults);

  } catch (err) {
    console.error("SerpAPI search failed:", err.message);
    return [];
  }
}

function extractSongsFromSerpResults(data, originalQuery) {
  const songs = [];
  
  // Extract from organic results
  data.organic_results?.forEach(result => {
    const title = result.title || '';
    const snippet = result.snippet || '';
    
    // Pattern matching for song titles
    const patterns = [
      /[""](.+?)[""] by (.+?)(?:\s|$|,|\.|;)/gi,
      /(.+?) - (.+?)(?:\s|$|,|\.|;)/gi,
      /(.+?) by (.+?)(?:\s|$|,|\.|;)/gi,
    ];

    patterns.forEach(pattern => {
      let match;
      const text = `${title} ${snippet}`;
      while ((match = pattern.exec(text)) !== null) {
        if (match[1] && match[2]) {
          songs.push({
            title: match[1].trim(),
            artist: match[2].trim(),
            source: 'serp_organic',
            sourceUrl: result.link,
            reason: `Found via Google search: "${originalQuery}"`,
            year: extractYear(text),
            genre: "Classic"
          });
        }
      }
    });
  });

  // Extract from knowledge graph if available
  if (data.knowledge_graph?.songs) {
    data.knowledge_graph.songs.forEach(song => {
      songs.push({
        title: song.name,
        artist: song.artists?.[0] || "Unknown",
        source: 'knowledge_graph',
        reason: `From Google Knowledge Graph`,
        year: song.year,
        genre: "Classic"
      });
    });
  }

  return songs;
}

// STEP 3: ENHANCED AI GENERATION WITH BETTER PROMPTING
async function generateAIRecommendations(refinedPrompt, constraints) {
  try {
    const systemPrompt = `You are a world-renowned music curator. Your expertise spans all genres and eras, from the 1940s to today.

Your role:
- Select songs that perfectly align with user requests, whether they want specific artists, genres, themes, or eras.
- Explain clearly why each song fits the request, including cultural or historical significance.
- If the user requests a specific artist, focus on that artist's best songs that match the theme.
- If the user requests a specific genre/theme/era, include the most representative and high-quality songs.

For each song, return an object with the following fields:
- title
- artist
- album
- year
- genre
- match_reason (why it matches the user's request)
- cultural_impact_score (1–10, based on legacy, innovation, and recognition)

Follow the user's intent exactly - if they want a specific artist, focus on that artist. If they want a genre/theme, find the best songs in that category.`;

    const response = await openai.chat.completions.create({
      model: "gpt-4",
      messages: [
        { role: "system", content: systemPrompt },
        { 
          role: "user", 
          content: `Refined user request: "${refinedPrompt}"

Constraints:
- Target count: ${constraints.targetCount || 20}
- Decade preference: ${constraints.decade || "any"}
- Specific artist: ${constraints.specificArtist || "none"}
- Mood/theme: ${constraints.mood || "balanced"}

Find songs that strongly align with the user's exact request. If they specified an artist, focus on that artist. If they specified a genre/theme/era, find the best representative songs.

Return as a JSON array. Do not include any preamble or explanation.` 
        }
      ],
      temperature: 0.7,
      max_tokens: 2500,
    });

    const content = response.choices[0]?.message?.content || "";
    const jsonStr = content.replace(/```json|```/g, '').trim();
    const parsed = JSON.parse(jsonStr);
    
    return Array.isArray(parsed) ? parsed.map(song => ({
      ...song,
      source: 'ai_generation'
    })) : [];

  } catch (err) {
    console.error("AI generation failed:", err.message);
    return [];
  }
}

// STEP 4: ENHANCED OPTIMIZED ALIGNMENT WITH PRE-FILTERING
async function combineAndVerifyAlignmentEnhanced(webResults, aiResults, originalPrompt, originalEmbedding, constraints) {
  try {
    const allSongs = removeDuplicateSongs([...webResults, ...aiResults]);
    
    if (allSongs.length === 0) return [];

    let finalCandidates = allSongs;

    // STEP 1: Pre-filtering with basic scoring (if enabled)
    if (EMBEDDING_CONFIG.preFilteringEnabled) {
      const scoredSongs = allSongs.map(song => {
        let score = 0;
        
        // Prefer AI-generated results (usually higher quality)
        if (song.source === 'ai_generation') score += 3;
        else if (song.source === 'knowledge_graph') score += 2;
        else if (song.source === 'serp_organic') score += 1;
        
        // Prefer songs with year information
        if (song.year && song.year >= 1940 && song.year <= 2024) score += 2;
        else if (song.year) score += 1;
        
        // Prefer songs with genre classification
        if (song.genre && song.genre !== "Classic") score += 1;
        
        // Prefer songs with detailed reasoning/significance
        if (song.reason && song.reason.length > 20) score += 1;
        if (song.significance && song.significance.length > 20) score += 1;
        if (song.match_reason && song.match_reason.length > 20) score += 1;
        
        // Cultural impact score bonus
        if (song.cultural_impact_score && song.cultural_impact_score >= 7) score += 2;
        else if (song.cultural_impact_score && song.cultural_impact_score >= 5) score += 1;
        
        // Keyword matching in title/artist (basic relevance)
        const searchTerms = originalPrompt.toLowerCase().split(' ').filter(term => term.length > 2);
        const songText = `${song.title} ${song.artist} ${song.genre || ''}`.toLowerCase();
        const keywordMatches = searchTerms.filter(term => songText.includes(term)).length;
        score += keywordMatches * 0.5;
        
        // Penalize songs without proper title/artist
        if (!song.title || song.title.length < 2) score -= 2;
        if (!song.artist || song.artist.length < 2) score -= 2;
        
        return { ...song, basicScore: score };
      });

      // Sort by basic score and take top candidates
      finalCandidates = scoredSongs
        .sort((a, b) => b.basicScore - a.basicScore)
        .slice(0, EMBEDDING_CONFIG.maxCandidatesForEmbedding);
      
      console.log(`Pre-filtered from ${allSongs.length} to ${finalCandidates.length} candidates using enhanced scoring`);
    } else {
      // Simple filtering without scoring
      finalCandidates = allSongs.slice(0, EMBEDDING_CONFIG.maxCandidatesForEmbedding);
      console.log(`Filtered from ${allSongs.length} to ${finalCandidates.length} candidates for embedding`);
    }

    // STEP 2: Semantic similarity only on filtered candidates
    let rankedSongs = finalCandidates;
    
    if (originalEmbedding && finalCandidates.length > 0) {
      console.log("Calculating semantic similarity for filtered candidates...");
      rankedSongs = await rankSongsBySementicSimilarity(finalCandidates, originalEmbedding, originalPrompt);
    }

    // STEP 3: AI verification with reduced payload
    const verificationPrompt = `
    You are a music quality controller. Your job is to **verify** that each suggested song genuinely fits the user's original request.
    
    Instructions:
    1. Review the original user request carefully: "${originalPrompt}"
    2. For each song, assess:
       - Does it match the tone, theme, mood, artist, or topic of the request?
    3. If the user requested a specific artist, prioritize songs from that artist.
    4. If the user requested a specific genre/theme/era, prioritize the most representative songs.
    5. Eliminate any that are weak matches, off-topic, or lack quality.
    6. Assign an alignment_score from 1 to 10 for how well each song matches the request.
    7. Return only the top ${constraints.targetCount || 15} songs with the highest scores.
    
    Output format: JSON array.
    Each object must include all original song fields, with an added field:
    - alignment_score (1–10)
    
    Return only the JSON array. No explanations, commentary, or markdown.
    `;

    const response = await openai.chat.completions.create({
      model: "gpt-4",
      messages: [
        { role: "system", content: verificationPrompt },
        { 
          role: "user", 
          content: `Original request: "${originalPrompt}"

Songs to verify (already pre-filtered for quality):
${JSON.stringify(rankedSongs, null, 2)}`
        }
      ],
      temperature: 0.2,
      max_tokens: 3000,
    });

    const content = response.choices[0]?.message?.content || "";
    const jsonStr = content.replace(/```json|```/g, '').trim();
    const verified = JSON.parse(jsonStr);
    
    return Array.isArray(verified) ? verified : rankedSongs.slice(0, constraints.targetCount || 15);

  } catch (err) {
    console.error("Enhanced alignment verification failed:", err.message);
    return allSongs.slice(0, constraints.targetCount || 15);
  }
}

// OPTIMIZED SEMANTIC SIMILARITY RANKING - Only for filtered candidates
async function rankSongsBySementicSimilarity(filteredSongs, originalEmbedding, originalPrompt) {
  try {
    console.log(`Generating embeddings for ${filteredSongs.length} filtered songs`);
    
    const songTexts = filteredSongs.map(song => 
      `${song.title} by ${song.artist} ${song.genre || ''} ${song.reason || ''} ${song.significance || ''} ${song.match_reason || ''}`
    );

    // Now we're only embedding the filtered candidates, not hundreds of songs
    const embeddingResponse = await openai.embeddings.create({
      model: EMBEDDING_CONFIG.embeddingModel,
      input: songTexts,
    });

    const songEmbeddings = embeddingResponse.data;

    // Calculate cosine similarity
    const songsWithSimilarity = filteredSongs.map((song, index) => {
      const similarity = cosineSimilarity(originalEmbedding, songEmbeddings[index].embedding);
      return {
        ...song,
        similarity_score: similarity
      };
    });

    // Sort by similarity score (descending)
    return songsWithSimilarity.sort((a, b) => b.similarity_score - a.similarity_score);

  } catch (err) {
    console.error("Semantic ranking failed:", err.message);
    return filteredSongs;
  }
}

// SPOTIFY SEARCH (Enhanced) - No changes needed here
async function searchTracksOnSpotify(songs, token) {
  const results = [];
  const maxConcurrent = 5;

  for (let i = 0; i < songs.length; i += maxConcurrent) {
    const batch = songs.slice(i, i + maxConcurrent);
    
    const batchPromises = batch.map(async (song) => {
      try {
        // Multiple search strategies
        const searchStrategies = [
          `track:"${song.title}" artist:"${song.artist}"`,
          `"${song.title}" "${song.artist}"`,
          `${song.title} ${song.artist}`
        ];

        for (const query of searchStrategies) {
          const response = await fetchFromSpotify(
            `https://api.spotify.com/v1/search?q=${encodeURIComponent(query)}&type=track&limit=3`,
            token
          );

          const tracks = response?.tracks?.items || [];
          const bestMatch = findBestTrackMatch(tracks, song);
          
          if (bestMatch) {
            bestMatch.classicMetadata = {
              ...song,
              search_strategy: query
            };
            return bestMatch;
          }
        }

        console.warn(`No Spotify match found for: ${song.title} by ${song.artist}`);
        return null;

      } catch (err) {
        console.error(`Spotify search failed for ${song.title}:`, err.message);
        return null;
      }
    });

    const batchResults = await Promise.all(batchPromises);
    results.push(...batchResults.filter(Boolean));

    // Rate limiting
    await new Promise(r => setTimeout(r, 200));
  }

  return results;
}

function findBestTrackMatch(tracks, targetSong) {
  if (!tracks.length) return null;

  // Score each track based on title and artist similarity
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
  
  // Return best match if score is reasonable
  return scoredTracks[0].score > 0.6 ? scoredTracks[0].track : tracks[0];
}

// UTILITY FUNCTIONS
function cosineSimilarity(vecA, vecB) {
  const dotProduct = vecA.reduce((sum, a, i) => sum + a * vecB[i], 0);
  const magnitudeA = Math.sqrt(vecA.reduce((sum, a) => sum + a * a, 0));
  const magnitudeB = Math.sqrt(vecB.reduce((sum, b) => sum + b * b, 0));
  return dotProduct / (magnitudeA * magnitudeB);
}

function removeDuplicateSongs(songs) {
  const unique = {};
  songs.forEach(song => {
    const key = `${song.title?.toLowerCase().trim()}-${song.artist?.toLowerCase().trim()}`;
    if (!unique[key] || (song.source === 'ai_generation' && unique[key].source !== 'ai_generation')) {
      unique[key] = song;
    }
  });
  return Object.values(unique);
}

function extractNumberFromPrompt(prompt) {
  const match = prompt.match(/\b(\d+)\b/);
  return match ? parseInt(match[1]) : null;
}

function extractYear(text) {
  const yearMatch = text.match(/\b(19[4-9]\d|20[0-2]\d)\b/);
  return yearMatch ? parseInt(yearMatch[1]) : null;
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
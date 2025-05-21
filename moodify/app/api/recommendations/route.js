import { NextResponse } from 'next/server';
import OpenAI from "openai";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// Spotify credentials
const SPOTIFY_CLIENT_ID = process.env.SPOTIFY_CLIENT_ID;
const SPOTIFY_CLIENT_SECRET = process.env.SPOTIFY_CLIENT_SECRET;
const SPOTIFY_REDIRECT_URI = process.env.SPOTIFY_REDIRECT_URI;

async function fetchFromSpotify(url, token) {
  try {
    console.log("Fetching from Spotify:", url);
    const response = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      }
    });

    if (!response.ok) {
      // For debugging
      console.warn(`Spotify API warning (${response.status}): ${url}`);
      
      if (response.status === 404) {
        // Return empty object for 404
        return { tracks: [] };
      }
      
      // Try to parse error
      try {
        const errorData = await response.json();
        throw new Error(`Spotify API error: ${errorData.error?.message || response.statusText}`);
      } catch (e) {
        // If parsing fails
        throw new Error(`Spotify API error: ${response.statusText}`);
      }
    }

    return await response.json();
  } catch (error) {
    console.error(`Error fetching from Spotify (${url}):`, error.message);
    throw error;
  }
}

async function analyzeMood(prompt) {
  try {
    // Use OpenAI to analyze the mood
    const response = await openai.chat.completions.create({
      model: "gpt-3.5-turbo",
      messages: [
        {
          role: "system",
          content: `You are a music expert who can analyze mood descriptions. Output ONLY a simple JSON with one property "mood" which should be a single word like: energetic, calm, melancholy, upbeat, sad, etc.`
        },
        {
          role: "user",
          content: `What mood best describes this: "${prompt}"`
        }
      ],
      temperature: 0.7,
      max_tokens: 50
    });

    const content = response.choices[0]?.message?.content || "";
    
    // Try to extract JSON
    try {
      const result = JSON.parse(content);
      return result.mood || "balanced";
    } catch (parseError) {
      // If we can't parse JSON, look for a single word
      const moodMatch = content.match(/["']?(\w+)["']?/);
      return moodMatch ? moodMatch[1] : "balanced";
    }
  } catch (error) {
    console.error('Error analyzing mood:', error);
    return "balanced";
  }
}

// Function: Evaluate if tracks match the mood/prompt
async function evaluateRecommendations(tracks, prompt, mood) {
  try {
    console.log("Evaluating recommendations for quality matching...");
    
    // Prepare track data for evaluation
    const tracksData = tracks.map(track => ({
      id: track.id,
      name: track.name,
      artists: track.artists.map(artist => artist.name).join(', '),
      popularity: track.popularity,
      album: track.album?.name || 'Unknown Album',
    }));
    
    // Send tracks and prompt to OpenAI for evaluation
    const evalResponse = await openai.chat.completions.create({
      model: "gpt-3.5-turbo",
      messages: [
        {
          role: "system",
          content: `You are a music expert evaluating how well songs match a specific mood or prompt. 
          Analyze each song and determine if it's a good match. 
          Return ONLY a JSON object with:
          1. An "evaluation" array containing objects with "id", "match_score" (0-10), and "reason"
          2. A "replacement_needed" array with the IDs of songs scoring below 6
          Example: {"evaluation":[{"id":"123","match_score":8,"reason":"Good energetic beat"}],"replacement_needed":[]}`
        },
        {
          role: "user",
          content: `User prompt: "${prompt}"
          Identified mood: "${mood}"
          
          Evaluate if these songs match the prompt/mood:
          ${JSON.stringify(tracksData, null, 2)}`
        }
      ],
      temperature: 0.5,
      max_tokens: 1000
    });

    const content = evalResponse.choices[0]?.message?.content || "";
    
    // Parse the evaluation result
    try {
      // Clean the response in case it has markdown code blocks
      const jsonStr = content.replace(/```json|```/g, '').trim();
      const result = JSON.parse(jsonStr);
      
      console.log("Evaluation complete:", result);
      return result;
    } catch (parseError) {
      console.error('Failed to parse evaluation result:', parseError);
      console.log('Raw content:', content);
      // Return empty evaluation if parsing fails
      return { evaluation: [], replacement_needed: [] };
    }
  } catch (error) {
    console.error('Error evaluating recommendations:', error);
    // Return empty evaluation if API call fails
    return { evaluation: [], replacement_needed: [] };
  }
}

// UPDATED FUNCTION: Get replacement tracks using Spotify Recommendations API
async function getReplacementTracks(token, prompt, mood, count = 5) {
  try {
    console.log(`Finding ${count} replacement tracks for mood: ${mood}`);
    
    // Map mood to audio features for better recommendations
    const moodToFeatures = {
      'energetic': 'min_energy=0.7&target_valence=0.6',
      'calm': 'max_energy=0.4&target_valence=0.5',
      'melancholy': 'max_energy=0.5&target_valence=0.3',
      'upbeat': 'min_energy=0.6&min_valence=0.6',
      'sad': 'max_energy=0.4&max_valence=0.3',
      'happy': 'min_valence=0.7',
      'focused': 'target_energy=0.5&max_valence=0.6',
      'relaxed': 'max_energy=0.4&target_valence=0.5',
      'party': 'min_energy=0.7&min_danceability=0.7',
      'romantic': 'target_energy=0.5&target_valence=0.5',
      'balanced': 'target_energy=0.5&target_valence=0.5'
    };
    
    // Map mood to genres for seed
    const moodToGenre = {
      'energetic': 'edm_dance,pop,rock',
      'calm': 'ambient,classical,chill',
      'melancholy': 'sad,indie,folk',
      'upbeat': 'happy,pop,electronic',
      'sad': 'sad,blues,indie',
      'happy': 'happy,pop,disco',
      'focused': 'study,classical,instrumental',
      'relaxed': 'chill,jazz,acoustic',
      'party': 'party,dance,electronic',
      'romantic': 'romance,r-n-b,jazz',
      'balanced': 'pop,rock,alternative'
    };
    
    const genreSeed = moodToGenre[mood.toLowerCase()] || 'pop';
    const audioFeatures = moodToFeatures[mood.toLowerCase()] || '';
    
    // First approach: Use Spotify's recommendations API with mood-based parameters
    const recResponse = await fetchFromSpotify(
      `https://api.spotify.com/v1/recommendations?seed_genres=${genreSeed}&${audioFeatures}&limit=${count}`, 
      token
    );
    
    if (recResponse && recResponse.tracks && recResponse.tracks.length > 0) {
      return recResponse.tracks;
    }
    
    // Second approach: Try a direct search if recommendations didn't work
    const searchResponse = await fetchFromSpotify(
      `https://api.spotify.com/v1/search?q=${encodeURIComponent(mood)}&type=track&limit=${count * 2}`, 
      token
    );
    
    if (searchResponse && searchResponse.tracks && searchResponse.tracks.items.length > 0) {
      // Shuffle and return requested number of tracks
      return shuffleArray(searchResponse.tracks.items).slice(0, count);
    }
    
    // If all else fails, get new releases (fallback option)
    const newReleasesResponse = await fetchFromSpotify('https://api.spotify.com/v1/browse/new-releases?limit=10', token);
    
    if (newReleasesResponse && newReleasesResponse.albums && newReleasesResponse.albums.items.length > 0) {
      // Get tracks from each album
      const tracks = [];
      
      for (const album of newReleasesResponse.albums.items) {
        if (tracks.length >= count) break;
        
        try {
          const albumTracksResponse = await fetchFromSpotify(`https://api.spotify.com/v1/albums/${album.id}/tracks?limit=1`, token);
          
          if (albumTracksResponse && albumTracksResponse.items && albumTracksResponse.items.length > 0) {
            const track = albumTracksResponse.items[0];
            // Add album info to track
            track.album = album;
            tracks.push(track);
          }
        } catch (error) {
          console.warn(`Error fetching album tracks:`, error.message);
        }
      }
      
      return tracks;
    }
    
    // If we get here, we couldn't find replacements
    return [];
  } catch (error) {
    console.error('Error getting replacement tracks:', error);
    return [];
  }
}

// Helper function: Extract songs from AI response
function extractSongsFromAIResponse(text) {
  const songs = [];
  // Look for patterns like "1. Song Name by Artist" or "- Song Name by Artist"
  const lines = text.split('\n');
  
  for (const line of lines) {
    const match = line.match(/(?:^\d+\.|\-)\s*(.*?)\s*by\s*(.*?)(?:$|\.|\()/i);
    if (match) {
      songs.push({
        name: match[1].trim(),
        artist: match[2].trim()
      });
    }
  }
  
  return songs;
}

// Helper function: Search multiple tracks on Spotify
async function searchMultipleTracksOnSpotify(tracks, token) {
  const results = [];
  
  for (const track of tracks) {
    if (results.length >= 10) break; // Limit to 10 tracks
    
    try {
      const query = `track:${encodeURIComponent(track.name)} artist:${encodeURIComponent(track.artist)}`;
      const searchResponse = await fetchFromSpotify(
        `https://api.spotify.com/v1/search?q=${query}&type=track&limit=1`, 
        token
      );
      
      if (searchResponse && searchResponse.tracks && searchResponse.tracks.items.length > 0) {
        results.push(searchResponse.tracks.items[0]);
      }
    } catch (error) {
      console.warn(`Error searching for track ${track.name}:`, error.message);
    }
  }
  
  return results;
}

export async function POST(request) {
  try {
    const body = await request.json();
    const { 
      prompt, 
      token, 
      seedTracks = [], 
      customStory = "", 
      createPlaylistFlag = false, 
      playlistName = "", 
      manualTracks = [],
      recommendationType = "mood", // Default "mood"
      outputFormat = "track",      // Default "track"
      qualityCheck = true          // Parameter to toggle quality checking
    } = body;

    
    // Handle playlist creation if that's what we're doing
    if (createPlaylistFlag && manualTracks && manualTracks.length > 0) {
      return await createSpotifyPlaylist(token, playlistName, manualTracks, customStory);
    }

    // Validate required data
    if (!token) {
      return NextResponse.json({ error: 'Spotify access token is required' }, { status: 400 });
    }

    // For creating recommendations, we need a prompt
    if (!createPlaylistFlag && !prompt) {
      return NextResponse.json({ error: 'Prompt is required' }, { status: 400 });
    }

    // Step 1: Analyze the mood from prompt (skip for classic recommendation type)
    let mood = "balanced";
    if (recommendationType !== "classic") {
      mood = await analyzeMood(prompt);
      console.log("Mood analysis:", mood);
    } else {
      console.log("Skipping mood analysis for classic recommendation type, using prompt directly");
      // For classic type, we'll use the prompt directly without mood analysis
    }

    let recommendations = [];
    
    // Step 2: Get recommendations based on type
    if (recommendationType === "mood") {
      try {
        console.log("Fetching user's library tracks...");
        const timeRanges = ['medium_term', 'short_term', 'long_term'];
        let allTopTracks = [];
        
        // Try to get tracks from each time range
        for (const timeRange of timeRanges) {
          try {
            console.log(`Fetching top tracks for ${timeRange}...`);
            const topTracksResponse = await fetchFromSpotify(
              `https://api.spotify.com/v1/me/top/tracks?time_range=${timeRange}&limit=50`, 
              token
            );
            
            if (topTracksResponse && topTracksResponse.items && topTracksResponse.items.length > 0) {
              console.log(`Found ${topTracksResponse.items.length} tracks from ${timeRange}`);
              allTopTracks.push(...topTracksResponse.items);
            }
          } catch (error) {
            console.warn(`Error fetching top tracks for ${timeRange}:`, error.message);
          }
        }
        
        // Get recently played tracks
        try {
          console.log("Fetching recently played tracks...");
          const recentlyPlayedResponse = await fetchFromSpotify(
            'https://api.spotify.com/v1/me/player/recently-played?limit=50',
            token
          );
          
          if (recentlyPlayedResponse && recentlyPlayedResponse.items) {
            console.log(`Found ${recentlyPlayedResponse.items.length} recently played tracks`);
            // Add each track from recently played
            allTopTracks.push(...recentlyPlayedResponse.items.map(item => item.track));
          }
        } catch (error) {
          console.warn("Error fetching recently played:", error.message);
        }
        
        // Get saved tracks
        try {
          console.log("Fetching saved tracks...");
          // Spotify API has pagination, so we'll get multiple batches
          let offset = 0;
          const limit = 50;
          let hasMoreTracks = true;
          
          while (hasMoreTracks) {
            const savedTracksResponse = await fetchFromSpotify(
              `https://api.spotify.com/v1/me/tracks?limit=${limit}&offset=${offset}`,
              token
            );
            
            if (savedTracksResponse && savedTracksResponse.items && savedTracksResponse.items.length > 0) {
              console.log(`Found ${savedTracksResponse.items.length} saved tracks (offset: ${offset})`);
              // Add each saved track
              allTopTracks.push(...savedTracksResponse.items.map(item => item.track));
              offset += limit;
              
              // Check if we need to fetch more
              hasMoreTracks = savedTracksResponse.items.length === limit;
            } else {
              hasMoreTracks = false;
            }
          }
        } catch (error) {
          console.warn("Error fetching saved tracks:", error.message);
        }
        
        // Remove duplicates
        const uniqueTracks = [];
        const trackIds = new Set();
        
        for (const track of allTopTracks) {
          if (track && track.id && !trackIds.has(track.id)) {
            uniqueTracks.push(track);
            trackIds.add(track.id);
          }
        }
        
        console.log(`Found ${uniqueTracks.length} unique tracks from user's library`);
        
        // Analyze all tracks: Select all tracks, not just random subset
        // We'll still limit to no more than 50 tracks for performance
        const tracksToAnalyze = shuffleArray(uniqueTracks);
        const maxTracksToAnalyze = Math.min(tracksToAnalyze.length, 50);
        
        if (tracksToAnalyze.length > 0) {
          recommendations = tracksToAnalyze.slice(0, maxTracksToAnalyze);
          console.log(`Selected ${recommendations.length} tracks from user's library to analyze`);
        }
      } catch (error) {
        console.error("Error getting user's library tracks:", error);
      }
      
      // If we don't have enough recommendations, try to use Spotify recommendations API
      if (recommendations.length < 5) {
        console.log("Not enough recommendations from library, using Spotify Recommendations API...");
        
        try {
          // Map mood to genres for recommendation seeds
          const moodToGenre = {
            'energetic': 'edm_dance,pop,rock',
            'calm': 'ambient,classical,chill',
            'melancholy': 'sad,indie,folk',
            'upbeat': 'happy,pop,electronic',
            'sad': 'sad,blues,indie',
            'happy': 'happy,pop,disco',
            'focused': 'study,classical,instrumental',
            'relaxed': 'chill,jazz,acoustic',
            'party': 'party,dance,electronic',
            'romantic': 'romance,r-n-b,jazz',
            'balanced': 'pop,rock,alternative'
          };
          
          // Map mood to audio features for better recommendations
          const moodToFeatures = {
            'energetic': 'min_energy=0.7&target_valence=0.6',
            'calm': 'max_energy=0.4&target_valence=0.5',
            'melancholy': 'max_energy=0.5&target_valence=0.3',
            'upbeat': 'min_energy=0.6&min_valence=0.6',
            'sad': 'max_energy=0.4&max_valence=0.3',
            'happy': 'min_valence=0.7',
            'focused': 'target_energy=0.5&max_valence=0.6',
            'relaxed': 'max_energy=0.4&target_valence=0.5',
            'party': 'min_energy=0.7&min_danceability=0.7',
            'romantic': 'target_energy=0.5&target_valence=0.5',
            'balanced': 'target_energy=0.5&target_valence=0.5'
          };
          
          const genreSeed = moodToGenre[mood.toLowerCase()] || 'pop';
          const audioFeatures = moodToFeatures[mood.toLowerCase()] || '';
          
          const recResponse = await fetchFromSpotify(
            `https://api.spotify.com/v1/recommendations?seed_genres=${genreSeed}&${audioFeatures}&limit=10`, 
            token
          );
          
          if (recResponse && recResponse.tracks && recResponse.tracks.length > 0) {
            // Add any new tracks not already in recommendations
            for (const track of recResponse.tracks) {
              if (!recommendations.some(r => r.id === track.id)) {
                recommendations.push(track);
              }
              
              if (recommendations.length >= 10) break;
            }
            
            console.log(`Added tracks from Spotify API recommendations, total now: ${recommendations.length}`);
          }
        } catch (error) {
          console.warn(`Error getting recommendations from Spotify API:`, error.message);
        }
      }
    }
    // Step 2b: For classic recommendation type, use AI to suggest classic songs with user prompt
    else if (recommendationType === "classic") {
      try {
        console.log("Getting classic song recommendations...");
        
        // Step 1: Web search for classic songs matching the user's prompt directly (without mood analysis)
        const webSearchPrompt = `songs that match: ${prompt}`;
        
        // Simulate web crawler with OpenAI call
        const webSearchResponse = await openai.chat.completions.create({
          model: "gpt-3.5-turbo",
          messages: [
            {
              role: "system",
              content: "You are a music expert. List 10 songs that match a specific prompt or theme. Format as JSON array with objects containing 'name' and 'artist' properties."
            },
            {
              role: "user",
              content: webSearchPrompt
            }
          ],
          temperature: 0.7,
          max_tokens: 500
        });
        
        // Parse the web search results
        let webResults = [];
        try {
          const content = webSearchResponse.choices[0]?.message?.content || "[]";
          webResults = JSON.parse(content.replace(/```json|```/g, '').trim());
          console.log("Web results:", webResults);
        } catch (e) {
          console.warn("Failed to parse web results:", e);
          webResults = [];
        }
        
        // Step 2: Combine with AI recommendations
        const combinedPrompt = `
          I need songs that match this description: "${prompt}".
          Here are some songs that might match: ${JSON.stringify(webResults)}
          
          Please recommend 10 songs that would be perfect for this prompt,
          formatted in a list like:
          1. Song Name by Artist
          2. Song Name by Artist
          etc.
        `;
        
        const finalRecommendationResponse = await openai.chat.completions.create({
          model: "gpt-3.5-turbo",
          messages: [
            {
              role: "system",
              content: `You are an expert music curator. Create the perfect list that match ${prompt}`
            },
            {
              role: "user",
              content: combinedPrompt
            }
          ],
          temperature: 0.7,
          max_tokens: 500
        });
        
        // Parse the AI recommendations
        try {
          const aiSuggestions = finalRecommendationResponse.choices[0]?.message?.content || "";
          console.log("AI suggestions:", aiSuggestions);
          
          // Extract track information from AI response
          const extractedTracks = extractSongsFromAIResponse(aiSuggestions);
          console.log("Extracted tracks:", extractedTracks);
          
          // Search for these songs on Spotify
          const spotifyResults = await searchMultipleTracksOnSpotify(extractedTracks, token);
          
          // If we found tracks on Spotify, use them
          if (spotifyResults.length > 0) {
            recommendations = spotifyResults;
            console.log(`Found ${recommendations.length} tracks on Spotify for classic recommendations`);
          }
        } catch (e) {
          console.warn("Failed to parse AI recommendations:", e);
        }
      } catch (error) {
        console.error("Error handling classic recommendation type:", error);
      }
    }

    // If we still don't have enough recommendations, return error
    if (!recommendations || recommendations.length === 0) {
      return NextResponse.json({ 
        error: 'Could not generate recommendations with the provided parameters'
      }, { status: 404 });
    }

    // Quality Check - Evaluate and refine recommendations if needed
    if (qualityCheck && recommendations.length > 1) {
      try {
        // Get evaluation of current recommendations
        const evaluation = await evaluateRecommendations(recommendations, prompt, mood);
        
        // Check if we need replacements
        if (evaluation.replacement_needed && evaluation.replacement_needed.length > 0) {
          console.log(`Need to replace ${evaluation.replacement_needed.length} tracks that don't match the prompt well`);
          
          // Get track IDs that need replacement
          const replaceIds = new Set(evaluation.replacement_needed);
          
          // Keep good tracks
          const goodTracks = recommendations.filter(track => !replaceIds.has(track.id));
          
          // Get replacement tracks using Spotify Recommendations API
          const replacementCount = Math.min(replaceIds.size, 5); // Limit to 5 replacements at once
          const replacementTracks = await getReplacementTracks(token, prompt, mood, replacementCount);
          
          if (replacementTracks.length > 0) {
            // Combine good tracks with replacements
            recommendations = [...goodTracks, ...replacementTracks];
            
            // If output format is track, we might need to do another evaluation to pick the best one
            if (outputFormat === "track" && recommendations.length > 1) {
              const finalEval = await evaluateRecommendations(recommendations, prompt, mood);
              
              // Sort by match score (highest first)
              const sortedTracks = [...recommendations].sort((a, b) => {
                const scoreA = finalEval.evaluation.find(e => e.id === a.id)?.match_score || 0;
                const scoreB = finalEval.evaluation.find(e => e.id === b.id)?.match_score || 0;
                return scoreB - scoreA;
              });
              
              // Take the best match
              recommendations = [sortedTracks[0]];
            }
          }
        }
      } catch (error) {
        console.error("Error during quality check:", error);
        // Continue with original recommendations if quality check fails
      }
    }

    // Handle output format - track vs playlist
    if (outputFormat === "track") {
      // Just return a single track if we have one
      recommendations = recommendations.length > 0 ? [recommendations[0]] : [];
      console.log("Returning single track as requested by outputFormat");
    } else {
      // For playlist output, limit to maximum 20 songs
      if (recommendations.length > 20) {
        console.log(`Limiting playlist from ${recommendations.length} to 20 songs maximum`);
        recommendations = recommendations.slice(0, 20);
      }
      
      // Additional verification step for playlists to ensure alignment with prompt
      if (recommendations.length > 1) {
        try {
          console.log("Performing final verification of playlist songs alignment with prompt...");
          
          // Get track info for verification
          const tracksInfo = recommendations.map(track => ({
            id: track.id,
            name: track.name,
            artists: track.artists.map(artist => artist.name).join(', ')
          }));
          
          // Use OpenAI to verify alignment
          const verificationResponse = await openai.chat.completions.create({
            model: "gpt-3.5-turbo",
            messages: [
              {
                role: "system",
                content: `You are a music expert evaluating if songs match a user's prompt. 
                For each song, determine if it matches. Return ONLY a JSON array with the IDs 
                of songs that DO match the prompt well. Do not include songs that seem unrelated 
                or don't fit the theme/mood.`
              },
              {
                role: "user",
                content: `User prompt: "${prompt}"
                
                Evaluate these songs and return only the IDs of songs that match the prompt:
                ${JSON.stringify(tracksInfo, null, 2)}`
              }
            ],
            temperature: 0.3,
            max_tokens: 500
          });
          
          // Parse verification result
          try {
            const content = verificationResponse.choices[0]?.message?.content || "[]";
            // Clean the response in case it has markdown code blocks
            const jsonStr = content.replace(/```json|```/g, '').trim();
            const matchingIds = JSON.parse(jsonStr);
            
            if (Array.isArray(matchingIds) && matchingIds.length > 0) {
              // Keep only matching songs but ensure we have at least 3 songs (if available)
              const matchingTracks = recommendations.filter(track => matchingIds.includes(track.id));
              
              if (matchingTracks.length >= 5 || matchingTracks.length === recommendations.length) {
                console.log(`Keeping ${matchingTracks.length} songs that align with the prompt out of ${recommendations.length}`);
                recommendations = matchingTracks;
              } else {
                console.log(`Only ${matchingTracks.length} songs matched strongly, but keeping at least 5 for variety`);
                // Sort recommendations: matching first, then others
                recommendations = [
                  ...matchingTracks,
                  ...recommendations.filter(track => !matchingIds.includes(track.id))
                ].slice(0, Math.max(3, matchingTracks.length));
              }
            }
          } catch (parseError) {
            console.error('Failed to parse verification result:', parseError);
            // Continue with original recommendations if parsing fails
          }
        } catch (error) {
          console.error('Error during additional verification:', error);
          // Continue with original recommendations if verification fails
        }
      }
    }

    console.log(`Final recommendation count: ${recommendations.length}`);

    // Generate a story based on the recommendations and prompt
    let story = '';
    try {
      // Get song names and artists for context
      const tracksInfo = recommendations.map(track => {
        return {
          name: track.name,
          artists: track.artists.map(artist => artist.name).join(', ')
        };
      });

      // Prepare prompt for OpenAI based on recommendation type and output format
      let aiPrompt = "";
      
      if (customStory) {
        aiPrompt = `Based on this custom theme: "${customStory}", write a short paragraph that connects these songs into a cohesive playlist narrative.`;
      } else if (recommendationType === "classic") {
        aiPrompt = `Write a short, engaging paragraph about how this collection of classic songs matches the theme: "${prompt}".`;
      } else if (outputFormat === "track") {
        aiPrompt = `Write a short, engaging paragraph about why this song perfectly matches the mood: "${prompt}".`;
      } else {
        aiPrompt = `Write a short, engaging paragraph about how this playlist matches the mood: "${prompt}".`;
      }
      
      aiPrompt += ` Here are the songs: ${JSON.stringify(tracksInfo)}. Keep it concise and personal.`;

      const aiResponse = await openai.chat.completions.create({
        model: "gpt-3.5-turbo",
        messages: [
          { role: "system", content: "You are a music expert who writes creative, evocative descriptions of playlists." },
          { role: "user", content: aiPrompt }
        ],
        max_tokens: 250
      });

      story = aiResponse.choices[0]?.message?.content || "";
    } catch (aiError) {
      console.error('Error generating story with AI:', aiError);
      // Fallback to simple story if AI fails
      if (outputFormat === "track") {
        story = `A song curated for your "${prompt}" mood.`;
      } else {
        story = `A playlist curated for your "${prompt}" mood.`;
      }
    }

    // Create a simplified audioFeatures object for the frontend
    const audioFeatures = {
      energy: mood === "energetic" || mood === "upbeat" ? 0.8 : mood === "calm" || mood === "sad" ? 0.3 : 0.5,
      valence: mood === "happy" || mood === "upbeat" ? 0.8 : mood === "sad" || mood === "melancholy" ? 0.2 : 0.5,
      danceability: mood === "party" || mood === "dance" ? 0.8 : mood === "calm" || mood === "focused" ? 0.3 : 0.5,
    };

    // Return the recommendations, mood, story and the requested parameters
    return NextResponse.json({
      recommendations: recommendations,
      audioFeatures: audioFeatures,
      mood: mood,
      story: story,
      recommendationType: recommendationType,
      outputFormat: outputFormat
    });
    
  } catch (error) {
    console.error('API error:', error);
    return NextResponse.json({ error: error.message || 'Internal server error' }, { status: 500 });
  }
}

// Helper function: Fisher-Yates shuffle algorithm
function shuffleArray(array) {
  const result = [...array];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

// Playlist creation function
async function createSpotifyPlaylist(token, playlistName, tracks, description) {
  try {
    console.log("Creating playlist with tracks:", JSON.stringify(tracks.map(t => t.name || t.id)));

    // 1. Get user profile to get user ID
    const userProfile = await fetchFromSpotify('https://api.spotify.com/v1/me', token);
    const userId = userProfile.id;

    if (!userId) {
      throw new Error('Could not determine user ID');
    }

    console.log("Creating playlist for user:", userId);

    // 2. Create a new playlist with truncated description
    // Spotify limit for description is 300 characters
    const truncatedDescription = description ? description.substring(0, 290) : 'Created with Moodify';
    
    const createPlaylistUrl = `https://api.spotify.com/v1/users/${userId}/playlists`;
    const playlistResponse = await fetch(createPlaylistUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        name: playlistName || 'Moodify Playlist',
        description: truncatedDescription,
        public: false
      })
    });

    if (!playlistResponse.ok) {
      const errorText = await playlistResponse.text();
      console.error("Playlist creation error response:", errorText);
      try {
        const errorData = JSON.parse(errorText);
        throw new Error(`Failed to create playlist: ${errorData.error?.message || playlistResponse.statusText}`);
      } catch (e) {
        throw new Error(`Failed to create playlist: ${playlistResponse.statusText}`);
      }
    }

    const playlist = await playlistResponse.json();
    console.log("Playlist created:", playlist.id);

    // 3. Add tracks to the playlist - ensure we have valid URIs
    const trackUris = tracks.map(track => {
      // Check if it already has a URI
      if (track.uri && track.uri.startsWith('spotify:track:')) {
        return track.uri;
      }
      // Check if it has an ID
      else if (track.id) {
        return `spotify:track:${track.id}`;
      }
      // Last resort, return null (will be filtered out)
      return null;
    }).filter(uri => uri !== null);

    if (trackUris.length === 0) {
      throw new Error('No valid track URIs to add to playlist');
    }

    console.log("Adding tracks to playlist:", trackUris);

    // Add the tracks in batches of 100 (Spotify API limit)
    const batchSize = 100;
    for (let i = 0; i < trackUris.length; i += batchSize) {
      const batch = trackUris.slice(i, i + batchSize);

      const addTracksUrl = `https://api.spotify.com/v1/playlists/${playlist.id}/tracks`;
      const addTracksResponse = await fetch(addTracksUrl, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          uris: batch
        })
      });

      if (!addTracksResponse.ok) {
        const errorText = await addTracksResponse.text();
        console.error("Track addition error response:", errorText);
        try {
          const errorData = JSON.parse(errorText);
          console.warn(`Warning adding tracks to playlist: ${errorData.error?.message}`);
        } catch (e) {
          console.warn(`Warning adding tracks to playlist: ${addTracksResponse.statusText}`);
        }
        // Continue anyway - we at least created the playlist
      }
    }

    // 4. Return the created playlist
    return NextResponse.json({
      playlist: playlist,
      message: 'Playlist created successfully',
      recommendationType: 'mood', // Default for created playlists
      outputFormat: 'playlist'
    });
  } catch (error) {
    console.error('Error creating playlist:', error);
    return NextResponse.json({ error: error.message || 'Failed to create playlist' }, { status: 500 });
  }
}
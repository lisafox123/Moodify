import OpenAI from "openai";
import { fetchFromSpotify } from './spotifyHelpers.js';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

export async function generateClassicRecommendations(prompt, token) {
  try {
    console.log("Generating classic recommendations for prompt:", prompt);
    
    // Step 1: Web crawler simulation + AI analysis
    const webSearchResults = await simulateWebCrawler(prompt);
    
    // Step 2: Use AI to answer user's prompt with classic songs
    const aiRecommendations = await getAIClassicRecommendations(prompt);
    
    // Step 3: Combine and refine results
    const combinedRecommendations = await combineAndRefineResults(
      webSearchResults, 
      aiRecommendations, 
      prompt
    );
    
    // Step 4: Search for tracks on Spotify
    const spotifyTracks = await searchTracksOnSpotify(combinedRecommendations, token);
    
    console.log(`Generated ${spotifyTracks.length} classic recommendations`);
    return spotifyTracks;

  } catch (error) {
    console.error('Error generating classic recommendations:', error);
    return [];
  }
}

async function simulateWebCrawler(prompt) {
  try {
    console.log("Simulating web crawler for classic songs...");
    
    const response = await openai.chat.completions.create({
      model: "gpt-3.5-turbo",
      messages: [
        {
          role: "system",
          content: `You are simulating a web crawler that searches for classic songs. 
          Based on the search query, return information about classic/timeless songs that match.
          Return ONLY a JSON array with objects containing:
          - "title": song title
          - "artist": artist name  
          - "year": release year (if known)
          - "genre": genre
          - "reason": why it matches the search
          
          Focus on well-known, timeless songs from various decades.`
        },
        {
          role: "user",
          content: `Search for classic songs related to: "${prompt}"`
        }
      ],
      temperature: 0.7,
      max_tokens: 1500
    });

    const content = response.choices[0]?.message?.content || "";
    
    try {
      const jsonStr = content.replace(/```json|```/g, '').trim();
      const results = JSON.parse(jsonStr);
      
      console.log(`Web crawler simulation found ${results.length} classic songs`);
      return Array.isArray(results) ? results : [];
    } catch (parseError) {
      console.error('Failed to parse web crawler results:', parseError);
      return [];
    }
  } catch (error) {
    console.error('Error in web crawler simulation:', error);
    return [];
  }
}

async function getAIClassicRecommendations(prompt) {
  try {
    console.log("Getting AI classic song recommendations...");
    
    const response = await openai.chat.completions.create({
      model: "gpt-3.5-turbo",
      messages: [
        {
          role: "system",
          content: `You are a music expert with deep knowledge of classic and timeless songs.
          Recommend classic songs that perfectly match the user's request.
          Return ONLY a JSON array with objects containing:
          - "title": song title
          - "artist": artist name
          - "year": release year (if known)
          - "genre": genre
          - "significance": why this song is considered classic
          - "match_reason": why it fits the user's request
          
          Focus on songs that are widely recognized as classics or have stood the test of time.`
        },
        {
          role: "user",
          content: `Recommend classic songs for: "${prompt}"`
        }
      ],
      temperature: 0.6,
      max_tokens: 1500
    });

    const content = response.choices[0]?.message?.content || "";
    
    try {
      const jsonStr = content.replace(/```json|```/g, '').trim();
      const results = JSON.parse(jsonStr);
      
      console.log(`AI recommended ${results.length} classic songs`);
      return Array.isArray(results) ? results : [];
    } catch (parseError) {
      console.error('Failed to parse AI classic recommendations:', parseError);
      return [];
    }
  } catch (error) {
    console.error('Error getting AI classic recommendations:', error);
    return [];
  }
}

async function combineAndRefineResults(webResults, aiResults, prompt) {
  try {
    console.log("Combining and refining classic song results...");
    
    // Combine all results
    const allResults = [...webResults, ...aiResults];
    
    // Remove duplicates based on title and artist
    const uniqueResults = [];
    const seen = new Set();
    
    for (const song of allResults) {
      const key = `${song.title?.toLowerCase().trim()}-${song.artist?.toLowerCase().trim()}`;
      if (!seen.has(key) && song.title && song.artist) {
        uniqueResults.push(song);
        seen.add(key);
      }
    }
    
    // Use AI to refine and select the best matches
    const response = await openai.chat.completions.create({
      model: "gpt-3.5-turbo",
      messages: [
        {
          role: "system",
          content: `You are a music curator selecting the best classic songs for a specific request.
          From the provided list, select the songs that best match the user's prompt.
          Remove any songs that don't fit well or seem inappropriate.
          Return ONLY a JSON array with the selected songs, keeping the same format.
          Aim for 15-20 of the best matches.`
        },
        {
          role: "user",
          content: `User request: "${prompt}"
          
          Select the best classic songs from this list:
          ${JSON.stringify(uniqueResults, null, 2)}`
        }
      ],
      temperature: 0.3,
      max_tokens: 2000
    });

    const content = response.choices[0]?.message?.content || "";
    
    try {
      const jsonStr = content.replace(/```json|```/g, '').trim();
      const refinedResults = JSON.parse(jsonStr);
      
      console.log(`Refined to ${refinedResults.length} best classic song matches`);
      return Array.isArray(refinedResults) ? refinedResults : uniqueResults;
    } catch (parseError) {
      console.error('Failed to parse refined results:', parseError);
      return uniqueResults;
    }
  } catch (error) {
    console.error('Error combining and refining results:', error);
    return [...webResults, ...aiResults];
  }
}

async function searchTracksOnSpotify(songRecommendations, token) {
  try {
    console.log(`Searching for ${songRecommendations.length} classic songs on Spotify`);
    
    const spotifyTracks = [];
    
    for (const song of songRecommendations) {
      try {
        // Create search query
        const query = `track:"${song.title}" artist:"${song.artist}"`;
        const encodedQuery = encodeURIComponent(query);
        
        const searchResponse = await fetchFromSpotify(
          `https://api.spotify.com/v1/search?q=${encodedQuery}&type=track&limit=1`,
          token
        );
        
        if (searchResponse?.tracks?.items?.length > 0) {
          const track = searchResponse.tracks.items[0];
          
          // Add classic song metadata
          track.classicMetadata = {
            year: song.year,
            genre: song.genre,
            significance: song.significance,
            match_reason: song.match_reason,
            reason: song.reason
          };
          
          spotifyTracks.push(track);
          console.log(`Found: ${track.name} by ${track.artists[0]?.name}`);
        } else {
          console.log(`Not found on Spotify: ${song.title} by ${song.artist}`);
        }
        
        // Add delay to respect rate limits
        await new Promise(resolve => setTimeout(resolve, 100));
        
      } catch (error) {
        console.error(`Error searching for ${song.title}:`, error);
      }
    }
    
    console.log(`Successfully found ${spotifyTracks.length} classic tracks on Spotify`);
    return spotifyTracks;
    
  } catch (error) {
    console.error('Error searching tracks on Spotify:', error);
    return [];
  }
}
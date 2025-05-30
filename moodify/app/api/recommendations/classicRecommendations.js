import { ProgressTracker } from '../../lib/progressStore.js';

// FIXED MUSIC RECOMMENDATION FUNCTION WITH FASTAPI INTEGRATION
export async function generateClassicRecommendations(prompt, token, requestId) {
  let progressTracker = null;
  
  try {
    progressTracker = new ProgressTracker(requestId, 'classic');
    console.log("Getting music recommendations for prompt:", prompt);

    await progressTracker.updateStep('classic_workflow', 'active', 'Fetching Fastapi');
    
    const response = await fetch('http://54.152.238.168:8000/music/recommend', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'accept': 'application/json'
      },
      body: JSON.stringify({
        prompt: prompt
      })
    });
    
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    } else {
      await progressTracker.completeStep('classic_workflow', 'Successfully Fetching Fastapi');
      await progressTracker.updateStep('generating', 'active', `Generating ${prompt} Recommendations`);
    }

    const data = await response.json();
    
    // Add detailed logging to debug the response structure
    console.log("Raw response JSON from FastAPI:", data);
    console.log("Type of data:", typeof data);
    console.log("data.songs exists?", data.songs ? "✅ Yes" : "❌ No");
    console.log("data keys:", Object.keys(data));
    
    // Check if there's an error in the response
    if (data.error) {
      console.error('FastAPI error:', data.error);
      await progressTracker.setError('generating', `Error: ${data.error}`);
      return null;
    }

    // More robust check for songs array
    if (!data.songs || !Array.isArray(data.songs)) {
      console.error("songs is not an array or is undefined:", data.songs);
      console.error("Full response:", JSON.stringify(data, null, 2));
      await progressTracker.setError('generating', 'Error: Invalid response format');
      return null;
    }
    
    console.log("Received songs from FastAPI:", data.songs.length);
    const songs = data.songs;

    if (songs.length === 0) {
      console.log("No songs received, using fallback");
      await progressTracker.completeStep('generating', 'No songs found');
      return null;
    }

    await progressTracker.completeStep('generating', 'Successfully Generated');
    await progressTracker.updateStep('spotify_search', 'active', 'Finding songs on Spotify');

    // Search for these songs on Spotify
    const spotifyTracks = await searchTracksOnSpotify(songs, token);
    console.log("Found Spotify tracks:", spotifyTracks.length);

    await progressTracker.completeStep('spotify_search', `Found ${spotifyTracks.length} tracks`);
    
    // FIX: Don't fail if some tracks aren't found on Spotify
    // Return whatever tracks we found, even if it's not all of them
    if (spotifyTracks.length === 0) {
      console.log("No tracks found on Spotify, but FastAPI provided recommendations");
      // Still return the original song data for fallback
      const fallbackTracks = songs.map(song => ({
        id: `fallback_${Date.now()}_${Math.random()}`,
        name: song.title,
        artists: [{ name: song.artist }],
        album: { name: song.album || 'Unknown Album' },
        external_urls: { spotify: null },
        preview_url: null,
        uri: null,
        isFallback: true,
        originalData: song
      }));
      
      await progressTracker.complete({
        tracks: fallbackTracks,
        totalFound: fallbackTracks.length,
        originalPrompt: prompt,
        note: "Spotify tracks not found, showing FastAPI recommendations"
      });
      
      return fallbackTracks;
    }
    
    await progressTracker.complete({
      tracks: spotifyTracks,
      totalFound: spotifyTracks.length,
      originalPrompt: prompt
    });

    return spotifyTracks;
    
  } catch (error) {
    console.error('Error getting music recommendations:', error);
    
    if (progressTracker) {
      await progressTracker.setError(progressTracker.currentStep || 'classic_workflow', error.message);
    }
    
    return null;
  }
}

// IMPROVED Helper function to search tracks on Spotify with better matching
async function searchTracksOnSpotify(songs, token) {
  const spotifyTracks = [];
  
  for (const song of songs) {
    try {
      // Try multiple search strategies for better results
      const searchStrategies = [
        // Strategy 1: Exact title and artist
        `"${song.title}" "${song.artist}"`,
        // Strategy 2: Title and artist without quotes
        `${song.title} ${song.artist}`,
        // Strategy 3: Just the title (for cases where artist name might be different)
        `${song.title}`,
        // Strategy 4: Clean up artist name (remove parentheses, etc.)
        `"${song.title}" ${song.artist.replace(/\([^)]*\)/g, '').trim()}`
      ];
      
      let trackFound = false;
      
      for (const query of searchStrategies) {
        if (trackFound) break;
        
        try {
          const searchUrl = `https://api.spotify.com/v1/search?q=${encodeURIComponent(query)}&type=track&limit=5`;
          
          const response = await fetch(searchUrl, {
            headers: {
              'Authorization': `Bearer ${token}`
            }
          });
          
          if (response.ok) {
            const spotifyData = await response.json();
            
            if (spotifyData.tracks && spotifyData.tracks.items && spotifyData.tracks.items.length > 0) {
              // Find the best match by checking artist similarity
              const bestMatch = findBestMatch(song, spotifyData.tracks.items);
              if (bestMatch) {
                spotifyTracks.push(bestMatch);
                trackFound = true;
                console.log(`✅ Found: "${song.title}" by ${song.artist} using strategy: ${query}`);
              }
            }
          }
        } catch (strategyError) {
          console.error(`Strategy "${query}" failed for ${song.title}:`, strategyError);
        }
      }
      
      if (!trackFound) {
        console.log(`❌ Could not find: "${song.title}" by ${song.artist} on Spotify`);
      }
      
    } catch (error) {
      console.error(`Error searching for ${song.title} by ${song.artist}:`, error);
    }
  }
  
  return spotifyTracks;
}

// Helper function to find the best matching track
function findBestMatch(originalSong, spotifyTracks) {
  // First, try to find exact title match
  for (const track of spotifyTracks) {
    if (track.name.toLowerCase() === originalSong.title.toLowerCase()) {
      // Check if any artist matches
      const artistMatch = track.artists.some(artist => 
        artist.name.toLowerCase().includes(originalSong.artist.toLowerCase()) ||
        originalSong.artist.toLowerCase().includes(artist.name.toLowerCase())
      );
      if (artistMatch) {
        return track;
      }
    }
  }
  
  // If no exact match, return the first track (Spotify's best match)
  return spotifyTracks[0];
}
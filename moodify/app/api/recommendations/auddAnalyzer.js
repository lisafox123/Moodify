// Configuration
const FASTAPI_BASE_URL = 'http://54.152.238.168:8000'; // Adjust this to your FastAPI server URL

// Helper function to extract track ID from Spotify URL or URI
function extractTrackId(track) {
  if (typeof track === 'string') {
    // Handle Spotify URLs and URIs
    const urlMatch = track.match(/track\/([a-zA-Z0-9]+)/);
    const uriMatch = track.match(/spotify:track:([a-zA-Z0-9]+)/);
    return urlMatch ? urlMatch[1] : (uriMatch ? uriMatch[1] : null);
  } else if (track && track.id) {
    return track.id;
  }
  return null;
}

// Function to fetch track data from Spotify API in batches
async function fetchSpotifyTracksBatch(trackIds, token) {
  const batchSize = 50; // Spotify allows up to 50 tracks per request
  const allTracks = [];
  
  for (let i = 0; i < trackIds.length; i += batchSize) {
    const batch = trackIds.slice(i, i + batchSize);
    const idsParam = batch.join(',');
    
    try {
      const response = await fetch(`https://api.spotify.com/v1/tracks?ids=${idsParam}`, {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      });
      
      if (!response.ok) {
        throw new Error(`Spotify API error: ${response.status}`);
      }
      
      const data = await response.json();
      allTracks.push(...data.tracks.filter(track => track !== null));
    } catch (error) {
      console.error(`Error fetching batch ${i / batchSize + 1}:`, error);
    }
  }
  
  return allTracks;
}

// Function to call FastAPI for single track
async function fetchSingleTrackFeatures(title, artist) {
  try {
    const response = await fetch(`${FASTAPI_BASE_URL}/audio_feature/extract`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        title: title,
        artist: artist
      })
    });
    
    if (!response.ok) {
      throw new Error(`FastAPI error: ${response.status} - ${response.statusText}`);
    }
    
    return await response.json();
  } catch (error) {
    console.error(`Error fetching features for "${title}" by "${artist}":`, error);
    return {
      title,
      artist,
      error: error.message
    };
  }
}

// Function to call FastAPI for multiple tracks
async function fetchMultipleTrackFeatures(tracks) {
  try {
    const response = await fetch(`${FASTAPI_BASE_URL}/audio_feature/extract_multiple`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        tracks: tracks.map(track => ({
          title: track.title,
          artist: track.artist
        }))
      })
    });
    
    if (!response.ok) {
      throw new Error(`FastAPI error: ${response.status} - ${response.statusText}`);
    }
    
    return await response.json();
  } catch (error) {
    console.error('Error fetching multiple track features:', error);
    throw error;
  }
}

// Function to process tracks in batches of 5
async function processTracksInBatches(tracksForAnalysis, batchSize = 5) {
  const allResults = [];
  const totalBatches = Math.ceil(tracksForAnalysis.length / batchSize);
  
  console.log(`Processing ${tracksForAnalysis.length} tracks in ${totalBatches} batches of ${batchSize}`);
  
  for (let i = 0; i < tracksForAnalysis.length; i += batchSize) {
    const batch = tracksForAnalysis.slice(i, i + batchSize);
    const batchNumber = Math.floor(i / batchSize) + 1;
    
    console.log(`Processing batch ${batchNumber}/${totalBatches} (${batch.length} tracks)`);
    
    try {
      const batchResult = await fetchMultipleTrackFeatures(batch);
      allResults.push(...batchResult.results);
      
      console.log(`Batch ${batchNumber} completed: ${batchResult.successful} successful, ${batchResult.failed} failed`);
      
      // Add delay between batches to avoid overwhelming the APIs
      if (i + batchSize < tracksForAnalysis.length) {
        console.log('Waiting 2 seconds before next batch...');
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
    } catch (error) {
      console.error(`Error processing batch ${batchNumber}:`, error);
      
      // Fallback to processing individual tracks in this batch
      console.log('Falling back to individual track processing for this batch...');
      for (const track of batch) {
        const singleResult = await fetchSingleTrackFeatures(track.title, track.artist);
        allResults.push(singleResult);
      }
    }
  }
  
  return allResults;
}

// Main export function
export async function enhancedFeatureAnalysis(tracks, token) {
  try {
    console.log('Performing enhanced feature analysis...');
    
    if (!token) {
      throw new Error('Spotify access token is required for track analysis');
    }
    
    // Extract track IDs
    const trackIds = tracks.map(track => extractTrackId(track)).filter(id => id !== null);
    console.log(`Extracted ${trackIds.length} valid track IDs`);
    
    if (trackIds.length === 0) {
      throw new Error('No valid track IDs found');
    }
    
    // Fetch full track data from Spotify API
    const fullTrackData = await fetchSpotifyTracksBatch(trackIds, token);
    console.log(`Fetched ${fullTrackData.length} tracks from Spotify API`);
    
    // Prepare tracks for FastAPI analysis
    const tracksForAnalysis = fullTrackData.map(track => ({
      title: track.name,
      artist: track.artists[0]?.name || 'Unknown Artist',
      spotify_id: track.id,
      spotify_data: {
        duration_ms: track.duration_ms,
        popularity: track.popularity,
        explicit: track.explicit,
        preview_url: track.preview_url,
        external_urls: track.external_urls
      }
    }));
    
    console.log(`Prepared ${tracksForAnalysis.length} tracks for enhanced analysis`);
    
    // Process tracks through FastAPI in batches of 5
    const enhancedResults = await processTracksInBatches(tracksForAnalysis, 5);
    
    // Combine Spotify data with enhanced features
    const combinedResults = enhancedResults.map((enhancedTrack, index) => {
      const originalTrack = tracksForAnalysis[index] || {};
      
      return {
        // Basic track info
        title: enhancedTrack.title,
        artist: enhancedTrack.artist,
        spotify_id: originalTrack.spotify_id,
        
        // Spotify data
        spotify: originalTrack.spotify_data,
        
        // Enhanced features from TuneBat/OpenAI
        enhanced_features: {
          bpm: enhancedTrack.bpm,
          energy: enhancedTrack.energy,
          danceability: enhancedTrack.danceability,
          happiness: enhancedTrack.happiness,
          acousticness: enhancedTrack.acousticness,
          instrumentalness: enhancedTrack.instrumentalness,
          liveness: enhancedTrack.liveness,
          speechiness: enhancedTrack.speechiness,
          loudness: enhancedTrack.loudness,
          key: enhancedTrack.key,
          camelot: enhancedTrack.camelot,
          duration: enhancedTrack.duration,
          release_date: enhancedTrack.release_date,
          album: enhancedTrack.album,
          label: enhancedTrack.label,
          explicit: enhancedTrack.explicit
        },
        
        // Processing status
        processing_status: {
          success: !enhancedTrack.error,
          error: enhancedTrack.error || null,
          enhanced_features_available: !enhancedTrack.error
        }
      };
    });
    
    // Calculate summary statistics
    const successful = combinedResults.filter(track => track.processing_status.success).length;
    const failed = combinedResults.length - successful;
    const successRate = (successful / combinedResults.length * 100).toFixed(1);
    
    console.log(`\n🎯 Enhanced Feature Analysis Complete:`);
    console.log(`Total tracks processed: ${combinedResults.length}`);
    console.log(`Successful: ${successful} (${successRate}%)`);
    console.log(`Failed: ${failed}`);
    
    // Return comprehensive results
    return {
      summary: {
        total_tracks: combinedResults.length,
        successful_extractions: successful,
        failed_extractions: failed,
        success_rate: parseFloat(successRate),
        processing_time: new Date().toISOString()
      },
      tracks: combinedResults,
      
      // Helper methods for data analysis
      getSuccessfulTracks: () => combinedResults.filter(track => track.processing_status.success),
      getFailedTracks: () => combinedResults.filter(track => !track.processing_status.success),
      getTracksByBPMRange: (min, max) => combinedResults.filter(track => {
        const bpm = track.enhanced_features.bpm;
        return bpm && bpm >= min && bpm <= max;
      }),
      getAverageFeatures: () => {
        const successfulTracks = combinedResults.filter(track => track.processing_status.success);
        if (successfulTracks.length === 0) return null;
        
        const features = ['bpm', 'energy', 'danceability', 'happiness', 'acousticness', 'instrumentalness', 'liveness', 'speechiness'];
        const averages = {};
        
        features.forEach(feature => {
          const values = successfulTracks
            .map(track => track.enhanced_features[feature])
            .filter(val => val !== null && val !== undefined);
          
          if (values.length > 0) {
            averages[feature] = values.reduce((sum, val) => sum + val, 0) / values.length;
          }
        });
        
        return averages;
      }
    };
    
  } catch (error) {
    console.error('Enhanced feature analysis failed:', error);
    throw new Error(`Enhanced feature analysis failed: ${error.message}`);
  }
}

// Utility function to check FastAPI health
export async function checkFastAPIHealth() {
  try {
    const response = await fetch(`${FASTAPI_BASE_URL}/audio_feature/health`);
    if (!response.ok) {
      throw new Error(`Health check failed: ${response.status}`);
    }
    return await response.json();
  } catch (error) {
    console.error('FastAPI health check failed:', error);
    return {
      status: 'unhealthy',
      error: error.message
    };
  }
}

// Utility function to analyze a single track
export async function analyzeSingleTrack(title, artist) {
  try {
    console.log(`Analyzing single track: "${title}" by "${artist}"`);
    
    const result = await fetchSingleTrackFeatures(title, artist);
    
    return {
      success: !result.error,
      track: result,
      error: result.error || null
    };
  } catch (error) {
    console.error('Single track analysis failed:', error);
    return {
      success: false,
      track: null,
      error: error.message
    };
  }
}

// Export configuration for easy updates
export const config = {
  FASTAPI_BASE_URL,
  MAX_BATCH_SIZE: 5,
  BATCH_DELAY_MS: 2000,
  SPOTIFY_BATCH_SIZE: 50
};

// Update configuration
export function updateConfig(newConfig) {
  Object.assign(config, newConfig);
}
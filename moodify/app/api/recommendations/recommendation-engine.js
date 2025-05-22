// recommendation-engine.js
import { fetchFromSpotify } from './spotify-api';

// Helper function: Fisher-Yates shuffle algorithm
export function shuffleArray(array) {
  const result = [...array];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

export async function getReplacementTracks(token, prompt, mood, count = 5) {
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

export async function getMoodBasedRecommendations(token, mood) {
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
    
    let recommendations = [];
    if (tracksToAnalyze.length > 0) {
      recommendations = tracksToAnalyze.slice(0, maxTracksToAnalyze);
      console.log(`Selected ${recommendations.length} tracks from user's library to analyze`);
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
    
    return recommendations;
  } catch (error) {
    console.error("Error getting user's library tracks:", error);
    return [];
  }
}

export function createAudioFeatures(mood) {
  return {
    energy: mood === "energetic" || mood === "upbeat" ? 0.8 : mood === "calm" || mood === "sad" ? 0.3 : 0.5,
    valence: mood === "happy" || mood === "upbeat" ? 0.8 : mood === "sad" || mood === "melancholy" ? 0.2 : 0.5,
    danceability: mood === "party" || mood === "dance" ? 0.8 : mood === "calm" || mood === "focused" ? 0.3 : 0.5,
  };
}
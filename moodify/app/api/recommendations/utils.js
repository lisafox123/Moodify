// Validation function for request parameters
export function validateRequestParams(body) {
  const errors = [];
  
  if (!body.prompt || typeof body.prompt !== 'string' || body.prompt.trim().length === 0) {
    errors.push('Prompt is required and must be a non-empty string');
  }
  
  if (body.prompt && body.prompt.length > 500) {
    errors.push('Prompt must be less than 500 characters');
  }
  
  if (body.recommendationType && !['mood', 'classic'].includes(body.recommendationType)) {
    errors.push('Recommendation type must be either "mood" or "classic"');
  }
  
  if (body.outputFormat && !['track', 'playlist'].includes(body.outputFormat)) {
    errors.push('Output format must be either "track" or "playlist"');
  }
  
  if (body.createPlaylistFlag && (!body.token || typeof body.token !== 'string')) {
    errors.push('Spotify token is required for playlist creation');
  }
  
  return {
    isValid: errors.length === 0,
    errors
  };
}

// Generate playlist story based on recommendations
export async function generatePlaylistStory(recommendations, prompt, mood, customStory, recommendationType, outputFormat) {
  if (customStory && customStory.trim()) {
    return customStory.trim();
  }
  
  if (!recommendations || recommendations.length === 0) {
    return "A carefully curated selection based on your musical preferences.";
  }
  
  try {
    const trackCount = recommendations.length;
    const artists = [...new Set(recommendations.map(track => 
      track.artists?.[0]?.name || 'Unknown Artist'
    ))].slice(0, 3);
    
    const storyPrompts = {
      mood: `Create a brief, engaging story (2-3 sentences) for a ${mood} mood playlist with ${trackCount} songs featuring artists like ${artists.join(', ')}. Make it personal and emotionally resonant.`,
      classic: `Create a brief, nostalgic story (2-3 sentences) for a classic music collection with ${trackCount} timeless songs featuring artists like ${artists.join(', ')}. Focus on the enduring quality of these classics.`
    };
    
    const storyPrompt = storyPrompts[recommendationType] || storyPrompts.mood;
    
    // Simple story generation without external API
    const moodDescriptions = {
      happy: "uplifting and joyful",
      sad: "melancholic and reflective", 
      energetic: "high-energy and motivating",
      calm: "peaceful and serene",
      romantic: "intimate and heartfelt",
      angry: "intense and powerful",
      balanced: "thoughtfully diverse"
    };
    
    const description = moodDescriptions[mood] || "carefully selected";
    const artistList = artists.length > 1 ? `${artists.slice(0, -1).join(', ')} and ${artists[artists.length - 1]}` : artists[0];
    
    if (recommendationType === 'classic') {
      return `A timeless collection of ${trackCount} classic tracks that have stood the test of time. Featuring legendary artists like ${artistList}, these songs represent the golden moments of music history that continue to resonate with listeners across generations.`;
    } else {
      return `A ${description} journey through ${trackCount} carefully selected tracks that capture the essence of your ${mood} mood. With music from ${artistList}, this playlist is designed to perfectly complement your current vibe and enhance your listening experience.`;
    }
    
  } catch (error) {
    console.error('Error generating playlist story:', error);
    return `A thoughtfully curated playlist of ${recommendations.length} tracks selected to match your mood and preferences.`;
  }
}

/**
 * Create audio features based on actual enhanced tracks from FastAPI
 * This replaces the mood-based synthetic audio features
 */
export function createAudioFeaturesFromTracks(tracks, fallbackMood = "balanced") {
  if (!tracks || tracks.length === 0) {
    console.log('No tracks provided, using fallback mood-based features');
    return createAudioFeatures(fallbackMood);
  }

  // Extract features from tracks that have enhanced_features
  const tracksWithFeatures = tracks.filter(track => 
    track.enhanced_features && 
    track.processing_status?.enhanced_features_available
  );

  console.log(`Found ${tracksWithFeatures.length}/${tracks.length} tracks with enhanced features`);

  if (tracksWithFeatures.length === 0) {
    console.log('No enhanced features available, using fallback mood-based features');
    return createAudioFeatures(fallbackMood);
  }

  // Calculate average values from actual track features
  const features = ['bpm', 'energy', 'danceability', 'happiness', 'acousticness', 'instrumentalness', 'liveness', 'speechiness'];
  const calculatedFeatures = {};
  
  features.forEach(feature => {
    const values = tracksWithFeatures
      .map(track => {
        const value = track.enhanced_features[feature];
        // Handle different data types and null values
        if (value === null || value === undefined) return null;
        if (typeof value === 'string') {
          const parsed = parseFloat(value);
          return isNaN(parsed) ? null : parsed;
        }
        return typeof value === 'number' && !isNaN(value) ? value : null;
      })
      .filter(val => val !== null);
    
    if (values.length > 0) {
      const average = values.reduce((sum, val) => sum + val, 0) / values.length;
      
      // Convert to appropriate scale for Spotify format
      if (feature === 'bpm') {
        calculatedFeatures.tempo = Math.round(average);
      } else {
        // Convert 0-100 scale to 0-1 scale for Spotify compatibility
        const spotifyFeatureName = feature === 'happiness' ? 'valence' : feature;
        calculatedFeatures[spotifyFeatureName] = Math.min(1, Math.max(0, average / 100));
      }
    }
  });

  // Calculate loudness (convert from dB string to number)
  const loudnessValues = tracksWithFeatures
    .map(track => {
      const loudness = track.enhanced_features.loudness;
      if (typeof loudness === 'string' && loudness.includes('dB')) {
        const parsed = parseFloat(loudness.replace('dB', '').trim());
        return isNaN(parsed) ? null : parsed;
      }
      if (typeof loudness === 'number' && !isNaN(loudness)) {
        return loudness;
      }
      return null;
    })
    .filter(val => val !== null);

  if (loudnessValues.length > 0) {
    calculatedFeatures.loudness = loudnessValues.reduce((sum, val) => sum + val, 0) / loudnessValues.length;
  }

  // Set defaults for missing features (Spotify standard format)
  const defaults = {
    danceability: 0.5,
    energy: 0.5,
    speechiness: 0.1,
    acousticness: 0.3,
    instrumentalness: 0.1,
    liveness: 0.2,
    valence: 0.5,
    tempo: 120,
    loudness: -8,
    mode: 1,
    key: 5,
    time_signature: 4
  };

  // Merge calculated features with defaults
  const finalFeatures = { ...defaults, ...calculatedFeatures };

  // Add some calculated metrics based on the actual data
  const enhancedFeatureCount = tracksWithFeatures.length;
  const totalTracks = tracks.length;
  const enhancementRate = (enhancedFeatureCount / totalTracks) * 100;

  console.log(`Audio features calculated from ${enhancedFeatureCount}/${totalTracks} tracks (${enhancementRate.toFixed(1)}% enhancement rate)`);
  console.log('Calculated features:', {
    tempo: finalFeatures.tempo,
    energy: finalFeatures.energy?.toFixed(2),
    valence: finalFeatures.valence?.toFixed(2),
    danceability: finalFeatures.danceability?.toFixed(2)
  });

  return {
    ...finalFeatures,
    // Add metadata about the calculation
    _metadata: {
      source: 'calculated_from_tracks',
      tracks_analyzed: enhancedFeatureCount,
      total_tracks: totalTracks,
      enhancement_rate: enhancementRate,
      fallback_mood: enhancedFeatureCount === 0 ? fallbackMood : null,
      calculation_successful: enhancedFeatureCount > 0,
      features_calculated: Object.keys(calculatedFeatures)
    }
  };
}

/**
 * Fallback mood-based audio features (used when no enhanced features available)
 */
export function createAudioFeatures(mood) {
  const moodFeatures = {
    happy: {
      danceability: 0.8,
      energy: 0.7,
      speechiness: 0.1,
      acousticness: 0.2,
      instrumentalness: 0.1,
      liveness: 0.3,
      valence: 0.9,
      tempo: 130,
      loudness: -5,
      mode: 1,
      key: 5,
      time_signature: 4
    },
    sad: {
      danceability: 0.3,
      energy: 0.2,
      speechiness: 0.05,
      acousticness: 0.7,
      instrumentalness: 0.3,
      liveness: 0.1,
      valence: 0.2,
      tempo: 80,
      loudness: -12,
      mode: 0,
      key: 2,
      time_signature: 4
    },
    energetic: {
      danceability: 0.9,
      energy: 0.95,
      speechiness: 0.15,
      acousticness: 0.1,
      instrumentalness: 0.05,
      liveness: 0.4,
      valence: 0.8,
      tempo: 140,
      loudness: -3,
      mode: 1,
      key: 7,
      time_signature: 4
    },
    calm: {
      danceability: 0.3,
      energy: 0.2,
      speechiness: 0.03,
      acousticness: 0.8,
      instrumentalness: 0.6,
      liveness: 0.1,
      valence: 0.4,
      tempo: 70,
      loudness: -15,
      mode: 0,
      key: 3,
      time_signature: 4
    },
    romantic: {
      danceability: 0.5,
      energy: 0.4,
      speechiness: 0.05,
      acousticness: 0.6,
      instrumentalness: 0.2,
      liveness: 0.2,
      valence: 0.6,
      tempo: 90,
      loudness: -10,
      mode: 1,
      key: 4,
      time_signature: 4
    },
    angry: {
      danceability: 0.6,
      energy: 0.9,
      speechiness: 0.2,
      acousticness: 0.1,
      instrumentalness: 0.1,
      liveness: 0.3,
      valence: 0.2,
      tempo: 150,
      loudness: -2,
      mode: 0,
      key: 1,
      time_signature: 4
    },
    balanced: {
      danceability: 0.6,
      energy: 0.6,
      speechiness: 0.1,
      acousticness: 0.3,
      instrumentalness: 0.2,
      liveness: 0.2,
      valence: 0.6,
      tempo: 120,
      loudness: -8,
      mode: 1,
      key: 5,
      time_signature: 4
    }
  };

  const features = moodFeatures[mood] || moodFeatures.balanced;
  
  return {
    ...features,
    _metadata: {
      source: 'mood_based_synthetic',
      mood: mood
    }
  };
}

// Extract count from user prompt (e.g., "recommend 15 songs")
export function extractCountFromPrompt(prompt) {
  const matches = prompt.match(/\b(\d+)\s*(?:songs?|tracks?|recommendations?)\b/i);
  if (matches) {
    const count = parseInt(matches[1]);
    return count > 0 && count <= 50 ? count : null; // Reasonable limits
  }
  return null;
}

// Format track duration from milliseconds to MM:SS
export function formatDuration(durationMs) {
  if (!durationMs || typeof durationMs !== 'number') {
    return 'Unknown';
  }
  
  const minutes = Math.floor(durationMs / 60000);
  const seconds = Math.floor((durationMs % 60000) / 1000);
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

// Clean track name for better matching
export function cleanTrackName(name) {
  if (!name || typeof name !== 'string') {
    return '';
  }
  
  return name
    .toLowerCase()
    .replace(/[^\w\s]/g, '') // Remove special characters
    .replace(/\s+/g, ' ')    // Normalize whitespace
    .trim();
}

// Generate a unique request ID
export function generateRequestId() {
  return `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

// Validate Spotify track object
export function isValidSpotifyTrack(track) {
  return (
    track &&
    typeof track === 'object' &&
    track.id &&
    track.name &&
    track.artists &&
    Array.isArray(track.artists) &&
    track.artists.length > 0
  );
}

// Extract artist names from track
export function getArtistNames(track) {
  if (!track || !track.artists || !Array.isArray(track.artists)) {
    return ['Unknown Artist'];
  }
  
  return track.artists.map(artist => artist.name || 'Unknown Artist');
}

// Calculate similarity between two audio feature objects
export function calculateAudioSimilarity(features1, features2) {
  if (!features1 || !features2) {
    return 0;
  }
  
  const compareFeatures = ['danceability', 'energy', 'valence', 'acousticness'];
  let totalSimilarity = 0;
  let validComparisons = 0;
  
  compareFeatures.forEach(feature => {
    const val1 = features1[feature];
    const val2 = features2[feature];
    
    if (typeof val1 === 'number' && typeof val2 === 'number') {
      const similarity = 1 - Math.abs(val1 - val2);
      totalSimilarity += similarity;
      validComparisons++;
    }
  });
  
  return validComparisons > 0 ? totalSimilarity / validComparisons : 0;
}

// Shuffle array using Fisher-Yates algorithm
export function shuffleArray(array) {
  if (!Array.isArray(array)) {
    return [];
  }
  
  const shuffled = [...array]; // Create a copy to avoid mutating original
  
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  
  return shuffled;
}

// Remove duplicate tracks based on track ID
export function removeDuplicateTracks(tracks) {
  if (!Array.isArray(tracks)) {
    return [];
  }
  
  const seen = new Set();
  return tracks.filter(track => {
    if (!track || !track.id) {
      return false;
    }
    
    if (seen.has(track.id)) {
      return false;
    }
    
    seen.add(track.id);
    return true;
  });
}

// Remove duplicate tracks based on name and artist combination
export function removeDuplicateTracksByNameArtist(tracks) {
  if (!Array.isArray(tracks)) {
    return [];
  }
  
  const seen = new Set();
  return tracks.filter(track => {
    if (!track || !track.name || !track.artists || !track.artists[0]) {
      return false;
    }
    
    const key = `${track.name.toLowerCase()}-${track.artists[0].name.toLowerCase()}`;
    
    if (seen.has(key)) {
      return false;
    }
    
    seen.add(key);
    return true;
  });
}

// Chunk array into smaller arrays of specified size
export function chunkArray(array, chunkSize) {
  if (!Array.isArray(array) || chunkSize <= 0) {
    return [];
  }
  
  const chunks = [];
  for (let i = 0; i < array.length; i += chunkSize) {
    chunks.push(array.slice(i, i + chunkSize));
  }
  
  return chunks;
}

// Delay execution for specified milliseconds
export function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Safe JSON parse with fallback
export function safeJsonParse(jsonString, fallback = null) {
  try {
    return JSON.parse(jsonString);
  } catch (error) {
    console.warn('Failed to parse JSON:', error.message);
    return fallback;
  }
}
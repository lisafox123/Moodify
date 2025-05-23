// Audd.io API integration for audio feature analysis
export async function analyzeTracksWithAudd(tracks) {
    try {
      console.log(`Analyzing ${tracks.length} tracks with Audd.io`);
      
      const auddResults = [];
      const auddApiToken = process.env.AUDDIO_API_KEY || 'test';
      
      // Process tracks in batches to avoid rate limiting
      const batchSize = 3; // Reduced batch size
      for (let i = 0; i < tracks.length; i += batchSize) {
        const batch = tracks.slice(i, i + batchSize);
        
        for (const track of batch) {
          try {
            // Use Spotify URL instead of preview URL
            const trackUrl = `https://open.spotify.com/track/${track.id}`;
            console.log(`Analyzing ${track.name} with Spotify URL: ${trackUrl}`);
  
            const params = new URLSearchParams({
              url: trackUrl,
              return: 'apple_music,spotify,mood,genre,tempo',
              api_token: auddApiToken
            });
  
            const auddResponse = await fetch(`https://api.audd.io/?${params.toString()}`, {
              method: 'GET',
              headers: {
                'Accept': 'application/json'
              }
            });
  
            if (auddResponse.ok) {
              const auddData = await auddResponse.json();
              
              if (auddData.status === 'success' && auddData.result) {
                auddResults.push({
                  track_id: track.id,
                  features: {
                    tempo: auddData.result.tempo || null,
                    genre: auddData.result.genre || null,
                    mood: auddData.result.mood || null,
                    energy: auddData.result.energy || null,
                    danceability: auddData.result.danceability || null,
                    valence: auddData.result.valence || null,
                    acousticness: auddData.result.acousticness || null,
                    instrumentalness: auddData.result.instrumentalness || null,
                    liveness: auddData.result.liveness || null,
                    speechiness: auddData.result.speechiness || null
                  },
                  metadata: auddData.result
                });
                console.log(`✓ Successfully analyzed ${track.name}`);
              } else {
                console.log(`Audd.io couldn't analyze ${track.name}, using fallback`);
                auddResults.push({
                  track_id: track.id,
                  features: generateFallbackFeatures(track),
                  error: auddData.error || 'Analysis failed'
                });
              }
            } else {
              console.warn(`Audd.io API error for ${track.name}, using fallback`);
              auddResults.push({
                track_id: track.id,
                features: generateFallbackFeatures(track),
                error: `API error: ${auddResponse.status}`
              });
            }
  
            // Add delay to respect rate limits
            await new Promise(resolve => setTimeout(resolve, 500));
  
          } catch (error) {
            console.error(`Error analyzing ${track.name} with Audd.io:`, error);
            auddResults.push({
              track_id: track.id,
              features: generateFallbackFeatures(track),
              error: error.message
            });
          }
        }
        
        // Longer delay between batches
        if (i + batchSize < tracks.length) {
          await new Promise(resolve => setTimeout(resolve, 2000));
        }
      }
  
      const successfulAnalyses = auddResults.filter(r => r.features && !r.error);
      console.log(`Audd.io analysis complete: ${successfulAnalyses.length}/${auddResults.length} successful (including fallbacks)`);
      return auddResults;
  
    } catch (error) {
      console.error('Error in Audd.io analysis:', error);
      return tracks.map(track => ({
        track_id: track.id,
        features: generateFallbackFeatures(track),
        error: error.message
      }));
    }
  }
  
  // Generate fallback features based on track metadata
  function generateFallbackFeatures(track) {
    try {
      // Use track popularity and artist info to estimate features
      const popularity = track.popularity || 50;
      const genres = track.artists?.[0]?.genres || [];
      const trackName = track.name.toLowerCase();
      const artistName = track.artists?.[0]?.name.toLowerCase() || '';
      
      // Basic feature estimation based on popularity and genres
      let energy = 0.5;
      let valence = 0.5;
      let danceability = 0.5;
      let tempo = 120;
      
      // Adjust based on popularity (more popular = more energetic/danceable)
      energy = Math.min(0.9, 0.3 + (popularity / 100) * 0.6);
      danceability = Math.min(0.9, 0.2 + (popularity / 100) * 0.7);
      
      // Adjust based on track name keywords
      const happyWords = ['happy', 'joy', 'love', 'good', 'great', 'amazing', 'wonderful', 'sunshine', 'bright', 'dance', 'party', 'fun'];
      const sadWords = ['sad', 'cry', 'tears', 'hurt', 'pain', 'broken', 'lonely', 'dark', 'empty', 'sorry'];
      const energeticWords = ['power', 'strong', 'energy', 'fire', 'rock', 'wild', 'crazy', 'fast', 'run', 'jump'];
      
      // Check for mood indicators in track name
      if (happyWords.some(word => trackName.includes(word))) {
        valence += 0.3;
        energy += 0.1;
        danceability += 0.2;
      }
      
      if (sadWords.some(word => trackName.includes(word))) {
        valence -= 0.3;
        energy -= 0.2;
        tempo -= 20;
      }
      
      if (energeticWords.some(word => trackName.includes(word))) {
        energy += 0.3;
        tempo += 30;
        danceability += 0.2;
      }
      
      // Adjust based on genres if available
      if (genres.some(g => g.includes('dance') || g.includes('pop') || g.includes('electronic'))) {
        energy += 0.2;
        danceability += 0.3;
        valence += 0.2;
        tempo += 20;
      }
      
      if (genres.some(g => g.includes('sad') || g.includes('melancholy') || g.includes('blues'))) {
        valence -= 0.3;
        energy -= 0.2;
        tempo -= 15;
      }
      
      if (genres.some(g => g.includes('happy') || g.includes('upbeat') || g.includes('cheerful'))) {
        valence += 0.3;
        energy += 0.1;
        tempo += 10;
      }
      
      if (genres.some(g => g.includes('rock') || g.includes('metal') || g.includes('punk'))) {
        energy += 0.4;
        tempo += 25;
      }
      
      if (genres.some(g => g.includes('classical') || g.includes('ambient') || g.includes('chill'))) {
        energy -= 0.2;
        valence = 0.5; // Neutral
        tempo -= 20;
      }
      
      // Artist-based adjustments for known happy artists
      const happyArtists = ['pharrell williams', 'bruno mars', 'justin timberlake', 'dua lipa', 'lizzo'];
      if (happyArtists.some(artist => artistName.includes(artist))) {
        valence += 0.2;
        energy += 0.1;
      }
      
      // Clamp values between 0 and 1
      energy = Math.max(0.1, Math.min(0.9, energy));
      valence = Math.max(0.1, Math.min(0.9, valence));
      danceability = Math.max(0.1, Math.min(0.9, danceability));
      tempo = Math.max(60, Math.min(200, tempo));
      
      // Determine mood based on valence and energy
      let mood = 'neutral';
      if (valence > 0.7 && energy > 0.6) mood = 'happy';
      else if (valence > 0.6) mood = 'upbeat';
      else if (valence < 0.4 && energy < 0.5) mood = 'sad';
      else if (energy > 0.7) mood = 'energetic';
      else if (energy < 0.4) mood = 'calm';
      
      return {
        tempo: Math.round(tempo),
        energy: Math.round(energy * 100) / 100,
        valence: Math.round(valence * 100) / 100,
        danceability: Math.round(danceability * 100) / 100,
        acousticness: 0.3,
        instrumentalness: trackName.includes('instrumental') ? 0.8 : 0.1,
        liveness: 0.2,
        speechiness: trackName.includes('rap') || trackName.includes('spoken') ? 0.7 : 0.1,
        genre: genres.length > 0 ? genres[0] : 'pop',
        mood: mood
      };
    } catch (error) {
      console.error('Error generating fallback features:', error);
      return {
        tempo: 120,
        energy: 0.5,
        valence: 0.5,
        danceability: 0.5,
        acousticness: 0.3,
        instrumentalness: 0.1,
        liveness: 0.2,
        speechiness: 0.1,
        genre: 'pop',
        mood: 'neutral'
      };
    }
  }
  
  // Enhanced analysis combining Audd.io results (no more Spotify audio features)
  export async function enhancedFeatureAnalysis(tracks, token) {
    try {
      console.log('Performing enhanced feature analysis with Audd.io...');
      
      // Get Audd.io analysis
      const auddResults = await analyzeTracksWithAudd(tracks);
      
      // Combine results with track data
      const combinedFeatures = tracks.map((track, index) => {
        const auddResult = auddResults.find(r => r.track_id === track.id);
        
        return {
          ...track,
          audioFeatures: auddResult?.features || generateFallbackFeatures(track),
          auddMetadata: auddResult?.metadata || null,
          analysisSource: auddResult?.features && !auddResult?.error ? 'audd.io' : 'fallback'
        };
      });
  
      const auddCount = combinedFeatures.filter(t => t.analysisSource === 'audd.io').length;
      const fallbackCount = combinedFeatures.filter(t => t.analysisSource === 'fallback').length;
      
      console.log(`Enhanced analysis complete: ${auddCount} from Audd.io, ${fallbackCount} from fallback`);
      return combinedFeatures;
    } catch (error) {
      console.error('Error in enhanced feature analysis:', error);
      // Return tracks with fallback features
      return tracks.map(track => ({
        ...track,
        audioFeatures: generateFallbackFeatures(track),
        auddMetadata: null,
        analysisSource: 'fallback'
      }));
    }
  }
  
  // Batch analysis function for better performance
  export async function analyzeBatchWithAuddio(tracks, apiToken, maxConcurrent = 3) {
    const results = [];
    
    // Process in batches to avoid rate limiting
    for (let i = 0; i < tracks.length; i += maxConcurrent) {
      const batch = tracks.slice(i, i + maxConcurrent);
      const batchPromises = batch.map(track => analyzeTrackWithAuddio(track, apiToken));
      
      try {
        const batchResults = await Promise.all(batchPromises);
        results.push(...batchResults.filter(result => result !== null));
        
        // Add delay between batches to respect rate limits
        if (i + maxConcurrent < tracks.length) {
          await new Promise(resolve => setTimeout(resolve, 2000));
        }
      } catch (error) {
        console.error('Error processing batch:', error);
      }
    }
    
    return results;
  }
  
  // Individual track analysis function
  export async function analyzeTrackWithAuddio(track, apiToken) {
    try {
      // Use Spotify URL instead of preview URL
      const trackUrl = `https://open.spotify.com/track/${track.id}`;
      
      const params = new URLSearchParams({
        url: trackUrl,
        return: 'apple_music,spotify,mood,genre,tempo',
        api_token: apiToken
      });
      
      const response = await fetch(`https://api.audd.io/?${params.toString()}`, {
        method: 'GET',
        headers: {
          'Accept': 'application/json'
        }
      });
      
      if (!response.ok) {
        throw new Error(`Audd.io API error: ${response.statusText}`);
      }
      
      const data = await response.json();
      
      if (data.status === 'success' && data.result) {
        return {
          trackId: track.id,
          mood: data.result.mood || null,
          genre: data.result.genre || null,
          tempo: data.result.tempo || null,
          energy: data.result.energy || null,
          danceability: data.result.danceability || null,
          valence: data.result.valence || null,
          acousticness: data.result.acousticness || null,
          instrumentalness: data.result.instrumentalness || null,
          liveness: data.result.liveness || null,
          speechiness: data.result.speechiness || null,
          metadata: data.result
        };
      }
      
      return null;
    } catch (error) {
      console.error(`Error analyzing track ${track.id} with Audd.io:`, error);
      return null;
    }
  }
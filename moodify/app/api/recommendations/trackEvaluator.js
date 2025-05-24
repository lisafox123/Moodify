import OpenAI from "openai";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

export async function evaluateTrackAlignment(tracks, prompt, mood) {
  try {
    console.log(`Evaluating ${tracks.length} tracks for alignment with prompt and mood`);
    
    // Prepare track data with features for evaluation
    const tracksData = tracks.map(track => ({
      id: track.id,
      name: track.name,
      artists: track.artists.map(artist => artist.name).join(', '),
      popularity: track.popularity,
      album: track.album?.name || 'Unknown Album',
      audioFeatures: track.audioFeatures || null,
      auddMetadata: track.auddMetadata || null
    }));

    // Split tracks into chunks for processing
    const chunkSize = 15; // Smaller chunks for better processing
    const chunks = [];
    for (let i = 0; i < tracksData.length; i += chunkSize) {
      chunks.push(tracksData.slice(i, i + chunkSize));
    }

    let allEvaluations = [];

    for (const chunk of chunks) {
      try {
        const response = await openai.chat.completions.create({
            model: "gpt-4.1-mini",
            messages: [
              {
                role: "system",
                content: `
          You are a music expert evaluating how well a set of songs matches a user's intended mood, based on title, artist, and musical/lyrical qualities.
          
          Instructions:
          1. For each track, assess its alignment with the user’s described mood and prompt.
          2. Consider:
             - Known genre or artist style
             - Audio features (if available): tempo, energy, valence, danceability
             - Lyrical themes or vibe (if known)
             - General emotional tone and instrumentation
          3. Use a **1–10 scale** for alignment (10 = perfect fit, 7+ = reasonable match).
          
          Be generous: a score of 7+ means the song has any meaningful connection to the user's mood, even if indirect. For example:
          - Happy moods → upbeat pop, dance, funk, sunshine indie, warm acoustic rock
          - Chill moods → lo-fi, soft jazz, ambient, mellow R&B
          - Sad moods → slow ballads, introspective lyrics, low valence tracks
          
          Return only a JSON object with:
          {
            "evaluations": [
              { "id": "track_id", "score": 8, "reason": "brief reason for fit (mention genre, lyrics, or vibe)" },
              ...
            ]
          }
          `
              },
              {
                role: "user",
                content: `User prompt: "${prompt}"
          Target mood: "${mood}"
          
          Evaluate these tracks generously based on alignment:
          ${JSON.stringify(chunk, null, 2)}`
              }
            ],
            temperature: 0.2,
          });

        const content = response.choices[0]?.message?.content || "";
        
        try {
          const jsonStr = content.replace(/```json|```/g, '').trim();
          const result = JSON.parse(jsonStr);
          
          if (result.evaluations && Array.isArray(result.evaluations)) {
            allEvaluations.push(...result.evaluations);
          }
        } catch (parseError) {
          console.error('Failed to parse evaluation result:', parseError);
          console.log('Raw content:', content);
          
          // Fallback: give all tracks in chunk a score of 6 (decent match)
          const fallbackEvaluations = chunk.map(track => ({
            id: track.id,
            score: 6,
            reason: 'Fallback scoring due to parsing error'
          }));
          allEvaluations.push(...fallbackEvaluations);
        }
      } catch (error) {
        console.error('Error in track evaluation chunk:', error);
        
        // Fallback: give all tracks in chunk a decent score
        const fallbackEvaluations = chunk.map(track => ({
          id: track.id,
          score: 6,
          reason: 'Fallback scoring due to API error'
        }));
        allEvaluations.push(...fallbackEvaluations);
      }
    }

    // Filter tracks based on scores - be more lenient with threshold
    const highQualityTracks = [];
    const lowQualityTracks = [];
    
    for (const track of tracks) {
      const evaluation = allEvaluations.find(e => e.id === track.id);
      const score = evaluation?.score || 6; // Default to decent score instead of 5
      
      if (score >= 6) { // Lowered threshold from 7 to 6
        highQualityTracks.push({
          ...track,
          alignmentScore: score,
          alignmentReason: evaluation?.reason || 'Good match'
        });
      } else {
        lowQualityTracks.push({
          ...track,
          alignmentScore: score,
          alignmentReason: evaluation?.reason || 'Poor match'
        });
      }
    }

    console.log(`Track evaluation complete: ${highQualityTracks.length} high-quality, ${lowQualityTracks.length} low-quality`);
    
    return {
      highQualityTracks,
      lowQualityTracks,
      allEvaluations
    };

  } catch (error) {
    console.error('Error evaluating track alignment:', error);
    
    // Complete fallback: treat all tracks as decent quality
    const fallbackTracks = tracks.map(track => ({
      ...track,
      alignmentScore: 6,
      alignmentReason: 'Fallback due to evaluation error'
    }));
    
    return {
      highQualityTracks: fallbackTracks,
      lowQualityTracks: [],
      allEvaluations: []
    };
  }
}

// Function to get top artists for fallback recommendations
export async function getUserTopArtists(token, limit = 5) {
  try {
    console.log(`Fetching user's top ${limit} artists`);
    
    const response = await fetch(`https://api.spotify.com/v1/me/top/artists?limit=${limit}`, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      }
    });

    if (response.ok) {
      const data = await response.json();
      return data.items || [];
    } else {
      console.warn('Error fetching top artists:', response.status);
      return [];
    }
  } catch (error) {
    console.error('Error getting user top artists:', error);
    return [];
  }
}

// Function to get artist's popular tracks
export async function getArtistTracks(artistId, token, limit = 5) {
  try {
    const response = await fetch(`https://api.spotify.com/v1/artists/${artistId}/top-tracks?market=US`, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      }
    });

    if (response.ok) {
      const data = await response.json();
      return (data.tracks || []).slice(0, limit);
    } else {
      console.warn(`Error fetching tracks for artist ${artistId}:`, response.status);
      return [];
    }
  } catch (error) {
    console.error(`Error getting artist tracks for ${artistId}:`, error);
    return [];
  }
}
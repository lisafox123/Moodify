import OpenAI from "openai";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

export async function analyzeTracksWithAI(tracks, prompt, mood, targetCount = 40) {
  try {
    console.log(`Analyzing ${tracks.length} tracks with AI to select ${targetCount} that match the prompt`);
    
    // Prepare track data for AI analysis
    const tracksData = tracks.map(track => ({
      id: track.id,
      name: track.name,
      artists: track.artists.map(artist => artist.name).join(', '),
      popularity: track.popularity,
      album: track.album?.name || 'Unknown Album',
      preview_url: track.preview_url || null
    }));

    // Split tracks into chunks to avoid token limits
    const chunkSize = 50;
    const chunks = [];
    for (let i = 0; i < tracksData.length; i += chunkSize) {
      chunks.push(tracksData.slice(i, i + chunkSize));
    }

    let selectedTracks = [];

    for (const chunk of chunks) {
      if (selectedTracks.length >= targetCount) break;

      try {
        const response = await openai.chat.completions.create({
            model: "gpt-4o",
            messages: [
              {
                role: "system",
                content: `
          You are a team of music curation experts: a musicologist, a lyric analyst, and a sound designer. Together, you evaluate whether tracks from a user's library match a target mood described by a prompt.
          
          Your task:
          - Analyze each track using knowledge of the artist, genre, lyrics, and emotional tone.
          - Determine if the track fits the described mood and user intent.
          - Prioritize alignment in terms of emotional content, lyrical themes, genre, tempo, instrumentation, and historical/cultural associations.
          - Think step-by-step for each track and only include tracks that truly fit.
          
          Return ONLY a valid JSON object with:
          - "selected": an array of track IDs (max ${Math.min(targetCount - selectedTracks.length, 20)}) that strongly align with the prompt and mood.
          - "reasons": an object where each selected track ID maps to a concise explanation of why it fits the mood (e.g., emotional tone, lyrics, genre, etc.)
          
          Do NOT include tracks that are neutral or uncertain. Be selective. Only tracks that strongly support the mood should be chosen.
                `
              },
              {
                role: "user",
                content: `
          User prompt: "${prompt}"
          Target mood: "${mood}"
          
          Analyze these tracks and select those that best match:
          ${JSON.stringify(chunk, null, 2)}
                `
              }
            ],
            temperature: 0.3,
            max_tokens: 1500
          });

        const content = response.choices[0]?.message?.content || "";
        
        try {
          const jsonStr = content.replace(/```json|```/g, '').trim();
          const result = JSON.parse(jsonStr);
          
          if (result.selected && Array.isArray(result.selected)) {
            // Get the actual track objects for selected IDs
            const chunkSelected = chunk.filter(track => result.selected.includes(track.id));
            selectedTracks.push(...chunkSelected);
            
            console.log(`Selected ${chunkSelected.length} tracks from chunk of ${chunk.length}`);
          }
        } catch (parseError) {
          console.error('Failed to parse AI analysis result:', parseError);
        }
      } catch (error) {
        console.error('Error in AI track analysis chunk:', error);
      }
    }

    // Convert back to full track objects
    const selectedTrackIds = new Set(selectedTracks.map(t => t.id));
    const fullSelectedTracks = tracks.filter(track => selectedTrackIds.has(track.id));

    console.log(`AI selected ${fullSelectedTracks.length} tracks that match the prompt`);
    return fullSelectedTracks;

  } catch (error) {
    console.error('Error in AI track analysis:', error);
    // Fallback: return a random selection
    return tracks.slice(0, Math.min(targetCount, tracks.length));
  }
}
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
              content: `You are a music expert analyzing songs for mood matching. 
              Analyze each song and determine if it matches the user's prompt and mood based on:
              1. Song title and artist knowledge
              2. Musical style and genre associations
              3. Lyrical themes (if known)
              4. Overall vibe and emotional content
              
              Return ONLY a JSON object with:
              - "selected": array of track IDs that strongly match (aim for ${Math.min(targetCount - selectedTracks.length, 20)} selections)
              - "reasons": object with track ID as key and brief reason as value
              
              Be selective - only choose songs that genuinely fit the mood/prompt.`
            },
            {
              role: "user",
              content: `User prompt: "${prompt}"
              Target mood: "${mood}"
              
              Analyze these tracks and select those that best match:
              ${JSON.stringify(chunk, null, 2)}`
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
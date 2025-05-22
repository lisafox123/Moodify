// ai-analysis.js
import OpenAI from "openai";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

export async function analyzeMood(prompt) {
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

export async function evaluateRecommendations(tracks, prompt, mood) {
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

export async function generateStory(recommendations, prompt, customStory, recommendationType, outputFormat) {
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

    return aiResponse.choices[0]?.message?.content || "";
  } catch (aiError) {
    console.error('Error generating story with AI:', aiError);
    // Fallback to simple story if AI fails
    if (outputFormat === "track") {
      return `A song curated for your "${prompt}" mood.`;
    } else {
      return `A playlist curated for your "${prompt}" mood.`;
    }
  }
}

export function extractSongsFromAIResponse(text) {
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

export async function getClassicRecommendations(prompt, token, searchMultipleTracksOnSpotify) {
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
    const aiSuggestions = finalRecommendationResponse.choices[0]?.message?.content || "";
    console.log("AI suggestions:", aiSuggestions);
    
    // Extract track information from AI response
    const extractedTracks = extractSongsFromAIResponse(aiSuggestions);
    console.log("Extracted tracks:", extractedTracks);
    
    // Search for these songs on Spotify
    const spotifyResults = await searchMultipleTracksOnSpotify(extractedTracks, token);
    
    // If we found tracks on Spotify, use them
    if (spotifyResults.length > 0) {
      console.log(`Found ${spotifyResults.length} tracks on Spotify for classic recommendations`);
      return spotifyResults;
    }
    
    return [];
  } catch (error) {
    console.error("Error handling classic recommendation type:", error);
    return [];
  }
}
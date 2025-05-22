// quality-control.js
import OpenAI from "openai";
import { getReplacementTracks } from './recommendation-engine';
import { evaluateRecommendations } from './ai-analysis';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

export async function performQualityCheck(recommendations, prompt, mood, token) {
  if (!recommendations || recommendations.length <= 1) {
    return recommendations;
  }

  try {
    // Get evaluation of current recommendations
    const evaluation = await evaluateRecommendations(recommendations, prompt, mood);
    
    // Check if we need replacements
    if (evaluation.replacement_needed && evaluation.replacement_needed.length > 0) {
      console.log(`Need to replace ${evaluation.replacement_needed.length} tracks that don't match the prompt well`);
      
      // Get track IDs that need replacement
      const replaceIds = new Set(evaluation.replacement_needed);
      
      // Keep good tracks
      const goodTracks = recommendations.filter(track => !replaceIds.has(track.id));
      
      // Get replacement tracks using Spotify Recommendations API
      const replacementCount = Math.min(replaceIds.size, 5); // Limit to 5 replacements at once
      const replacementTracks = await getReplacementTracks(token, prompt, mood, replacementCount);
      
      if (replacementTracks.length > 0) {
        // Combine good tracks with replacements
        return [...goodTracks, ...replacementTracks];
      }
    }
    
    return recommendations;
  } catch (error) {
    console.error("Error during quality check:", error);
    // Continue with original recommendations if quality check fails
    return recommendations;
  }
}

export async function performFinalVerification(recommendations, prompt, outputFormat) {
  if (outputFormat === "track" && recommendations.length > 1) {
    try {
      const finalEval = await evaluateRecommendations(recommendations, prompt, "balanced");
      
      // Sort by match score (highest first)
      const sortedTracks = [...recommendations].sort((a, b) => {
        const scoreA = finalEval.evaluation.find(e => e.id === a.id)?.match_score || 0;
        const scoreB = finalEval.evaluation.find(e => e.id === b.id)?.match_score || 0;
        return scoreB - scoreA;
      });
      
      // Take the best match
      return [sortedTracks[0]];
    } catch (error) {
      console.error("Error during final verification:", error);
      return [recommendations[0]];
    }
  }
  
  // For playlist output, limit to maximum 20 songs
  if (outputFormat === "playlist" && recommendations.length > 20) {
    console.log(`Limiting playlist from ${recommendations.length} to 20 songs maximum`);
    recommendations = recommendations.slice(0, 20);
  }
  
  // Additional verification step for playlists to ensure alignment with prompt
  if (outputFormat === "playlist" && recommendations.length > 1) {
    try {
      console.log("Performing final verification of playlist songs alignment with prompt...");
      
      // Get track info for verification
      const tracksInfo = recommendations.map(track => ({
        id: track.id,
        name: track.name,
        artists: track.artists.map(artist => artist.name).join(', ')
      }));
      
      // Use OpenAI to verify alignment
      const verificationResponse = await openai.chat.completions.create({
        model: "gpt-3.5-turbo",
        messages: [
          {
            role: "system",
            content: `You are a music expert evaluating if songs match a user's prompt. 
            For each song, determine if it matches. Return ONLY a JSON array with the IDs 
            of songs that DO match the prompt well. Do not include songs that seem unrelated 
            or don't fit the theme/mood.`
          },
          {
            role: "user",
            content: `User prompt: "${prompt}"
            
            Evaluate these songs and return only the IDs of songs that match the prompt:
            ${JSON.stringify(tracksInfo, null, 2)}`
          }
        ],
        temperature: 0.3,
        max_tokens: 500
      });
      
      // Parse verification result
      try {
        const content = verificationResponse.choices[0]?.message?.content || "[]";
        // Clean the response in case it has markdown code blocks
        const jsonStr = content.replace(/```json|```/g, '').trim();
        const matchingIds = JSON.parse(jsonStr);
        
        if (Array.isArray(matchingIds) && matchingIds.length > 0) {
          // Keep only matching songs but ensure we have at least 3 songs (if available)
          const matchingTracks = recommendations.filter(track => matchingIds.includes(track.id));
          
          if (matchingTracks.length >= 5 || matchingTracks.length === recommendations.length) {
            console.log(`Keeping ${matchingTracks.length} songs that align with the prompt out of ${recommendations.length}`);
            return matchingTracks;
          } else {
            console.log(`Only ${matchingTracks.length} songs matched strongly, but keeping at least 5 for variety`);
            // Sort recommendations: matching first, then others
            return [
              ...matchingTracks,
              ...recommendations.filter(track => !matchingIds.includes(track.id))
            ].slice(0, Math.max(3, matchingTracks.length));
          }
        }
      } catch (parseError) {
        console.error('Failed to parse verification result:', parseError);
        // Continue with original recommendations if parsing fails
      }
    } catch (error) {
      console.error('Error during additional verification:', error);
      // Continue with original recommendations if verification fails
    }
  }
  
  return recommendations;
}
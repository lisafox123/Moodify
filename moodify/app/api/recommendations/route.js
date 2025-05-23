import { NextResponse } from 'next/server';

// Import all modules (fix relative paths)
import { analyzeMood } from './analyzeMood.js';
import { fetchLibrary } from './fetchLibrary.js';
import { analyzeTracksWithAI } from './aiTrackAnalyzer.js';
import { enhancedFeatureAnalysis } from './auddAnalyzer.js';
import { evaluateTrackAlignment } from './trackEvaluator.js';
import { generateFallbackRecommendations } from './fallbackRecommendations.js';
import { generateClassicRecommendations } from './classicRecommendations.js';
import { createSpotifyPlaylist } from './spotifyHelpers.js';
import { 
  validateRequestParams, 
  generatePlaylistStory, 
  createAudioFeatures 
} from './utils.js';

export async function POST(request) {
  try {
    const body = await request.json();
    
    // Validate request parameters
    const validation = validateRequestParams(body);
    if (!validation.isValid) {
      return NextResponse.json({ 
        error: validation.errors.join(', ') 
      }, { status: 400 });
    }

    const { 
      prompt, 
      token, 
      seedTracks = [], 
      customStory = "", 
      createPlaylistFlag = false, 
      playlistName = "", 
      manualTracks = [],
      recommendationType = "mood",
      outputFormat = "track",
      qualityCheck = true
    } = body;

    // Handle playlist creation if that's what we're doing
    if (createPlaylistFlag && manualTracks && manualTracks.length > 0) {
      try {
        const playlist = await createSpotifyPlaylist(token, playlistName, manualTracks, customStory);
        return NextResponse.json({
          playlist: playlist,
          message: 'Playlist created successfully',
          recommendationType: 'mood',
          outputFormat: 'playlist'
        });
      } catch (error) {
        return NextResponse.json({ 
          error: error.message || 'Failed to create playlist' 
        }, { status: 500 });
      }
    }

    let recommendations = [];
    let mood = "balanced";

    // WORKFLOW BRANCHES
    if (recommendationType === "mood") {
      recommendations = await processMoodRecommendations(prompt, token, outputFormat, qualityCheck);
      mood = await analyzeMood(prompt);
    } else if (recommendationType === "classic") {
      recommendations = await processClassicRecommendations(prompt, token, outputFormat);
    }

    // Validate we have recommendations
    if (!recommendations || recommendations.length === 0) {
      return NextResponse.json({ 
        error: 'Could not generate recommendations with the provided parameters'
      }, { status: 404 });
    }

    // Generate story and audio features
    const story = await generatePlaylistStory(
      recommendations, 
      prompt, 
      mood, 
      customStory, 
      recommendationType, 
      outputFormat
    );
    
    const audioFeatures = createAudioFeatures(mood);

    // Return final response
    return NextResponse.json({
      recommendations: recommendations,
      audioFeatures: audioFeatures,
      mood: mood,
      story: story,
      recommendationType: recommendationType,
      outputFormat: outputFormat
    });
    
  } catch (error) {
    console.error('API error:', error);
    return NextResponse.json({ 
      error: error.message || 'Internal server error' 
    }, { status: 500 });
  }
}

// MOOD RECOMMENDATION WORKFLOW
async function processMoodRecommendations(prompt, token, outputFormat, qualityCheck) {
  try {
    console.log("=== STARTING MOOD RECOMMENDATION WORKFLOW ===");
    
    // Step 1: Analyze user's mood
    console.log("Step 1: Analyzing mood...");
    const mood = await analyzeMood(prompt);
    console.log(`Detected mood: ${mood}`);
    
    // Step 2: Fetch user's library
    console.log("Step 2: Fetching user's library...");
    const libraryTracks = await fetchLibrary(token);
    console.log(`Retrieved ${libraryTracks.length} tracks from library`);
    
    if (libraryTracks.length === 0) {
      console.warn("No tracks found in user's library, trying Spotify recommendations API directly");
      const { getSpotifyRecommendations } = await import('./fallbackRecommendations.js');
      const targetCount = outputFormat === 'track' ? 1 : 10;
      return await getSpotifyRecommendations(token, mood, targetCount);
    }
    
    // Step 3: AI analysis to choose 30-50 songs that match prompt
    console.log("Step 3: AI analyzing tracks for mood match...");
    const targetCount = outputFormat === 'track' ? 5 : 20; // Get fewer for better quality
    const aiSelectedTracks = await analyzeTracksWithAI(libraryTracks, prompt, mood, targetCount);
    console.log(`AI selected ${aiSelectedTracks.length} tracks`);
    
    if (aiSelectedTracks.length === 0) {
      console.warn("AI couldn't find matching tracks in library, using fallback");
      const fallbackCount = outputFormat === 'track' ? 1 : 10;
      return await generateFallbackRecommendations(token, prompt, mood, [], fallbackCount);
    }
    
    // Step 4: Use enhanced analysis for features (with fallbacks for missing preview URLs)
    console.log("Step 4: Analyzing audio features...");
    const tracksWithFeatures = await enhancedFeatureAnalysis(aiSelectedTracks, token);
    console.log(`Enhanced ${tracksWithFeatures.length} tracks with audio features`);
    
    // Step 5: Use OpenAI again to carefully select tracks that align with mood
    console.log("Step 5: Evaluating track alignment...");
    const evaluation = await evaluateTrackAlignment(tracksWithFeatures, prompt, mood);
    console.log(`Found ${evaluation.highQualityTracks.length} high-quality tracks`);
    
    let finalTracks = evaluation.highQualityTracks;
    
    // Step 5.1: Check if we need fallback recommendations
    const minRequired = outputFormat === 'track' ? 1 : 5; // Reduced minimum for playlist
    if (finalTracks.length < minRequired) {
      console.log(`Step 5.1: Need fallback recommendations (have ${finalTracks.length}, need ${minRequired})`);
      
      const fallbackTracks = await generateFallbackRecommendations(
        token, 
        prompt, 
        mood, 
        finalTracks, 
        minRequired - finalTracks.length
      );
      
      finalTracks = [...finalTracks, ...fallbackTracks];
      console.log(`Added ${fallbackTracks.length} fallback tracks, total now: ${finalTracks.length}`);
    }
    
    // Ensure we have at least something to return
    if (finalTracks.length === 0) {
      console.warn("Still no tracks found, using final fallback");
      const ultimateFallback = outputFormat === 'track' ? 1 : 10;
      finalTracks = await generateFallbackRecommendations(token, prompt, mood, [], ultimateFallback);
    }
    
    // Step 6: Format output based on type
    if (outputFormat === 'track') {
      // Return single best track
      return finalTracks.length > 0 ? [finalTracks[0]] : [];
    } else {
      // Return playlist (limit to 15 for better user experience)
      return finalTracks.slice(0, 15);
    }
    
  } catch (error) {
    console.error('Error in mood recommendation workflow:', error);
    
    // Emergency fallback
    try {
      console.log("Attempting emergency fallback...");
      const emergencyCount = outputFormat === 'track' ? 1 : 10;
      return await generateFallbackRecommendations(token, prompt, "balanced", [], emergencyCount);
    } catch (fallbackError) {
      console.error('Emergency fallback also failed:', fallbackError);
      throw error;
    }
  }
}

// CLASSIC RECOMMENDATION WORKFLOW  
async function processClassicRecommendations(prompt, token, outputFormat) {
  try {
    console.log("=== STARTING CLASSIC RECOMMENDATION WORKFLOW ===");
    
    // Step 1: Use web crawler simulation + AI to get classic songs
    console.log("Step 1-3: Generating classic recommendations...");
    const classicTracks = await generateClassicRecommendations(prompt, token);
    console.log(`Generated ${classicTracks.length} classic recommendations`);
    
    if (classicTracks.length === 0) {
      throw new Error("Could not find classic songs matching the prompt");
    }
    
    // Step 4: Format output based on type
    if (outputFormat === 'track') {
      // Return single best classic track
      return classicTracks.length > 0 ? [classicTracks[0]] : [];
    } else {
      // Return classic playlist (limit to 20)
      return classicTracks.slice(0, 20);
    }
    
  } catch (error) {
    console.error('Error in classic recommendation workflow:', error);
    throw error;
  }
}
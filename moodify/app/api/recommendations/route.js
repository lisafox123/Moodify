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
  createAudioFeaturesFromTracks
} from './utils.js';

// Import progress tracker
import { ProgressTracker } from '../../lib/progressStore.js';

export async function POST(request) {
  let progressTracker = null;
  
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
      qualityCheck = true,
      requestId = `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
    } = body;

    // Initialize progress tracker FIRST
    progressTracker = new ProgressTracker(requestId);
    console.log('ProgressTracker created successfully');

    await new Promise(resolve => setTimeout(resolve, 100));

    // Add this function to get userId from token
    async function getUserIdFromToken(token) {
      try {
        const response = await fetch('https://api.spotify.com/v1/me', {
          headers: { 'Authorization': `Bearer ${token}` }
        });

        if (response.ok) {
          const userData = await response.json();
          return userData.id;
        }
      } catch (error) {
        console.error('Failed to get user ID from token:', error);
      }

      return null;
    }

    const userId = token ? await getUserIdFromToken(token) : null;

    console.log("=== MUSIC RECOMMENDATION API REQUEST ===");
    console.log(`Type: ${recommendationType}, Format: ${outputFormat}, Prompt: "${prompt}"`);

    // Handle playlist creation if that's what we're doing
    if (createPlaylistFlag && manualTracks && manualTracks.length > 0) {
      await progressTracker.updateStep('playlist_creation', 'active', 'Creating playlist...');
      
      try {
        const playlist = await createSpotifyPlaylist(token, playlistName, manualTracks, customStory);
        await progressTracker.completeStep('playlist_creation', 'Playlist created successfully');
        await progressTracker.complete(playlist);
        
        return NextResponse.json({
          requestId,
          playlist: playlist,
          message: 'Playlist created successfully',
          recommendationType: 'mood',
          outputFormat: 'playlist'
        });
      } catch (error) {
        await progressTracker.setError('playlist_creation', error.message);
        return NextResponse.json({
          error: error.message || 'Failed to create playlist'
        }, { status: 500 });
      }
    }

    let recommendations = [];
    let mood = "balanced";
    let processingMetadata = {};

    // WORKFLOW BRANCHES
    if (recommendationType === "mood") {
      const result = await processMoodRecommendationsSimplified(prompt, token, outputFormat, qualityCheck, userId, progressTracker);
      recommendations = result.recommendations;
      mood = result.mood;
      processingMetadata = result.metadata;
    } else if (recommendationType === "classic") {
      const result = await processClassicRecommendations(prompt, token, outputFormat, progressTracker);
      recommendations = result.recommendations;
      processingMetadata = result.metadata;
    }

    // Validate we have recommendations
    if (!recommendations || recommendations.length === 0) {
      await progressTracker.setError('final_validation', 'Could not generate recommendations with the provided parameters');
      return NextResponse.json({
        error: 'Could not generate recommendations with the provided parameters',
        metadata: processingMetadata
      }, { status: 404 });
    }

    await progressTracker.updateStep('story_generation', 'active', 'Generating playlist story...');

    // Generate story and calculate audio features from enhanced tracks
    const story = await generatePlaylistStory(
      recommendations,
      prompt,
      mood,
      customStory,
      recommendationType,
      outputFormat
    );

    // Create audio features based on the actual tracks returned from FastAPI
    const audioFeatures = createAudioFeaturesFromTracks(recommendations, mood);

    await progressTracker.completeStep('story_generation', 'Story generated');

    console.log(`=== REQUEST COMPLETED: ${recommendations.length} recommendations generated ===`);

    // Mark as complete
    await progressTracker.complete({
      recommendations: recommendations.length,
      mood,
      story: story ? 'Generated' : 'None'
    });

    // Return final response
    return NextResponse.json({
      requestId,
      recommendations: recommendations,
      audioFeatures: audioFeatures,
      mood: mood,
      story: story,
      recommendationType: recommendationType,
      outputFormat: outputFormat,
      processingMetadata: processingMetadata
    });

  } catch (error) {
    console.error('API error:', error);
    if (progressTracker) {
      await progressTracker.setError('api_error', error.message);
    }
    
    return NextResponse.json({
      error: error.message || 'Internal server error',
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    }, { status: 500 });
  }
}

// SIMPLIFIED MOOD RECOMMENDATION WORKFLOW
async function processMoodRecommendationsSimplified(prompt, token, outputFormat, qualityCheck, userId, progressTracker) {
  const metadata = {
    workflow: "mood_simplified_with_fastapi",
    steps: [],
    timing: { start: Date.now() }
  };

  try {
    console.log("=== STARTING SIMPLIFIED MOOD RECOMMENDATION WORKFLOW ===");

    // Step 1: Analyze user's mood
    await progressTracker.updateStep('mood_analysis', 'active', 'Analyzing your mood...');
    console.log("Step 1: Mood analysis...");
    const stepStart = Date.now();
    const mood = await analyzeMood(prompt);
    const moodDuration = Date.now() - stepStart;
    
    metadata.steps.push({
      step: 1,
      name: "mood_analysis",
      result: mood,
      duration: moodDuration
    });
    
    await progressTracker.completeStep('mood_analysis', mood, moodDuration);
    console.log(`Detected mood: ${mood}`);

    // Step 2: Fetch user's library
    await progressTracker.updateStep('library_fetch', 'active', 'Scanning your music library...');
    console.log("Step 2: Library fetching...");
    const libStart = Date.now();
    const libraryTracks = await fetchLibrary(token);
    const libDuration = Date.now() - libStart;
    
    metadata.steps.push({
      step: 2,
      name: "library_fetch",
      result: `${libraryTracks.length} tracks`,
      duration: libDuration
    });
    
    await progressTracker.completeStep('library_fetch', `${libraryTracks.length} tracks`, libDuration);
    console.log(`Retrieved ${libraryTracks.length} tracks from library`);

    if (libraryTracks.length === 0) {
      console.warn("No tracks found in user's library, using Spotify recommendations");
      await progressTracker.updateStep('fallback_recommendations', 'active', 'Generating Spotify recommendations...');
      
      const fallbackStart = Date.now();
      const targetCount = outputFormat === 'track' ? 1 : 10;
      const fallbackTracks = await generateFallbackRecommendations(token, prompt, mood, [], targetCount);
      const fallbackDuration = Date.now() - fallbackStart;
      
      metadata.steps.push({
        step: "fallback",
        name: "spotify_recommendations",
        result: `${fallbackTracks.length} tracks`,
        duration: fallbackDuration
      });

      await progressTracker.completeStep('fallback_recommendations', `${fallbackTracks.length} tracks`, fallbackDuration);

      return {
        recommendations: fallbackTracks,
        mood: mood,
        metadata: { ...metadata, timing: { ...metadata.timing, total: Date.now() - metadata.timing.start } }
      };
    }

    // Step 3: AI analysis for initial selection
    await progressTracker.updateStep('ai_track_analysis', 'active', 'AI selecting best matches...');
    console.log("Step 3: AI track analysis...");
    const aiStart = Date.now();
    const targetCount = outputFormat === 'track' ? 10 : 30; // Get more candidates for FastAPI analysis
    const aiSelectedTracks = await analyzeTracksWithAI(libraryTracks, prompt, mood, userId, targetCount);
    const aiDuration = Date.now() - aiStart;
    
    metadata.steps.push({
      step: 3,
      name: "ai_track_analysis",
      result: `${aiSelectedTracks.length} tracks selected`,
      duration: aiDuration
    });
    
    await progressTracker.completeStep('ai_track_analysis', `${aiSelectedTracks.length} tracks selected`, aiDuration);
    console.log(`AI selected ${aiSelectedTracks.length} tracks`);

    if (aiSelectedTracks.length === 0) {
      console.warn("AI couldn't find matching tracks, using fallback");
      await progressTracker.updateStep('ai_fallback', 'active', 'Using fallback recommendations...');
      
      const fallbackCount = outputFormat === 'track' ? 1 : 10;
      const fallbackTracks = await generateFallbackRecommendations(token, prompt, mood, [], fallbackCount);

      await progressTracker.completeStep('ai_fallback', `${fallbackTracks.length} fallback tracks`);

      return {
        recommendations: fallbackTracks,
        mood: mood,
        metadata: { ...metadata, timing: { ...metadata.timing, total: Date.now() - metadata.timing.start } }
      };
    }

    // Step 4: FastAPI Enhanced Feature Analysis 
    await progressTracker.updateStep('fastapi_analysis', 'active', 'Analyzing audio features...');
    console.log("Step 4: FastAPI enhanced feature analysis...");
    const featureStart = Date.now();

    const enhancedResult = await enhancedFeatureAnalysis(aiSelectedTracks, token);
    const featureDuration = Date.now() - featureStart;

    metadata.steps.push({
      step: 4,
      name: "fastapi_enhanced_analysis",
      result: `${enhancedResult.tracks?.length || 0} tracks enhanced`,
      duration: featureDuration,
      successful: enhancedResult.summary?.successful_extractions || 0,
      failed: enhancedResult.summary?.failed_extractions || 0
    });
    
    await progressTracker.completeStep('fastapi_analysis', 
      `${enhancedResult.tracks?.length || 0} tracks enhanced (${enhancedResult.summary?.successful_extractions || 0} with features)`, 
      featureDuration);
    
    console.log(`FastAPI enhanced ${enhancedResult.tracks?.length || 0} tracks`);

    // Convert enhanced result back to track format for AI analysis
    const tracksWithEnhancedFeatures = mergeEnhancedFeaturesWithTracks(aiSelectedTracks, enhancedResult.tracks || []);

    // Step 5: Enhanced Track Evaluation with Audio Features
    await progressTracker.updateStep('track_evaluation', 'active', 'Evaluating tracks with enhanced features...');
    console.log("Step 5: Enhanced track evaluation with FastAPI features...");
    const evalStart = Date.now();
    
    const evaluation = await evaluateTrackAlignment(tracksWithEnhancedFeatures, prompt, mood);
    const evalDuration = Date.now() - evalStart;
    
    metadata.steps.push({
      step: 5,
      name: "enhanced_track_evaluation",
      result: `${evaluation.highQualityTracks.length} high-quality tracks found`,
      duration: evalDuration
    });
    
    await progressTracker.completeStep('track_evaluation', `${evaluation.highQualityTracks.length} high-quality tracks`, evalDuration);
    console.log(`Track evaluation found ${evaluation.highQualityTracks.length} high-quality tracks`);

    // Step 6: Final ranking and selection
    await progressTracker.updateStep('final_selection', 'active', 'Making final selections...');
    console.log("Step 6: Final ranking and selection...");
    
    let finalTracks = evaluation.highQualityTracks;
    
    // Apply final ranking based on multiple factors
    finalTracks = rankTracksWithEnhancedFeatures(finalTracks, mood, prompt, outputFormat);
    
    await progressTracker.completeStep('final_selection', `${finalTracks.length} final tracks selected`);

    // Ensure we have minimum required tracks
    const minRequired = outputFormat === 'track' ? 1 : 5;
    if (finalTracks.length < minRequired) {
      console.log(`Adding fallback tracks to reach minimum of ${minRequired}`);
      const additionalTracks = await generateFallbackRecommendations(
        token,
        prompt,
        mood,
        finalTracks,
        minRequired - finalTracks.length
      );
      finalTracks.push(...additionalTracks);
    }

    // Format output based on type
    let result;
    if (outputFormat === 'track') {
      result = finalTracks.length > 0 ? [finalTracks[0]] : [];
    } else {
      result = finalTracks.slice(0, 15);
    }

    metadata.timing.total = Date.now() - metadata.timing.start;

    console.log(`=== ENHANCED WORKFLOW COMPLETED IN ${metadata.timing.total}ms ===`);
    console.log(`Final result: ${result.length} tracks with enhanced features`);

    return {
      recommendations: result,
      mood: mood,
      metadata: metadata
    };

  } catch (error) {
    console.error('Error in simplified mood recommendation workflow:', error);
    await progressTracker.setError('workflow_error', error.message);
    metadata.error = error.message;

    // Emergency fallback
    try {
      console.log("Attempting emergency fallback...");
      const emergencyCount = outputFormat === 'track' ? 1 : 10;
      const emergencyTracks = await generateFallbackRecommendations(token, prompt, "balanced", [], emergencyCount);

      return {
        recommendations: emergencyTracks,
        mood: "balanced",
        metadata: { ...metadata, timing: { ...metadata.timing, total: Date.now() - metadata.timing.start } }
      };
    } catch (fallbackError) {
      console.error('Emergency fallback also failed:', fallbackError);
      throw error;
    }
  }
}

// Function to merge enhanced features back with original tracks
function mergeEnhancedFeaturesWithTracks(originalTracks, enhancedTracks) {
  const enhancedMap = new Map();
  
  // Create a map of enhanced tracks by title and artist for matching
  enhancedTracks.forEach(enhanced => {
    const key = `${enhanced.title?.toLowerCase()}-${enhanced.artist?.toLowerCase()}`;
    enhancedMap.set(key, enhanced);
  });
  
  return originalTracks.map(track => {
    const key = `${track.name?.toLowerCase()}-${track.artists?.[0]?.name?.toLowerCase()}`;
    const enhanced = enhancedMap.get(key);
    
    if (enhanced) {
      return {
        ...track,
        enhanced_features: enhanced.enhanced_features,
        processing_status: enhanced.processing_status,
        fastapi_enhanced: true,
        enhancement_error: enhanced.error || null
      };
    }
    
    return {
      ...track,
      enhanced_features: null,
      processing_status: { success: false, enhanced_features_available: false },
      fastapi_enhanced: false,
      enhancement_error: 'No enhanced features available'
    };
  });
}

// Final ranking function that considers enhanced features and evaluation scores
function rankTracksWithEnhancedFeatures(tracks, mood, prompt, outputFormat) {
  if (!tracks || tracks.length === 0) {
    return [];
  }

  console.log(`Ranking ${tracks.length} tracks with enhanced features and evaluation scores`);

  // Apply final scoring that considers everything
  const finalScoredTracks = tracks.map(track => {
    let finalScore = 0;
    
    // Base score from user preferences
    if (track.userPreferenceScore) {
      finalScore += track.userPreferenceScore * 3;
    }
    
    // Track evaluation alignment score (from evaluateTrackAlignment)
    if (track.alignmentScore) {
      finalScore += track.alignmentScore * 5; // High weight for mood alignment
    }
    
    // Bonus for successfully enhanced tracks with FastAPI features
    if (track.enhanced_features && track.processing_status?.enhanced_features_available) {
      finalScore += 15;
      
      // Additional scoring based on enhanced features matching mood
      const features = track.enhanced_features;
      
      switch (mood) {
        case 'happy':
          if (features.happiness) finalScore += (features.happiness / 100) * 10;
          if (features.energy) finalScore += (features.energy / 100) * 5;
          if (features.danceability) finalScore += (features.danceability / 100) * 3;
          break;
        case 'sad':
          if (features.happiness) finalScore += ((100 - features.happiness) / 100) * 10;
          if (features.energy) finalScore += ((100 - features.energy) / 100) * 5;
          if (features.acousticness) finalScore += (features.acousticness / 100) * 3;
          break;
        case 'energetic':
          if (features.energy) finalScore += (features.energy / 100) * 10;
          if (features.danceability) finalScore += (features.danceability / 100) * 5;
          if (features.bpm && features.bpm > 120) finalScore += 5;
          break;
        case 'calm':
          if (features.energy) finalScore += ((100 - features.energy) / 100) * 8;
          if (features.acousticness) finalScore += (features.acousticness / 100) * 5;
          if (features.instrumentalness) finalScore += (features.instrumentalness / 100) * 3;
          break;
        case 'romantic':
          // Target moderate happiness (around 60-80)
          if (features.happiness) {
            const happinessTarget = Math.max(0, 80 - Math.abs(features.happiness - 70));
            finalScore += (happinessTarget / 100) * 8;
          }
          if (features.acousticness) finalScore += (features.acousticness / 100) * 5;
          if (features.energy) {
            const energyTarget = Math.max(0, 70 - Math.abs(features.energy - 50));
            finalScore += (energyTarget / 100) * 3;
          }
          break;
        default: // balanced
          finalScore += 5; // Neutral bonus
      }
    }
    
    // Spotify popularity boost
    if (track.popularity) {
      finalScore += track.popularity * 0.15;
    }
    
    // Recent release bonus (if we have release date)
    if (track.enhanced_features?.release_date) {
      try {
        const releaseYear = new Date(track.enhanced_features.release_date).getFullYear();
        const currentYear = new Date().getFullYear();
        if (currentYear - releaseYear < 5) {
          finalScore += 3; // Bonus for recent releases
        }
      } catch (e) {
        // Ignore date parsing errors
      }
    }
    
    return {
      ...track,
      finalRankingScore: finalScore
    };
  });

  // Sort by final score
  finalScoredTracks.sort((a, b) => b.finalRankingScore - a.finalRankingScore);
  
  // Return appropriate number based on output format
  const maxResults = outputFormat === 'track' ? 1 : 15;
  const result = finalScoredTracks.slice(0, maxResults);
  
  console.log(`Final ranking complete: returning top ${result.length} tracks`);
  
  // Log top track details for debugging
  if (result.length > 0) {
    const topTrack = result[0];
    console.log(`Top track: "${topTrack.name}" by ${topTrack.artists?.[0]?.name} (Score: ${topTrack.finalRankingScore.toFixed(1)}, Enhanced: ${!!topTrack.enhanced_features})`);
  }
  
  return result;
}

// ENHANCED CLASSIC RECOMMENDATION WORKFLOW (unchanged)
async function processClassicRecommendations(prompt, token, outputFormat, progressTracker) {
  const metadata = {
    workflow: "classic_enhanced_real",
    steps: [],
    timing: { start: Date.now() }
  };

  try {
    console.log("=== STARTING REAL CLASSIC RECOMMENDATION WORKFLOW ===");
    console.log(`Prompt: "${prompt}", Format: ${outputFormat}`);

    const classicStart = Date.now();
    const classicTracks = await generateClassicRecommendations(prompt, token, progressTracker.requestId);
    const classicDuration = Date.now() - classicStart;
    
    metadata.steps.push({
      step: "1-11",
      name: "enhanced_classic_generation",
      result: `${classicTracks.length} classic tracks found using real APIs`,
      duration: classicDuration
    });
    
    console.log(`Real classic recommendations completed: ${classicTracks.length} tracks found`);

    if (classicTracks.length === 0) {
      await progressTracker.setError('classic_generation', 'Could not find classic songs matching the prompt');
      throw new Error("Could not find classic songs matching the prompt");
    }

    let result;
    const userRequestedCount = extractCountFromPrompt(prompt);

    if (outputFormat === 'track') {
      result = classicTracks.length > 0 ? [classicTracks[0]] : [];
    } else {
      const playlistSize = userRequestedCount || Math.min(classicTracks.length, 20);
      result = classicTracks.slice(0, playlistSize);
    }

    metadata.timing.total = Date.now() - metadata.timing.start;
    console.log(`=== REAL CLASSIC WORKFLOW COMPLETED IN ${metadata.timing.total}ms ===`);

    return {
      recommendations: result,
      metadata: metadata
    };

  } catch (error) {
    console.error('Error in real classic recommendation workflow:', error);
    metadata.error = error.message;
    metadata.timing.total = Date.now() - metadata.timing.start;
    throw error;
  }
}

// Extract count from user prompt
function extractCountFromPrompt(prompt) {
  const matches = prompt.match(/\b(\d+)\s*(?:songs?|tracks?|recommendations?)\b/i);
  if (matches) {
    const count = parseInt(matches[1]);
    return count > 0 && count <= 50 ? count : null;
  }
  return null;
}
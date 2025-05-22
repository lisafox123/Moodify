// route.js
import { NextResponse } from 'next/server';
import { createSpotifyPlaylist, searchMultipleTracksOnSpotify } from './spotify-api';
import { analyzeMood, generateStory, getClassicRecommendations } from './ai-analysis';
import { getMoodBasedRecommendations, createAudioFeatures } from './recommendation-engine';
import { performQualityCheck, performFinalVerification } from './quality-control';

export async function POST(request) {
  try {
    const body = await request.json();
    const { 
      prompt, 
      token, 
      seedTracks = [], 
      customStory = "", 
      createPlaylistFlag = false, 
      playlistName = "", 
      manualTracks = [],
      recommendationType = "mood", // Default "mood"
      outputFormat = "track",      // Default "track"
      qualityCheck = true          // Parameter to toggle quality checking
    } = body;

    // Handle playlist creation if that's what we're doing
    if (createPlaylistFlag && manualTracks && manualTracks.length > 0) {
      const result = await createSpotifyPlaylist(token, playlistName, manualTracks, customStory);
      return NextResponse.json(result);
    }

    // Validate required data
    if (!token) {
      return NextResponse.json({ error: 'Spotify access token is required' }, { status: 400 });
    }

    // For creating recommendations, we need a prompt
    if (!createPlaylistFlag && !prompt) {
      return NextResponse.json({ error: 'Prompt is required' }, { status: 400 });
    }

    // Step 1: Analyze the mood from prompt (skip for classic recommendation type)
    let mood = "balanced";
    if (recommendationType !== "classic") {
      mood = await analyzeMood(prompt);
      console.log("Mood analysis:", mood);
    } else {
      console.log("Skipping mood analysis for classic recommendation type, using prompt directly");
      // For classic type, we'll use the prompt directly without mood analysis
    }

    let recommendations = [];
    
    // Step 2: Get recommendations based on type
    if (recommendationType === "mood") {
      recommendations = await getMoodBasedRecommendations(token, mood);
    }
    // Step 2b: For classic recommendation type, use AI to suggest classic songs with user prompt
    else if (recommendationType === "classic") {
      recommendations = await getClassicRecommendations(prompt, token, searchMultipleTracksOnSpotify);
    }

    // If we still don't have enough recommendations, return error
    if (!recommendations || recommendations.length === 0) {
      return NextResponse.json({ 
        error: 'Could not generate recommendations with the provided parameters'
      }, { status: 404 });
    }

    // Quality Check - Evaluate and refine recommendations if needed
    if (qualityCheck && recommendations.length > 1) {
      recommendations = await performQualityCheck(recommendations, prompt, mood, token);
    }

    // Handle output format - track vs playlist
    if (outputFormat === "track") {
      // Just return a single track if we have one
      recommendations = recommendations.length > 0 ? [recommendations[0]] : [];
      console.log("Returning single track as requested by outputFormat");
    } else {
      // Additional verification and filtering for playlists
      recommendations = await performFinalVerification(recommendations, prompt, outputFormat);
    }

    console.log(`Final recommendation count: ${recommendations.length}`);

    // Generate a story based on the recommendations and prompt
    const story = await generateStory(recommendations, prompt, customStory, recommendationType, outputFormat);

    // Create a simplified audioFeatures object for the frontend
    const audioFeatures = createAudioFeatures(mood);

    // Return the recommendations, mood, story and the requested parameters
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
    return NextResponse.json({ error: error.message || 'Internal server error' }, { status: 500 });
  }
}
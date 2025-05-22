// spotify-api.js
export async function fetchFromSpotify(url, token) {
    try {
      console.log("Fetching from Spotify:", url);
      const response = await fetch(url, {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      });
  
      if (!response.ok) {
        // For debugging
        console.warn(`Spotify API warning (${response.status}): ${url}`);
        
        if (response.status === 404) {
          // Return empty object for 404
          return { tracks: [] };
        }
        
        // Try to parse error
        try {
          const errorData = await response.json();
          throw new Error(`Spotify API error: ${errorData.error?.message || response.statusText}`);
        } catch (e) {
          // If parsing fails
          throw new Error(`Spotify API error: ${response.statusText}`);
        }
      }
  
      return await response.json();
    } catch (error) {
      console.error(`Error fetching from Spotify (${url}):`, error.message);
      throw error;
    }
  }
  
  export async function searchMultipleTracksOnSpotify(tracks, token) {
    const results = [];
    
    for (const track of tracks) {
      if (results.length >= 10) break; // Limit to 10 tracks
      
      try {
        const query = `track:${encodeURIComponent(track.name)} artist:${encodeURIComponent(track.artist)}`;
        const searchResponse = await fetchFromSpotify(
          `https://api.spotify.com/v1/search?q=${query}&type=track&limit=1`, 
          token
        );
        
        if (searchResponse && searchResponse.tracks && searchResponse.tracks.items.length > 0) {
          results.push(searchResponse.tracks.items[0]);
        }
      } catch (error) {
        console.warn(`Error searching for track ${track.name}:`, error.message);
      }
    }
    
    return results;
  }
  
  export async function createSpotifyPlaylist(token, playlistName, tracks, description) {
    try {
      console.log("Creating playlist with tracks:", JSON.stringify(tracks.map(t => t.name || t.id)));
  
      // 1. Get user profile to get user ID
      const userProfile = await fetchFromSpotify('https://api.spotify.com/v1/me', token);
      const userId = userProfile.id;
  
      if (!userId) {
        throw new Error('Could not determine user ID');
      }
  
      console.log("Creating playlist for user:", userId);
  
      // 2. Create a new playlist with truncated description
      // Spotify limit for description is 300 characters
      const truncatedDescription = description ? description.substring(0, 290) : 'Created with Moodify';
      
      const createPlaylistUrl = `https://api.spotify.com/v1/users/${userId}/playlists`;
      const playlistResponse = await fetch(createPlaylistUrl, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          name: playlistName || 'Moodify Playlist',
          description: truncatedDescription,
          public: false
        })
      });
  
      if (!playlistResponse.ok) {
        const errorText = await playlistResponse.text();
        console.error("Playlist creation error response:", errorText);
        try {
          const errorData = JSON.parse(errorText);
          throw new Error(`Failed to create playlist: ${errorData.error?.message || playlistResponse.statusText}`);
        } catch (e) {
          throw new Error(`Failed to create playlist: ${playlistResponse.statusText}`);
        }
      }
  
      const playlist = await playlistResponse.json();
      console.log("Playlist created:", playlist.id);
  
      // 3. Add tracks to the playlist - ensure we have valid URIs
      const trackUris = tracks.map(track => {
        // Check if it already has a URI
        if (track.uri && track.uri.startsWith('spotify:track:')) {
          return track.uri;
        }
        // Check if it has an ID
        else if (track.id) {
          return `spotify:track:${track.id}`;
        }
        // Last resort, return null (will be filtered out)
        return null;
      }).filter(uri => uri !== null);
  
      if (trackUris.length === 0) {
        throw new Error('No valid track URIs to add to playlist');
      }
  
      console.log("Adding tracks to playlist:", trackUris);
  
      // Add the tracks in batches of 100 (Spotify API limit)
      const batchSize = 100;
      for (let i = 0; i < trackUris.length; i += batchSize) {
        const batch = trackUris.slice(i, i + batchSize);
  
        const addTracksUrl = `https://api.spotify.com/v1/playlists/${playlist.id}/tracks`;
        const addTracksResponse = await fetch(addTracksUrl, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            uris: batch
          })
        });
  
        if (!addTracksResponse.ok) {
          const errorText = await addTracksResponse.text();
          console.error("Track addition error response:", errorText);
          try {
            const errorData = JSON.parse(errorText);
            console.warn(`Warning adding tracks to playlist: ${errorData.error?.message}`);
          } catch (e) {
            console.warn(`Warning adding tracks to playlist: ${addTracksResponse.statusText}`);
          }
          // Continue anyway - we at least created the playlist
        }
      }
  
      // 4. Return the created playlist
      return {
        playlist: playlist,
        message: 'Playlist created successfully',
        recommendationType: 'mood', // Default for created playlists
        outputFormat: 'playlist'
      };
    } catch (error) {
      console.error('Error creating playlist:', error);
      throw error;
    }
  }
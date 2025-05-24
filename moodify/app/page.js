"use client";
import { useRouter } from 'next/navigation';
import { useEffect, useState, useCallback } from 'react';
import Image from 'next/image';
import AudioFeaturesDisplay from './components/AudioFeaturesDisplay';
import StoryModal from './components/StoryModal';
import FeedbackButton from './components/FeedbackButton';
import { styles } from './styles'; // Import the separated styles

// Toggle Switch Component
const ToggleSwitch = ({ isOn, label, leftText, rightText, onToggle }) => {
  return (
    <div style={styles.optionLabel}>
      <span style={styles.switchLabel}>{label}</span>
      <div
        style={{
          ...styles.toggleButton,
          ...(isOn ? styles.toggleButtonActive : styles.toggleButtonInactive),
        }}
        onClick={onToggle}
      >
        <div
          style={{
            ...styles.toggleSlider,
            ...(isOn ? styles.toggleSliderActive : styles.toggleSliderInactive),
          }}
        />
        <span
          style={{
            ...styles.toggleText,
            ...styles.toggleTextOff,
            opacity: isOn ? 0 : 1,
          }}
        >
          {leftText}
        </span>
        <span
          style={{
            ...styles.toggleText,
            ...styles.toggleTextOn,
            opacity: isOn ? 1 : 0,
          }}
        >
          {rightText}
        </span>
      </div>
    </div>
  );
};

export default function Home() {
  const router = useRouter();
  const [error, setError] = useState('');
  const [prompt, setPrompt] = useState('');
  const [inputFocused, setInputFocused] = useState(false);
  const [buttonHover, setButtonHover] = useState(false);

  // Authentication and user state
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [userData, setUserData] = useState(null);
  const [accessToken, setAccessToken] = useState('');
  const [topTracks, setTopTracks] = useState([]);
  const [isLoadingTracks, setIsLoadingTracks] = useState(false);

  // Toggle states
  const [moodMode, setMoodMode] = useState(true);
  const [playlistMode, setPlaylistMode] = useState(false);
  const [customMode, setCustomMode] = useState(false);
  const [customStory, setCustomStory] = useState('');
  const [customInputFocused, setCustomInputFocused] = useState(false);

  // Recommendations state
  const [isGenerating, setIsGenerating] = useState(false);
  const [recommendations, setRecommendations] = useState([]);
  const [recommendationStory, setRecommendationStory] = useState('');
  const [generatedPlaylist, setGeneratedPlaylist] = useState(null);
  const [aiInsights, setAiInsights] = useState([]);
  const [audioFeaturesData, setAudioFeaturesData] = useState(null);
  const [expandedTrackId, setExpandedTrackId] = useState(null);

  // Story modal state
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [story, setStory] = useState(null);
  const [trackId, setTrackId] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [hoveredTrackId, setHoveredTrackId] = useState(null);
  const [clickedTrackId, setClickedTrackId] = useState(null);

  // Feedback callback handler
  const handleFeedbackSubmitted = useCallback((trackId, feedback) => {
    console.log(`Feedback submitted for track ${trackId}: ${feedback}`);
    // You can add additional logic here if needed, such as:
    // - Updating local state
    // - Triggering analytics
    // - Showing confirmation messages
  }, []);

  // Function to fetch user profile
  const fetchUserProfile = useCallback(async (token) => {
    try {
      const response = await fetch('https://api.spotify.com/v1/me', {
        headers: {
          'Authorization': `Bearer ${token}`,
        },
      });

      if (response.ok) {
        const profile = await response.json();
        setUserData(profile);
      } else {
        if (response.status === 401) {
          handleLogout();
        }
        const errorData = await response.json();
        console.error('Failed to fetch user profile:', errorData);
      }
    } catch (error) {
      console.error('Error fetching user profile:', error);
    }
  }, []);

  // Function to fetch top tracks
  const fetchTopTracks = useCallback(async () => {
    if (!accessToken) return;

    setIsLoadingTracks(true);
    try {
      const response = await fetch('https://api.spotify.com/v1/me/top/tracks?time_range=medium_term&limit=5', {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
        },
      });

      if (response.ok) {
        const data = await response.json();
        setTopTracks(data.items);
      } else {
        if (response.status === 401) {
          handleLogout();
        }
        console.error('Failed to fetch top tracks:', await response.json());
      }
    } catch (error) {
      console.error('Error fetching top tracks:', error);
    } finally {
      setIsLoadingTracks(false);
    }
  }, [accessToken]);

  // Function to exchange code for token
  const exchangeCodeForToken = useCallback(async (code) => {
    try {
      console.log('Exchanging code for token...');

      const response = await fetch('/api/callback', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ code }),
      });

      const contentType = response.headers.get('content-type');
      if (!contentType || !contentType.includes('application/json')) {
        const textContent = await response.text();
        console.error('Non-JSON response:', textContent);
        setError('Server returned invalid response format');
        return;
      }

      const data = await response.json();

      if (!response.ok) {
        console.error('Token exchange error:', data);
        setError(data.error || 'Failed to authenticate with Spotify');
        return;
      }

      if (data.access_token) {
        console.log('Token received successfully');
        localStorage.setItem('spotify_access_token', data.access_token);

        const expiryTime = Date.now() + (data.expires_in * 1000);
        localStorage.setItem('spotify_token_expiry', expiryTime.toString());

        setAccessToken(data.access_token);
        setIsLoggedIn(true);
        fetchUserProfile(data.access_token);

        window.history.replaceState({}, document.title, '/');
      } else {
        console.error('No access token in response:', data);
        setError('Failed to receive access token from Spotify');
      }
    } catch (error) {
      console.error('Error exchanging code for token:', error);
      setError('An error occurred during authentication');
    }
  }, [fetchUserProfile]);

  // Function to handle logout
  const handleLogout = () => {
    localStorage.removeItem('spotify_access_token');
    localStorage.removeItem('spotify_token_expiry');
    setAccessToken('');
    setIsLoggedIn(false);
    setUserData(null);
    setTopTracks([]);
    setRecommendations([]);
    setRecommendationStory('');
    setGeneratedPlaylist(null);
    setAiInsights([]);
    setAudioFeaturesData(null);
  };

  // Handle authentication on component mount
  useEffect(() => {
    const queryParams = new URLSearchParams(window.location.search);
    const accessToken = queryParams.get('access_token');
    const error = queryParams.get('error');
    const tokenReceived = queryParams.get('token_received');
    const code = queryParams.get('code');

    if (error) {
      setError(error.replace(/_/g, ' '));
      window.history.replaceState({}, document.title, '/');
    }

    if (accessToken && tokenReceived === 'true') {
      console.log('Token received directly in URL');
      const expiresIn = parseInt(queryParams.get('expires_in') || '3600');

      localStorage.setItem('spotify_access_token', accessToken);
      const expiryTime = Date.now() + (expiresIn * 1000);
      localStorage.setItem('spotify_token_expiry', expiryTime.toString());

      setAccessToken(accessToken);
      setIsLoggedIn(true);
      fetchUserProfile(accessToken);

      window.history.replaceState({}, document.title, '/');
      return;
    }

    if (code) {
      console.log('Code found in URL, exchanging for token');
      exchangeCodeForToken(code);
      return;
    }

    const storedToken = localStorage.getItem('spotify_access_token');
    const tokenExpiry = localStorage.getItem('spotify_token_expiry');

    if (storedToken && tokenExpiry && Number(tokenExpiry) > Date.now()) {
      console.log('Using stored token from localStorage');
      setAccessToken(storedToken);
      setIsLoggedIn(true);
      fetchUserProfile(storedToken);
    } else if (storedToken && tokenExpiry) {
      console.log('Stored token has expired');
      localStorage.removeItem('spotify_access_token');
      localStorage.removeItem('spotify_token_expiry');
    }
  }, [exchangeCodeForToken, fetchUserProfile]);

  // Fetch user's top tracks when accessToken changes
  useEffect(() => {
    if (accessToken) {
      fetchTopTracks();
    }
  }, [accessToken, fetchTopTracks]);

  const handleLogin = () => {
    window.location.href = '/api/login';
  };

  const toggleTrackDetails = (trackId) => {
    if (expandedTrackId === trackId) {
      setExpandedTrackId(null);
    } else {
      setExpandedTrackId(trackId);
    }
  };

  const generateRecommendations = async () => {
    if (!isLoggedIn) {
      setError('Please connect to Spotify first');
      return;
    }

    if (!prompt.trim()) {
      setError('Please enter a mood or vibe');
      return;
    }

    setIsGenerating(true);
    setError('');

    try {
      if (!accessToken) {
        throw new Error('No access token available. Please reconnect to Spotify.');
      }

      console.log('Fetching recommendations with prompt:', prompt);

      const recommendationResponse = await fetch('/api/recommendations', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          prompt: prompt,
          token: accessToken,
          customStory: customMode ? customStory : '',
          seedTracks: topTracks.map(track => track.id),
          recommendationType: moodMode ? 'mood' : 'classic',
          outputFormat: playlistMode ? 'playlist' : 'track'
        }),
      });

      console.log('Recommendation API response status:', recommendationResponse.status);

      if (!recommendationResponse.ok) {
        let errorMessage = `Failed to generate recommendations: ${recommendationResponse.status} ${recommendationResponse.statusText}`;

        try {
          const errorData = await recommendationResponse.json();
          if (errorData && errorData.error) {
            errorMessage = `Error: ${errorData.error}`;
          }
        } catch (jsonError) {
          try {
            const errorText = await recommendationResponse.text();
            console.error('Recommendation API error response:', errorText);
          } catch (textError) {
            console.error('Could not parse error response');
          }
        }

        throw new Error(errorMessage);
      }

      const recommendationData = await recommendationResponse.json();

      if (!recommendationData.recommendations || recommendationData.recommendations.length === 0) {
        setError('No recommendations found. Try a different mood.');
        setIsGenerating(false);
        return;
      }

      setAudioFeaturesData(recommendationData.audioFeatures || null);
      setRecommendations(recommendationData.recommendations || []);
      setRecommendationStory(recommendationData.story || '');

      // Get AI insights for the recommendations
      try {
        const aiResponse = await fetch('/api/ai-recommendations', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            prompt: prompt,
            token: accessToken,
            topTracks: topTracks,
            recommendedTracks: recommendationData.recommendations || [],
            audioFeatures: recommendationData.audioFeatures || {},
            mood: recommendationData.mood || 'balanced'
          }),
        });

        if (aiResponse.ok) {
          const aiData = await aiResponse.json();
          if (aiData.story) setRecommendationStory(aiData.story);
          if (aiData.insightfulComments) setAiInsights(aiData.insightfulComments);
        }
      } catch (aiError) {
        console.error('Error enhancing with AI:', aiError);
      }

      // Create playlist if needed
      if (playlistMode && recommendationData.recommendations && recommendationData.recommendations.length > 0) {
        try {
          const playlistResponse = await fetch('/api/recommendations', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              token: accessToken,
              createPlaylistFlag: true,
              playlistName: `${prompt.substring(0, 20)}... Mix`,
              customStory: recommendationData.story || customStory,
              manualTracks: recommendationData.recommendations
            }),
          });

          if (playlistResponse.ok) {
            const playlistData = await playlistResponse.json();
            if (playlistData.playlist) {
              setGeneratedPlaylist(playlistData.playlist);
            }
          }
        } catch (playlistError) {
          console.error('Error creating playlist:', playlistError);
        }
      }

    } catch (error) {
      console.error('Error generating recommendations:', error);
      setError(error.message || 'Failed to generate recommendations');
      setRecommendations([]);
      setRecommendationStory('');
      setAiInsights([]);
      setAudioFeaturesData(null);
    } finally {
      setIsGenerating(false);
    }
  };

  const getStoryForTrack = async (artist, song) => {
    setIsLoading(true);
    try {
      const response = await fetch('/api/story_agent', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ artist, song, customStory: customStory ? customStory : '' }),
      });

      if (!response.ok) {
        throw new Error(`HTTP error! Status: ${response.status}`);
      }

      const data = await response.json();
      if (data.error) {
        throw new Error(data.error);
      }
      return data.story;
    } catch (error) {
      console.error('無法獲取故事:', error.message);
      return `錯誤: ${error.message}`;
    } finally {
      setIsLoading(false);
      setClickedTrackId(null);
    }
  };

  const handleTrackClick = async (trackId, artist, song) => {
    try {
      const trackStory = await getStoryForTrack(artist, song);
      setStory(trackStory);
      setTrackId(trackId);
      setIsModalOpen(true);
    } catch (error) {
      console.error('處理歌曲故事時出錯:', error);
      setStory(`錯誤: ${error.message}`);
      setIsModalOpen(true);
    }
  };

  return (
    <div style={styles.container}>
      <nav style={styles.navbar}>
        <div style={styles.logoContainer}>
          <Image
            src="/logo.png"
            alt="Moodify Logo"
            width={40}
            height={40}
          />
          <h1 style={styles.logoText}>Moodify</h1>
        </div>

        <div style={styles.navRight}>
          {isLoggedIn && userData ? (
            <div style={styles.userProfile}>
              <span style={styles.userName}>
                {userData.display_name}
              </span>
              {userData.images && userData.images.length > 0 ? (
                <Image
                  src={userData.images[0].url}
                  alt="User Avatar"
                  width={32}
                  height={32}
                  style={styles.userAvatar}
                  unoptimized={true}
                />
              ) : (
                <div style={styles.userAvatarPlaceholder}>
                  {userData.display_name ? userData.display_name[0].toUpperCase() : 'U'}
                </div>
              )}
              <button
                onClick={handleLogout}
                style={styles.logoutButton}
              >
                Logout
              </button>
            </div>
          ) : (
            <button
              style={styles.spotifyButton}
              onClick={handleLogin}
            >
              Connect Spotify
            </button>
          )}
        </div>
      </nav>

      <main style={styles.main}>
        <h1 style={styles.title}>Generate Music Based on Your Mood</h1>
        <p style={styles.description}>
          Describe how you&apos;re feeling or what vibe you&apos;re looking for, and we&apos;ll create the perfect playlist
        </p>

        {error && (
          <p style={styles.error}>Error: {error}</p>
        )}

        <div style={styles.settingsSection}>
          <h2 style={styles.sectionTitle}>Settings</h2>
          <div style={styles.switchesContainer}>
            <div style={styles.switchRow}>
              <ToggleSwitch
                isOn={moodMode}
                label="Recommendation Type"
                leftText="Classic"
                rightText="Mood"
                onToggle={() => setMoodMode(!moodMode)}
              />
              <ToggleSwitch
                isOn={playlistMode}
                label="Output Format"
                leftText="Track"
                rightText="Playlist"
                onToggle={() => setPlaylistMode(!playlistMode)}
              />
            </div>

            <div style={styles.switchRow}>
              <ToggleSwitch
                isOn={customMode}
                label="Story Style"
                leftText="Classic"
                rightText="Custom"
                onToggle={() => setCustomMode(!customMode)}
              />

              {customMode && (
                <div style={{ marginTop: '0.75rem' }}>
                  <input
                    id="custom-story"
                    type="text"
                    placeholder="e.g., 'A traveler discovering new sounds...'"
                    value={customStory}
                    onChange={(e) => setCustomStory(e.target.value)}
                    onFocus={() => setCustomInputFocused(true)}
                    onBlur={() => setCustomInputFocused(false)}
                    style={{
                      ...styles.customInput,
                      ...(customInputFocused ? styles.customInputFocus : {})
                    }}
                  />
                </div>
              )}
            </div>
          </div>
        </div>

        <div style={styles.inputContainer}>
          <label style={styles.promptLabel} htmlFor="mood-prompt">
            Enter your mood or vibe
          </label>
          <input
            id="mood-prompt"
            type="text"
            placeholder="e.g., 'Upbeat music for a morning workout' or 'Calm piano for reading'"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onFocus={() => setInputFocused(true)}
            onBlur={() => setInputFocused(false)}
            style={{
              ...styles.promptInput,
              ...(inputFocused ? styles.promptInputFocus : {})
            }}
          />

          <button
            onClick={generateRecommendations}
            disabled={!isLoggedIn || !prompt || isGenerating}
            onMouseEnter={() => setButtonHover(true)}
            onMouseLeave={() => setButtonHover(false)}
            style={{
              ...styles.button,
              ...(buttonHover && !isGenerating && isLoggedIn && prompt ? styles.buttonHover : {}),
              ...(!isLoggedIn || !prompt || isGenerating ? styles.buttonDisabled : {})
            }}
          >
            {isGenerating ? 'Generating...' : 'Generate Recommendations'}
          </button>
        </div>

        {/* Display top tracks section if logged in */}
        {isLoggedIn && (
          <div style={styles.topTracksSection}>
            <h2 style={styles.sectionTitle}>Your Top Tracks</h2>

            {isLoadingTracks ? (
              <p style={styles.loadingIndicator}>Loading your top tracks...</p>
            ) : topTracks.length > 0 ? (
              <ul style={styles.tracksList}>
                {topTracks.map((track, index) => (
                  <li key={track.id} style={styles.trackItem}>
                    <div style={styles.trackWithFeedback}>
                      <div style={styles.trackMainContent}>
                        <span style={styles.trackNumber}>{index + 1}</span>
                        {track.album.images && track.album.images.length > 0 && (
                          <Image
                            src={track.album.images[2].url}
                            alt={track.album.name}
                            width={40}
                            height={40}
                            style={styles.trackImage}
                            unoptimized={true}
                          />
                        )}
                        <div style={styles.trackInfo}>
                          <div style={styles.trackName}>{track.name}</div>
                          <div style={styles.trackArtist}>
                            {track.artists.map(artist => artist.name).join(', ')}
                          </div>
                        </div>
                        <button
                          onClick={() => {
                            setClickedTrackId(track.id);
                            setIsLoading(true);
                            handleTrackClick(track.id, track.artists[0].name, track.name);
                          }}
                          style={{
                            ...styles.button,
                            ...(isLoading ? styles.buttonDisabled : {}),
                            ...(hoveredTrackId === track.id ? styles.trackItemHover : {})
                          }}
                          onMouseEnter={() => setHoveredTrackId(track.id)}
                          onMouseLeave={() => setHoveredTrackId(null)}
                          disabled={isLoading && clickedTrackId === track.id}
                          aria-label="生成歌曲故事"
                        >
                          {isLoading && clickedTrackId === track.id ? '生成中...' : '生成故事'}
                        </button>
                      </div>
                      
                      {/* Feedback Button for Top Tracks */}
                      <div style={styles.feedbackContainer}>
                        <FeedbackButton
                          trackId={track.id}
                          userId={userData?.id}
                          onFeedbackSubmitted={handleFeedbackSubmitted}
                        />
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <p style={styles.loadingIndicator}>No top tracks found. Try listening to more music on Spotify!</p>
            )}
          </div>
        )}

        {/* Story Modal */}
        {isModalOpen && (
          <StoryModal
            story={story}
            trackId={trackId}
            onClose={() => {
              setIsModalOpen(false);
              setStory(null);
              setTrackId(null);
            }}
          />
        )}

        {/* Display recommendations if available */}
        {recommendations.length > 0 && (
          <div style={styles.recommendationsSection}>
            <h2 style={styles.sectionTitle}>Your Personalized Recommendations</h2>

            {/* Display audio features target for the mood */}
            {audioFeaturesData && (
              <div style={styles.moodFeatures}>
                <h3 style={{ fontSize: '1rem', marginBottom: '0.5rem' }}>Target Audio Profile</h3>
                <AudioFeaturesDisplay features={audioFeaturesData} />
              </div>
            )}

            {recommendationStory && (
              <div style={styles.storyText}>
                {recommendationStory}
              </div>
            )}

            <ul style={styles.recommendationsList}>
              {recommendations.map((track, index) => (
                <li key={track.id} style={styles.trackItem}>
                  <div style={styles.trackWithFeedback}>
                    <div style={styles.trackMainContent}>
                      <span style={styles.trackNumber}>{index + 1}</span>
                      {track.album.images && track.album.images.length > 0 && (
                        <Image
                          src={track.album.images[2].url}
                          alt={track.album.name}
                          width={40}
                          height={40}
                          style={styles.trackImage}
                          unoptimized={true}
                        />
                      )}
                      <div style={styles.trackInfo}>
                        <div style={styles.trackName}>
                          {track.name}
                          <button
                            onClick={() => toggleTrackDetails(track.id)}
                            style={styles.detailsButton}
                          >
                            {expandedTrackId === track.id ? 'Hide Details' : 'Show Details'}
                          </button>
                        </div>
                        <div style={styles.trackArtist}>
                          {track.artists.map(artist => artist.name).join(', ')}
                        </div>

                        {/* Track details section with audio features */}
                        <div
                          style={{
                            ...styles.trackDetails,
                            ...(expandedTrackId === track.id ? styles.trackDetailsOpen : {})
                          }}
                        >
                          {track.audioFeatures && (
                            <AudioFeaturesDisplay features={track.audioFeatures} />
                          )}

                          {/* Lyrics sentiment (if available) */}
                          {track.lyricsInfo && (
                            <div style={{ marginTop: '0.5rem' }}>
                              <div style={{ fontSize: '0.85rem', fontWeight: '600', marginBottom: '0.3rem' }}>
                                Lyrics Sentiment
                              </div>
                              <div style={{
                                padding: '0.3rem 0.6rem',
                                borderRadius: '4px',
                                display: 'inline-block',
                                backgroundColor: track.lyricsInfo.sentiment === 'positive'
                                  ? 'rgba(29, 185, 84, 0.2)'
                                  : 'rgba(255, 85, 85, 0.2)',
                                color: track.lyricsInfo.sentiment === 'positive'
                                  ? '#1DB954'
                                  : '#ff5555',
                                fontSize: '0.8rem'
                              }}>
                                {track.lyricsInfo.sentiment.charAt(0).toUpperCase() + track.lyricsInfo.sentiment.slice(1)}
                              </div>

                              {track.lyricsInfo.themes && track.lyricsInfo.themes.length > 0 && (
                                <div style={{ marginTop: '0.5rem' }}>
                                  <div style={{ fontSize: '0.85rem', fontWeight: '600', marginBottom: '0.3rem' }}>
                                    Themes
                                  </div>
                                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.3rem' }}>
                                    {track.lyricsInfo.themes.map((theme, i) => (
                                      <span key={i} style={{
                                        padding: '0.2rem 0.5rem',
                                        borderRadius: '20px',
                                        backgroundColor: 'rgba(255, 255, 255, 0.1)',
                                        fontSize: '0.7rem'
                                      }}>
                                        {theme}
                                      </span>
                                    ))}
                                  </div>
                                </div>
                              )}
                            </div>
                          )}

                          {/* Spotify player link */}
                          <div style={{ marginTop: '0.5rem', textAlign: 'right' }}>
                            <a
                              href={track.external_urls.spotify}
                              target="_blank"
                              rel="noopener noreferrer"
                              style={{
                                color: '#1DB954',
                                fontSize: '0.8rem',
                                textDecoration: 'none'
                              }}
                            >
                              Play on Spotify
                            </a>
                          </div>
                        </div>
                      </div>

                      {/* Track action buttons */}
                      <div style={styles.trackActionsContainer}>
                        <div style={styles.trackMainActions}>
                          {/* Story generation button */}
                          <button
                            onClick={() => {
                              setClickedTrackId(track.id);
                              setIsLoading(true);
                              handleTrackClick(track.id, track.artists[0].name, track.name);
                            }}
                            style={{
                              ...styles.button,
                              ...(isLoading && clickedTrackId === track.id ? styles.buttonDisabled : {}),
                              ...(hoveredTrackId === track.id ? styles.trackItemHover : {})
                            }}
                            onMouseEnter={() => setHoveredTrackId(track.id)}
                            onMouseLeave={() => setHoveredTrackId(null)}
                            disabled={isLoading && clickedTrackId === track.id}
                            aria-label="生成歌曲故事"
                          >
                            {isLoading && clickedTrackId === track.id ? '生成中...' : '生成故事'}
                          </button>

                          {/* Spotify Listen button */}
                          <a
                            href={track.external_urls.spotify}
                            target="_blank"
                            rel="noopener noreferrer"
                            style={styles.spotifyListenButton}
                            onMouseEnter={(e) => {
                              e.currentTarget.style.backgroundColor = '#1aa34a';
                              e.currentTarget.style.transform = 'translateY(-2px)';
                              e.currentTarget.style.boxShadow = '0 4px 12px rgba(29, 185, 84, 0.3)';
                            }}
                            onMouseLeave={(e) => {
                              e.currentTarget.style.backgroundColor = '#1DB954';
                              e.currentTarget.style.transform = 'none';
                              e.currentTarget.style.boxShadow = 'none';
                            }}
                          >
                            Listen on Spotify
                          </a>
                        </div>
                      </div>
                    </div>

                    {/* Feedback Button for Recommendations */}
                    <div style={styles.feedbackContainer}>
                      <FeedbackButton
                        trackId={track.id}
                        userId={userData?.id}
                        onFeedbackSubmitted={handleFeedbackSubmitted}
                      />
                    </div>
                  </div>
                </li>
              ))}
            </ul>

            {/* AI Insights */}
            {aiInsights && aiInsights.length > 0 && (
              <div style={styles.insightsContainer}>
                <div style={styles.insightTitle}>AI Music Insights</div>
                <ul style={styles.insightsList}>
                  {aiInsights.map((insight, index) => (
                    <li key={index} style={styles.insightItem}>
                      {insight}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {generatedPlaylist && (
              <div style={styles.playlistInfo}>
                <div style={styles.playlistTitle}>
                  Playlist Created: {generatedPlaylist.name}
                </div>
                <p>{generatedPlaylist.description}</p>
                <div style={{ display: 'flex', gap: '1rem', marginTop: '1rem' }}>
                  <a
                    href={generatedPlaylist.external_urls.spotify}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={styles.playlistLink}
                  >
                    Open in Spotify
                  </a>
                  <a
                    href={generatedPlaylist.external_urls.spotify}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{
                      ...styles.spotifyListenButton,
                      marginLeft: 0
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.backgroundColor = '#1aa34a';
                      e.currentTarget.style.transform = 'translateY(-2px)';
                      e.currentTarget.style.boxShadow = '0 4px 12px rgba(29, 185, 84, 0.3)';
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.backgroundColor = '#1DB954';
                      e.currentTarget.style.transform = 'none';
                      e.currentTarget.style.boxShadow = 'none';
                    }}
                  >
                    Listen to Playlist
                  </a>
                </div>
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
import React from 'react';

const StoryModal = ({ story, trackId, onClose }) => {
  if (!story || !trackId) {
    return null; // 或顯示錯誤訊息，例如 <div>缺少故事或歌曲 ID</div>
  }

  return (
    <div style={styles.modal}>
      <div style={styles.modalContent}>
       <button style={styles.closeButton} onClick={onClose}>
          關閉
        </button>
        {/* Spotify 播放器嵌入 */}
        <div style={{ marginTop: '20px' }}>
          <iframe
            src={`https://open.spotify.com/embed/track/${trackId}?utm_source=generator`}
            width="100%"
            height="152" // 迷你播放器高度，適合行動裝置
            frameBorder="0"
            allow="encrypted-media"
            title="Spotify Player"
            style={{ borderRadius: '8px' }}
          ></iframe>
        </div>
        <h2 style={{ backgroundColor: 'balck'}}>歌曲故事</h2>
        {story.startsWith('錯誤') || story.includes('無法') ? (
          <p style={{ backgroundColor: 'lightblue', whiteSpace: 'pre-wrap',color:" #000000" }}>{story}</p>
        ) : (
          <p style={{ color: 'balck',whiteSpace: 'pre-wrap' }}>{story}</p>
        )}
        
      </div>
    </div>
  );
};

const styles = {
  modal: {
    position: 'fixed',
    top: '0',
    left: '0',
    right: '0',
    bottom: '0',
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: '1000',
  },
  modalContent: {
    backgroundColor: 'white',
    padding: '20px',
    borderRadius: '8px',
    width: '90%',
    maxWidth: '600px',
    maxHeight: '80vh',
    overflowY: 'auto',
  },
  closeButton: {
    position:'relative',
    background: '#ff5555',
    color: 'white',
    border: 'none',
    padding: '0.5rem 1rem',
    cursor: 'pointer',
    borderRadius: '4px',
    fontSize: '1rem',
    left: '480px',
    top: '10px',
  },
 
};

export default StoryModal;
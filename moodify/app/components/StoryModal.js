import React, { useState } from 'react';

const StoryModal = ({ story, trackId, onClose }) => {
  const [isFadingOut, setIsFadingOut] = useState(false);

  if (!story || !trackId) {
    return null; // 或顯示錯誤訊息，例如 <div>缺少故事或歌曲 ID</div>
  }

  const handleClose = () => {
    setIsFadingOut(true); // 啟動淡出動畫
    setTimeout(() => {
      onClose(); // 在動畫結束後關閉 Modal
    }, 300); // 與動畫持續時間一致
  };

  return (
    <div style={styles.modal}>
      <div
        style={{
          ...styles.modalContent,
          animation: isFadingOut ? 'fadeOut 0.3s ease-out' : 'fadeIn 0.3s ease-out',
        }}
      >
        <button style={styles.closeButton} onClick={handleClose}>
          Close
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
        <h2 style={{ marginTop: '10px' }}>歌曲故事</h2>
        {story.startsWith('錯誤') || story.includes('無法') ? (
          <p
            style={{
              backgroundColor: '#E8E6F0',
              whiteSpace: 'pre-wrap',
              color: '#000000',
              borderRadius: '10px',
              padding: '7px 5px 7px 10px',
            }}
          >
            {story}
          </p>
        ) : (
          <p style={{ color: 'black', whiteSpace: 'pre-wrap', color: '#000000' }}>{story}</p>
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
    backgroundColor: '#FFFFDD',
    padding: '30px',
    borderRadius: '8px',
    width: '90%',
    maxWidth: '600px',
    maxHeight: '80vh',
    overflowY: 'auto',
  },
  closeButton: {
    position: 'relative',
    background: '#E7C889',
    color: 'white',
    border: 'none',
    padding: '0.5rem 1rem',
    cursor: 'pointer',
    borderRadius: '4px',
    fontSize: '1rem',
    left: '460px',
  },
};

// 定義動畫效果
const globalStyles = `
@keyframes fadeIn {
  from {
    opacity: 0;
    transform: scale(0.9);
  }
  to {
    opacity: 1;
    transform: scale(1);
  }
}

@keyframes fadeOut {
  from {
    opacity: 1;
    transform: scale(1);
  }
  to {
    opacity: 0;
    transform: scale(0.9);
  }
}
`;

// 將動畫樣式插入到頁面中
if (typeof document !== 'undefined') {
  const styleSheet = document.createElement('style');
  styleSheet.type = 'text/css';
  styleSheet.innerText = globalStyles;
  document.head.appendChild(styleSheet);
}

export default StoryModal;
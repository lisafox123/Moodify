import { ChatMistralAI } from '@langchain/mistralai';
import { DynamicTool } from '@langchain/core/tools';

// 環境變數
const mistralApiKey = process.env.MISTRAL_API_KEY;
const serpApiKey = process.env.SERPAPI_KEY;

if (!mistralApiKey) {
  throw new Error('MISTRAL_API_KEY is missing');
}
if (!serpApiKey) {
  throw new Error('SERP_API_KEY is missing');
}

const llm = new ChatMistralAI({
  model: 'mistral-large-latest',
  apiKey: mistralApiKey,
  temperature: 0.8,
  maxRetries: 2,
});

// Step 1: Fetch lyrics using SerpAPI
async function fetchLyricsWithSerpAPI(artist, song) {
  try {
    console.log(`Fetching lyrics via SerpAPI: ${artist} - ${song}`);
    
    // Search for lyrics using SerpAPI Google Search
    const searchQuery = `${artist} ${song} lyrics`;
    const serpUrl = `https://serpapi.com/search.json?engine=google&q=${encodeURIComponent(searchQuery)}&api_key=${serpApiKey}`;
    
    const response = await fetch(serpUrl);
    if (!response.ok) {
      throw new Error(`SerpAPI request failed: ${response.status}`);
    }
    
    const data = await response.json();
    console.log('SerpAPI search completed');
    
    // Look for lyrics in different sections
    let lyricsContent = null;
    
    // Check knowledge graph for direct lyrics
    if (data.knowledge_graph && data.knowledge_graph.lyrics) {
      lyricsContent = data.knowledge_graph.lyrics;
      console.log('Found lyrics in knowledge graph');
    }
    
    // Check organic results for lyrics sites
    if (!lyricsContent && data.organic_results) {
      const lyricsUrls = data.organic_results
        .filter(result => 
          result.link && (
            result.link.includes('genius.com') ||
            result.link.includes('azlyrics.com') ||
            result.link.includes('lyrics.com') ||
            result.link.includes('metrolyrics.com')
          )
        )
        .slice(0, 3); // Try first 3 results
      
      for (const result of lyricsUrls) {
        try {
          console.log(`Trying to fetch from: ${result.link}`);
          lyricsContent = await fetchLyricsFromUrl(result.link);
          if (lyricsContent && lyricsContent.length > 100) {
            console.log('Successfully fetched lyrics from URL');
            break;
          }
        } catch (error) {
          console.log(`Failed to fetch from ${result.link}: ${error.message}`);
          continue;
        }
      }
    }
    
    // Check answer box or featured snippet
    if (!lyricsContent && data.answer_box) {
      if (data.answer_box.snippet) {
        lyricsContent = data.answer_box.snippet;
        console.log('Found lyrics in answer box');
      }
    }
    
    return lyricsContent;
  } catch (error) {
    console.error('SerpAPI lyrics fetch error:', error.message);
    return null;
  }
}

// Helper function to fetch lyrics from a specific URL
async function fetchLyricsFromUrl(url) {
  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
      }
    });
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    
    const html = await response.text();
    
    // Simple text extraction - look for common patterns
    let lyrics = '';
    
    if (url.includes('genius.com')) {
      // Extract text between common genius patterns
      const lyricsMatch = html.match(/<div[^>]*data-lyrics-container[^>]*>([\s\S]*?)<\/div>/gi);
      if (lyricsMatch) {
        lyrics = lyricsMatch.map(match => 
          match.replace(/<[^>]*>/g, '').trim()
        ).join('\n');
      }
    } else if (url.includes('azlyrics.com')) {
      // Extract from azlyrics pattern
      const lyricsMatch = html.match(/<!-- Usage of azlyrics\.com content[\s\S]*?-->([\s\S]*?)<!-- MxM banner -->/);
      if (lyricsMatch) {
        lyrics = lyricsMatch[1].replace(/<[^>]*>/g, '').trim();
      }
    } else {
      // Generic extraction - look for large text blocks
      const textBlocks = html.match(/<div[^>]*>([\s\S]*?)<\/div>/gi);
      if (textBlocks) {
        const candidates = textBlocks
          .map(block => block.replace(/<[^>]*>/g, '').trim())
          .filter(text => text.length > 200 && text.includes('\n'))
          .sort((a, b) => b.length - a.length);
        
        if (candidates.length > 0) {
          lyrics = candidates[0];
        }
      }
    }
    
    return lyrics && lyrics.length > 50 ? lyrics : null;
  } catch (error) {
    console.error(`Error fetching from ${url}:`, error.message);
    return null;
  }
}

// Step 2: Format lyrics using AI
async function formatLyricsWithAI(rawLyrics, artist, song) {
  try {
    console.log('Formatting lyrics with AI...');
    
    const formatPrompt = `請將以下原始歌詞內容進行格式化和清理：

原始內容：
${rawLyrics}

歌曲資訊：
- 歌手：${artist}
- 歌名：${song}

請執行以下處理：
1. 移除不相關的網站資訊、廣告文字、版權聲明
2. 保留完整的歌詞內容
3. 整理段落結構，保持適當的換行
4. 移除重複的標記如 [Verse], [Chorus] 等
5. 確保歌詞的完整性和可讀性

請只回傳清理後的歌詞內容，不要其他說明文字。`;

    const formatResult = await llm.invoke([{ role: 'user', content: formatPrompt }]);
    const formattedLyrics = formatResult.content.trim();
    
    console.log('Lyrics formatted successfully');
    return formattedLyrics;
  } catch (error) {
    console.error('AI formatting error:', error.message);
    return rawLyrics; // Return original if formatting fails
  }
}

// Step 3: Generate story using AI
async function generateStoryWithAI(lyrics, artist, song, customStory = null) {
  try {
    console.log('Generating story with AI...');
    
    // First, analyze the lyrics to extract theme and tone
    const analysisPrompt = `請分析以下歌詞的主題和情感基調：

歌詞：
${lyrics.substring(0, 1500)}

歌曲：${artist} - ${song}

請以JSON格式回應，包含：
{
  "story_theme": "歌詞的主要主題（如愛情、友情、成長、思鄉等）",
  "tone": "情感基調（如溫暖懷舊、激勵向上、憂鬱深沉、輕快愉悅等）",
  "key_emotions": "主要情感元素",
  "setting_suggestion": "建議的故事背景設定"
}

只回傳JSON，無其他文字。`;

    const analysisResult = await llm.invoke([{ role: 'user', content: analysisPrompt }]);
    
    let themeData;
    try {
      const jsonMatch = analysisResult.content.match(/\{[\s\S]*\}/);
      themeData = JSON.parse(jsonMatch ? jsonMatch[0] : analysisResult.content);
    } catch (error) {
      console.log('JSON parsing failed, using default theme');
      themeData = {
        story_theme: "人生感悟",
        tone: "溫暖感人",
        key_emotions: "深刻回憶",
        setting_suggestion: "日常生活場景"
      };
    }
    
    console.log('Theme analysis completed:', themeData);
    
    // Generate the story
    let storyPrompt = `請根據以下條件創作一篇感人的第一人稱短篇故事：

**歌曲靈感來源：**
- 歌手：${artist}
- 歌名：${song}
- 主題：${themeData.story_theme}
- 情感基調：${themeData.tone}
- 關鍵情感：${themeData.key_emotions}
- 建議背景：${themeData.setting_suggestion}

**故事要求：**
- 長度約400-600字
- 情節完整，有起承轉合
- 情感真摯，引人共鳴
- 自然融入歌曲的精神內核`;

    if (customStory) {
      storyPrompt += `\n- 必須包含使用者指定元素：${customStory}`;
    }

    storyPrompt += `\n\n請創作一個能夠觸動人心的故事，讓讀者感受到這首歌想要傳達的情感。`;

    const storyResult = await llm.invoke([{ role: 'user', content: storyPrompt }]);
    
    console.log('Story generation completed');
    
    return {
      story: storyResult.content,
      theme: themeData.story_theme,
      tone: themeData.tone,
      key_emotions: themeData.key_emotions,
      artist: artist,
      song: song,
      lyrics_preview: lyrics.substring(0, 200) + '...'
    };
    
  } catch (error) {
    console.error('Story generation error:', error.message);
    throw error;
  }
}

// Main story generation tool
const storyTool = new DynamicTool({
  name: 'story_generation',
  description: '使用SerpAPI獲取歌詞，AI格式化，然後生成故事',
  func: async (input) => {
    try {
      console.log('Starting story generation process...');
      
      // Parse input
      const parts = input.split(/[-–—]/).map((s) => s.trim());
      const artist = parts[0];
      const song = parts[1];
      const customStory = parts.length > 2 ? parts.slice(2).join(' ') : null;
      
      if (!artist || !song) {
        return { error: '輸入格式錯誤，請提供「藝術家 - 歌曲」格式' };
      }

      console.log(`Processing: ${artist} - ${song}`);
      if (customStory) {
        console.log(`Custom elements: ${customStory}`);
      }

      // Step 1: Fetch lyrics using SerpAPI
      const rawLyrics = await fetchLyricsWithSerpAPI(artist, song);
      if (!rawLyrics || rawLyrics.length < 50) {
        return { 
          error: `無法通過SerpAPI獲取《${song}》的歌詞，請檢查歌曲名稱或稍後再試`,
          suggestion: '請確認歌手和歌曲名稱的正確性'
        };
      }

      console.log(`Raw lyrics fetched (${rawLyrics.length} chars)`);

      // Step 2: Format lyrics using AI
      const formattedLyrics = await formatLyricsWithAI(rawLyrics, artist, song);
      console.log('Lyrics formatted by AI');

      // Step 3: Generate story using AI
      const storyData = await generateStoryWithAI(formattedLyrics, artist, song, customStory);
      
      return {
        success: true,
        ...storyData,
        process_info: {
          step1: 'SerpAPI歌詞獲取 ✓',
          step2: 'AI歌詞格式化 ✓', 
          step3: 'AI故事生成 ✓'
        }
      };

    } catch (error) {
      console.error('Story tool error:', error.message);
      return { 
        error: `處理過程發生錯誤: ${error.message}`,
        step_failed: '請檢查API配置和網路連接'
      };
    }
  },
});

const tools = [storyTool];

// POST API Handler
export async function POST(req) {
  try {
    const { artist, song, customStory } = await req.json();
    
    if (!artist || !song) {
      return new Response(
        JSON.stringify({ 
          success: false,
          error: '必須提供 artist 和 song 參數' 
        }),
        { 
          status: 400,
          headers: { 'Content-Type': 'application/json' }
        }
      );
    }

    console.log(`\n=== Story Generation Request ===`);
    console.log(`Artist: ${artist}`);
    console.log(`Song: ${song}`);
    if (customStory) console.log(`Custom Story: ${customStory}`);
    console.log(`================================\n`);

    const modelWithTools = llm.bindTools(tools);
    
    const prompt = customStory 
      ? `請使用工具為${artist}的歌曲《${song}》生成一個故事，並包含以下元素：${customStory}`
      : `請使用工具為${artist}的歌曲《${song}》生成一個故事`;

    const result = await modelWithTools.invoke([{
      role: 'user',
      content: prompt,
    }]);

    // Handle tool call results
    if (result.tool_calls?.length) {
      const toolCall = result.tool_calls[0];
      if (toolCall.name === 'story_generation') {
        const input = customStory
          ? `${artist} - ${song} - ${customStory}`
          : `${artist} - ${song}`;
        
        const storyData = await storyTool.func(input);
        
        return new Response(JSON.stringify(storyData), { 
          status: storyData.success ? 200 : 400,
          headers: { 'Content-Type': 'application/json' }
        });
      }
    }

    // Fallback response
    return new Response(JSON.stringify({
      success: true,
      story: result.content
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });

  } catch (error) {
    console.error('API Error:', error.message);
    return new Response(
      JSON.stringify({ 
        success: false,
        error: `API錯誤: ${error.message}`,
        timestamp: new Date().toISOString()
      }),
      { 
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      }
    );
  }
}
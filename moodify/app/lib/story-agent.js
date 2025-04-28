require('dotenv').config();
import axios from 'axios';
import { JSDOM } from 'jsdom';
import { ChatMistralAI } from '@langchain/mistralai';
import { ChatPromptTemplate } from '@langchain/core/prompts';

// 環境變數驗證
const mistralApiKey = process.env.MISTRAL_API_KEY;
if (!mistralApiKey) {
  throw new Error('MISTRAL_API_KEY is missing. Please set it in your .env file.');
}

// 初始化 LLM
const llm = new ChatMistralAI({
  model: 'mistral-large-latest',
  apiKey: mistralApiKey,
  temperature: 0.8,
  maxRetries: 2,
});

// 爬取 KKBOX 歌曲 URL
export async function kkbox(artist, song) {
  try {
    const query = encodeURIComponent(`${artist} ${song}`);
    const url = `https://www.kkbox.com/api/search/song?q=${query}&terr=tw&lang=tc`;
    const headers = { 'User-Agent': 'Mozilla/5.0' };

    const response = await axios.get(url, { headers });
    if (response.status !== 200 || !response.data?.data?.result?.length) {
      return null; // 返回 null 表示未找到
    }

    return response.data.data.result[0].url;
  } catch (error) {
    console.error('KKBOX API error:', error.message);
    return null;
  }
}

// 爬取歌詞（假設從 KKBOX 頁面解析，需確認是否可行）
export async function getLyrics(url) {
  if (!url) return '無效的歌曲 URL';

  try {
    const headers = { 'User-Agent': 'Mozilla/5.0' };
    const response = await axios.get(url, { headers });
    const dom = new JSDOM(response.data);
    const document = dom.window.document;

    // 假設 KKBOX 頁面有歌詞區塊（需根據實際頁面結構調整）
    const lyricsDiv = document.querySelector('.lyrics'); // 需確認選擇器
    if (!lyricsDiv) return '找不到歌詞區塊';
    if (lyricsDiv) {
        const paragraphs = lyricsDiv.querySelectorAll('p');
        const lyrics = Array.from(paragraphs).map(p => p.textContent.trim());
    } else {
        console.log("未找到歌詞區塊");
    }
    const lyrics = lyricsDiv.textContent.trim();
    return lyrics || '歌詞內容為空';
  } catch (error) {
    console.error('Lyrics scraping error:', error.message);
    return '無法獲取歌詞';
  }
}

// 提取 JSON 數據
export function extractJson(text) {
  try {
    const match = text.match(/{[\s\S]*}/);
    if (!match) throw new Error('No valid JSON found');
    return JSON.parse(match[0]);
  } catch (error) {
    console.error('JSON extraction error:', error.message);
    throw new Error('Failed to parse JSON response');
  }
}

// StoryTool 類
export class StoryTool {
  name = 'story';
  description = '根據指定的藝術家和歌曲，產生一段故事';

  schema = {
    type: 'object',
    properties: {
      artist: { type: 'string', description: '藝術家或樂團名稱' },
      song: { type: 'string', description: '歌曲名稱' },
    },
    required: ['artist', 'song'],
  };

  async _call({ artist, song }) {
    try {
      // 爬取歌詞
      const url = await kkbox(artist, song);
      if (!url) return '找不到歌曲資訊';

      const lyrics = await getLyrics(url);
      if (!lyrics || lyrics.includes('找不到') || lyrics.includes('無法')) {
        return '無法獲取歌詞，請試試其他歌曲';
      }

      // 生成故事主題
      const userPrompt = `請根據歌詞的介紹 ${lyrics}，來設定與歌詞有關的故事主題，以及這則故事的語調。你的回應必須是 **標準 JSON 格式**，無多餘內容。例如：周杰倫的歌曲《稻香》講述了珍惜生活和回歸簡單的美好。輸出: {"story_theme": "珍惜生活和回歸簡單的美好", "tone": "溫暖且懷舊，觸景生情"}`;

      const storyBg = await llm.invoke([{ role: 'user', content: userPrompt }]);
      const data = extractJson(storyBg.content);
      const { story_theme, tone } = data;

      // 生成故事
      const prompt = ChatPromptTemplate.fromTemplate(
        `請根據以下條件撰寫一篇個人視角的短篇故事腳本，主題為「${story_theme}」。用${tone}的語調來設計這篇故事。`
      );
      const chain = prompt.pipe(llm);
      const story = await chain.invoke({});

      return story.content;
    } catch (error) {
      console.error('Story generation error:', error.message);
      return `生成故事時發生錯誤: ${error.message}`;
    }
  }
}
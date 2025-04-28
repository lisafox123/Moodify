import { ChatMistralAI } from '@langchain/mistralai';
import { DynamicTool } from '@langchain/core/tools';
import { ChatPromptTemplate } from '@langchain/core/prompts';
import { kkbox, getLyrics, extractJson } from '../../lib/story-agent';

// 環境變數
const mistralApiKey = process.env.MISTRAL_API_KEY;
if (!mistralApiKey) {
  throw new Error('MISTRAL_API_KEY is missing');
}

const llm = new ChatMistralAI({
  model: 'mistral-large-latest',
  apiKey: mistralApiKey,
  temperature: 0.8,
  maxRetries: 2,
});

// DynamicTool
const storyTool = new DynamicTool({
  name: 'story_generation',
  description: '根據歌手和歌曲生成一個故事',
  func: async (input) => {
    try {
      // 解析輸入（支援更多格式）
      const [artist, ...songParts] = input.split(/[-–—]/).map((s) => s.trim());
      const song = songParts.join(' ');
      if (!artist || !song) {
        return '輸入格式錯誤，請提供「藝術家 - 歌曲」格式';
      }

      // 爬取歌詞
      const url = await kkbox(artist, song);
      console.log(url);

      const lyrics = await getLyrics(url);
      console.log(lyrics);
      if (!lyrics || lyrics.includes('找不到') || lyrics.includes('無法')) {
        return '無法獲取歌詞，請試試其他歌曲';
      }

      // 生成故事主題
      const userPrompt = `請根據歌詞 ${lyrics}，來設定與歌詞有關的故事主題，以及這則故事的語調。你的回應必須是 **標準 JSON 格式**，無多餘內容。例如：周杰倫的歌曲《稻香》講述了珍惜生活和回歸簡單的美好。輸出: {"story_theme": "珍惜生活和回歸簡單的美好", "tone": "溫暖且懷舊，觸景生情"}`;

      const storyBg = await llm.invoke([{ role: 'user', content: userPrompt }]);
      const data = extractJson(storyBg.content);
      const { story_theme, tone } = data;

      // 生成故事
      const prompt = ChatPromptTemplate.fromTemplate(
        `請根據以下條件撰寫一篇個人視角的短篇故事，主題為「${story_theme}」。用${tone}的語調來設計這篇故事。`
      );
      const story = await prompt.pipe(llm).invoke({});
      console.log(story)
      return story.content;
    } catch (error) {
      console.error('Story generation error:', error.message);
      return `生成故事時發生錯誤: ${error.message}`;
    }
  },
});

const tools = [storyTool];

// POST 請求
export async function POST(req) {
  try {
    const { artist, song } = await req.json();
    if (!artist || !song) {
      return new Response(
        JSON.stringify({ error: '必須提供 artist 和 song 參數' }),
        { status: 400 }
      );
    }

    const modelWithTools = llm.bindTools(tools);
    const result = await modelWithTools.invoke([
      {
        role: 'user',
        content: `幫我用${artist} - ${song}寫一個故事`,
      },
    ]);
    console.log(result)
    // 檢查是否為工具調用結果
    if (result.tool_calls?.length) {
      const toolCall = result.tool_calls[0];
      if (toolCall.name === 'story_generation') {
        const story = await storyTool.func(`${artist} - ${song}`);
        return new Response(JSON.stringify({ story }), { status: 200 });
      }
    }

    return new Response(JSON.stringify({ story: result.content }), {
      status: 200,
    });
  } catch (error) {
    console.error('API error:', error.message);
    return new Response(
      JSON.stringify({ error: `內部伺服器錯誤: ${error.message}` }),
      { status: 500 }
    );
  }
}
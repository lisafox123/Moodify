import OpenAI from "openai";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

export async function analyzeMood(prompt) {
  try {
    console.log("Analyzing mood for prompt:", prompt);
    
    const response = await openai.chat.completions.create({
      model: "gpt-3.5-turbo",
      messages: [
        {
          role: "system",
          content: `You are a music expert who can analyze mood descriptions. Output ONLY a simple JSON with one property "mood" which should be a single word like: energetic, calm, melancholy, upbeat, sad, happy, focused, relaxed, party, romantic, balanced, etc.`
        },
        {
          role: "user",
          content: `What mood best describes this: "${prompt}"`
        }
      ],
      temperature: 0.7,
      max_tokens: 50
    });

    const content = response.choices[0]?.message?.content || "";
    
    // Try to extract JSON
    try {
      const result = JSON.parse(content);
      return result.mood || "balanced";
    } catch (parseError) {
      // If we can't parse JSON, look for a single word
      const moodMatch = content.match(/["']?(\w+)["']?/);
      return moodMatch ? moodMatch[1] : "balanced";
    }
  } catch (error) {
    console.error('Error analyzing mood:', error);
    return "balanced";
  }
}
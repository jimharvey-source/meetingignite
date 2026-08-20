// The tools send { messages }. Everything model-specific lives in lib/llm.js.
// The reply keeps the OpenAI envelope on purpose: see asChatCompletion there.
import { complete, asChatCompletion } from '../lib/llm.js';

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end();

  const { messages, fast } = req.body || {};
  const result = await complete({ messages, maxTokens: 4000, fast: Boolean(fast) });

  if (!result.ok) return res.status(result.status).json({ error: result.error });
  return res.status(200).json(asChatCompletion(result.text));
}

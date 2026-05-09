import OpenAI from 'openai'
import type {
  ChatCompletionCreateParamsNonStreaming,
  ChatCompletionMessageParam,
} from 'openai/resources/chat/completions'

const client = new OpenAI({
  apiKey: process.env.PIPESHIFT_API_KEY,
  baseURL: 'https://api.pipeshift.com/api/v0',
})

export const CHEAP_MODEL = 'meta-llama/Llama-3.2-3B-Instruct'
export const HEAVY_MODEL = process.env.PIPESHIFT_MODEL ?? 'moonshotai/Kimi-K2.6'
export const LONG_CONTEXT_MODEL = process.env.PIPESHIFT_LONG_CONTEXT_MODEL ?? 'MiniMaxAI/MiniMax-M2'

interface ChatArgs {
  messages: ChatCompletionMessageParam[]
  model?: string
  temperature?: number
  jsonMode?: boolean
  maxTokens?: number
}

export async function chat({
  messages,
  model = CHEAP_MODEL,
  temperature = 0,
  jsonMode = false,
  maxTokens,
}: ChatArgs): Promise<string> {
  const params: ChatCompletionCreateParamsNonStreaming = {
    model,
    messages,
    temperature,
  }
  if (jsonMode) params.response_format = { type: 'json_object' }
  if (maxTokens !== undefined) params.max_tokens = maxTokens

  const completion = await client.chat.completions.create(params)
  const choice = completion.choices[0]
  const content = choice?.message?.content ?? ''
  if (!content) {
    console.warn('[pipeshift] empty content returned', {
      model,
      jsonMode,
      finishReason: choice?.finish_reason,
      usage: completion.usage,
      refusal: choice?.message?.refusal,
    })
  }
  return content
}

export const pipeshift = {
  chat,
  configured: Boolean(process.env.PIPESHIFT_API_KEY),
}

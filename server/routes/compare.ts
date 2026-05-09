import { Router, type Request, type Response } from 'express'

const router = Router()

router.post('/', (req: Request, res: Response) => {
  const { text } = req.body ?? {}
  if (typeof text !== 'string' || !text.trim()) {
    return res.status(400).json({ error: 'text is required' })
  }

  // TODO: replace with a real Pipeshift-backed NLP parse step.
  // For now, return a hardcoded mock so the UI flow is exercisable.
  return res.json({
    optionA: 'Option A',
    optionB: 'Option B',
    domain: 'general',
  })
})

export default router

/**
 * AI recognition of floor-plan drawings with Claude (vision + structured output).
 * Runs in the browser with the user's own API key; loaded on demand.
 */
import Anthropic from '@anthropic-ai/sdk'
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod'
import { z } from 'zod'
import type { ImportResult } from './convert'

const PointSchema = z.object({ x: z.number(), y: z.number() })

const PlanSchema = z.object({
  scale_source: z.enum(['labels', 'estimated']),
  rooms: z.array(
    z.object({
      name: z.string(),
      corners: z.array(PointSchema),
    }),
  ),
  openings: z.array(
    z.object({
      kind: z.enum(['door', 'window', 'opening']),
      from: PointSchema,
      to: PointSchema,
    }),
  ),
})

const PROMPT = `This image is a floor plan drawing: a hand sketch, a photo of paper, or a printed plan. Convert it into geometry for a floor-plan editor.

Coordinates are in meters. The origin is the top-left corner of the whole plan, x grows to the right and y grows downward, in the orientation where the drawing's text reads normally.

Rooms: one entry per enclosed room or space, including hallways, closets and bathrooms. "corners" is the room's interior outline, in order around the room. Walls are straight; keep them exactly horizontal or vertical wherever the drawing intends right angles. Where two rooms share a wall, give their facing edges the same coordinate — the editor adds wall thickness itself. Name each room from its label in the drawing; if a room has no label, name it from its fixtures or use "Room" with a number.

Sizes: when dimensions are written on the drawing (for example "4 x 3.5", "350", or 12'6"), use them even if the sketch is not drawn to scale, converting feet and inches to meters. Where a size isn't written, estimate it from rooms that do have dimensions, or from typical sizes when nothing is labeled (an interior door is about 0.8-0.9 m wide). Set scale_source to "labels" if you relied on written dimensions, otherwise "estimated".

Openings: list every door, window and doorless opening as the segment it covers along a wall, with "from" and "to" in the same coordinates as the rooms. A door is usually drawn as a gap with a swing arc or a leaf line; a window as a thin rectangle or parallel lines within an outer wall; a plain gap between two rooms is an opening.`

export interface AiOutcome {
  result: ImportResult
  scaleSource: 'labels' | 'estimated'
  model: string
}

/** Send the drawing to Claude and get rooms (cm) and openings back. */
export async function recognizePlan(
  apiKey: string,
  image: { data: string; mediaType: 'image/jpeg' | 'image/png' },
  signal?: AbortSignal,
): Promise<AiOutcome> {
  // The key is the user's own and never leaves their browser except to call the API.
  const client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true })
  try {
    const response = await client.beta.messages.parse(
      {
        model: 'claude-opus-5',
        max_tokens: 16000,
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
        output_config: { format: betaZodOutputFormat(PlanSchema) },
        messages: [
          {
            role: 'user',
            content: [
              { type: 'image', source: { type: 'base64', media_type: image.mediaType, data: image.data } },
              { type: 'text', text: PROMPT },
            ],
          },
        ],
      },
      { signal },
    )
    if (response.stop_reason === 'refusal') {
      throw new Error('The model declined to process this image. Try a different drawing.')
    }
    if (response.stop_reason === 'max_tokens') {
      throw new Error('The drawing was too complex to convert in one go. Try cropping it to one floor.')
    }
    const plan = response.parsed_output
    if (!plan) throw new Error('Could not read a floor plan from the response. Please try again.')

    const cm = (p: { x: number; y: number }) => ({ x: p.x * 100, y: p.y * 100 })
    return {
      result: {
        rooms: plan.rooms
          .filter((r) => r.corners.length >= 3)
          .map((r) => ({ name: r.name.trim(), points: r.corners.map(cm) })),
        openings: plan.openings.map((o) => ({ kind: o.kind, a: cm(o.from), b: cm(o.to) })),
      },
      scaleSource: plan.scale_source,
      model: response.model,
    }
  } catch (error) {
    if (error instanceof Anthropic.AuthenticationError) throw new Error('That API key was rejected. Check it and try again.')
    if (error instanceof Anthropic.PermissionDeniedError) throw new Error('This API key is not allowed to use the model.')
    if (error instanceof Anthropic.RateLimitError) throw new Error('Rate limit reached. Wait a moment and try again.')
    if (error instanceof Anthropic.APIUserAbortError) throw new Error('Cancelled.')
    if (error instanceof Anthropic.APIConnectionError) throw new Error('Could not reach the Anthropic API. Check your connection.')
    if (error instanceof Anthropic.APIError) throw new Error(`The API returned an error (${error.status}): ${error.message}`)
    throw error
  }
}

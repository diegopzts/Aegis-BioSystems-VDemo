import { z } from 'zod'

export const situationIds = ['panic_bio_sync', 'o2_leak_zero_ui', 'extreme_isolation', 'mars_murphy', 'nominal'] as const
export type SituationId = typeof situationIds[number]
export const orbitalSchema = z.object({
  distance_million_km: z.number().positive(), one_way_seconds: z.number().int().positive(),
  one_way_label: z.string(), link_status: z.enum(['normal', 'warning']), link_label: z.string(),
  autonomous_override: z.boolean(), synthetic: z.literal(true),
})
export type OrbitalTelemetry = z.infer<typeof orbitalSchema>
export const simulationSchema = z.object({
  scenario_id: z.enum(situationIds), scenario_name: z.string(),
  active_mode: z.enum(['standard', 'breathing_sync', 'zero_ui', 'ground_anchor']),
  started_at: z.string(), event_id: z.string(), version: z.number().int().nonnegative(),
  mission_day: z.number().nullable(), heart_rate_bpm: z.number().nullable(),
  stress_proxy: z.number().nullable(), communication_delay_minutes: z.number().nullable(),
  emotional_fatigue_demo: z.boolean(), pending_live: z.boolean(), breathing_guide: z.boolean(),
  habitat: z.object({
    oxygen_percent: z.number(), co2_ppm: z.number(), pressure_kpa: z.number(),
    reserve_minutes_demo: z.number(), sealed_sectors: z.array(z.enum(['A','B','C'])),
    oxygen_reserve: z.enum(['off','low','high']), lighting_percent: z.number(), dust_storm: z.boolean(),
  }),
  ambience: z.enum(["silent", "soft_wind", "warm_rain", "dust_wind"]),
  orbital: orbitalSchema.optional(),
  narrative: z.string().nullable().optional(),
  actions: z.array(z.string()),
})
export type Simulation = z.infer<typeof simulationSchema>
export type InputGraph = {context: AudioContext; input: MediaStreamAudioSourceNode}


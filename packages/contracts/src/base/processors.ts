import { z } from 'zod';

import { uuidV7Schema } from './ids.js';
import { tenantProjectScopeSchema } from './scope.js';

const isoTimestampSchema = z.string().datetime({ offset: true });
const nonBlankTextSchema = z
  .string()
  .min(1)
  .refine((value) => value.trim().length > 0, 'Expected non-blank text');
const optionalNonBlankTextSchema = nonBlankTextSchema.optional();
const labelKeySchema = z
  .string()
  .regex(/^[a-zA-Z0-9][a-zA-Z0-9_.:/-]{0,62}$/u, 'Expected a non-empty label key');
const labelValueSchema = z.string().max(256);
const metadataSchema = z.record(z.string(), z.unknown());

export const processorHardwareSchema = z
  .object({
    gpu: z.boolean(),
    gpuModel: optionalNonBlankTextSchema,
    gpuCount: z.number().int().nonnegative().optional(),
    memoryMb: z.number().int().positive(),
    cpuCores: z.number().int().positive().optional(),
    architecture: optionalNonBlankTextSchema,
  })
  .strict()
  .refine((hardware) => hardware.gpu || (hardware.gpuModel === undefined && hardware.gpuCount === undefined), {
    message: 'GPU model/count require gpu=true',
    path: ['gpu'],
  });

export const processorCapabilitySchema = z
  .object({
    name: nonBlankTextSchema,
    version: nonBlankTextSchema,
  })
  .strict();

export const processorLabelsSchema = z.record(labelKeySchema, labelValueSchema);
export const processorTagsSchema = z.array(nonBlankTextSchema).max(64);

export const routingExplanationSchema = z
  .object({
    eligible: z.boolean(),
    reasons: z.array(nonBlankTextSchema),
    matchedCapabilities: z.array(nonBlankTextSchema),
    rejectedConstraints: z.array(nonBlankTextSchema),
    metadata: metadataSchema,
  })
  .strict();

export const processorRegistryRecordSchema = tenantProjectScopeSchema
  .extend({
    id: uuidV7Schema,
    agentId: uuidV7Schema,
    capabilities: z.array(processorCapabilitySchema).min(1),
    hardware: processorHardwareSchema,
    region: nonBlankTextSchema,
    labels: processorLabelsSchema,
    tags: processorTagsSchema,
    routingExplanation: routingExplanationSchema,
    createdAt: isoTimestampSchema,
    updatedAt: isoTimestampSchema,
  })
  .strict();

export const processorRegistryResponseSchema = z
  .object({
    processor: processorRegistryRecordSchema,
  })
  .strict();

export const processorRegistryListResponseSchema = z
  .object({
    processors: z.array(processorRegistryRecordSchema),
  })
  .strict();

export type ProcessorHardware = z.infer<typeof processorHardwareSchema>;
export type ProcessorCapability = z.infer<typeof processorCapabilitySchema>;
export type ProcessorLabels = z.infer<typeof processorLabelsSchema>;
export type ProcessorTags = z.infer<typeof processorTagsSchema>;
export type RoutingExplanation = z.infer<typeof routingExplanationSchema>;
export type ProcessorRegistryRecord = z.infer<typeof processorRegistryRecordSchema>;
export type ProcessorRegistryResponse = z.infer<typeof processorRegistryResponseSchema>;
export type ProcessorRegistryListResponse = z.infer<typeof processorRegistryListResponseSchema>;

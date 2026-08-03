import { z } from 'zod';

/** Validated public request contract for `POST /screenshots`. */
export const screenshotRequestSchema = z
    .object({
        url: z
            .string()
            .url()
            .refine((value) => {
                const parsed = new URL(value);
                return (
                    parsed.protocol === 'http:' || parsed.protocol === 'https:'
                );
            }, 'URL must use http or https.'),
        waitForMs: z.number().int().nonnegative().optional(),
        resizeWaitMs: z.number().int().nonnegative().optional(),
        includeMobile: z.boolean().optional(),
    })
    .strict();

/** Validated screenshot request payload. */
export type ScreenshotRequest = z.infer<typeof screenshotRequestSchema>;

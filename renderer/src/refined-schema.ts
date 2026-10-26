import {z} from 'zod';
const shot=z.object({id:z.string().min(1),seconds:z.number().min(1).max(10),source:z.string().min(1),trimBefore:z.number().nonnegative(),sourceDuration:z.number().positive(),kicker:z.string().max(60),headline:z.string().min(1).max(48),caption:z.string().max(80),captionFrom:z.number().nonnegative().optional(),captionTo:z.number().positive().optional(),position:z.string(),zoom:z.number().min(1).max(2),shiftX:z.number(),shiftY:z.number()}).refine(s=>s.trimBefore+s.seconds<=s.sourceDuration,{message:'Source range exceeds clip duration'});
export const refinedSchema=z.object({format:z.literal('9:16'),productName:z.string(),mix:z.string().min(1),demo:z.boolean(),shots:z.array(shot).length(5)});
export type RefinedProps=z.infer<typeof refinedSchema>;

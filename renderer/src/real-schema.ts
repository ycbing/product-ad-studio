import {z} from 'zod';
export const realShotSchema=z.object({id:z.string().min(1),seconds:z.number().min(1).max(10),source:z.string().min(1),trimBefore:z.number().nonnegative(),sourceDuration:z.number().positive(),kicker:z.string().max(60),headline:z.string().min(1).max(48),caption:z.string().min(1).max(80),position:z.string()}).refine(s=>s.trimBefore+s.seconds<=s.sourceDuration,{message:'Source clip is shorter than requested range'});
export const filmSchema=z.object({format:z.literal('9:16'),productName:z.string().min(1).max(30),voice:z.string().nullable(),music:z.string().nullable(),demo:z.boolean(),shots:z.array(realShotSchema).length(5)});
export type FilmProps=z.infer<typeof filmSchema>;

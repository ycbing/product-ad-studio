import {z} from 'zod';
export const shotSchema = z.object({id:z.string().min(1),seconds:z.number().min(1).max(10),eyebrow:z.string().max(60),headline:z.string().min(1).max(48),caption:z.string().min(1).max(80),layout:z.enum(['problem','organize','hero','benefits','cta'])});
export const adSchema = z.object({format:z.literal('9:16'),productName:z.string().min(1).max(30),brand:z.string().max(60),asset:z.string().min(1),demo:z.boolean(),voice:z.string().nullable(),shots:z.array(shotSchema).length(5)});
export type AdProps = z.infer<typeof adSchema>;
